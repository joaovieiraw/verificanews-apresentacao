import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { createGeminiTavily } from '../src/gemini-tavily.js';
import { extractUrl } from '../src/extract.js';
import { extractWithFallback,createReferenceExtractor } from '../src/extract-fallback.js';
import { analyze } from '../src/analyze.js';
import { defaultTrustedDomains } from '../src/source-policy.js';
import { AppError } from '../src/errors.js';
try{loadEnvFile(fileURLToPath(new URL('../.env',import.meta.url)));}catch{}
const url=process.argv[2];
if(!url||!process.env.GEMINI_API_KEY||!process.env.TAVILY_API_KEY){console.log('Pendente: informe a URL e configure as chaves localmente.');process.exitCode=1;}
else try{
 const providers=createGeminiTavily({geminiKey:process.env.GEMINI_API_KEY,tavilyKey:process.env.TAVILY_API_KEY,geminiModel:process.env.GEMINI_MODEL||'gemini-3.5-flash-lite'});
 const article=await extractWithFallback(url,providers);console.log('Página original extraída.');
 const text=process.argv[3]||article.text;
 const result=await analyze(text,{providers,extract:createReferenceExtractor(providers),trustedDomains:defaultTrustedDomains,inputSource:article,maxClaims:3,progress:async(stage,current,total)=>console.log(`Etapa: ${stage}${total?` ${current}/${total}`:''}`)});
 const report={inputUrl:url,inputTitle:article.title,checkedAt:result.checkedAt,classification:result.classification,claims:result.claims.map(c=>({text:c.text,classification:c.classification,explanation:c.explanation,evidenceCount:c.evidence.length,limitations:c.limitations})),sources:result.sources.map(s=>({url:s.url,title:s.title,accessed:s.accessed,trusted:s.trusted})),warnings:result.warnings};
 await writeFile(new URL('../VALIDACAO-NOTICIA.json',import.meta.url),JSON.stringify(report,null,2));
 console.log(JSON.stringify({classification:result.classification,claims:report.claims.map(c=>({text:c.text,classification:c.classification,evidenceCount:c.evidenceCount})),sources:result.sources.length}));
}catch(error){console.log(error instanceof AppError?error.message:'Falha na validação da notícia, sem exibir detalhes sensíveis.');process.exitCode=1;}
