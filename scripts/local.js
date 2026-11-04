import { randomBytes } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
try{loadEnvFile(fileURLToPath(new URL('../.env',import.meta.url)));}catch(error){if(error.code!=='ENOENT')throw new Error('Não foi possível carregar a configuração local.');}
process.env.PROVIDER='gemini-tavily';
process.env.STORAGE='file';
process.env.LOCAL_SETUP='true';
process.env.NODE_ENV='development';
process.env.PORT=process.env.PORT||'3000';
process.env.APP_ORIGIN=`http://localhost:${process.env.PORT}`;
const localDir=fileURLToPath(new URL('../.local/',import.meta.url));
await mkdir(localDir,{recursive:true});
const secretPath=fileURLToPath(new URL('../.local/session-secret',import.meta.url));
try{const secret=(await readFile(secretPath,'utf8')).trim();if(!/^[a-f0-9]{96}$/.test(secret))throw new Error('Segredo local inválido.');process.env.SESSION_SECRET=secret;}
catch(error){if(error.code!=='ENOENT')throw new Error('Não foi possível carregar a sessão local.');process.env.SESSION_SECRET=randomBytes(48).toString('hex');await writeFile(secretPath,process.env.SESSION_SECRET,{mode:0o600});}
await import('../src/server.js');
