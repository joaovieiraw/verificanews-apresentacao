import pg from 'pg';
import { unavailable } from './errors.js';
export class Repository {
  constructor(config) {
    this.retentionDays = config.retentionDays;
    this.pool = config.databaseUrl ? new pg.Pool({ connectionString: config.databaseUrl, ssl: config.databaseSsl ? { rejectUnauthorized: true } : false, max: 5, connectionTimeoutMillis: 3000, statement_timeout: 5000 }) : null;
    this.pool?.on('error', () => console.error('Conexão de banco indisponível.'));
  }
  async ready() { if (!this.pool) return false; try { await this.pool.query('SELECT version FROM schema_migrations WHERE version=1'); return true; } catch { return false; } }
  async requireReady() { if (!await this.ready()) throw unavailable('Banco de dados indisponível ou não inicializado. Nenhuma análise foi iniciada.'); }
  async create({ id, owner, type, text, metadata }) {
    await this.requireReady();
    await this.pool.query(`INSERT INTO news(id,owner_hash,input_type,title,content,metadata,status,expires_at) VALUES($1,$2,$3,$4,$5,$6,'queued',now()+($7 * interval '1 day'))`, [id, owner, type, metadata.title || text.slice(0, 110), text, metadata, this.retentionDays]);
  }
  async progress(id, status, current = 0, total = 0) { await this.pool.query('UPDATE news SET status=$2,progress=$3 WHERE id=$1', [id, status, { current, total }]); }
  async fail(id, message) { await this.pool.query("UPDATE news SET status='failed',error=$2,content='' WHERE id=$1", [id, message]); }
  async complete(id, result) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Um visitante pode ter excluído o registro enquanto a tarefa executava.
      const exists = await client.query('SELECT id FROM news WHERE id=$1 FOR UPDATE', [id]);
      if (!exists.rowCount) { await client.query('ROLLBACK'); return; }
      await client.query('INSERT INTO results(news_id,classification,summary,warnings,checked_at) VALUES($1,$2,$3,$4,$5)', [id, result.classification, result.summary, JSON.stringify(result.warnings), result.checkedAt]);
      for (const [i,c] of result.claims.entries()) await client.query('INSERT INTO claims(news_id,position,content,classification,explanation,evidence,limitations) VALUES($1,$2,$3,$4,$5,$6,$7)', [id,i,c.text,c.classification,c.explanation,JSON.stringify(c.evidence),JSON.stringify(c.limitations)]);
      for (const source of result.sources) await client.query('INSERT INTO sources(news_id,source_id,data) VALUES($1,$2,$3)', [id,source.id,source]);
      await client.query("UPDATE news SET status='complete',content='' WHERE id=$1", [id]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async get(id, owner) {
    const { rows } = await this.pool.query('SELECT id,title,input_type,status,progress,error,metadata,created_at,expires_at FROM news WHERE id=$1 AND owner_hash=$2 AND expires_at>now()', [id,owner]);
    if (!rows[0]) return null;
    const item = rows[0];
    if (item.status === 'complete') {
      const result = (await this.pool.query('SELECT classification,summary,warnings,checked_at AS "checkedAt" FROM results WHERE news_id=$1',[id])).rows[0];
      const claims = (await this.pool.query('SELECT content AS text,classification,explanation,evidence,limitations FROM claims WHERE news_id=$1 ORDER BY position',[id])).rows;
      const sources = (await this.pool.query('SELECT data FROM sources WHERE news_id=$1 ORDER BY source_id',[id])).rows.map(s => s.data);
      item.result = { ...result, claims, sources };
    }
    return item;
  }
  async history(owner) { return (await this.pool.query('SELECT id,title,input_type,status,created_at,classification FROM verification_history WHERE owner_hash=$1 AND expires_at>now() ORDER BY created_at DESC LIMIT 50',[owner])).rows; }
  async remove(owner, id) { await this.pool.query('DELETE FROM news WHERE owner_hash=$1 AND ($2::uuid IS NULL OR id=$2)', [owner,id || null]); }
  async recover() { if (await this.ready()) await this.pool.query("UPDATE news SET status='failed',error='O servidor reiniciou durante a análise. Envie novamente.',content='' WHERE status NOT IN ('complete','failed')"); }
  async purge() { if (await this.ready()) { await this.pool.query('DELETE FROM news WHERE expires_at<=now()'); await this.pool.query("UPDATE news SET content='' WHERE status='failed'"); } }
  async close() { await this.pool?.end(); }
}
