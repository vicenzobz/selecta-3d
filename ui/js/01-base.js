'use strict';
// Selecta 3D — interface, parte 1 de 22: 01-base.js. Os arquivos de ui/js/ são carregados em ordem pelo
// index.html e dividem o mesmo escopo global (scripts comuns, sem compilação). Dividido do antigo ui/app.js em fila-v27 (A17).
// Selecta 3D — interface. Tudo vem da API local (/api/...), que lê e grava os .md da pasta.

// ------------------------------------------------------------------ base
const params = new URLSearchParams(location.search);
function tokenGuardado() { try { return localStorage.getItem('org3d.token') || ''; } catch { return ''; } }
const TOKEN = params.get('t') || sessionStorage.getItem('t') || tokenGuardado();
if (params.get('t')) sessionStorage.setItem('t', TOKEN);
const SEM_PC = 'sem conexão com o PC: ele precisa estar ligado, com o Selecta 3D aberto e o acesso pelo celular ligado';

// gravações que o app do celular pode guardar quando o PC não responde e mandar depois, na mesma ordem
const PODE_ESPERAR = new Set(['/api/tabela/atualizar', '/api/tabela/adicionar', '/api/fila/atualizar', '/api/fila/adicionar',
  '/api/fila/registrar', '/api/estoque/movimentar', '/api/estoque/pesar', '/api/estimativa/salvar',
  '/api/referencia/imagem', '/api/referencia/fila']);

async function buscar(rota, op, prazo) {
  if (!prazo) return fetch(rota, op);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), prazo);
  try { return await fetch(rota, { ...op, signal: ctl.signal }); } finally { clearTimeout(t); }
}

async function api(rota, corpo) {
  const post = corpo !== undefined;
  const remoto = !!(E.dados && E.dados.remoto);
  const esperavel = post && remoto && PODE_ESPERAR.has(rota);
  if (esperavel) {
    // código da mudança: se a resposta se perder e ela for mandada de novo, o PC não grava duas vezes
    corpo = { ...corpo, _op: corpo._op || (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)) };
    if (E.semPC || E.esperando.ops.length) return guardarParaDepois(rota, corpo); // PC fora, ou mantém a ordem
  }
  const op = { headers: { 'X-Token': TOKEN } };
  if (post) {
    op.method = 'POST';
    op.headers['Content-Type'] = 'application/json';
    op.body = JSON.stringify(corpo);
  }
  let r;
  try { r = await buscar(rota, op, post && remoto ? 15000 : 0); } catch {
    if (esperavel) return guardarParaDepois(rota, corpo);
    const e = new Error(SEM_PC); e.semConexao = true; throw e;
  }
  if (esperavel && r.status >= 502 && r.status <= 504) return guardarParaDepois(rota, corpo);
  // o app do celular guarda a última cópia; ela vem marcada quando o PC não respondeu
  if (rota === '/api/tudo' || rota === '/api/versao') marcarConexao(Number(r.headers.get('X-Org3d-Guardado')) || 0);
  let j = null;
  try { j = await r.json(); } catch { /* sem corpo */ }
  if (!r.ok) {
    const msg = r.status >= 502 && r.status <= 504 ? SEM_PC : ((j && j.erro) || `erro ${r.status}`);
    const e = new Error(msg); e.status = r.status; throw e;
  }
  return j;
}

function marcarConexao(guardado) {
  const antes = E.semPC || 0;
  E.semPC = guardado;
  if (!!antes !== !!guardado && E.dados) render();
  if (antes && !guardado && E.esperando.ops.length) setTimeout(enviarEsperando, 300); // o PC voltou
}

// ------------------------------------------------------------------ mudanças feitas sem o PC
const BANCO_ESPERA = 'org3d-espera';
function bancoEspera() {
  return new Promise((ok, erro) => {
    const req = indexedDB.open(BANCO_ESPERA, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => ok(req.result);
    req.onerror = () => erro(req.error);
  });
}
async function lerEspera() {
  try {
    const db = await bancoEspera();
    return await new Promise((ok) => { const r = db.transaction('kv').objectStore('kv').get('esperando'); r.onsuccess = () => ok(r.result); r.onerror = () => ok(null); });
  } catch { return null; }
}
async function gravarEspera() {
  try {
    const db = await bancoEspera();
    await new Promise((ok, erro) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(E.esperando, 'esperando'); t.oncomplete = ok; t.onerror = () => erro(t.error); });
  } catch (e) { aviso('Não consegui guardar a mudança no celular: ' + e.message, true); }
}

const curto = (v, n = 40) => { const t = String(v ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : (t || '—'); };
function descreverMudanca(rota, c) {
  const nome = (x) => (x && (x['Título'] || x.Item || x.Projeto || x['Peça'] || x.Cor)) || '(sem nome)';
  const campos = (x) => Object.entries(x || {}).map(([k, v]) => `${k} → ${curto(v, 28)}`).join(', ');
  switch (rota) {
    case '/api/tabela/adicionar': return `Novo em ${c.arquivo}: ${curto(nome(c.campos))}`;
    case '/api/tabela/atualizar': return `${c.id || c.secao}: ${campos(c.campos)}`;
    case '/api/fila/adicionar': return `Nova peça na fila: ${curto(nome(c.campos))}`;
    case '/api/fila/atualizar': return `${c.id}: ${campos(c.campos)}`;
    case '/api/fila/registrar': return `${c.id}: impressão registrada (${c.status})`;
    case '/api/estoque/movimentar': return `${c.id}: ${c.delta > 0 ? '+' : ''}${c.delta} (${curto(c.motivo || 'estoque', 24)})`;
    case '/api/estoque/pesar': return `${c.id}: pesado na balança (${c.balanca} g)`;
    case '/api/estimativa/salvar': return `${c.peca}: estimativa`;
    case '/api/referencia/imagem': return `${c.id}: imagem`;
    case '/api/referencia/fila': return `${c.id}: mandar para a fila`;
    default: return rota;
  }
}

async function guardarParaDepois(rota, corpo) {
  const n = ++E.esperando.seq;
  const item = { n, rota, corpo, quando: Date.now(), desc: descreverMudanca(rota, corpo) };
  let resp = { ok: true, pendente: true };
  if (['/api/tabela/adicionar', '/api/fila/adicionar', '/api/referencia/fila'].includes(rota)) {
    item.marca = `NOVO${n}`; // ID provisório; troca pelo de verdade quando o PC gravar
    resp = { id: item.marca, pendente: true };
  } else if (rota.endsWith('/atualizar')) {
    resp = { mudou: Object.keys(corpo.campos || {}), pendente: true };
  }
  E.esperando.ops.push(item);
  await gravarEspera();
  aviso(E.semPC ? 'Sem o PC: guardado no celular. Vai sozinho quando o PC voltar.' : 'Guardado; enviando com as outras mudanças que estavam esperando.');
  if (!E.semPC) setTimeout(enviarEsperando, 300);
  return resp;
}

const SECOES_TUDO = {
  'fila-impressao.md|Fila': 'fila', 'estoque.md|Filamentos': 'filamentos', 'estoque.md|Insumos e peças': 'insumos',
  'compras.md|Compras': 'compras', 'compras.md|Prazos': 'prazos', 'projetos.md|Projetos': 'projetos',
  'projetos.md|Materiais': 'materiais', 'impressoes.md|Estimativas': 'estimativas', 'impressoes.md|Impressões': 'impressoes',
  'modelos.md|Origem dos modelos': 'modelos', 'referencias.md|Referências': 'referencias',
};

// mostra na tela as mudanças que ainda esperam o PC (sobre a última cópia dos dados)
function aplicarEsperando(d) {
  if (!d || !E.esperando.ops.length) return d;
  const achar = (tab, c) => {
    if (!tab) return null;
    const k = tab.colunas && tab.colunas[0];
    return c.id ? tab.linhas.find((x) => x[k] === c.id) : tab.linhas[c.indice];
  };
  for (const { rota, corpo: c, marca } of E.esperando.ops) {
    if (rota === '/api/tabela/atualizar') {
      const linha = achar(d[SECOES_TUDO[`${c.arquivo}|${c.secao}`]], c);
      if (linha) Object.assign(linha, c.campos, { _esperando: true });
    } else if (rota === '/api/tabela/adicionar' || rota === '/api/fila/adicionar') {
      const tab = rota === '/api/fila/adicionar' ? d.fila : d[SECOES_TUDO[`${c.arquivo}|${c.secao}`]];
      if (!tab || !tab.colunas) continue;
      const nova = Object.fromEntries(tab.colunas.map((col) => [col, '']));
      Object.assign(nova, c.campos, { _esperando: true });
      if (tab.colunas[0] === 'ID') nova.ID = marca;
      if (rota === '/api/fila/adicionar' && !nova.Status) nova.Status = 'aguardando modelo';
      tab.linhas.push(nova);
    } else if (rota === '/api/fila/atualizar') {
      const linha = achar(d.fila, c);
      if (linha) Object.assign(linha, c.campos, { _esperando: true });
    } else if (rota === '/api/fila/registrar') {
      const linha = achar(d.fila, c);
      if (linha && c.status) Object.assign(linha, { Status: c.status, _esperando: true });
    }
  }
  return d;
}

const trocarMarcas = (corpo, mapa) => JSON.parse(JSON.stringify(corpo).replace(/NOVO\d+/g, (m) => mapa[m] || m));

async function enviarEsperando() {
  if (E.enviando || !E.esperando.ops.length) return;
  E.enviando = true;
  const mapa = E.esperando.mapa || (E.esperando.mapa = {});
  let enviadas = 0, falharam = 0;
  try {
    while (E.esperando.ops.length) {
      const item = E.esperando.ops[0];
      let r, j = null;
      try {
        r = await buscar(item.rota, { method: 'POST', headers: { 'X-Token': TOKEN, 'Content-Type': 'application/json' },
          body: JSON.stringify(trocarMarcas(item.corpo, mapa)) }, 20000);
      } catch { break; } // o PC sumiu de novo: tenta depois
      if (r.status >= 502 && r.status <= 504) break;
      try { j = await r.json(); } catch { /* sem corpo */ }
      E.esperando.ops.shift();
      if (r.ok) {
        enviadas++;
        if (item.marca && j && j.id) mapa[item.marca] = j.id;
      } else {
        falharam++;
        E.esperando.falhas.push({ ...item, corpo: trocarMarcas(item.corpo, mapa), erro: (j && j.erro) || `erro ${r.status}`, quando: Date.now() });
      }
      await gravarEspera();
    }
  } finally {
    E.enviando = false;
  }
  if (!E.esperando.ops.length) { E.esperando.mapa = {}; await gravarEspera(); }
  if (enviadas || falharam) {
    await carregar();
    if (enviadas) aviso(`${enviadas} ${enviadas === 1 ? 'mudança feita sem o PC foi gravada' : 'mudanças feitas sem o PC foram gravadas'}.`);
    if (falharam) aviso(`${falharam} ${falharam === 1 ? 'mudança não foi gravada' : 'mudanças não foram gravadas'}: veja no aviso do topo.`, true);
  }
}

function descartarEsperando(tipo, n) {
  const lista = E.esperando[tipo];
  const i = lista.findIndex((x) => x.n === n);
  if (i < 0) return;
  const [item] = lista.splice(i, 1);
  if (tipo === 'ops' && item.marca) {
    // o que dependia do item novo descartado também sai (ex.: a imagem de uma referência que não vai existir)
    E.esperando.ops = E.esperando.ops.filter((x) => !JSON.stringify(x.corpo).includes(item.marca));
  }
}

function abrirEsperando() {
  const { ops, falhas } = E.esperando;
  const item = (o, tipo) => `<div class="espera-item"><div style="min-width:0"><div>${esc(o.desc)}</div>
    <div class="linha-2">${esc(quandoGuardado(o.quando))}${o.erro ? ' · ' + esc(o.erro) : ''}</div></div>
    <button class="botao pequeno" data-acao="espera-descartar" data-tipo="${tipo}" data-n="${o.n}">Descartar</button></div>`;
  abrirModal({
    titulo: 'Mudanças feitas sem o PC',
    sub: 'Ficam guardadas no celular e vão para o PC na ordem em que foram feitas. As que não foram gravadas precisam ser refeitas.',
    corpo: `${ops.length ? `<p class="celular-titulo">Esperando o PC</p>${ops.map((o) => item(o, 'ops')).join('')}` : ''}
      ${falhas.length ? `<p class="celular-titulo" style="margin-top:18px">Não gravadas</p>${falhas.map((o) => item(o, 'falhas')).join('')}` : ''}
      ${!ops.length && !falhas.length ? '<p>Nada esperando.</p>' : ''}`,
    acoes: [
      { rotulo: 'Fechar' },
      ...(ops.length && !E.semPC ? [{ rotulo: 'Enviar agora', primario: true, fn: () => { enviarEsperando(); return true; } }] : []),
    ],
  });
}

const quandoGuardado = (ms) => new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const pref = {
  ler(k, padrao) { try { const v = localStorage.getItem('org3d.' + k); return v === null ? padrao : JSON.parse(v); } catch { return padrao; } },
  gravar(k, v) { try { localStorage.setItem('org3d.' + k, JSON.stringify(v)); } catch { /* sem armazenamento */ } },
};

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const FILA_STATUS = ['aguardando modelo', 'pronto para fatiar', 'fatiado', 'imprimindo', 'concluído', 'falhou'];
const FILA_FIM = new Set(['concluído', 'falhou']);
const COMPRA_STATUS = ['a comprar', 'pedido', 'a caminho', 'recebido', 'devolvido', 'problema', 'a conferir'];
const ROLO_STATUS = ['lacrado', 'aberto', 'na impressora', 'acabou'];
const PROJ_STATUS = ['ideia', 'ativo', 'pausado', 'concluído', 'cancelado'];
const PRIORIDADES = { '1': 'essencial', '2': 'com prazo', '3': 'se der tempo', '4': 'depois', '5': 'sem pressa' };
const ROLO_BAIXO = 200;

const TONS = {
  'aguardando modelo': 'apagado', 'pronto para fatiar': 'menta', 'fatiado': 'floresta', 'imprimindo': 'lima',
  'concluído': 'neutro', 'falhou': 'erro',
  'a comprar': 'menta', 'pedido': 'floresta', 'a caminho': 'lima', 'recebido': 'neutro', 'devolvido': 'apagado',
  'problema': 'erro', 'a conferir': 'alerta',
  'lacrado': 'menta', 'aberto': 'floresta', 'na impressora': 'lima', 'acabou': 'apagado',
  'ideia': 'apagado', 'ativo': 'lima', 'pausado': 'alerta', 'cancelado': 'apagado',
};
const tom = (s) => 'tom-' + (TONS[s] || 'neutro');

const I = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICONE = {
  painel: I('<rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/>'),
  fila: I('<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>'),
  estoque: I('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v6M12 15v6"/>'),
  compras: I('<path d="M6 7h12l-1 13H7L6 7Z"/><path d="M9 7a3 3 0 0 1 6 0"/>'),
  projetos: I('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>'),
  arquivos: I('<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>'),
  cima: I('<path d="m6 15 6-6 6 6"/>'),
  baixo: I('<path d="m6 9 6 6 6-6"/>'),
  editar: I('<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"/>'),
  abrir: I('<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  pasta: I('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3V7Z"/><path d="M3 10h18l-2 9H5l-2-9Z"/>'),
  ver: I('<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>'),
  mais: I('<path d="M12 5v14M5 12h14"/>'),
  opcoes: I('<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>'),
  menos: I('<path d="M5 12h14"/>'),
  check: I('<path d="m5 12 5 5 9-10"/>'),
  x: I('<path d="M6 6l12 12M18 6 6 18"/>'),
  recarregar: I('<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>'),
  balanca: I('<path d="M12 4v16M5 20h14M6 8h12M6 8l-3 6a3 3 0 0 0 6 0L6 8ZM18 8l-3 6a3 3 0 0 0 6 0l-3-6Z"/>'),
  entrada: I('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>'),
  pesquisa: I('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  coracao: I('<path d="M12 20s-7-4.4-9-9a4.6 4.6 0 0 1 9-3 4.6 4.6 0 0 1 9 3c-2 4.6-9 9-9 9Z"/>'),
  chave: I('<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3"/>'),
  impressoes: I('<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>'),
  relogio: I('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  celular: I('<rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18h2"/>'),
  etiqueta: I('<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9Z"/><circle cx="7.5" cy="7.5" r="1.5"/>'),
  grade: I('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
  lista: I('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  info: I('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>'),
  referencias: I('<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z"/>'),
  // Reggae Slicer: o próprio ícone do programa (cópia de PROGRAMAS/REGGAE-SLICER/icone/icone_arco_v04.svg)
  fatiador: '<img class="icone-programa" src="reggae-slicer.svg" alt="" aria-hidden="true">',
  carrinho: I('<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.5 12h11L21 7H6"/>'),
};

const ABAS = [
  { id: 'painel', nome: 'Painel' },
  { id: 'fila', nome: 'Fila' },
  { id: 'impressoes', nome: 'Impressões' },
  { id: 'estoque', nome: 'Estoque' },
  { id: 'compras', nome: 'Compras', dentro: 'estoque' }, // D2 (22/11): menu com 8 itens; Compras é sub-aba do Estoque
  { id: 'projetos', nome: 'Projetos' },
  { id: 'referencias', nome: 'Referências' },
  { id: 'pesquisa', nome: 'Buscar', dentro: 'referencias' }, // A16: aba "Buscar" dentro de Referências (o atalho #pesquisa continua)
  { id: 'arquivos', nome: 'Arquivos' },
  { id: 'fatiador', nome: 'Reggae Slicer' },
];

const E = {
  dados: null,
  arquivos: null,
  aba: pref.ler('aba', 'painel'),
  versao: '',
  salvando: false,
  pendente: false,
  modalAcoes: [],
  vis: null,
  filtros: Object.assign({
    fila: { busca: '', status: '', prio: '', projeto: '', concluidas: false },
    arquivos: { busca: '', projeto: '', ext: '', fila: '', vista: 'lista' },
    compras: { status: '' },
    referencias: { busca: '', tipo: '', status: '', projeto: '', site: '', tag: '', ocultarDescartadas: true },
  }, pref.ler('filtros', {})),
  miniaturas: new Map(),
  esperando: { ops: [], falhas: [], seq: 0, mapa: {} }, // mudanças feitas sem o PC (app do celular)
  base: null, // última leitura do PC (sem as mudanças que esperam)
};

// ------------------------------------------------------------------ formatos
function numero(t) {
  if (t === null || t === undefined) return null;
  let s = String(t).replace('R$', '').replace(/\s/g, '').replace('−', '-');
  if (!/\d/.test(s)) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}
const fmtNum = (n, casas = 0) => (n === null || n === undefined) ? '?' : n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
const fmtReais = (n) => 'R$ ' + fmtNum(n, 2);
function fmtTamanho(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return fmtNum(b / 1024, 0) + ' KB';
  return fmtNum(b / 1024 / 1024, 1) + ' MB';
}
function dataISO(s) {
  const m = String(s || '').match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}
function diasAte(s) {
  const d = dataISO(s);
  if (!d) return null;
  const h = new Date(); h.setHours(0, 0, 0, 0);
  return Math.round((d - h) / 86400000);
}
function fmtData(s) {
  const d = dataISO(s);
  if (!d) return esc(s || '—');
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function textoDias(n) {
  if (n === null) return '';
  if (n === 0) return 'hoje';
  if (n === 1) return 'amanhã';
  if (n === -1) return 'ontem';
  return n > 0 ? `em ${n} dias` : `há ${-n} dias`;
}
const crases = (t) => [...String(t || '').matchAll(/`([^`]+)`/g)].map((m) => m[1].trim());
const norm = (s) => String(s || '').toLowerCase().trim();

// ------------------------------------------------------------------ dados derivados
const linhas = (k) => (E.dados && E.dados[k] ? E.dados[k].linhas : []);
const fila = () => linhas('fila');
const acharFila = (id) => fila().find((r) => r.ID === id);

function indiceCores() {
  const mapa = new Map();
  for (const r of linhas('filamentos')) {
    const n = norm(r['Cor']);
    if (!n) continue;
    if (!mapa.has(n)) mapa.set(n, { nome: r['Cor'], hex: r['Hex'] || '#888888', ids: [] });
    mapa.get(n).ids.push(r.ID);
  }
  const entradas = [...mapa.entries()].map(([chave, v]) => ({ chave, ...v }));
  const primeiras = {};
  for (const e of entradas) { const p = e.chave.split(' ')[0]; primeiras[p] = (primeiras[p] || 0) + 1; }
  for (const e of [...entradas]) {
    const p = e.chave.split(' ')[0];
    if (p !== e.chave && primeiras[p] === 1 && !mapa.has(p)) entradas.push({ ...e, chave: p });
  }
  return entradas.sort((a, b) => b.chave.length - a.chave.length);
}

function coresDoTexto(texto) {
  let t = norm(String(texto || '').split('(')[0]);
  const achadas = [];
  for (const e of indiceCores()) {
    let i = t.indexOf(e.chave);
    while (i >= 0) {
      const antes = i === 0 || /[^a-zà-ú]/.test(t[i - 1]);
      const depois = i + e.chave.length >= t.length || /[^a-zà-ú]/.test(t[i + e.chave.length]);
      if (antes && depois) {
        achadas.push({ pos: i, ...e });
        t = t.slice(0, i) + ' '.repeat(e.chave.length) + t.slice(i + e.chave.length);
      }
      i = t.indexOf(e.chave, i + 1);
    }
  }
  const vistos = new Set();
  return achadas.sort((a, b) => a.pos - b.pos).filter((c) => !vistos.has(c.nome) && vistos.add(c.nome));
}

const bolinhas = (texto) => coresDoTexto(texto).map((c) => `<span class="bolinha" style="background:${esc(c.hex)}" title="${esc(c.nome)}"></span>`).join('');

function janela(obs) {
  const m = String(obs || '').match(/^\s*(Em casa|Trabalho|Madrugada)\b/i);
  return m ? m[1] : '';
}

function pastaDoProjeto(p) { return (crases(p['Pasta'])[0] || String(p['Pasta'] || '').trim()).replace(/\/+$/, ''); }
function idsExtras(texto) {
  const ids = new Set();
  for (const m of String(texto || '').matchAll(/F(\d+)(?:\s*[–-]\s*F?(\d+))?/g)) {
    const a = +m[1], b = m[2] ? +m[2] : a;
    for (let n = a; n <= b && n - a < 500; n++) ids.add('F' + String(n).padStart(2, '0'));
  }
  return ids;
}
function projetosDaPeca(r) {
  const res = [];
  for (const p of linhas('projetos')) {
    const pasta = pastaDoProjeto(p);
    const porPasta = pasta && (r._arquivos || []).some((a) => a.caminho === pasta || a.caminho.startsWith(pasta + '/'));
    if (porPasta || idsExtras(p['Fila (IDs extras)']).has(r.ID)) res.push(p.ID);
  }
  return res;
}
const pecasDoProjeto = (p) => fila().filter((r) => projetosDaPeca(r).includes(p.ID));

function filaDoArquivo(caminho) {
  const exatos = [], pasta = [];
  for (const r of fila()) {
    const arqs = r._arquivos || [];
    if (arqs.some((a) => a.caminho === caminho)) exatos.push(r.ID);
    else if (arqs.some((a) => a.pasta && caminho.startsWith(a.caminho.replace(/\/+$/, '') + '/'))) pasta.push(r.ID);
  }
  return { exatos, pasta, total: exatos.length + pasta.length };
}

// texto com `código` vira <code>, o resto é escapado
const textoMd = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');

// ------------------------------------------------------------------ estimativas, previsão e custo
function minutos(t) {
  const s = String(t || '').toLowerCase().replace('~', '').replace(',', '.').trim();
  if (!s) return null;
  let m = s.match(/(\d+)\s*:\s*(\d{1,2})/);
  if (m) return +m[1] * 60 + +m[2];
  m = s.match(/(\d+(?:\.\d+)?)\s*h\s*(\d{1,2})?/);
  if (m) return Math.round(parseFloat(m[1]) * 60) + (m[2] ? +m[2] : 0);
  m = s.match(/(\d+)\s*min/);
  return m ? +m[1] : null;
}
const fmtMin = (n) => (n === null || n === undefined) ? '—' : n >= 60 ? `${Math.floor(n / 60)}h${String(Math.round(n % 60)).padStart(2, '0')}` : `${Math.round(n)} min`;

function partesEstimativa(texto) {
  return String(texto || '').split(/[;\n]/).map((p) => p.match(/^\s*(.*?)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*g?\s*$/))
    .filter((m) => m && m[1].trim()).map((m) => ({ cor: m[1].trim(), g: numero(m[2]) }));
}
const estimativaDe = (id) => linhas('estimativas').find((e) => e['Peça'] === id);

// nome de cor (como escrito) -> entrada do índice de cores do estoque
function corPorNome(nome) {
  const n = norm(nome);
  return indiceCores().find((c) => c.chave === n) || null;
}

function custoGrama(rolo) {
  const p = numero(rolo['Preço (R$)']), w = numero(rolo['Peso (g)']);
  return p !== null && w ? p / w : null;
}
function custoGramaCor(entrada) {
  const valores = linhas('filamentos').filter((r) => entrada.ids.includes(r.ID)).map(custoGrama).filter((v) => v !== null);
  return valores.length ? valores.reduce((a, b) => a + b, 0) / valores.length : null;
}

function resumoEstimativa(est) {
  if (!est) return null;
  const partes = partesEstimativa(est['Gramas por cor']);
  const g = partes.reduce((s, p) => s + (p.g || 0), 0);
  let custo = 0, custoOk = partes.length > 0;
  for (const p of partes) {
    const c = corPorNome(p.cor);
    const cg = c ? custoGramaCor(c) : null;
    if (cg === null) custoOk = false; else custo += cg * p.g;
  }
  return { g, min: minutos(est.Tempo), custo: custoOk ? custo : null, partes };
}

function previsao() {
  const ativos = fila().filter((r) => !FILA_FIM.has(r.Status));
  const porCor = new Map();
  const semEstimativa = [];
  let semCor = 0, minutosTotal = 0;
  const semCorPecas = [];
  for (const r of ativos) {
    const est = estimativaDe(r.ID);
    if (!est || !partesEstimativa(est['Gramas por cor']).length) { semEstimativa.push(r); if (est) minutosTotal += minutos(est.Tempo) || 0; continue; }
    minutosTotal += minutos(est.Tempo) || 0;
    for (const p of partesEstimativa(est['Gramas por cor'])) {
      const c = corPorNome(p.cor);
      if (!c) { semCor += p.g || 0; semCorPecas.push(r.ID); continue; }
      if (!porCor.has(c.nome)) porCor.set(c.nome, { ...c, precisa: 0, pecas: [] });
      const e = porCor.get(c.nome);
      e.precisa += p.g || 0;
      if (!e.pecas.includes(r.ID)) e.pecas.push(r.ID);
    }
  }
  for (const c of indiceCores()) {
    if (c.chave !== norm(c.nome)) continue; // apelido
    if (!porCor.has(c.nome)) porCor.set(c.nome, { ...c, precisa: 0, pecas: [] });
  }
  const lista = [...porCor.values()].map((c) => {
    const rolos = linhas('filamentos').filter((r) => c.ids.includes(r.ID) && r.Status !== 'acabou');
    const tem = rolos.reduce((s, r) => s + (numero(r['Restante (g)']) || 0), 0);
    return { ...c, tem, falta: Math.max(0, c.precisa - tem), sobra: tem - c.precisa };
  }).sort((a, b) => (b.falta - a.falta) || (a.sobra - b.sobra));
  return { lista, semEstimativa, semCor, semCorPecas: [...new Set(semCorPecas)], minutosTotal, ativos };
}

function barraPrevisao(c) {
  const escala = Math.max(c.tem, c.precisa, 1);
  const pctTem = (c.tem / escala) * 100, pctPrecisa = (c.precisa / escala) * 100;
  return `<div class="prev-linha" title="${esc(c.pecas.join(', '))}">
    <span class="bolinha" style="background:${esc(c.hex)}"></span>
    <span class="prev-nome">${esc(c.nome)}</span>
    <div class="prev-barra ${c.falta ? 'falta' : ''}"><i style="width:${pctTem}%"></i>${c.precisa ? `<b style="left:${Math.min(pctPrecisa, 100)}%"></b>` : ''}</div>
    <span class="prev-num ${c.falta ? 'erro' : ''}">${c.precisa ? `${fmtNum(c.precisa)} / ` : ''}${fmtNum(c.tem)} g${c.falta ? ` · faltam ${fmtNum(c.falta)}` : ''}</span>
  </div>`;
}

function origemDe(caminho) {
  let melhor = null, tam = -1;
  for (const [i, m] of linhas('modelos').entries()) {
    const c = (crases(m.Caminho)[0] || m.Caminho || '').replace(/\/+$/, '');
    if (c && (caminho === c || caminho.startsWith(c + '/')) && c.length > tam) { melhor = { ...m, _i: i, _caminho: c }; tam = c.length; }
  }
  return melhor;
}

function statusMaterial(m) {
  const precisa = numero(m.Quantidade) ?? 1;
  const ins = m.Estoque ? linhas('insumos').find((i) => i.ID === m.Estoque) : null;
  if (ins && (numero(ins.Quantidade) ?? 0) >= precisa) return { s: 'em estoque', t: 'menta' };
  const c = m.Compra ? linhas('compras').find((x) => x.ID === m.Compra) : null;
  if (c && ['pedido', 'a caminho'].includes(c.Status)) return { s: `pedido (${c.ID})`, t: 'floresta' };
  if (c && c.Status === 'recebido') return { s: 'chegou: dar entrada', t: 'alerta' };
  if (c && c.Status === 'a comprar') return { s: `a comprar (${c.ID})`, t: 'alerta' };
  if (c && c.Status === 'a conferir') return { s: `a conferir (${c.ID})`, t: 'alerta' };
  return { s: 'falta', t: 'erro' };
}

function projetoDoCaminho(caminho) {
  for (const p of linhas('projetos')) {
    const pasta = pastaDoProjeto(p);
    if (pasta && (caminho === pasta || caminho.startsWith(pasta + '/'))) return p;
  }
  return null;
}

function gastoDe(compras) {
  return compras.filter((c) => !['a comprar', 'devolvido'].includes(c['Status']))
    .reduce((s, c) => s + (numero(c['Valor (R$)']) || 0), 0);
}

// ------------------------------------------------------------------ carregamento
async function carregar() {
  // sem o PC e com mudanças guardadas: redesenha na hora, sem esperar a rede
  if (E.semPC && E.base && E.esperando.ops.length && !E.forcarLeitura) {
    E.dados = aplicarEsperando(structuredClone(E.base));
    render();
    return;
  }
  try {
    E.base = await api('/api/tudo');
    E.dados = aplicarEsperando(structuredClone(E.base));
    E.versao = JSON.stringify(E.dados.versao);
    sinc(!E.semPC, E.semPC ? 'dados guardados de ' + quandoGuardado(E.semPC) : '');
    if (!FAT.estado && !FAT.pedido && !E.dados.remoto) { FAT.pedido = true; carregarFatiador().then(() => render()); }
  } catch (e) {
    sinc(false, e.message);
    if (!E.dados) {
      const dica = e.semConexao || e.status >= 502 ? 'Tento de novo sozinho a cada poucos segundos.' : 'Feche e abra o programa de novo.';
      $('#conteudo').innerHTML = `<div class="pagina"><div class="faixa-aviso">Não consegui ler os dados: ${esc(e.message)}. ${dica}</div></div>`;
      return;
    }
  }
  render();
}

async function carregarArquivos() {
  try { E.arquivos = await api('/api/arquivos'); } catch (e) { if (!e.semConexao && !E.semPC) aviso(e.message, true); E.arquivos = E.arquivos || []; }
}

function sinc(ok, msg) {
  const s = $('#sinc');
  s.classList.toggle('ok', ok);
  s.classList.toggle('erro', !ok);
  $('#sinc-texto').textContent = ok ? 'em dia com a pasta' : ('sem conexão' + (msg ? ': ' + msg : ''));
}

setInterval(async () => {
  if (document.hidden || E.salvando) return;
  if (!E.dados) { await carregar(); if (E.dados) { abrirPorEndereco(); registrarApp(); } return; }
  try {
    const v = JSON.stringify(await api('/api/versao'));
    if (E.semPC) { sinc(false, 'dados guardados de ' + quandoGuardado(E.semPC)); return; }
    sinc(true);
    if (E.esperando.ops.length) enviarEsperando();
    if (v !== E.versao) {
      if (modalAberto()) { E.pendente = true; return; }
      await carregar();
      aviso('Atualizado com mudanças feitas fora do programa.');
    }
  } catch (e) { sinc(false, e.message); }
}, 4000);

async function salvar(fn, msg) {
  E.salvando = true;
  try {
    const r = await fn();
    if (msg) aviso(msg);
    return r;
  } catch (e) {
    aviso(e.message, true);
    throw e;
  } finally {
    E.salvando = false;
    await carregar();
  }
}

