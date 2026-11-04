import { defaultTrustedDomains } from './source-policy.js';
import { fileURLToPath } from 'node:url';
export function configFrom(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const secret = env.SESSION_SECRET || '';
  if (secret.length < 32 || secret.startsWith('SUBSTITUA')) throw new Error('Configure SESSION_SECRET com pelo menos 32 caracteres aleatórios.');
  const origin = new URL(env.APP_ORIGIN || (env.RENDER_EXTERNAL_HOSTNAME ? `https://${env.RENDER_EXTERNAL_HOSTNAME}` : 'http://localhost:3000')).origin;
  if (production && !origin.startsWith('https://')) throw new Error('APP_ORIGIN deve usar HTTPS em produção.');
  const retentionDays = Number(env.RETENTION_DAYS || 30);
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 365) throw new Error('RETENTION_DAYS: use 1–365.');
  return { production, secret, origin, retentionDays, port: Number(env.PORT || 3000), databaseUrl: env.DATABASE_URL,
    provider: env.PROVIDER || 'openai-brave', storage: env.STORAGE || 'postgres', localSetup: env.LOCAL_SETUP === 'true' && !production,
    historyFile:fileURLToPath(new URL('../.local/history.json',import.meta.url)),
    geminiKey: env.GEMINI_API_KEY || '', geminiModel: env.GEMINI_MODEL || 'gemini-3.5-flash-lite', tavilyKey: env.TAVILY_API_KEY || '',
    databaseSsl: env.DATABASE_SSL === 'true', openaiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL,
    braveKey: env.BRAVE_API_KEY, ocrLang: env.OCR_LANG || 'por+eng',
    trustedDomains: (env.TRUSTED_DOMAINS || defaultTrustedDomains.join(',')).split(',').map(s => s.trim().toLowerCase()).filter(Boolean) };
}
