import { extractUrl } from './extract.js';
export async function extractWithFallback(url,providers,direct=extractUrl){
 try{return await direct(url);}catch(error){
  // Erros de endereço privado/SSRF nunca são contornados por um extrator externo.
  if(error.status===400||!providers.readPage)throw error;
  return providers.readPage(url);
 }
}
export function createReferenceExtractor(providers,direct=extractUrl,maxFallbacks=2){
 let remaining=maxFallbacks;
 return async url=>{try{return await direct(url);}catch(error){if(error.status===400||!providers.readPage||remaining<=0)throw error;remaining--;return providers.readPage(url);}};
}
