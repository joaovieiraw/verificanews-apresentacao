import { AppError } from './errors.js';
// Modo local sem PostgreSQL. Dados e tarefas desaparecem ao encerrar o processo.
export class MemoryRepository {
 constructor(config){this.items=new Map();this.days=config.retentionDays;}
 async ready(){return true;}
 async requireReady(){}
 async create({id,owner,type,text,metadata}){
  await this.purge();
  if(this.items.size>=250)throw new AppError(429,'Histórico local cheio. Exclua verificações antes de continuar.');
  this.items.set(id,{id,owner,title:metadata.title||text.slice(0,110),input_type:type,metadata,status:'queued',progress:{},created_at:new Date().toISOString(),expires_at:new Date(Date.now()+this.days*86400000).toISOString()});
 }
 async progress(id,status,current=0,total=0){const item=this.items.get(id);if(item)Object.assign(item,{status,progress:{current,total}});}
 async fail(id,error){const item=this.items.get(id);if(item)Object.assign(item,{status:'failed',error});}
 async complete(id,result){const item=this.items.get(id);if(item)Object.assign(item,{status:'complete',result});}
 async get(id,owner){await this.purge();const item=this.items.get(id);if(!item||item.owner!==owner)return null;const {owner:_owner,...safe}=item;return structuredClone(safe);}
 async history(owner){await this.purge();return [...this.items.values()].filter(i=>i.owner===owner).sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,50).map(i=>({id:i.id,title:i.title,input_type:i.input_type,status:i.status,created_at:i.created_at,classification:i.result?.classification}));}
 async remove(owner,id){for(const [key,item]of this.items)if(item.owner===owner&&(!id||id===key))this.items.delete(key);}
 async recover(){}
 async purge(){for(const [key,item]of this.items)if(Date.parse(item.expires_at)<=Date.now())this.items.delete(key);}
 async close(){this.items.clear();}
}
