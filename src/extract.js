import { JSDOM, VirtualConsole } from 'jsdom';
import { Readability } from '@mozilla/readability';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';
import { safeHtml } from './safe-url.js';
import { AppError } from './errors.js';

export function extractHtml(html, url) {
  // Scripts e recursos externos nunca são executados/carregados pelo JSDOM.
  const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
  try {
    const published = dom.window.document.querySelector('meta[property="article:published_time"],meta[name="date"]')?.content;
    const article = new Readability(dom.window.document, { charThreshold: 120 }).parse();
    const text = article?.textContent?.replace(/\s+/g, ' ').trim();
    if (!text || text.length < 80) throw new AppError(422, 'Não foi possível extrair o texto principal. Cole o conteúdo na aba Texto.');
    return { url, title: (article.title || '').slice(0, 500), author: (article.byline || '').slice(0, 300) || null, publishedAt: published && Number.isFinite(Date.parse(published)) ? new Date(published).toISOString() : null, text: text.slice(0, 20000), truncated: text.length > 20000 };
  } finally { dom.window.close(); }
}
export async function extractUrl(url, fetcher = safeHtml) { const page = await fetcher(url); return extractHtml(page.html, page.url); }

export async function validateImage(buffer, mime) {
  if (!buffer?.length || buffer.length > 5 * 1024 * 1024) throw new AppError(400, 'Envie uma imagem de até 5 MB.');
  const jpg = buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
  const png = buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const webp = buffer.subarray(0,4).toString() === 'RIFF' && buffer.subarray(8,12).toString() === 'WEBP';
  const actual = jpg ? 'image/jpeg' : png ? 'image/png' : webp ? 'image/webp' : null;
  if (!actual || mime !== actual) throw new AppError(400, 'Tipo de arquivo inválido. Use JPG, PNG ou WEBP.');
  try {
    const image = sharp(buffer, { limitInputPixels: 20_000_000, animated: false });
    const metadata = await image.metadata();
    if (metadata.pages > 1) throw new Error('Imagem animada');
    return await image.rotate().resize({ width: 2200, height: 2200, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  } catch { throw new AppError(400, 'Imagem inválida, animada ou com resolução excessiva.'); }
}
let ocrBusy = false;
export async function extractImage(buffer, mime, lang = 'por+eng') {
  if (ocrBusy) throw new AppError(429, 'OCR ocupado. Tente novamente em instantes.');
  ocrBusy = true; let worker; let timer;
  try {
    const image = await validateImage(buffer, mime);
    let expired = false;
    const work = (async () => {
      worker = await createWorker(lang, 1, { cacheMethod: 'none', errorHandler: () => {} });
      if (expired) { await worker.terminate(); throw new AppError(504, 'OCR excedeu o tempo limite.'); }
      const { data } = await worker.recognize(image);
      return data.text.trim().slice(0, 20000);
    })();
    // Também encerra um worker que só terminou de inicializar após o timeout.
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => { expired = true; worker?.terminate().catch(() => {}); reject(new AppError(504, 'OCR excedeu o tempo limite. Tente uma imagem menor ou cole o texto.')); }, 45000); });
    work.finally(() => { if (expired) worker?.terminate().catch(() => {}); }).catch(() => {});
    const text = await Promise.race([work, deadline]);
    if (text.length < 20) throw new AppError(422, 'Texto insuficiente na imagem. Use uma imagem mais legível.');
    return { text, warning: 'OCR pode conter erros. Revise o texto antes de analisar; a imagem não foi autenticada.' };
  } finally { clearTimeout(timer); await worker?.terminate().catch(() => {}); ocrBusy = false; }
}
