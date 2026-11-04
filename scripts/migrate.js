import pg from 'pg';
import { readFile } from 'node:fs/promises';
if (!process.env.DATABASE_URL) throw new Error('Configure DATABASE_URL.');
const client = new pg.Client({ connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized:true } : false });
try { await client.connect(); await client.query(await readFile(new URL('../sql/001_init.sql',import.meta.url),'utf8')); console.log('Migração 001 aplicada.'); } finally { await client.end(); }
