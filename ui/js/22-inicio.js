'use strict';
// Selecta 3D — interface, parte 22 de 22: 22-inicio.js. Os arquivos de ui/js/ são carregados em ordem pelo
// index.html e dividem o mesmo escopo global (scripts comuns, sem compilação). Dividido do antigo ui/app.js em fila-v27 (A17).
// ------------------------------------------------------------------ início
// links das etiquetas com QR: #rolo=R07, #insumo=I01, #peca=F07
async function lerCompartilhado() {
  try {
    const c = await caches.open('org3d-compartilhado');
    const r = await c.match('/compartilhado/dados');
    if (!r) return null;
    const d = await r.json();
    const ri = await c.match('/compartilhado/imagem');
    if (ri) {
      try { d.imagem = await reduzirImagem(await ri.blob(), 'compartilhada'); } catch (e) { aviso(e.message, true); }
    }
    await c.delete('/compartilhado/dados');
    await c.delete('/compartilhado/imagem');
    return d;
  } catch { return null; }
}

// "Compartilhar" de outro app (link, texto ou imagem) ou link no endereço (?link=…)
async function abrirCompartilhado() {
  const q = new URLSearchParams(location.search);
  let d = null;
  if (q.has('compartilhado')) d = await lerCompartilhado();
  else if (q.get('link') || q.get('texto') || q.get('titulo')) d = { titulo: q.get('titulo') || '', texto: q.get('texto') || '', link: q.get('link') || '' };
  if (!q.has('compartilhado') && !d) return false;
  history.replaceState(null, '', location.pathname);
  if (!d || !E.dados) return !!d;
  const m = [d.link, d.texto, d.titulo].filter(Boolean).join(' ').match(/https?:\/\/[^\s<>"']+/);
  let titulo = String(d.titulo || '').trim();
  if (/^https?:/.test(titulo)) titulo = '';
  if (!titulo && d.texto && m) titulo = d.texto.replace(m[0], '').trim().slice(0, 140);
  if (m) { perguntarDestino(m[0], { titulo, imagem: d.imagem, origem: 'compartilhado' }); return true; }
  if (d.imagem) {
    irPara('referencias');
    abrirReferencia(null, { 'Título': titulo });
    anexarImagemRef(d.imagem);
    return true;
  }
  aviso('O que foi compartilhado não tem link nem imagem.', true);
  return true;
}

async function abrirPorEndereco() {
  if (await abrirCompartilhado()) return;
  const aba = location.hash.slice(1);
  if (E.dados && ABAS.some((a) => a.id === aba)) {
    history.replaceState(null, '', location.pathname + location.search);
    irPara(aba);
    return;
  }
  const m = location.hash.match(/^#(rolo|insumo|peca)=([A-Z]\d+)$/);
  if (!m || !E.dados) return;
  history.replaceState(null, '', location.pathname + location.search);
  const [, tipo, id] = m;
  if (tipo === 'rolo') {
    const r = linhas('filamentos').find((x) => x.ID === id);
    irPara('estoque');
    if (r) abrirMovimentarRolo(r);
  } else if (tipo === 'insumo') {
    const r = linhas('insumos').find((x) => x.ID === id);
    irPara('estoque');
    if (r) abrirFormulario('insumo', r);
  } else {
    const r = acharFila(id);
    irPara('fila');
    if (r) abrirRegistrar(r);
  }
}
window.addEventListener('hashchange', abrirPorEndereco);

// app instalável no celular (precisa de HTTPS: endereço do Tailscale)
function registrarApp() {
  if (!E.dados || !E.dados.remoto || !window.isSecureContext || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('service worker', e));
}

renderMenu();
lerEspera().then((x) => { if (x && Array.isArray(x.ops)) E.esperando = { ops: [], falhas: [], seq: 0, mapa: {}, ...x }; })
  .then(carregar).then(abrirPorEndereco).then(() => verificarAreaDeTransferencia()).then(() => agendarRevisaoImagens()).then(registrarApp).then(() => carregarArquivos()).then(() => { if (['arquivos', 'projetos', 'fila'].includes(E.aba)) render(); gerarMiniaturasFaltando(); });

// botões "Copiar" (endereços do celular e da extensão)
document.addEventListener('click', async (ev) => {
  const b = ev.target.closest && ev.target.closest('[data-copiar]');
  if (!b) return;
  try { await navigator.clipboard.writeText(b.dataset.copiar); aviso('Copiado.'); } catch { aviso('Não consegui copiar; selecione o texto.', true); }
});

// link colado (Ctrl+V) na aba Referências, fora de um campo de texto (ou na busca)
document.addEventListener('paste', (ev) => {
  if (E.aba !== 'referencias' || modalAberto() || !E.dados) return;
  const alvo = ev.target;
  const campo = alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA' || alvo.isContentEditable);
  if (campo && alvo.id !== 'busca-referencias') return;
  const m = ((ev.clipboardData && ev.clipboardData.getData('text')) || '').trim().match(/^https?:\/\/\S+$/);
  if (!m) return;
  ev.preventDefault();
  abrirLinkColado(m[0]);
});

document.addEventListener('focusin', (ev) => { if (ev.target.id === 'ref-tags') atualizarSugestoesTags(true); });
document.addEventListener('input', (ev) => {
  if (['ref-tags', 'ref-titulo', 'ref-obs', 'ref-link', 'ref-site'].includes(ev.target.id)) atualizarSugestoesTags();
});
document.addEventListener('change', (ev) => { if (ev.target.closest && ev.target.closest('#ref-projetos')) atualizarSugestoesTags(); });

// link colado no campo "Link" da referência: busca os dados na hora
document.addEventListener('input', (ev) => {
  if (ev.target.id === 'ref-link' && ev.inputType === 'insertFromPaste' && /^https?:\/\//.test(ev.target.value.trim())) buscarDadosRef();
});

// imagem colada (Ctrl+V) no formulário de referência
document.addEventListener('paste', (ev) => {
  if (!$('#ref-previa')) return;
  const item = [...(ev.clipboardData ? ev.clipboardData.items : [])].find((i) => i.type.startsWith('image/'));
  if (!item) return;
  ev.preventDefault();
  lerImagemRef(item.getAsFile());
});

// imagem arrastada do navegador (ou do Explorer) para a prévia da referência
document.addEventListener('dragover', (ev) => {
  if (ev.target.closest && ev.target.closest('#ref-previa')) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; }
});
document.addEventListener('drop', (ev) => {
  const alvo = ev.target.closest && ev.target.closest('#ref-previa');
  if (!alvo) return;
  ev.preventDefault();
  const arquivo = [...ev.dataTransfer.files].find((f) => f.type.startsWith('image/'));
  if (arquivo) return lerImagemRef(arquivo);
  const html = ev.dataTransfer.getData('text/html') || '';
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  const linhasUri = (ev.dataTransfer.getData('text/uri-list') || '').split(String.fromCharCode(10));
  const url = (m ? m[1] : linhasUri.find((l) => /^https?:/i.test(l.trim())) || '').trim();
  if (!/^https?:/i.test(url)) return aviso('Não reconheci a imagem arrastada; tente Ctrl+V.', true);
  E.refImagem = { url };
  mostrarPreviaRef(url);
});

