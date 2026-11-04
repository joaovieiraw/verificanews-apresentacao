import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { createGeminiTavily } from '../src/gemini-tavily.js';
import { AppError } from '../src/errors.js';
try{loadEnvFile(fileURLToPath(new URL('../.env',import.meta.url)));}catch{}
if(!process.env.GEMINI_API_KEY){console.log('PENDENTE: chave Gemini ainda não salva no arquivo local.');process.exitCode=1;}
else {
 const p=createGeminiTavily({geminiKey:process.env.GEMINI_API_KEY,geminiModel:process.env.GEMINI_MODEL||'gemini-3.5-flash-lite'});
 try{const result=await p.model({type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false},'Teste de conexão. Responda somente com ok=true.',{test:'connectivity'});if(result.ok===true)console.log('OK: Gemini respondeu a uma geração real com JSON válido.');else console.log('FALHA: resposta de diagnóstico inesperada.');}
 catch(error){console.log(error instanceof AppError?error.message:'Falha no diagnóstico, sem exibir dados sensíveis.');process.exitCode=1;}
}
