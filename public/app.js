const $ = selector => document.querySelector(selector);
const state = { tab:'text', csrf:'', checking:false, current:null, preview:null, poll:0, pollCount:0 };
// Identificador anônimo do histórico local; nunca contém chaves de API.
let localClient='';
try{localClient=localStorage.getItem('vn-client-v1')||'';if(!/^[a-f0-9]{64}$/.test(localClient)){localClient=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');localStorage.setItem('vn-client-v1',localClient);}}catch{}
const labels = { queued:'Preparando conteúdo…',claims:'Identificando alegações…',search:'Pesquisando fontes…',compare:'Comparando evidências…',complete:'Concluída',failed:'Falhou' };
const classes = { CONFIRMADA:'confirmed',FALSA:'false',ENGANOSA:'misleading',INCONCLUSIVA:'inconclusive' };
const date = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('pt-BR') : 'Não informada';
function el(tag,text,className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
function badge(value) { return el('span',value,`badge ${classes[value] || 'inconclusive'}`); }
function feedback(message) { $('#feedback').textContent=message; $('#feedback').hidden=!message; }
async function api(path,options={}) {
  const headers = { 'x-csrf-token':state.csrf,...options.headers };
  if(localClient)headers['x-local-client']=localClient;
  if (options.body && !(options.body instanceof FormData)) headers['Content-Type']='application/json';
  const response = await fetch(`/api${path}`,{ ...options,headers,credentials:'same-origin',signal:AbortSignal.timeout(90000) });
  if (response.status===204) return;
  let data;try{data=await response.json();}catch{throw new Error('O servidor não respondeu corretamente. Verifique se a janela do VerificaNews está aberta.');}
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a solicitação.');
  return data;
}
function busy(value) { state.checking=value; $('#submit').disabled=value; $('#submit').textContent=value?'Verificação em andamento…':'Verificar informação ↗'; }
function switchTab(tab) {
  state.tab=tab;
  document.querySelectorAll('[role=tab]').forEach(button => { const selected=button.dataset.tab===tab; button.setAttribute('aria-selected',String(selected)); button.tabIndex=selected?0:-1; $(`#panel-${button.dataset.tab}`).hidden=!selected; });
  feedback('');
}
document.querySelectorAll('[role=tab]').forEach(button => {
  button.addEventListener('click',()=>switchTab(button.dataset.tab));
  button.addEventListener('keydown',event=>{ const tabs=['text','image','url']; let index=tabs.indexOf(state.tab); if (!['ArrowRight','ArrowLeft','Home','End'].includes(event.key)) return; event.preventDefault(); index=event.key==='Home'?0:event.key==='End'?2:(index+(event.key==='ArrowRight'?1:2))%3; switchTab(tabs[index]); $(`#tab-${tabs[index]}`).focus(); });
});
$('#news-text').addEventListener('input',()=>$('#text-count').textContent=`${$('#news-text').value.length.toLocaleString('pt-BR')} / 20.000`);
try { if (localStorage.getItem('vn-theme')==='dark') document.body.classList.add('dark'); } catch {}
function themeLabel() { $('#theme').setAttribute('aria-label',document.body.classList.contains('dark')?'Ativar modo claro':'Ativar modo escuro'); }
themeLabel();
$('#theme').addEventListener('click',()=>{ document.body.classList.toggle('dark'); themeLabel(); try { localStorage.setItem('vn-theme',document.body.classList.contains('dark')?'dark':'light'); } catch {} });
$('#news-image').addEventListener('change',()=>{
  feedback(''); $('#ocr-area').hidden=true; $('#ocr-text').value=''; $('#image-preview').hidden=true;
  if (state.preview) URL.revokeObjectURL(state.preview);
  const file=$('#news-image').files[0];
  if (!file) return;
  if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size>5*1024*1024) { $('#news-image').value=''; feedback('Use uma imagem JPG, PNG ou WEBP de até 5 MB.'); return; }
  state.preview=URL.createObjectURL(file); $('#image-preview').src=state.preview; $('#image-preview').hidden=false;
});
$('#extract-image').addEventListener('click',async()=>{
  const file=$('#news-image').files[0]; if (!file) return feedback('Escolha uma imagem primeiro.');
  const button=$('#extract-image'); button.disabled=true; button.textContent='Extraindo texto…'; feedback('');
  try { const form=new FormData(); form.append('image',file); const result=await api('/ocr',{method:'POST',body:form}); $('#ocr-text').value=result.text; $('#ocr-area').hidden=false; $('#ocr-text').focus(); feedback(result.warning); }
  catch(error) { feedback(error.message); }
  finally { button.disabled=false; button.textContent='Extrair texto da imagem'; }
});
$('#check-form').addEventListener('submit',async event=>{
  event.preventDefault(); if (state.checking) return;
  if (!$('#consent').checked) return feedback('Leia a política de privacidade e aceite o processamento do conteúdo para continuar.');
  const input={type:state.tab,consent:true,coverage:$('#coverage').value};
  if (state.tab==='url') { try { const url=new URL($('#news-url').value); if (!['http:','https:'].includes(url.protocol)) throw new Error(); input.url=url.href; } catch { return feedback('Informe uma URL HTTP ou HTTPS válida.'); } }
  else { input.text=$(state.tab==='text'?'#news-text':'#ocr-text').value.trim(); if (input.text.length<20 || input.text.length>20000) return feedback('O texto precisa ter entre 20 e 20.000 caracteres. Para imagens, extraia e revise o texto primeiro.'); }
  feedback(''); busy(true); $('#progress').hidden=false; $('#progress-title').textContent='Preparando conteúdo…'; $('#resultado').hidden=true;
  try { const result=await api('/checks',{method:'POST',body:JSON.stringify(input)}); state.pollCount=0; await poll(result.id); }
  catch(error) { busy(false); $('#progress').hidden=true; feedback(error.message); }
});
async function poll(id) {
  clearTimeout(state.poll);
  try {
    const item=await api(`/checks/${id}`); state.current=item;
    if (item.status==='complete') { busy(false); $('#progress').hidden=true; renderResult(item); await history(); return; }
    if (item.status==='failed') { busy(false); $('#progress').hidden=true; feedback(item.error); await history(); return; }
    busy(true); $('#progress').hidden=false;
    $('#progress-title').textContent=`${labels[item.status] || 'Analisando…'}${item.progress?.total?` Alegação ${item.progress.current} de ${item.progress.total}.`:''}`;
    const stages=['claims','search','compare'];
    document.querySelectorAll('[data-stage]').forEach(node=>{ node.classList.toggle('active',node.dataset.stage===item.status); node.classList.toggle('done',stages.indexOf(node.dataset.stage)<stages.indexOf(item.status)); });
    // Sem falsa porcentagem; etapas podem se repetir para cada alegação.
    state.pollCount++;
    if (state.pollCount>180) { busy(false); $('#progress').hidden=true; feedback('A análise continua no servidor. Consulte o histórico para acompanhar.'); return; }
    state.poll=setTimeout(()=>poll(id),5000);
  } catch(error) { busy(false); $('#progress').hidden=true; feedback(`${error.message} Consulte o histórico para retomar o acompanhamento.`); }
}
function safeLink(source) {
  const anchor=el('a',source.title || source.url);
  try { const url=new URL(source.url); if (!['http:','https:'].includes(url.protocol)) return el('span','Endereço de fonte inválido'); anchor.href=url.href; anchor.target='_blank'; anchor.rel='noopener noreferrer'; } catch { return el('span','Endereço de fonte inválido'); }
  return anchor;
}
function renderResult(item) {
  const result=item.result; if (!result) return;
  const container=$('#result-content'); container.replaceChildren();
  const overview=el('div',undefined,'result-overview'); overview.append(badge(result.classification),el('p',result.summary),el('div',`Verificado em ${date(result.checkedAt)} · Entrada: ${item.input_type==='url'?'URL':item.input_type==='image'?'imagem (texto revisado)':'texto'}`, 'result-meta'));
  if (item.metadata?.title) overview.append(el('p',`Artigo: ${item.metadata.title}`));
  if (item.metadata?.author || item.metadata?.publishedAt) overview.append(el('div',`Autoria: ${item.metadata.author || 'Não informada'} · Publicação: ${date(item.metadata.publishedAt)}`,'result-meta'));
  container.append(overview);
  result.claims.forEach((claim,index)=>{
    const card=el('article',undefined,'claim'); card.append(badge(claim.classification),el('h3',`${index+1}. ${claim.text}`),el('p',claim.explanation));
    claim.evidence.forEach(evidence=>{ const source=result.sources.find(s=>s.id===evidence.sourceId); if (!source) return; const quote=el('blockquote'); const cite=el('cite',`${evidence.relation.toUpperCase()} · `); cite.append(safeLink(source)); quote.append(el('p',`“${evidence.quote}”`),cite); card.append(quote); });
    if (claim.limitations.length) { const list=el('ul',undefined,'limitations'); claim.limitations.forEach(text=>list.append(el('li',text))); card.append(list); }
    container.append(card);
  });
  const details=el('details'); details.open=true; details.append(el('summary',`Fontes consultadas (${result.sources.length})`)); const list=el('ul',undefined,'source-list');
  result.sources.forEach(source=>{ const row=el('li'); row.append(safeLink(source),el('small',`${source.accessed?'Página acessada':'Página não acessível; não usada como prova'} · Publicação: ${date(source.publishedAt)} · Acesso: ${date(source.accessedAt)}`)); if (source.author) row.append(el('small',`Autoria: ${source.author}`)); list.append(row); }); details.append(list); container.append(details);
  const limitations=el('ul',undefined,'limitations'); result.warnings.forEach(text=>limitations.append(el('li',text))); container.append(limitations);
  $('#resultado').hidden=false; $('#resultado').scrollIntoView({behavior:'smooth',block:'start'}); $('#copy-status').textContent='';
}
async function history() {
  const list=$('#history-list');
  try { const items=await api('/checks'); list.replaceChildren();
    if (!items.length) { const empty=el('div','Seu histórico começa com a primeira pergunta.', 'empty'); empty.append(el('br'),el('span','As verificações desta sessão aparecerão aqui.')); list.append(empty); return; }
    items.forEach(item=>{ const row=el('div',undefined,'history-row'); const open=el('button',undefined,'history-open'); open.type='button'; open.append(el('strong',item.title),el('small',`${date(item.created_at)} · ${item.input_type}`)); open.addEventListener('click',async()=>{ if (state.checking && state.current?.id!==item.id) return feedback('Aguarde a análise em andamento antes de abrir outra.'); state.pollCount=0; await poll(item.id); }); const remove=el('button','Excluir','text-button'); remove.type='button'; remove.setAttribute('aria-label',`Excluir verificação: ${item.title}`); remove.addEventListener('click',async()=>{ if (!confirm('Excluir esta verificação?')) return; try { await api(`/checks/${item.id}`,{method:'DELETE'}); if (state.current?.id===item.id) { clearTimeout(state.poll); busy(false); state.current=null; $('#resultado').hidden=true; $('#progress').hidden=true; } await history(); } catch(error) { feedback(error.message); } }); row.append(open,item.classification?badge(item.classification):el('small',labels[item.status] || item.status),remove); list.append(row); });
  } catch(error) { list.replaceChildren(el('div',error.message,'empty')); }
}
$('#refresh-history').addEventListener('click',history);
$('#clear-history').addEventListener('click',async()=>{ if (!confirm('Excluir todas as verificações desta sessão? Esta ação não pode ser desfeita.')) return; try { await api('/checks',{method:'DELETE'}); clearTimeout(state.poll); state.current=null; busy(false); $('#resultado').hidden=true; $('#progress').hidden=true; await history(); } catch(error) { feedback(error.message); } });
function shareText() {
  const result=state.current?.result; if (!result) return '';
  return ['VerificaNews',`Verificado em ${date(result.checkedAt)}`,`Síntese: ${result.classification}`,result.summary,...result.claims.flatMap((c,i)=>[`${i+1}. ${c.text} — ${c.classification}`,c.explanation,...c.evidence.map(e=>{ const source=result.sources.find(s=>s.id===e.sourceId); return `${e.relation}: “${e.quote}” (${source?.url || ''})`; }),...c.limitations]),'Limitações:',...result.warnings].join('\n\n');
}
$('#copy-result').addEventListener('click',async()=>{ try { await navigator.clipboard.writeText(shareText()); $('#copy-status').textContent='Resultado copiado com fontes e ressalvas.'; } catch { $('#copy-status').textContent='Não foi possível acessar a área de transferência. Selecione e copie o texto do resultado.'; } });
$('#share-result').addEventListener('click',async()=>{ try { if (navigator.share) await navigator.share({title:'VerificaNews — resultado',text:shareText()}); else { await navigator.clipboard.writeText(shareText()); $('#copy-status').textContent='Resultado copiado para compartilhar, com fontes e ressalvas.'; } } catch(error) { if (error.name!=='AbortError') $('#copy-status').textContent='Compartilhamento indisponível. Use Copiar resultado.'; } });
(async()=>{ try { const status=await api('/status'); state.csrf=status.csrfToken; if ($('#api-settings')) { $('#api-settings').hidden=!status.localSetup||(status.ai&&status.search); if($('#connection-tools'))$('#connection-tools').hidden=!status.localSetup; if(status.localSetup) { $('#gemini-model').value=status.model||'gemini-3.5-flash-lite'; document.querySelector('.history > p.helper').textContent=status.storage==='file'?'Histórico salvo neste computador, associado a este navegador. Até 50 registros recentes.':'Histórico temporário enquanto o servidor estiver aberto.'; } } $('#retention').textContent=status.retentionDays; const missing=[!status.database&&'banco de dados',!status.ai&&'IA',!status.search&&'pesquisa'].filter(Boolean); $('#service-status').textContent=missing.length?`Configuração pendente: ${missing.join(', ')}. Preencha as chaves nos campos abaixo para começar.`:'Credenciais carregadas · Pronto para pesquisar. Use Testar conexão antes de apresentar.'; $('#service-status').classList.toggle('warning',Boolean(missing.length)); await history(); } catch { $('#service-status').textContent='Não foi possível conectar ao servidor. Tente recarregar a página.'; $('#service-status').classList.add('warning'); } })();

$('#api-settings')?.addEventListener('submit',async event=>{event.preventDefault();const button=$('#save-keys');button.disabled=true;$('#settings-message').textContent='Conectando ao servidor local…';try{const result=await api('/local-settings',{method:'POST',body:JSON.stringify({geminiKey:$('#gemini-key').value.trim(),tavilyKey:$('#tavily-key').value.trim(),model:$('#gemini-model').value.trim(),persist:$('#remember-keys').checked})});$('#gemini-key').value='';$('#tavily-key').value='';$('#settings-message').textContent=result.message;$('#service-status').textContent='Chaves configuradas. Cole uma notícia abaixo para testar IA e pesquisa reais.';$('#service-status').classList.remove('warning'); $('#api-settings').hidden=true;}catch(error){$('#settings-message').textContent=error.message;}finally{button.disabled=false;}});

$('#toggle-settings').addEventListener('click',()=>{$('#api-settings').hidden=!$('#api-settings').hidden;});
$('#test-services').addEventListener('click',async()=>{const button=$('#test-services');button.disabled=true;button.textContent='Testando…';const box=$('#diagnostics-result');box.hidden=false;box.textContent='Testando acesso real ao Gemini e ao Tavily. Isso utiliza a cota das suas APIs.';try{const result=await api('/diagnostics',{method:'POST',body:'{}'});box.replaceChildren();result.checks.forEach(check=>box.append(el('p',(check.ok?'✓ ':'⚠ ')+check.service+': '+check.message)));}catch(error){box.textContent=error.message;}finally{button.disabled=false;button.textContent='Testar conexão';}});
$('#presentation-mode').addEventListener('click',()=>{document.body.classList.toggle('presenting');$('#presentation-mode').textContent=document.body.classList.contains('presenting')?'Sair da apresentação':'Modo apresentação';});
$('#download-result').addEventListener('click',()=>{const content=shareText();if(!content)return;const url=URL.createObjectURL(new Blob([content],{type:'text/plain;charset=utf-8'}));const anchor=document.createElement('a');anchor.href=url;anchor.download='VerificaNews-relatorio.txt';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
$('#print-result').addEventListener('click',()=>window.print());
