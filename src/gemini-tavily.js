import { AppError, unavailable } from './errors.js';
import { parsePublicUrl, resolvePublic } from './safe-url.js';

async function requestJson(service,url,options,fetcher,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))) {
 const controller=new AbortController();let timer;
 const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new AppError(504,`${service}: a consulta demorou além do limite. Tente novamente em instantes.`,'UPSTREAM_TIMEOUT'));},service==='Gemini'?90000:35000);});
 const run=async()=>{
  try {
    let res;
    for(let attempt=0;attempt<3;attempt++){
      try{res=await fetcher(url,{...options,signal:controller.signal,redirect:'error'});}
      catch(error){if(service!=='Gemini'||attempt>0)throw error;await wait(1000+Math.floor(Math.random()*250));continue;}
      if(service!=='Gemini'||![500,502,503,504].includes(res.status)||attempt===2)break;
      await res.body?.cancel();
      await wait(1000*2**attempt+Math.floor(Math.random()*250));
    }
    if(!res.ok) {
      const detail=res.status===503?'Modelo temporariamente indisponível (HTTP 503), mesmo após três tentativas. Aguarde e tente novamente. Não é necessário gerar outra chave por causa deste erro.':res.status===429?'Limite de uso atingido. Aguarde ou confira a cota da conta.':res.status===401||res.status===403?'Chave inválida, sem permissão ou serviço indisponível para sua conta.':res.status===404?'Modelo não disponível. Confira o nome do modelo nas configurações.':`Serviço retornou HTTP ${res.status}.`;
      throw new AppError(502,`${service}: ${detail}`,'UPSTREAM_ERROR');
    }
    const reader=res.body.getReader();const chunks=[];let length=0;
    try {while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>4_000_000){await reader.cancel();throw new AppError(502,`${service}: resposta excedeu o limite de tamanho.`,'UPSTREAM_RESPONSE_TOO_LARGE');}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
    try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new AppError(502,`${service}: resposta em formato inesperado.`,'UPSTREAM_BAD_JSON');}
  }catch(error){if(error instanceof AppError)throw error;throw new AppError(502,`${service}: falha de conexão. Tente novamente.`,'UPSTREAM_CONNECTION');}
 };
 try{return await Promise.race([run(),timeout]);}finally{clearTimeout(timer);}
}
export function servicesConfigured(config){
  return config.provider==='gemini-tavily'?{ai:Boolean(config.geminiKey&&config.geminiModel),search:Boolean(config.tavilyKey)}:{ai:Boolean(config.openaiKey&&config.model),search:Boolean(config.braveKey)};
}
export function createGeminiTavily(config,fetcher=fetch,wait){
 return {
  async readPage(input){
   if(!config.tavilyKey)throw unavailable('Configure a chave do Tavily.');
   const url=parsePublicUrl(input);await resolvePublic(url);
   const data=await requestJson('Tavily','https://api.tavily.com/extract',{method:'POST',headers:{Authorization:`Bearer ${config.tavilyKey}`,'Content-Type':'application/json'},body:JSON.stringify({urls:[url.href],extract_depth:'basic',format:'text',include_images:false})},fetcher);
   const raw=data.results?.[0]?.raw_content;
   if(typeof raw!=='string'||raw.trim().length<80)throw new AppError(422,'O extrator não conseguiu acessar o artigo. Cole o texto na aba Texto.');
   const text=raw.replace(/\s+/g,' ').trim();
   return{url:url.href,text:text.slice(0,20000),title:raw.split('\n').map(s=>s.trim()).find(s=>s.length>15&&s.length<250)||url.hostname,author:null,publishedAt:null,truncated:text.length>20000,extractionMethod:'tavily'};
  },
  async model(schema,instructions,input){
   if(!config.geminiKey||!config.geminiModel)throw unavailable('Configure a chave do Gemini e o modelo.');
   if(!/^[a-zA-Z0-9._-]{1,100}$/.test(config.geminiModel))throw new AppError(400,'Nome de modelo inválido.');
   const data=await requestJson('Gemini',`https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent`,{method:'POST',headers:{'x-goog-api-key':config.geminiKey,'Content-Type':'application/json'},body:JSON.stringify({systemInstruction:{parts:[{text:instructions}]},contents:[{role:'user',parts:[{text:JSON.stringify(input)}]}],generationConfig:{responseMimeType:'application/json',responseJsonSchema:schema,maxOutputTokens:6000}})},fetcher,wait);
   const candidate=data.candidates?.[0];
   if(!candidate||candidate.finishReason!=='STOP')throw new AppError(502,'Gemini não concluiu a resposta (limite, bloqueio ou resposta incompleta). Nenhuma conclusão foi inventada.','INVALID_MODEL_OUTPUT');
   try{return JSON.parse(candidate.content.parts.filter(p=>typeof p.text==='string'&&!p.thought).map(p=>p.text).join(''));}catch{throw new AppError(502,'Gemini retornou JSON inválido. Tente novamente.','INVALID_MODEL_OUTPUT');}
  },
  async search(query,context={}){
   if(!config.tavilyKey)throw unavailable('Configure a chave do Tavily.');
   const request=raw=>requestJson('Tavily','https://api.tavily.com/search',{method:'POST',headers:{Authorization:`Bearer ${config.tavilyKey}`,'Content-Type':'application/json'},body:JSON.stringify({query:query.slice(0,500),topic:context.recent?'news':'general',...(context.recent?{start_date:context.startDate,end_date:context.endDate}:{}),search_depth:'basic',max_results:4,include_answer:false,include_raw_content:raw?'text':false,include_published_date:true,auto_parameters:false})},fetcher);
   let data;try{data=await request(false);}catch(error){if(!['UPSTREAM_TIMEOUT','UPSTREAM_CONNECTION','UPSTREAM_RESPONSE_TOO_LARGE','UPSTREAM_BAD_JSON'].includes(error.code))throw error;data=await request(false);}
   if(!Array.isArray(data.results))throw new AppError(502,'Tavily retornou resultados inválidos.','INVALID_SEARCH_OUTPUT');
   return data.results.slice(0,4).flatMap(result=>{try{return[{url:parsePublicUrl(result.url).href,title:String(result.title||'').slice(0,500),snippet:String(result.content||'').slice(0,1000),rawText:typeof result.raw_content==='string'?result.raw_content.slice(0,20000):null,publishedAt:result.published_date&&Number.isFinite(Date.parse(result.published_date))?new Date(result.published_date).toISOString():null}];}catch{return[];}});
  }
 };
}
