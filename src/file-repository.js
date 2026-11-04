import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { MemoryRepository } from './memory-repository.js';
import { AppError } from './errors.js';
export class FileRepository extends MemoryRepository{
 constructor(config){super(config);this.file=config.historyFile;this.writes=Promise.resolve();this.loaded=this.load();}
 async load(){
  await mkdir(dirname(this.file),{recursive:true});
  let rows;let corrupted=false;
  for(const path of [this.file,`${this.file}.bak`]){try{const raw=await readFile(path,'utf8');if(raw.length>30_000_000)throw new Error('oversize');rows=JSON.parse(raw);if(!Array.isArray(rows))throw new Error('invalid');break;}catch(error){if(error.code==='ENOENT')continue;corrupted=true;if(path.endsWith('.bak'))throw new AppError(503,'Histórico local danificado. Restaure uma cópia antes de continuar.');}}
  if(corrupted&&!rows)throw new AppError(503,'Histórico local danificado e sem cópia de recuperação.');
  for(const row of (rows||[]).slice(0,250)){if(row&&typeof row.id==='string'&&/^[a-f0-9]{64}$/.test(row.owner)&&Number.isFinite(Date.parse(row.expires_at)))this.items.set(row.id,row);}
 }
 async ready(){try{await this.loaded;return true;}catch{return false;}}
 async requireReady(){await this.loaded;}
 async save(){await this.loaded;const snapshot=JSON.stringify([...this.items.values()]);const write=this.writes.catch(()=>{}).then(async()=>{try{const previous=await readFile(this.file,'utf8');await writeFile(`${this.file}.bak`,previous,{mode:0o600});}catch(error){if(error.code!=='ENOENT')throw error;}await writeFile(this.file,snapshot,{mode:0o600});});this.writes=write;try{await write;}catch{throw new AppError(503,'Não foi possível gravar o histórico local.');}}
 async create(value){await this.loaded;await super.create(value);await this.save();}
 async progress(...args){await this.loaded;await super.progress(...args);await this.save();}
 async complete(...args){await this.loaded;await super.complete(...args);await this.save();}
 async fail(...args){await this.loaded;await super.fail(...args);await this.save();}
 async get(...args){await this.loaded;return super.get(...args);}
 async history(...args){await this.loaded;return super.history(...args);}
 async remove(...args){await this.loaded;await super.remove(...args);await this.save();await writeFile(`${this.file}.bak`,JSON.stringify([...this.items.values()]),{mode:0o600});}
 async recover(){await this.loaded;for(const row of this.items.values())if(!['complete','failed'].includes(row.status)){row.status='failed';row.error='O servidor reiniciou durante a checagem. Envie a notícia novamente.';}await this.save();}
 async purge(){await this.loaded;const before=this.items.size;await super.purge();if(this.items.size!==before){await this.save();await writeFile(`${this.file}.bak`,JSON.stringify([...this.items.values()]),{mode:0o600});}}
 async close(){await this.writes;}
}
