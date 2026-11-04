import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import { randomBytes, createHmac, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { AppError, unavailable } from './errors.js';
import { extractImage, extractUrl } from './extract.js';
import { parsePublicUrl } from './safe-url.js';
import { analyze } from './analyze.js';
import { servicesConfigured } from './gemini-tavily.js';
import { saveLocalSecrets } from './local-secrets.js';
import { parseLocalSettings } from './local-settings.js';
import { createReferenceExtractor } from './extract-fallback.js';

export function createApp({ config, repo, providers, runAnalysis = analyze, imageExtractor = extractImage, urlExtractor = extractUrl }) {
  const app = express(); const active = new Set(); let preparing = 0;
  app.disable('x-powered-by');
  // Confie em proxy apenas em topologia conhecida; padrão não confia em X-Forwarded-For.
  app.use(helmet({ referrerPolicy: { policy: 'no-referrer' }, contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'blob:', 'data:'], connectSrc: ["'self'"], objectSrc: ["'none'"], baseUri: ["'none'"], frameAncestors: ["'none'"], formAction: ["'self'"], upgradeInsecureRequests: config.production ? [] : null } } }));
  if (!config.production) app.use((_req,res,next) => { res.removeHeader('Strict-Transport-Security'); next(); });
  app.use('/api', rateLimit({ windowMs: 15*60*1000, limit: 180, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Muitas requisições. Aguarde alguns minutos.' } }));
  app.use(cookieParser(config.secret));
  app.use('/api', (req,res,next) => {
    res.set('Cache-Control', 'no-store');
    let session = req.signedCookies.vn_session;
    if (typeof session !== 'string' || !/^[a-f0-9]{64}$/.test(session)) {
      session = randomBytes(32).toString('hex');
      res.cookie('vn_session', session, { signed: true, httpOnly: true, secure: config.production, sameSite: 'strict', maxAge: config.retentionDays*86400000, path: '/' });
    }
    req.owner = createHmac('sha256',config.secret).update(session).digest('hex');
    const client=req.get('x-local-client');
    if(config.localSetup&&typeof client==='string'&&/^[a-f0-9]{64}$/.test(client))req.owner=createHmac('sha256',config.secret).update(`client:${client}`).digest('hex');
    req.csrf = createHmac('sha256',config.secret).update(`csrf:${session}`).digest('hex');
    if (!['GET','HEAD','OPTIONS'].includes(req.method) && (req.get('origin') !== config.origin || req.get('x-csrf-token') !== req.csrf)) return next(new AppError(403,'Origem ou sessão inválida. Atualize a página.'));
    next();
  });
  app.use(express.json({ limit: '96kb' }));
  const expensive = rateLimit({ windowMs: 15*60*1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Limite de 10 envios por 15 minutos atingido. Aguarde para continuar.' } });
  app.get('/api/status', async (req,res) => res.json({ csrfToken: req.csrf, database: await repo.ready(), ...servicesConfigured(config), retentionDays: config.retentionDays, localSetup: Boolean(config.localSetup), storage: config.storage, provider: config.provider, model:config.geminiModel }));
  app.post('/api/local-settings', expensive, async (req,res) => {
    if(!config.localSetup||config.production||config.provider!=='gemini-tavily'||!['127.0.0.1','::ffff:127.0.0.1','::1'].includes(req.socket.remoteAddress))throw new AppError(404,'Configuração local indisponível.');
    if(active.size||preparing)throw new AppError(409,'Aguarde as análises terminarem antes de alterar as chaves.');
    const settings=parseLocalSettings(req.body);
    if(settings.persist)await saveLocalSecrets(fileURLToPath(new URL('../.env',import.meta.url)),settings);
    config.geminiKey=settings.geminiKey;config.tavilyKey=settings.tavilyKey;config.geminiModel=settings.model;
    res.json({saved:true,message:settings.persist?'Chaves salvas na configuração local. Serão carregadas automaticamente na próxima abertura.':'Chaves recebidas somente na memória do servidor local. A primeira verificação validará o acesso às APIs.'});
  });
  app.post('/api/diagnostics',expensive,async(_req,res)=>{
    if(!config.localSetup)throw new AppError(404,'Diagnóstico disponível apenas no modo local.');
    const checks=[];
    try{const result=await providers.model({type:'object',additionalProperties:false,properties:{ok:{type:'boolean'}},required:['ok']},'Teste de conexão. Responda apenas ok=true.',{test:true});if(result?.ok!==true)throw new AppError(502,'A IA respondeu em formato inesperado.');checks.push({service:'Gemini',ok:true,message:'IA respondeu a uma solicitação real.'});}catch(error){checks.push({service:'Gemini',ok:false,message:error instanceof AppError?error.message:'Não foi possível testar a IA.'});}
    try{await providers.search('Brasil notícias fontes de informação');checks.push({service:'Tavily',ok:true,message:'Pesquisa respondeu a uma solicitação real.'});}catch(error){checks.push({service:'Tavily',ok:false,message:error instanceof AppError?error.message:'Não foi possível testar a pesquisa.'});}
    res.json({ok:checks.every(c=>c.ok),checks});
  });
  app.post('/api/ocr', expensive, multer({ storage: multer.memoryStorage(), limits: { fileSize: 5*1024*1024, files: 1, fields: 0 }, fileFilter: (_req,file,cb) => cb(null,['image/jpeg','image/png','image/webp'].includes(file.mimetype)) }).single('image'), async (req,res) => {
    if (!req.file) throw new AppError(400,'Envie uma imagem JPG, PNG ou WEBP.');
    res.json(await imageExtractor(req.file.buffer,req.file.mimetype,config.ocrLang));
  });
  const Submission = z.object({ type: z.enum(['text','image','url']), text: z.string().trim().min(20).max(20000).optional(), url: z.string().max(2048).optional(), consent: z.literal(true),coverage:z.enum(['main','full']).optional().default('main') }).strict();
  app.post('/api/checks', expensive, async (req,res) => {
    const parsed = Submission.safeParse(req.body);
    if (!parsed.success) throw new AppError(400,'Informe o conteúdo (20 a 20.000 caracteres) e aceite o tratamento dos dados.');
    const input = parsed.data;
    if (input.type !== 'url' && !input.text || input.type === 'url' && !input.url) throw new AppError(400,'Conteúdo ausente.');
    await repo.requireReady();
    const configured=servicesConfigured(config);
    if (!configured.ai || !configured.search) throw unavailable('Configure as chaves de IA e pesquisa no servidor antes de verificar.');
    if (active.size + preparing >= 2) throw new AppError(429,'Há duas análises em andamento. Tente novamente em instantes.');
    if (active.has(req.owner)) throw new AppError(429,'Sua análise anterior ainda está em andamento.');
    preparing++;
    let id, text, metadata = {};
    try {
      if (input.type === 'url') { parsePublicUrl(input.url); metadata = await urlExtractor(input.url); text = metadata.text; delete metadata.text; }
      else text = input.text;
      if (text.length < 20) throw new AppError(422,'Texto insuficiente para análise.');
      id = randomUUID();
      await repo.create({ id,owner:req.owner,type:input.type,text,metadata });
      active.add(req.owner);
    } finally { preparing--; }
    res.status(202).json({ id });
    // Tarefa registrada no banco; reinício marca pendências como falha explícita.
    void (async () => {
      try { const result = await runAnalysis(text, { providers, trustedDomains:config.trustedDomains,extract:createReferenceExtractor(providers), maxClaims:input.coverage==='full'?6:3,inputSource:input.type==='url'?{...metadata,text}:null, progress:(stage,current,total) => repo.progress(id,stage,current,total) });
        if (metadata.truncated) result.warnings.push('O artigo excedeu o limite: somente os primeiros 20.000 caracteres foram analisados.');
        if (metadata.extractionMethod==='tavily')result.warnings.push('O acesso direto ao artigo falhou; o texto foi obtido pelo extrator do Tavily. Data e autoria podem não ter sido extraídas.');
        await repo.complete(id,result);
      } catch (error) { try { await repo.fail(id,error instanceof AppError ? error.message : 'Não foi possível concluir a análise. Tente novamente.'); } catch { console.error('Não foi possível registrar falha da análise.'); } }
      finally { active.delete(req.owner); }
    })();
  });
  const uuid = value => { if (!z.string().uuid().safeParse(value).success) throw new AppError(400,'Identificador inválido.'); return value; };
  app.get('/api/checks', async (req,res) => { await repo.requireReady(); res.json(await repo.history(req.owner)); });
  app.get('/api/checks/:id', async (req,res) => { await repo.requireReady(); const item = await repo.get(uuid(req.params.id),req.owner); if (!item) throw new AppError(404,'Verificação não encontrada ou expirada.'); res.json(item); });
  app.delete('/api/checks/:id', async (req,res) => { await repo.requireReady(); await repo.remove(req.owner,uuid(req.params.id)); res.status(204).end(); });
  app.delete('/api/checks', async (req,res) => { await repo.requireReady(); await repo.remove(req.owner); res.status(204).end(); });
  app.use('/api', (_req,_res,next) => next(new AppError(404,'Rota não encontrada.')));
  app.use(express.static(fileURLToPath(new URL('../public',import.meta.url)), { dotfiles:'deny', index:'index.html' }));
  app.use((error,_req,res,_next) => {
    const upload = error instanceof multer.MulterError;
    const status = upload ? 400 : error.status || 500;
    res.status(status).json({ error: upload ? 'Upload inválido. Envie somente uma imagem de até 5 MB.' : status < 500 || error instanceof AppError ? error.message : 'Serviço temporariamente indisponível.', code:error.code || 'INTERNAL_ERROR' });
  });
  return app;
}
