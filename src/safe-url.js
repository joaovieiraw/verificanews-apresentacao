import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import ipaddr from 'ipaddr.js';
import { AppError } from './errors.js';

export function publicAddress(address) {
  try { let ip = ipaddr.parse(address); if (ip.kind() === 'ipv6' && ip.isIPv4MappedAddress()) ip = ip.toIPv4Address(); return ip.range() === 'unicast'; } catch { return false; }
}
export function parsePublicUrl(input) {
  let url;
  try { url = new URL(input); } catch { throw new AppError(400, 'URL inválida.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) throw new AppError(400, 'Use um endereço HTTP ou HTTPS público, sem credenciais e sem portas alternativas.');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || /\.(localhost|local|internal|test|invalid)$/.test(host) || !host.includes('.') && !ipaddr.isValid(host)) throw new AppError(400, 'Endereço interno ou reservado bloqueado.');
  if (ipaddr.isValid(host) && !publicAddress(host)) throw new AppError(400, 'Endereço privado ou reservado bloqueado.');
  url.hash = ''; return url;
}
export async function resolvePublic(url, lookup = dns.lookup) {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const records = ipaddr.isValid(host) ? [{ address: host, family: ipaddr.parse(host).kind() === 'ipv6' ? 6 : 4 }] : await lookup(host, { all: true, verbatim: true });
  if (!records.length || records.some(r => !publicAddress(r.address))) throw new AppError(400, 'Destino interno, privado ou reservado bloqueado.');
  return records[0];
}
// Resolve, valida TODOS os endereços e fixa a conexão ao IP validado (evita DNS rebinding).
async function safeHtmlRequest(input, { maxBytes = 1_500_000, timeout = 10000, redirects = 3, lookup = dns.lookup, requester, signal } = {}) {
  const deadline = Date.now() + timeout;
  let url = parsePublicUrl(input);
  for (let hop = 0; hop <= redirects; hop++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new AppError(504, 'Tempo limite ao acessar a página.');
    const record = await Promise.race([resolvePublic(url, lookup), new Promise((_, reject) => { const timer = setTimeout(() => reject(new AppError(504, 'Tempo limite de DNS.')), remaining); timer.unref(); })]);
    const response = requester ? await requester(url, record) : await new Promise((resolve, reject) => {
      const transport = url.protocol === 'https:' ? https : http;
      const req = transport.get(url, { agent: false, signal, headers: { 'User-Agent': 'VerificaNews/1.0 (+fact-check; contact site operator)', Accept: 'text/html,application/xhtml+xml', 'Accept-Encoding': 'identity' },
        lookup: (_host, options, callback) => callback(null, options?.all ? [record] : record.address, record.family) }, res => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) { res.destroy(); resolve({ redirect: res.headers.location }); return; }
        if (res.statusCode !== 200) { res.destroy(); reject(new AppError(422, `Página indisponível (HTTP ${res.statusCode}).`)); return; }
        if (!/^(text\/html|application\/xhtml\+xml)(;|$)/i.test(res.headers['content-type'] || '')) { res.destroy(); reject(new AppError(422, 'A URL não retornou uma página HTML.')); return; }
        let size = 0; const chunks = [];
        res.on('data', chunk => { size += chunk.length; if (size > maxBytes) { res.destroy(new AppError(422, 'Página excede o limite de tamanho.')); return; } chunks.push(chunk); });
        res.on('end', () => resolve({ html: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', reject);
      });
      const timer = setTimeout(() => req.destroy(new AppError(504, 'Tempo limite ao acessar a página.')), Math.max(1, deadline - Date.now()));
      req.on('close', () => clearTimeout(timer)); req.on('error', reject);
    });
    if ('html' in response) return { html: response.html, url: url.href };
    if (!response.redirect || hop === redirects) throw new AppError(422, 'Redirecionamentos excessivos ou inválidos.');
    const next = parsePublicUrl(new URL(response.redirect, url).href);
    if (url.protocol === 'https:' && next.protocol !== 'https:') throw new AppError(400, 'Redirecionamento inseguro bloqueado.');
    url = next;
  }
}
export async function safeHtml(input,options={}){
 const controller=new AbortController();let timer;
 const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new AppError(504,'Tempo limite ao acessar a página.'));},options.timeout||10000);});
 try{return await Promise.race([safeHtmlRequest(input,{...options,signal:controller.signal}),timeout]);}finally{clearTimeout(timer);}
}
