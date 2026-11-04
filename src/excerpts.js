// Trechos são recortados pelo servidor. A IA escolhe IDs, sem reescrever citações.
export function selectExcerpts(text,claim,max=22){
 const tokens=new Set((claim.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu)||[]).filter(w=>!['para','como','pela','pelo','essa','esse','sobre','entre','mais','foram','uma','com','que'].includes(w)));
 const chunks=[];let offset=0;
 while(offset<text.length){let end=Math.min(offset+320,text.length);if(end<text.length){const space=text.lastIndexOf(' ',end);if(space>offset+100)end=space;}const quote=text.slice(offset,end).trim();if(quote.length>=20)chunks.push({quote,position:offset,score:[...tokens].filter(t=>quote.toLowerCase().includes(t)).length});offset=Math.max(end,offset+1);}
 return chunks.sort((a,b)=>b.score-a.score||a.position-b.position).slice(0,max).sort((a,b)=>a.position-b.position).map((c,i)=>({id:`p${i+1}`,quote:c.quote}));
}
