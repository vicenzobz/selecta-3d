'use strict';
// Selecta 3D — interface, parte 19 de 22: 19-miniaturas.js. Os arquivos de ui/js/ são carregados em ordem pelo
// index.html e dividem o mesmo escopo global (scripts comuns, sem compilação). Dividido do antigo ui/app.js em fila-v27 (A17).
// ------------------------------------------------------------------ miniaturas (grade de arquivos)
const BANCO_MINI = 'org3d-miniaturas';
function bancoMini() {
  return new Promise((ok, erro) => {
    try {
      const req = indexedDB.open(BANCO_MINI, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('mini');
      req.onsuccess = () => ok(req.result);
      req.onerror = () => erro(req.error);
    } catch (e) { erro(e); }
  });
}
async function lerMiniCache(chave) {
  try {
    const db = await bancoMini();
    return await new Promise((ok) => { const r = db.transaction('mini').objectStore('mini').get(chave); r.onsuccess = () => ok(r.result || null); r.onerror = () => ok(null); });
  } catch { return null; }
}
async function gravarMiniCache(chave, valor) {
  try { const db = await bancoMini(); db.transaction('mini', 'readwrite').objectStore('mini').put(valor, chave); } catch { /* sem cache */ }
}

let filaMini = Promise.resolve();
let observador = null;
function observarMiniaturas() {
  if (observador) observador.disconnect();
  const els = $$('.mini[data-mini]');
  if (!els.length) return;
  observador = new IntersectionObserver((entradas) => {
    for (const en of entradas) {
      if (!en.isIntersecting) continue;
      observador.unobserve(en.target);
      carregarMiniatura(en.target);
    }
  }, { root: $('#conteudo'), rootMargin: '300px' });
  els.forEach((el) => {
    const pronta = E.miniaturas.get(el.dataset.chave);
    if (pronta) el.style.backgroundImage = `url("${pronta}")`; else observador.observe(el);
  });
}
// miniatura de um arquivo: a guardada no aparelho, a que o PC tem (do fatiador ou feita antes) ou, na janela
// do PC, desenhada agora e guardada no PC (o celular passa a ver também)
async function obterMiniatura(caminho, chave, tamanho, gerar = true) {
  let img = E.miniaturas.get(chave) || await lerMiniCache(chave);
  if (!img) {
    try {
      const r = await fetch(`/api/miniatura?caminho=${encodeURIComponent(caminho)}`, { headers: { 'X-Token': TOKEN } });
      if (r.ok) img = await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); r.blob().then((b) => fr.readAsDataURL(b)); });
    } catch { /* sem o PC */ }
  }
  if (!img && gerar && !E.dados.remoto && tamanho < 40 * 1024 * 1024) {
    try {
      const m = await import(new URL('visualizador.js', document.baseURI).href) /* relativo à página, não a ui/js/ */;
      img = await m.gerarMiniatura(`/api/modelo?caminho=${encodeURIComponent(caminho)}&t=${encodeURIComponent(TOKEN)}`, caminho);
      api('/api/miniatura/guardar', { caminho, dados: img }).catch(() => { /* fica só neste aparelho */ });
    } catch { /* arquivo que o three.js não lê */ }
  }
  if (img) {
    E.miniaturas.set(chave, img);
    gravarMiniCache(chave, img);
    const a = arquivoDe(caminho);
    if (a) a.mini = true;
  }
  return img;
}

function carregarMiniatura(el) {
  const caminho = el.dataset.mini, chave = el.dataset.chave, tamanho = +el.dataset.tamanho;
  el.classList.add('carregando');
  filaMini = filaMini.then(async () => {
    const img = await obterMiniatura(caminho, chave, tamanho);
    el.classList.remove('carregando');
    if (img) {
      $$(`.mini[data-chave="${CSS.escape(chave)}"]`).forEach((x) => { x.style.backgroundImage = `url("${img}")`; x.innerHTML = ''; });
      if (document.body.contains(el)) el.style.backgroundImage = `url("${img}")`;
    } else {
      el.innerHTML = `<span class="mini-ext">${E.dados.remoto ? 'sem prévia ainda' : 'sem prévia'}</span>`;
    }
  });
}

// arquivo novo na pasta (ou sem miniatura): a janela do PC desenha e guarda no PC, um por vez, sem pressa
async function gerarMiniaturasFaltando() {
  if (!E.dados || E.dados.remoto || E.gerandoMinis || !E.arquivos) return;
  E.gerandoMinis = true;
  try {
    for (const a of E.arquivos.filter((x) => eh3D(x.caminho) && !x.mini && x.tamanho < 40 * 1024 * 1024)) {
      while (E.vis || document.hidden) await new Promise((ok) => setTimeout(ok, 5000)); // visualizador aberto: espera
      const img = await (filaMini = filaMini.then(() => obterMiniatura(a.caminho, chaveMini(a), a.tamanho)));
      a.mini = true; // mesmo sem conseguir desenhar, não tenta de novo nesta abertura
      if (img) $$(`.mini[data-chave="${CSS.escape(chaveMini(a))}"]`).forEach((x) => { x.style.backgroundImage = `url("${img}")`; x.innerHTML = ''; });
      await new Promise((ok) => setTimeout(ok, 400));
    }
  } finally {
    E.gerandoMinis = false;
  }
}

// a cada minuto, no PC, confere se entraram arquivos 3D novos na pasta
setInterval(async () => {
  if (!E.dados || E.dados.remoto || E.salvando) return;
  const antes = (E.arquivos || []).map((a) => chaveMini(a)).join('\n');
  try { E.arquivos = await api('/api/arquivos'); } catch { return; }
  if (E.arquivos.map((a) => chaveMini(a)).join('\n') !== antes) {
    if (['arquivos', 'fila', 'projetos'].includes(E.aba) && !modalAberto()) render();
    gerarMiniaturasFaltando();
  }
}, 60000);

