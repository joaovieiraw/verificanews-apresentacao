import { z } from 'zod';
import { AppError } from './errors.js';

export function normalizeToken(value){
 if(typeof value!=='string')return value;
 let token=value.replace(/^[\s\u200B-\u200D\uFEFF]+|[\s\u200B-\u200D\uFEFF]+$/g,'');
 token=token.replace(/^(?:export\s+)?(?:GEMINI_API_KEY|GOOGLE_API_KEY|TAVILY_API_KEY)\s*=\s*/i,'').replace(/^Bearer\s+/i,'');
 if((token.startsWith('"')&&token.endsWith('"'))||(token.startsWith("'")&&token.endsWith("'")))token=token.slice(1,-1);
 return token.trim();
}
const token=z.preprocess(normalizeToken,z.string().min(15).max(4096).regex(/^[A-Za-z0-9._~+\/=-]+$/));
const schema=z.object({geminiKey:token,tavilyKey:token,model:z.preprocess(v=>typeof v==='string'?v.trim().replace(/^models\//,''):v,z.string().regex(/^[A-Za-z0-9._-]{1,100}$/)),persist:z.boolean().optional().default(false)}).strict();
export function parseLocalSettings(input){
 const result=schema.safeParse(input);
 if(result.success)return result.data;
 const field=result.error.issues[0]?.path[0];
 const messages={geminiKey:'Chave do Gemini: cole somente a chave completa, sem espaços no meio.',tavilyKey:'Chave do Tavily: cole somente a chave completa, sem espaços no meio.',model:'Modelo Gemini: use somente o identificador do modelo, sem espaços.',persist:'Recarregue a página para atualizar a opção de lembrar.'};
 throw new AppError(400,messages[field]||'Configuração em formato incorreto. Recarregue a página e tente novamente.');
}
