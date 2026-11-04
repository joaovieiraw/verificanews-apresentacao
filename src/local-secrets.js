import { readFile, writeFile } from 'node:fs/promises';
import { AppError } from './errors.js';

export async function saveLocalSecrets(file, {geminiKey,tavilyKey,model}) {
  let content='';
  try {content=await readFile(file,'utf8');}catch(error){if(error.code!=='ENOENT')throw new AppError(500,'Não foi possível ler a configuração local.');}
  const values={GEMINI_API_KEY:geminiKey,TAVILY_API_KEY:tavilyKey,GEMINI_MODEL:model};
  // Valores já validados como tokens sem espaços/quebras de linha pelo endpoint.
  for(const [name,value]of Object.entries(values)){
    if(!/^[A-Za-z0-9._~+\/=-]+$/.test(value))throw new AppError(400,'Valor de configuração inválido.');
    content=content.replace(new RegExp(`^${name}=.*(?:\\r?\\n|$)`,'gm'),'');
    if(content&&!content.endsWith('\n'))content+='\n';
    content+=`${name}=${value}\n`;
  }
  try{await writeFile(file,content,{encoding:'utf8',mode:0o600});}
  catch{throw new AppError(500,'Não foi possível salvar as chaves neste computador.');}
}
