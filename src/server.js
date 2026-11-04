import { configFrom } from './config.js';
import { Repository } from './repository.js';
import { createProviders } from './providers.js';
import { createApp } from './app.js';
import { MemoryRepository } from './memory-repository.js';
import { createGeminiTavily } from './gemini-tavily.js';
import { extractWithFallback } from './extract-fallback.js';
import { FileRepository } from './file-repository.js';
import { execFile } from 'node:child_process';
const config = configFrom();
const repo = config.storage==='file'?new FileRepository(config):config.storage==='memory'?new MemoryRepository(config):new Repository(config);
await repo.recover(); await repo.purge();
const providers=config.provider==='gemini-tavily'?createGeminiTavily(config):createProviders(config);
const app = createApp({ config, repo, providers, urlExtractor:url=>extractWithFallback(url,providers) });
const server = app.listen(config.port,config.localSetup?'127.0.0.1':'0.0.0.0',() => {
 console.log(`VerificaNews: ${config.origin} — ${config.storage==='file'?'histórico salvo neste computador':config.storage==='memory'?'histórico temporário em memória':'PostgreSQL'}.`);
 if(config.localSetup&&process.env.OPEN_BROWSER==='1'&&process.platform==='win32')execFile('cmd.exe',['/c','start','',`http://localhost:${server.address().port}`],{windowsHide:true},()=>{});
});
const cleanup = setInterval(() => repo.purge().catch(() => console.error('Limpeza de retenção pendente.')),3600000); cleanup.unref();
async function stop() { clearInterval(cleanup); server.close(); await repo.close(); process.exit(0); }
process.on('SIGTERM',stop); process.on('SIGINT',stop);
