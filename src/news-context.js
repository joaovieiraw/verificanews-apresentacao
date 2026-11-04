export function publicationContext(source,now=Date.now()){
 if(!source)return{dateHint:null,dateBasis:null,recent:false};
 let day=null,basis=null;
 if(source.publishedAt&&Number.isFinite(Date.parse(source.publishedAt))){day=new Date(source.publishedAt).toISOString().slice(0,10);basis='publication';}
 else{try{const match=new URL(source.url).pathname.match(/\/(20\d{2})\/(\d{2})\/(\d{2})\//);if(match){const value=`${match[1]}-${match[2]}-${match[3]}`;if(Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value){day=value;basis='url';}}}catch{}}
 if(!day)return{dateHint:null,dateBasis:null,recent:false};
 const time=Date.parse(day),age=now-time;
 const recent=age>=-86400000&&age<7*86400000;
 // Tavily interpreta end_date como "antes de"; o dia seguinte inclui o dia da matéria.
 return{dateHint:day,dateBasis:basis,recent,...(recent?{startDate:new Date(time-3*86400000).toISOString().slice(0,10),endDate:new Date(time+86400000).toISOString().slice(0,10)}:{})};
}
