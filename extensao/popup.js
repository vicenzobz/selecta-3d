// Selecta 3D — extensão do navegador.
// Lê a página aberta (nome, imagens, preço) e grava no programa do PC, que guarda tudo nos .md da pasta:
// referência (referencias.md), projeto novo (projetos.md) ou compra (compras.md).

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s || '').toLowerCase().trim();
const tela = $('#tela');
const Q = new URLSearchParams(location.search);
const JANELA = Q.has('link'); // aberta pelo menu do botão direito
if (JANELA) document.body.classList.add('janela');

const REF_TIPOS = ['quero fazer', 'referência'];
const PROJ_STATUS = ['ideia', 'ativo', 'pausado'];
const COMPRA_STATUS = ['a comprar', 'pedido', 'a caminho', 'recebido'];
const DESTINOS = [['referencia', 'Referência'], ['projeto', 'Projeto novo'], ['compra', 'Compra']];

let CFG = null; // { base, token }
let DADOS = null; // /api/tudo do programa
let PAG = null; // o que foi lido da página
let PRINT = null; // print da parte visível da página
let V = null; // valores do formulário (passam de uma aba para outra)
let DESTINO = 'referencia';

// ------------------------------------------------------------------ conversa com o programa
async function api(rota, corpo) {
  const op = { headers: { 'X-Token': CFG.token } };
  if (corpo !== undefined) {
    op.method = 'POST';
    op.headers['Content-Type'] = 'application/json';
    op.body = JSON.stringify(corpo);
  }
  let r;
  try { r = await fetch(CFG.base + rota, op); } catch {
    throw new Error('Não consegui falar com o programa. Ele está aberto no PC, com "Celular e extensão" ligado (botão Celular)?');
  }
  let j = null;
  try { j = await r.json(); } catch { /* sem corpo */ }
  if (r.status === 403 && j && /token/i.test(j.erro || '')) throw new Error('O código de acesso não confere. Clique na engrenagem e cole o endereço de novo.');
  if (!r.ok) throw new Error((j && j.erro) || `erro ${r.status}`);
  return j;
}

const linhas = (k) => (DADOS && DADOS[k] ? DADOS[k].linhas : []);

// parâmetros que não fazem parte do endereço: rastreio de campanha e o código de verificação do Cloudflare
const PARAMS_LIXO = /^(utm_|__cf_chl)|^(fbclid|gclid|igshid|mc_cid|mc_eid)$/i;
function limparLink(u) {
  try {
    const x = new URL(String(u).trim());
    const lixo = [...x.searchParams.keys()].filter((k) => PARAMS_LIXO.test(k));
    if (!lixo.length) return String(u).trim();
    lixo.forEach((k) => x.searchParams.delete(k));
    return x.href;
  } catch { return String(u || '').trim(); }
}

// mesmo link com ou sem www, barra no fim, #âncora, utm_ ou código do Cloudflare
function chaveLink(u) {
  try {
    const x = new URL(String(u).trim());
    [...x.searchParams.keys()].filter((k) => PARAMS_LIXO.test(k)).forEach((k) => x.searchParams.delete(k));
    return (x.host.replace(/^www\./, '') + x.pathname.replace(/\/+$/, '') + x.search).toLowerCase();
  } catch { return norm(u); }
}

function nomeDoSite(url, doSite) {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { return doSite || ''; }
  for (const [trecho, nome] of (DADOS && DADOS.sites) || []) if (host.includes(trecho)) return nome;
  return doSite || host.replace(/^www\./, '');
}

function precoBR(p) {
  const s = String(p || '').replace(/[^\d.,]/g, '');
  if (!s) return '';
  const ult = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  const n = ult >= 0 && s.length - ult - 1 <= 2
    ? parseFloat(s.slice(0, ult).replace(/[.,]/g, '') + '.' + s.slice(ult + 1))
    : parseFloat(s.replace(/[.,]/g, ''));
  return Number.isFinite(n) ? n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
}

// ------------------------------------------------------------------ leitura da página (roda dentro da aba)
function extrairDaPagina() {
  const meta = (...nomes) => {
    for (const n of nomes) {
      const el = document.querySelector(`meta[property="${n}"],meta[name="${n}"],meta[itemprop="${n}"]`);
      if (el && el.content) return el.content.trim();
    }
    return '';
  };
  const abs = (u) => { try { return new URL(u, location.href).href; } catch { return ''; } };
  let ld = {};
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const j = JSON.parse(s.textContent);
      for (const it of [].concat(j['@graph'] || j)) {
        if (/Product|CreativeWork|3DModel|Article|VideoObject|Recipe|HowTo/i.test([].concat(it['@type'] || []).join(' '))) { ld = it; break; }
      }
    } catch { /* JSON quebrado */ }
    if (ld['@type']) break;
  }
  const oferta = ld.offers ? [].concat(ld.offers)[0] : null;
  const precoEl = document.querySelector('[itemprop="price"]');
  const preco = meta('product:price:amount', 'og:price:amount') || (oferta && (oferta.price || oferta.lowPrice))
    || (precoEl && (precoEl.getAttribute('content') || precoEl.textContent)) || '';
  const moeda = meta('product:price:currency', 'og:price:currency') || (oferta && oferta.priceCurrency) || '';
  const autorLd = ld.author ? [].concat(ld.author)[0] : null;
  const imagens = [];
  const somar = (u) => { u = abs(u); if (u && /^https?:/.test(u) && !imagens.includes(u)) imagens.push(u); };
  const capa = meta('og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src');
  if (capa) somar(capa);
  if (ld.image) { const im = [].concat(ld.image)[0]; somar(typeof im === 'string' ? im : im && im.url); }
  [...document.images]
    .filter((i) => i.naturalWidth >= 180 && i.naturalHeight >= 140 && i.getBoundingClientRect().width >= 90)
    .sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight)
    .slice(0, 12).forEach((i) => somar(i.currentSrc || i.src));

  // licença: link Creative Commons, dados da página (MakerWorld e outros guardam em JSON) ou o texto
  const idLicenca = (t) => {
    t = String(t || '');
    let m = t.match(/creativecommons\.org\/licenses\/(by(?:-(?:nc|sa|nd)){0,2})\/(\d\.\d)/i);
    if (m) return `CC ${m[1].toUpperCase()} ${m[2]}`;
    if (/creativecommons\.org\/publicdomain\/zero|\bCC0\b/i.test(t)) return 'CC0';
    m = t.match(/\bCC[ _-]?BY((?:[ _-]?(?:NC|SA|ND)){0,2})(?:[ _-]?(\d\.\d))?\b/i);
    if (m) return 'CC ' + ['BY', ...(m[1].match(/NC|SA|ND/gi) || []).map((x) => x.toUpperCase())].join('-') + (m[2] ? ' ' + m[2] : '');
    m = t.match(/^\s*(BY(?:[-_ ](?:NC|SA|ND)){0,2})\s*$/i);
    if (m) return 'CC ' + m[1].toUpperCase().replace(/[_ ]/g, '-');
    m = t.match(/creative\s*commons/i);
    if (m) {
      const tr = t.slice(m.index + m[0].length, m.index + m[0].length + 160);
      if (/^\W{0,6}(public\s*domain|dom[ií]nio|zero)/i.test(tr)) return 'CC0';
      if (/attribution|atribui[cç][aã]o|\bBY\b/i.test(tr)) {
        const p = ['BY'];
        if (/non[\s-]*commercial|n[aã]o[\s-]*comercial|\bNC\b/i.test(tr)) p.push('NC');
        if (/share[\s-]*alike|compartilha[\s-]*igual|\bSA\b/i.test(tr)) p.push('SA');
        if (/no[\s-]*deriv|sem[\s-]*deriva|\bND\b/i.test(tr)) p.push('ND');
        const v = tr.match(/\b(\d\.\d)\b/);
        return 'CC ' + p.join('-') + (v ? ' ' + v[1] : '');
      }
    }
    m = t.match(/standard\s+digital\s+file\s+license|\bGNU\s*L?GPL(?:\s*v?\d(?:\.\d)?)?/i);
    return m ? m[0].replace(/\s+/g, ' ') : '';
  };
  let licenca = '';
  for (const a of document.querySelectorAll('a[href*="creativecommons.org"], a[rel~="license"]')) { licenca = idLicenca(a.href); if (licenca) break; }
  if (!licenca && typeof ld.license === 'string') licenca = idLicenca(ld.license) || ld.license;
  if (!licenca) {
    for (const s of document.querySelectorAll('script#__NEXT_DATA__, script[type="application/json"]')) {
      const m = (s.textContent || '').match(/"licen[cs]e(?:Type|Name)?"\s*:\s*"([^"]{2,80})"/i);
      if (m) { licenca = idLicenca(m[1]) || (/licen|copyright|personal|standard/i.test(m[1]) ? m[1] : ''); if (licenca) break; }
    }
  }
  if (!licenca) {
    const texto = (document.body && document.body.innerText || '').slice(0, 300000);
    const rotulo = texto.match(/(licen[cç]a|license)\s*[:\n]\s*([^\n]{2,120})/i);
    licenca = (rotulo && idLicenca(rotulo[2])) || idLicenca(texto);
  }
  return {
    url: location.href,
    titulo: meta('og:title', 'twitter:title') || ld.name || document.title || '',
    descricao: (meta('og:description', 'description', 'twitter:description') || ld.description || '').slice(0, 400),
    site: meta('og:site_name'),
    autor: meta('author', 'article:author') || (autorLd && (autorLd.name || (typeof autorLd === 'string' ? autorLd : ''))) || '',
    licenca,
    preco: String(preco || '').trim(),
    moeda,
    imagens: imagens.slice(0, 10),
  };
}

// imagem que o servidor do site não deixou baixar: tenta pela própria página (mesmos cookies e origem)
async function imagemDentroDaPagina(src) {
  const paraDados = (blob) => new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = () => ok(null); fr.readAsDataURL(blob); });
  try {
    const r = await fetch(src, { credentials: 'include' });
    const b = await r.blob();
    if (r.ok && b.type.startsWith('image/')) return await paraDados(b);
  } catch { /* bloqueada */ }
  try {
    const img = [...document.images].find((i) => (i.currentSrc || i.src) === src);
    if (!img) return null;
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return c.toDataURL('image/jpeg', 0.9);
  } catch { return null; }
}

async function lerPagina() {
  const idAba = Number(Q.get('aba')) || null;
  let aba = null;
  if (idAba) aba = await chrome.tabs.get(idAba).catch(() => null);
  else [aba] = await chrome.tabs.query({ active: true, currentWindow: true });
  const link = Q.get('link');

  // "Salvar link" do botão direito: a página do link não está aberta; quem lê é o programa
  if (link && (!aba || chaveLink(link) !== chaveLink(aba.url))) {
    let d = {};
    try { d = await api('/api/referencia/ler', { url: link }); } catch { /* fica só com o link */ }
    return {
      url: d.link || link, titulo: Q.get('nome') || d.titulo || '', descricao: d.descricao || '', autor: d.autor || '',
      licenca: d.licenca || '', site: '', preco: '', moeda: '', imagens: [Q.get('imagem'), d.imagem].filter(Boolean),
      aviso: d.erro ? 'O site não deixou o programa ler a página: confira o nome. A imagem pode ser escolhida depois, no programa.' : '',
    };
  }
  if (!aba) return { url: '', titulo: '', imagens: [] };
  let info = { url: aba.url || '', titulo: aba.title || '', imagens: [] };
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: aba.id }, func: extrairDaPagina });
    info = { ...info, ...result };
  } catch {
    info.aviso = 'Não deu para ler esta página (as páginas internas do navegador ficam de fora).';
  }
  if (Q.get('imagem')) info.imagens = [Q.get('imagem'), ...info.imagens.filter((u) => u !== Q.get('imagem'))];
  info.abaId = aba.id;
  try { PRINT = await chrome.tabs.captureVisibleTab(aba.windowId, { format: 'jpeg', quality: 82 }); } catch { PRINT = null; }
  return info;
}

// ------------------------------------------------------------------ telas
function telaConfig(msg = '') {
  const atual = CFG ? `${CFG.base}/?t=${CFG.token}` : '';
  tela.innerHTML = `
    <h1>Conectar ao programa</h1>
    <p>No Selecta 3D do PC, clique em <b>Celular</b> (no menu), ligue <b>celular e extensão</b> e copie o endereço da parte <b>Extensão do navegador</b>.</p>
    <label>Endereço do programa<input id="cfg-end" placeholder="http://127.0.0.1:8765/?t=…" value="${esc(atual)}" spellcheck="false"></label>
    ${msg ? `<div class="aviso erro">${esc(msg)}</div>` : ''}
    <div class="acoes"><button class="primario" id="cfg-ok">Conectar</button></div>`;
  $('#cfg-end').focus();
  $('#cfg-ok').onclick = conectar;
  $('#cfg-end').onkeydown = (e) => { if (e.key === 'Enter') conectar(); };
}

async function conectar() {
  let u;
  try { u = new URL($('#cfg-end').value.trim()); } catch { return telaConfig('Cole o endereço inteiro, começando com http.'); }
  const token = u.searchParams.get('t');
  if (!token) return telaConfig('O endereço precisa terminar com o código ?t=…');
  const base = u.origin;
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) {
    const ok = await chrome.permissions.request({ origins: [base + '/*'] }).catch(() => false);
    if (!ok) return telaConfig('Sem permissão para falar com esse endereço.');
  }
  CFG = { base, token };
  try { await api('/api/versao'); } catch (e) { return telaConfig(e.message); }
  await chrome.storage.local.set({ org3d: CFG });
  iniciar();
}

function telaErro(msg) {
  tela.innerHTML = `<div class="aviso erro">${esc(msg)}</div>
    <div class="acoes"><button id="de-novo" class="primario">Tentar de novo</button></div>`;
  $('#de-novo').onclick = iniciar;
}

function valoresIniciais() {
  const loja = (DADOS.lojas || []).includes(nomeDoSite(PAG.url, PAG.site));
  const moedaOk = !PAG.moeda || /^BRL$/i.test(PAG.moeda);
  DESTINO = loja || (PAG.preco && moedaOk) ? 'compra' : 'referencia';
  const titulo = String(PAG.titulo || '').replace(/\s+[|·–—-]\s+[^|·–—-]{2,40}$/, '').trim(); // tira " | Printables"
  return {
    nome: titulo,
    nomeProjeto: titulo,
    link: limparLink(PAG.url),
    site: nomeDoSite(PAG.url, PAG.site),
    autor: PAG.autor || '',
    licenca: PAG.licenca || '',
    tipo: 'quero fazer',
    projetos: new Set(),
    tags: '',
    obs: '',
    descricao: PAG.descricao || '',
    projStatus: 'ideia',
    guardarRef: true,
    loja: nomeDoSite(PAG.url, PAG.site),
    valor: moedaOk ? precoBR(PAG.preco) : '',
    obsCompra: !moedaOk && PAG.preco ? `Preço na página: ${PAG.moeda} ${PAG.preco}` : '',
    compraStatus: 'a comprar',
    imagem: PAG.imagens.length ? 0 : (PRINT ? 'print' : 'nenhuma'),
  };
}

function montar() {
  if (!V) V = valoresIniciais();
  let host = '';
  try { host = new URL(PAG.url).hostname.replace(/^www\./, ''); } catch { /* sem link */ }
  tela.innerHTML = `
    <div class="origem"><div style="min-width:0"><div class="site">${esc(V.site || host || 'Página')}</div><div class="url" title="${esc(PAG.url)}">${esc(PAG.url)}</div></div></div>
    <div class="abas">${DESTINOS.map(([k, n]) => `<button data-destino="${k}" class="${k === DESTINO ? 'ativo' : ''}">${n}</button>`).join('')}</div>
    ${PAG.aviso ? `<div class="aviso">${esc(PAG.aviso)}</div>` : ''}
    <div id="duplicado"></div>
    <div id="form">${formulario()}</div>
    <div id="msg"></div>
    <div class="acoes"><button id="salvar" class="primario">${textoSalvar()}</button></div>
    <div class="dica">Atalho: <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> abre esta janela · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> salva.</div>`;
  mostrarDuplicado();
}

const textoSalvar = () => ({ referencia: 'Salvar referência', projeto: 'Criar projeto', compra: 'Salvar compra' }[DESTINO]);

function chipsProjetos() {
  const ativos = linhas('projetos').filter((p) => !['concluído', 'cancelado'].includes(p.Status));
  if (!ativos.length) return '';
  return `<label>Projetos relacionados<div class="chips">${ativos.map((p) => `<button type="button" class="chip ${V.projetos.has(p.ID) ? 'ativo' : ''}" data-projeto="${esc(p.ID)}" title="${esc(p.Projeto)}">${esc(p.ID)} · ${esc(p.Projeto)}</button>`).join('')}</div></label>`;
}

// tags que já existem, as relacionadas com esta página primeiro (mesma conta do programa)
const semAcento = (t) => norm(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const tagsDe = (r) => String(r.Tags || '').split(/[,;]+/).map((t) => norm(t)).filter(Boolean);
const projetosDe = (texto) => String(texto || '').split(/[\s,]+/).filter((p) => /^P\d+$/.test(p));

// "a, b, pan" → escolhidas [a, b] e o pedaço "pan" sendo digitado; "a, pandeiro" → as duas escolhidas
function lerCampoTags(valor) {
  const partes = String(valor || '').split(',').map((t) => t.trim());
  const ultimo = partes.pop() || '';
  const existentes = new Set(linhas('referencias').flatMap(tagsDe).map(semAcento));
  const completo = !ultimo || existentes.has(semAcento(ultimo));
  return { escolhidas: [...partes.filter(Boolean), ...(completo && ultimo ? [ultimo] : [])], fragmento: completo ? '' : ultimo };
}

function sugerirTags() {
  const refs = linhas('referencias');
  const campo = lerCampoTags(V.tags);
  const fragmento = semAcento(campo.fragmento);
  const ja = new Set(campo.escolhidas.map(semAcento));
  const total = new Map(), pontos = new Map();
  for (const r of refs) for (const t of new Set(tagsDe(r))) total.set(t, (total.get(t) || 0) + 1);
  const somar = (t, p) => { if (!ja.has(semAcento(t))) pontos.set(t, (pontos.get(t) || 0) + p); };
  const projs = [...V.projetos];
  for (const r of refs) {
    const ts = new Set(tagsDe(r));
    const comuns = [...ts].filter((t) => ja.has(semAcento(t))).length;
    if (comuns) ts.forEach((t) => somar(t, 3 * comuns));
    if (projs.length && projetosDe(r.Projeto).some((x) => projs.includes(x))) ts.forEach((t) => somar(t, 2));
    if (V.site && r.Site === V.site) ts.forEach((t) => somar(t, 0.5));
  }
  const alvo = ' ' + semAcento([V.nome, V.nomeProjeto, V.link, V.descricao, V.obs].join(' ')).replace(/[^a-z0-9]+/g, ' ') + ' ';
  for (const t of total.keys()) {
    const tt = semAcento(t).replace(/[^a-z0-9]+/g, ' ').trim();
    if (tt.length >= 3 && (alvo.includes(' ' + tt + ' ') || alvo.includes(' ' + tt.replace(/s$/, '') + ' '))) somar(t, 5);
  }
  return [...total.keys()].filter((t) => !ja.has(semAcento(t)) && (!fragmento || semAcento(t).includes(fragmento)))
    .sort((a, b) => (pontos.get(b) || 0) - (pontos.get(a) || 0) || total.get(b) - total.get(a) || a.localeCompare(b, 'pt-BR'))
    .map((t) => ({ tag: t, n: total.get(t), relacionada: (pontos.get(t) || 0) >= 1 }));
}

function chipsDeTags() {
  const lista = sugerirTags().slice(0, 14);
  return lista.map((x) => `<button type="button" class="chip ${x.relacionada ? 'relacionada' : ''}" data-tag="${esc(x.tag)}" title="${x.relacionada ? 'Relacionada com esta página' : 'Já usada'} · ${x.n}">#${esc(x.tag)}</button>`).join('');
}

function chipsTags() {
  return `<label>Tags<input data-v="tags" value="${esc(V.tags)}" placeholder="separadas por vírgula" autocomplete="off">
    <div class="chips" id="chips-tags">${chipsDeTags()}</div>
    <div class="dica-tags">Em verde: relacionadas com esta página.</div></label>`;
}

function seletorImagens() {
  const opcoes = PAG.imagens.map((u, i) => `<button type="button" data-imagem="${i}" class="${V.imagem === i ? 'ativo' : ''}" style="background-image:url('${esc(u)}')" title="Imagem da página"></button>`);
  if (PRINT) opcoes.push(`<button type="button" data-imagem="print" class="${V.imagem === 'print' ? 'ativo' : ''}" style="background-image:url('${PRINT}')" title="Print da parte visível da página"></button>`);
  opcoes.push(`<button type="button" data-imagem="nenhuma" class="${V.imagem === 'nenhuma' ? 'ativo' : ''}">sem imagem</button>`);
  return `<label>Imagem${PRINT ? ' <span style="font-weight:400;color:var(--texto-3)">(a última com fundo é o print da tela)</span>' : ''}<div class="imagens">${opcoes.join('')}</div></label>`;
}

function formulario() {
  if (DESTINO === 'compra') {
    return `
      <label>Item<input data-v="nome" value="${esc(V.nome)}"></label>
      <div class="duas">
        <label>Loja<input data-v="loja" value="${esc(V.loja)}"></label>
        <label>Valor (R$)<input data-v="valor" value="${esc(V.valor)}" placeholder="ex.: 89,90" inputmode="decimal"></label>
      </div>
      <label>Status<select data-v="compraStatus">${COMPRA_STATUS.map((s) => `<option ${s === V.compraStatus ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      ${chipsProjetos()}
      <label>Observações<textarea data-v="obsCompra" placeholder="Cor, tamanho, quantidade… (sem dados de cartão)">${esc(V.obsCompra)}</textarea></label>`;
  }
  if (DESTINO === 'projeto') {
    return `
      <label>Nome do projeto<input data-v="nomeProjeto" value="${esc(V.nomeProjeto)}"></label>
      <label>Status<select data-v="projStatus">${PROJ_STATUS.map((s) => `<option ${s === V.projStatus ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      <label>Descrição<textarea data-v="descricao">${esc(V.descricao)}</textarea></label>
      <label class="marcar"><input type="checkbox" data-v="guardarRef" ${V.guardarRef ? 'checked' : ''}>Guardar este link como referência do projeto</label>
      ${V.guardarRef ? chipsTags() + seletorImagens() : ''}`;
  }
  return `
    <label>Nome<input data-v="nome" value="${esc(V.nome)}"></label>
    <div class="duas">
      <label>Tipo<select data-v="tipo">${REF_TIPOS.map((t) => `<option ${t === V.tipo ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>Autor<input data-v="autor" value="${esc(V.autor)}"></label>
    </div>
    ${chipsProjetos()}
    ${chipsTags()}
    ${seletorImagens()}
    <label>Observações<textarea data-v="obs" placeholder="${esc(V.descricao ? V.descricao.slice(0, 140) : 'Por que salvou, o que aproveitar…')}">${esc(V.obs)}</textarea></label>`;
}

function mostrarDuplicado() {
  const el = $('#duplicado');
  if (!el) return;
  const k = chaveLink(V.link);
  let txt = '';
  if (DESTINO === 'compra') {
    const c = linhas('compras').find((x) => x.Link && chaveLink(x.Link) === k);
    if (c) txt = `Este link já está nas compras como ${c.ID} (${c.Item}).`;
  } else {
    const r = linhas('referencias').find((x) => x.Link && chaveLink(x.Link) === k);
    if (r) txt = `Este link já está nas referências como ${r.ID} (${r['Título']}). Salvar cria outra.`;
  }
  el.innerHTML = txt ? `<div class="aviso">${esc(txt)}</div>` : '';
}

function redesenharForm() {
  $('#form').innerHTML = formulario();
  $('#salvar').textContent = textoSalvar();
  $$('.abas button').forEach((b) => b.classList.toggle('ativo', b.dataset.destino === DESTINO));
  mostrarDuplicado();
}

// ------------------------------------------------------------------ gravação
function imagemEscolhida() {
  if (V.imagem === 'print') return PRINT ? { dados: PRINT, nome: 'print.jpg' } : null;
  if (typeof V.imagem === 'number' && PAG.imagens[V.imagem]) return { url: PAG.imagens[V.imagem] };
  return null;
}

const extDoTipo = (dados) => ({ 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif' }[(String(dados).match(/^data:([^;,]+)/) || [])[1]] || '.jpg');

async function salvarImagem(id, avisos) {
  const img = imagemEscolhida();
  if (!img) return;
  if (img.dados) { await api('/api/referencia/imagem', { id, dados: img.dados, nome: img.nome }); return; }
  try {
    await api('/api/referencia/imagem', { id, url: img.url, pagina: V.link });
  } catch (e) {
    let dados = null;
    if (PAG.abaId) {
      try {
        const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: PAG.abaId }, func: imagemDentroDaPagina, args: [img.url] });
        dados = result;
      } catch { /* sem acesso à aba */ }
    }
    if (dados) await api('/api/referencia/imagem', { id, dados, nome: 'imagem' + extDoTipo(dados) });
    else if (PRINT) { await api('/api/referencia/imagem', { id, dados: PRINT, nome: 'print.jpg' }); avisos.push('O site não deixou baixar a imagem escolhida: guardei o print da tela.'); }
    else avisos.push(`A imagem não veio (${e.message}). No programa, use "Escolher na página" ou cole com Ctrl+V.`);
  }
}

async function salvarReferencia(extra, avisos) {
  const campos = {
    'Título': V.nome, Link: V.link, Site: V.site, Tipo: V.tipo, Status: 'salvo',
    Projeto: [...V.projetos].join(' '), Tags: V.tags.split(',').map((t) => t.trim()).filter(Boolean).join(', '),
    Autor: V.autor, 'Licença': V.licenca, 'Observações': V.obs, ...extra,
  };
  const { id } = await api('/api/tabela/adicionar', { arquivo: 'referencias.md', secao: 'Referências', campos });
  await salvarImagem(id, avisos);
  return id;
}

async function salvar() {
  const b = $('#salvar');
  if (!b || b.disabled) return;
  const msg = $('#msg');
  msg.innerHTML = '';
  if (DESTINO === 'projeto' ? !V.nomeProjeto.trim() : !V.nome.trim()) { msg.innerHTML = '<div class="aviso erro">Dê um nome antes de salvar.</div>'; return; }
  b.disabled = true;
  b.textContent = 'Salvando…';
  const avisos = [];
  try {
    let titulo, texto, aba;
    if (DESTINO === 'compra') {
      const { id } = await api('/api/tabela/adicionar', { arquivo: 'compras.md', secao: 'Compras', campos: {
        Data: DADOS.hoje || '', Item: V.nome, Loja: V.loja, Link: V.link, 'Valor (R$)': V.valor, Status: V.compraStatus,
        Projeto: [...V.projetos].join(' '), 'Observações': V.obsCompra,
      } });
      titulo = id; texto = 'Compra salva em compras.md.'; aba = 'compras';
    } else if (DESTINO === 'projeto') {
      const { id } = await api('/api/tabela/adicionar', { arquivo: 'projetos.md', secao: 'Projetos', campos: {
        Projeto: V.nomeProjeto, Status: V.projStatus, 'Descrição': V.descricao.replace(/\s+/g, ' ').trim(),
        'Observações': V.guardarRef ? '' : `Link: ${V.link}`,
      } });
      titulo = id; texto = 'Projeto criado em projetos.md.'; aba = 'projetos';
      if (V.guardarRef) {
        const rid = await salvarReferencia({ 'Título': V.nomeProjeto, Projeto: id, Tipo: 'quero fazer' }, avisos);
        texto += ` O link ficou guardado como ${rid}.`;
      }
    } else {
      titulo = await salvarReferencia({}, avisos);
      texto = 'Referência salva em referencias.md.'; aba = 'referencias';
    }
    tela.innerHTML = `<div class="feito"><div class="grande">${esc(titulo)}</div><p>${esc(texto)}</p></div>
      ${avisos.map((a) => `<div class="aviso">${esc(a)}</div>`).join('')}
      <div class="acoes" style="justify-content:center"><button id="ver">Ver no Selecta 3D</button><button id="fechar" class="primario">Fechar</button></div>`;
    $('#ver').onclick = () => chrome.tabs.create({ url: `${CFG.base}/?t=${encodeURIComponent(CFG.token)}#${aba}` });
    $('#fechar').onclick = () => window.close();
  } catch (e) {
    msg.innerHTML = `<div class="aviso erro">${esc(e.message)}</div>`;
    b.disabled = false;
    b.textContent = textoSalvar();
  }
}

// ------------------------------------------------------------------ eventos
document.addEventListener('click', (ev) => {
  const t = ev.target.closest('button');
  if (!t) return;
  if (t.id === 'configurar') return telaConfig();
  if (t.id === 'salvar') return salvar();
  if (t.dataset.destino) { DESTINO = t.dataset.destino; return redesenharForm(); }
  if (t.dataset.projeto) {
    V.projetos.has(t.dataset.projeto) ? V.projetos.delete(t.dataset.projeto) : V.projetos.add(t.dataset.projeto);
    t.classList.toggle('ativo');
    if ($('#chips-tags')) $('#chips-tags').innerHTML = chipsDeTags();
    return;
  }
  if (t.dataset.tag) {
    V.tags = [...lerCampoTags(V.tags).escolhidas, t.dataset.tag].join(', ') + ', '; // o pedaço digitado vira a tag
    const campo = $('[data-v="tags"]');
    if (campo) { campo.value = V.tags; campo.focus(); }
    if ($('#chips-tags')) $('#chips-tags').innerHTML = chipsDeTags();
    return;
  }
  if (t.dataset.imagem !== undefined) {
    const v = t.dataset.imagem;
    V.imagem = /^\d+$/.test(v) ? Number(v) : v;
    $$('.imagens button').forEach((x) => x.classList.toggle('ativo', x === t));
  }
});

document.addEventListener('input', (ev) => {
  const k = ev.target.dataset && ev.target.dataset.v;
  if (!k || !V) return;
  V[k] = ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value;
  if (k === 'guardarRef') redesenharForm();
  else if ($('#chips-tags') && ['tags', 'nome', 'nomeProjeto', 'obs', 'descricao'].includes(k)) $('#chips-tags').innerHTML = chipsDeTags();
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey) && $('#salvar')) { ev.preventDefault(); salvar(); }
});

// ------------------------------------------------------------------ modelo baixado
// Aberta pelo fundo.js quando o navegador termina de baixar um 3MF, STL, STEP ou OBJ: escolhe o projeto,
// confere a licença (lida da página ou escolhida aqui) e o programa move o arquivo para a pasta do projeto.
let BX = null;
const nomeArq = (f) => String(f || '').split(/[\\/]/).pop();
const PROJ_FIM = ['concluído', 'cancelado'];

async function telaBaixado() {
  const [item] = await chrome.downloads.search({ id: Number(Q.get('baixado')) });
  if (!item || item.exists === false) return telaErro('O arquivo baixado não está mais na pasta Downloads.');
  const aba = Q.get('aba') ? await chrome.tabs.get(Number(Q.get('aba'))).catch(() => null) : null;
  const pagina = aba && /^https?:/.test(aba.url || '') ? limparLink(aba.url) : (item.referrer ? limparLink(item.referrer) : '');
  BX = { item, aba, pagina, titulo: aba ? aba.title : '', autor: '', site: '', licenca: '', achada: '', semPermissao: false,
    projeto: null, outra: '' };
  if (aba) await lerPaginaBaixado(true);
  try { BX.ctx = await api('/api/baixados/contexto', { pagina }); } catch { BX.ctx = { licencas: [], projeto: '' }; }
  const ref = BX.ctx.referencia;
  if (BX.ctx.projeto) BX.projeto = BX.ctx.projeto;
  if (ref) {
    BX.titulo = ref['Título'] || BX.titulo;
    BX.autor = BX.autor || ref.Autor || '';
    if (!BX.licenca && ref['Licença']) { BX.licenca = ref['Licença']; BX.achada = 'referência'; }
  }
  desenharBaixado();
  BX.vigia = setInterval(vigiarLicenca, 2000);
}

async function lerPaginaBaixado(primeira = false) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: BX.aba.id }, func: extrairDaPagina });
    BX.semPermissao = false;
    if (primeira) {
      BX.titulo = String(result.titulo || BX.titulo).replace(/\s+[|·–—-]\s+[^|·–—-]{2,40}$/, '').trim();
      BX.autor = result.autor || '';
      BX.site = nomeDoSite(BX.pagina, result.site);
    }
    if (result.licenca && BX.achada !== 'manual') { BX.licenca = result.licenca; BX.achada = 'página'; }
  } catch {
    BX.semPermissao = true;
  }
}

// enquanto a licença não aparece, relê a aba a cada 2 s (o usuário pode estar navegando até ela)
async function vigiarLicenca() {
  if (!BX || BX.achada || !BX.aba || BX.semPermissao || !$('#bx-salvar')) return;
  await lerPaginaBaixado();
  if (BX.achada) desenharBaixado();
}

function desenharBaixado() {
  const ref = BX.ctx.referencia;
  const projetos = linhas('projetos').filter((p) => !PROJ_FIM.includes(p.Status));
  const licencas = [...new Set([...(BX.ctx.licencas || []), ...(BX.licenca && BX.licenca !== '?' ? [BX.licenca] : [])])];
  const chip = (id, nome) => `<button class="chip ${BX.projeto === id ? 'ativo' : ''}" data-bx-projeto="${esc(id)}">${esc(nome)}</button>`;
  let caixaLic;
  if (BX.achada === 'página') caixaLic = `<div class="aviso ok">Licença lida na página: <b>${esc(BX.licenca)}</b>. Confira se é a do modelo.</div>`;
  else if (BX.achada === 'referência') caixaLic = `<div class="aviso ok">Licença já anotada na referência ${esc(ref.ID)}: <b>${esc(BX.licenca)}</b>.</div>`;
  else if (BX.achada === 'manual') caixaLic = '';
  else if (BX.semPermissao) caixaLic = `<div class="aviso">A extensão ainda não pode ler esta página para achar a licença.
      <div class="acoes" style="justify-content:flex-start;margin-top:8px"><button id="bx-permitir">Deixar ler esta página</button></div></div>`;
  else caixaLic = `<div class="aviso">Não achei a licença na página. Na aba do modelo, procure <b>Licença</b> ou <b>License</b>
      (no MakerWorld fica embaixo da descrição; no Printables e no Thingiverse, na lateral). Quando ela aparecer na tela, eu preencho sozinho.
      Ou escolha abaixo.${BX.aba ? '<div class="acoes" style="justify-content:flex-start;margin-top:8px"><button id="bx-ir">Ir para a página do modelo</button></div>' : ''}</div>`;
  tela.innerHTML = `
    <h1>Modelo baixado</h1>
    <div class="origem"><div style="min-width:0"><div class="site">${esc(nomeArq(BX.item.filename))}</div>
      <div class="url" title="${esc(BX.pagina)}">${esc(BX.pagina || 'sem página de origem')}</div></div></div>
    ${ref ? `<div class="aviso ok">Esta página já é a referência ${esc(ref.ID)}: o arquivo fica ligado a ela.</div>`
      : BX.pagina ? '<p>Vou criar uma referência para esta página, com o arquivo e a licença.</p>' : ''}
    <label>Em qual projeto salvar?</label>
    <div class="chips" style="margin-bottom:12px">${projetos.map((p) => chip(p.ID, `${p.ID} · ${p.Projeto}`)).join('')}${chip('', `Sem projeto (${BX.ctx.pasta_sem_projeto || 'BAIXADOS'})`)}</div>
    <label>Nome<input data-bx="titulo" value="${esc(BX.titulo)}"></label>
    <label>Autor<input data-bx="autor" value="${esc(BX.autor)}"></label>
    ${caixaLic}
    <label>Licença<select data-bx="licenca">
      <option value="">Escolha…</option>
      ${licencas.map((l) => `<option ${l === BX.licenca ? 'selected' : ''}>${esc(l)}</option>`).join('')}
      <option value="outra" ${BX.licenca === 'outra' ? 'selected' : ''}>Outra (escrever)</option>
      <option value="?" ${BX.licenca === '?' ? 'selected' : ''}>Ainda não sei (fica "?" para revisar)</option>
    </select></label>
    ${BX.licenca === 'outra' ? `<label>Qual licença<input data-bx="outra" value="${esc(BX.outra)}" placeholder="como o site escreve"></label>` : ''}
    <div id="msg"></div>
    <div class="acoes"><button id="bx-deixar">Deixar em Downloads</button><button id="bx-salvar" class="primario">Guardar no projeto</button></div>
    <div class="dica">O arquivo sai da pasta Downloads e vai para <code>pasta do projeto\\baixados</code>. A origem e a licença ficam em <code>modelos.md</code>.</div>`;
}

async function salvarBaixado() {
  const msg = $('#msg');
  const licenca = BX.licenca === 'outra' ? BX.outra.trim() : BX.licenca;
  if (BX.projeto === null) { msg.innerHTML = '<div class="aviso erro">Escolha o projeto (ou "Sem projeto").</div>'; return; }
  if (!licenca) { msg.innerHTML = '<div class="aviso erro">Escolha a licença, ou "Ainda não sei" para revisar depois.</div>'; return; }
  const b = $('#bx-salvar');
  b.disabled = true; b.textContent = 'Guardando…';
  try {
    const r = await api('/api/baixados/receber', { origem: BX.item.filename, pagina: BX.pagina, projeto: BX.projeto,
      titulo: BX.titulo, autor: BX.autor, site: BX.site, licenca });
    clearInterval(BX.vigia);
    tela.innerHTML = `<div class="feito"><div class="grande">${esc(r.referencia || 'Guardado')}</div>
        <p>Arquivo em <code>${esc(r.caminho)}</code>.<br>Licença: <b>${esc(r.licenca)}</b>${r.licenca === '?' ? ' (aparece na revisão de licenças do Selecta 3D)' : ''}.</p></div>
      <div class="acoes" style="justify-content:center"><button id="ver">Ver no Selecta 3D</button><button id="fechar" class="primario">Fechar</button></div>`;
    $('#ver').onclick = () => chrome.tabs.create({ url: `${CFG.base}/?t=${encodeURIComponent(CFG.token)}#referencias` });
    $('#fechar').onclick = () => window.close();
  } catch (e) {
    msg.innerHTML = `<div class="aviso erro">${esc(e.message)}</div>`;
    b.disabled = false; b.textContent = 'Guardar no projeto';
  }
}

document.addEventListener('click', async (ev) => {
  if (!BX) return;
  const t = ev.target.closest('button');
  if (!t) return;
  if (t.dataset.bxProjeto !== undefined) { BX.projeto = t.dataset.bxProjeto; return desenharBaixado(); }
  if (t.id === 'bx-salvar') return salvarBaixado();
  if (t.id === 'bx-deixar') { clearInterval(BX.vigia); return window.close(); }
  if (t.id === 'bx-ir' && BX.aba) {
    await chrome.tabs.update(BX.aba.id, { active: true }).catch(() => {});
    await chrome.windows.update(BX.aba.windowId, { focused: true }).catch(() => {});
    return;
  }
  if (t.id === 'bx-permitir' && BX.aba) {
    let origem = '';
    try { origem = new URL(BX.aba.url).origin; } catch { return; }
    const ok = await chrome.permissions.request({ origins: [origem + '/*'] }).catch(() => false);
    if (ok) { await lerPaginaBaixado(); desenharBaixado(); }
  }
});

document.addEventListener('input', (ev) => {
  const k = ev.target.dataset && ev.target.dataset.bx;
  if (!k || !BX) return;
  BX[k] = ev.target.value;
  if (k === 'licenca') { BX.achada = ev.target.value ? 'manual' : ''; desenharBaixado(); }
});

// ------------------------------------------------------------------ início
async function iniciar() {
  tela.innerHTML = '<p class="carregando">Lendo a página…</p>';
  CFG = (await chrome.storage.local.get('org3d')).org3d || null;
  if (!CFG) return telaConfig();
  try {
    DADOS = await api('/api/tudo');
  } catch (e) {
    return telaErro(e.message);
  }
  if (Q.has('baixado')) return telaBaixado();
  PAG = await lerPagina();
  if (!PAG.url) return telaErro('Abra a página que quer salvar e clique de novo no ícone.');
  V = null;
  montar();
  const primeiro = $('#form input');
  if (primeiro) { primeiro.focus(); primeiro.select(); }
}

iniciar();
