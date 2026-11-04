import { AppError, unavailable } from './errors.js';
import { parsePublicUrl } from './safe-url.js';

export async function jsonRequest(url, options, fetcher = fetch) {
  try {
    const response = await fetcher(url, { ...options, signal: AbortSignal.timeout(45000), redirect: 'error' });
    if (!response.ok) throw new AppError(502, `Serviço externo indisponível (HTTP ${response.status}).`, 'UPSTREAM_ERROR');
    const reader = response.body.getReader(); let size = 0; const chunks = [];
    try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 2_000_000) { await reader.cancel(); throw new Error('Resposta muito grande'); } chunks.push(Buffer.from(value)); } } finally { reader.releaseLock(); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(502, 'Falha de conexão ou resposta inválida do serviço externo.', 'UPSTREAM_ERROR');
  }
}
export function createProviders(config, fetcher = fetch) {
  return {
    async model(schema, instructions, input) {
      if (!config.openaiKey || !config.model) throw unavailable('Configure a chave e o modelo de IA no servidor.');
      const response = await jsonRequest('https://api.openai.com/v1/responses', {
        method: 'POST', headers: { Authorization: `Bearer ${config.openaiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: config.model, store: false, instructions, input: JSON.stringify(input), max_output_tokens: 6000,
          text: { format: { type: 'json_schema', name: 'verification', strict: true, schema } } })
      }, fetcher);
      if (response.status !== 'completed') throw new AppError(502, 'A IA não concluiu a análise. Tente novamente.', 'INVALID_MODEL_OUTPUT');
      const parts = response.output?.flatMap(item => item.content || []) || [];
      if (parts.some(p => p.type === 'refusal')) throw new AppError(422, 'A IA recusou analisar este conteúdo.', 'MODEL_REFUSAL');
      try { return JSON.parse(parts.filter(p => p.type === 'output_text').map(p => p.text).join('')); }
      catch { throw new AppError(502, 'A IA retornou uma resposta incompleta.', 'INVALID_MODEL_OUTPUT'); }
    },
    async search(query) {
      if (!config.braveKey) throw unavailable('Configure o serviço de pesquisa no servidor.');
      const url = new URL('https://api.search.brave.com/res/v1/web/search');
      url.search = new URLSearchParams({ q: query.split(/\s+/).slice(0, 70).join(' ').slice(0, 500), count: '5', country: 'BR', search_lang: 'pt-br', text_decorations: 'false' }).toString();
      const data = await jsonRequest(url, { headers: { Accept: 'application/json', 'X-Subscription-Token': config.braveKey } }, fetcher);
      if (!data.web && !data.query) throw new AppError(502, 'Resposta inválida do mecanismo de pesquisa.', 'INVALID_SEARCH_OUTPUT');
      if (data.web && !Array.isArray(data.web.results)) throw new AppError(502, 'Resultados de pesquisa incompletos.', 'INVALID_SEARCH_OUTPUT');
      return (data.web?.results || []).slice(0, 5).flatMap(result => {
        try { return [{ url: parsePublicUrl(result.url).href, title: String(result.title || '').slice(0, 500), snippet: String(result.description || '').slice(0, 1000) }]; } catch { return []; }
      });
    }
  };
}
