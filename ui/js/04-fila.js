'use strict';
// Selecta 3D — interface, parte 4 de 22: 04-fila.js. Os arquivos de ui/js/ são carregados em ordem pelo
// index.html e dividem o mesmo escopo global (scripts comuns, sem compilação). Dividido do antigo ui/app.js em fila-v27 (A17).
// ------------------------------------------------------------------ FILA
function filaFiltrada() {
  const f = E.filtros.fila;
  const busca = norm(f.busca);
  return fila().filter((r) => {
    if (!f.concluidas && FILA_FIM.has(r.Status) && f.status !== r.Status) return false;
    if (f.status && r.Status !== f.status) return false;
    if (f.prio && r.Prioridade !== f.prio) return false;
    if (f.projeto && !projetosDaPeca(r).includes(f.projeto)) return false;
    if (busca) {
      const alvo = norm([r.ID, r['Peça'], r['Filamento/cor'], r['Observações'], r['Arquivo (caminho relativo)']].join(' '));
      if (!busca.split(/\s+/).every((p) => alvo.includes(p))) return false;
    }
    return true;
  });
}

function telaFila() {
  const f = E.filtros.fila;
  const total = fila().length;
  const ativos = fila().filter((r) => !FILA_FIM.has(r.Status)).length;
  const barra = `
    <input class="campo-busca" id="busca-fila" placeholder="Buscar peça, cor, observação…" value="${esc(f.busca)}" data-filtro="fila.busca">
    <select class="seletor" data-filtro="fila.status"><option value="">Todos os status</option>${FILA_STATUS.map((s) => `<option ${s === f.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
    <select class="seletor" data-filtro="fila.prio"><option value="">Toda prioridade</option>${Object.entries(PRIORIDADES).map(([k, v]) => `<option value="${k}" ${k === f.prio ? 'selected' : ''}>P${k} · ${v}</option>`).join('')}</select>
    <select class="seletor" data-filtro="fila.projeto"><option value="">Todos os projetos</option>${linhas('projetos').map((p) => `<option value="${esc(p.ID)}" ${p.ID === f.projeto ? 'selected' : ''}>${esc(p.Projeto)}</option>`).join('')}</select>
    <label class="alternar"><input type="checkbox" data-filtro="fila.concluidas" ${f.concluidas ? 'checked' : ''}>Mostrar concluídas</label>`;
  return `
    ${cabecalho('Fila', `${ativos} peças ativas de ${total}. A ordem é a do arquivo <code>fila-impressao.md</code>; toda mudança feita aqui vai para o Histórico.`,
      `<button class="botao" data-acao="plano-tudo">${ICONE.relogio}Linha do tempo</button> <button class="botao primario" data-acao="fila-nova">${ICONE.mais}Nova peça</button>`)}
    <div class="barra">${barra}<label class="alternar"><input type="checkbox" data-acao="fila-agrupar" ${pref.ler('filaAgrupar', true) ? 'checked' : ''}>Agrupar pelos dias do Plano</label></div>
    <section class="lista fila-lista" id="corpo-lista">${listaFila()}</section>`;
}

// ------------------------------------------------------------------ PRÓXIMO PASSO (A04)
// Um botão principal por peça, pelo status e pelo que existe (arquivo, fatiado, ponte); o resto vai para o menu "…".
function arquivoDaPeca(r) {
  const arqs = (r && r._arquivos) || [];
  return arqs.find((a) => a.existe && !a.pasta) || arqs.find((a) => a.existe) || null;
}

function proximoPasso(r) {
  if (!r || FILA_FIM.has(r.Status)) return null;
  const id = `data-id="${esc(r.ID)}"`;
  const arq = arquivoDaPeca(r);
  const pc = !E.dados.remoto;
  const fat = fatiadoDe(r);
  const fatiavel = arq && !arq.pasta && ehFatiavel(arq.caminho);
  const indicar = { rotulo: 'Indicar o arquivo', icone: 'editar', acao: 'fila-editar', attrs: id };
  switch (r.Status) {
    case 'aguardando modelo':
      if (arq && arq.pasta) return { rotulo: 'Abrir a pasta', icone: 'pasta', acao: 'pasta', attrs: dadosCaminho(arq.caminho) };
      if (fatiavel && pc) return { rotulo: 'Fatiar', icone: 'fatiador', acao: 'fatiar-arquivo', attrs: `${dadosCaminho(arq.caminho)} ${id}` };
      return indicar;
    case 'pronto para fatiar':
      if (fatiavel && pc) return { rotulo: 'Fatiar', icone: 'fatiador', acao: 'fatiar-arquivo', attrs: `${dadosCaminho(arq.caminho)} ${id}` };
      if (arq && !arq.pasta && pc) return { rotulo: `Abrir no ${nomeAbrir(padraoAbrir())}`, icone: 'abrir', acao: 'abrir-fatiador', attrs: dadosCaminho(arq.caminho) };
      if (arq && !pc) return { rotulo: 'Fatiar no PC', icone: 'fatiador', acao: 'aviso-pc', attrs: '' };
      return indicar;
    case 'fatiado':
      if (fat && podeImprimirKX()) return { rotulo: 'Imprimir na Kobra X', icone: 'impressoes', acao: 'kx-imprimir', attrs: id };
      // ponte desligada: plano B (Anycubic Slicer Next), depois "Comecei a imprimir" no menu
      if (fat && pc) return { rotulo: 'Imprimir pelo Anycubic', icone: 'abrir', acao: 'abrir-em', attrs: `data-programa="anycubic" ${dadosCaminho(fat)}` };
      if (!fat && fatiavel && pc) return { rotulo: 'Fatiar', icone: 'fatiador', acao: 'fatiar-arquivo', attrs: `${dadosCaminho(arq.caminho)} ${id}` };
      return { rotulo: 'Comecei a imprimir', icone: 'impressoes', acao: 'fila-imprimir', attrs: id };
    case 'imprimindo':
      if (kxImprimindo()) return { rotulo: 'Acompanhar', icone: 'painel', acao: 'aba', attrs: 'data-aba="painel"' };
      return { rotulo: 'Registrar', icone: 'check', acao: 'fila-registrar', attrs: id };
    default:
      return indicar;
  }
}

// todas as ações da peça, com rótulo de texto (menu "…"); a do próximo passo fica de fora
function acoesDaPeca(r) {
  const id = `data-id="${esc(r.ID)}"`;
  const arq = arquivoDaPeca(r);
  const pc = !E.dados.remoto;
  const fat = fatiadoDe(r);
  const fim = FILA_FIM.has(r.Status);
  const lista = [];
  if (arq && eh3D(arq.caminho)) lista.push({ rotulo: 'Ver em 3D', icone: 'ver', acao: 'ver3d', attrs: dadosCaminho(arq.caminho) });
  if (fat && podeImprimirKX() && r.Status !== 'imprimindo' && !fim) lista.push({ rotulo: `Imprimir na Kobra X (${nomeArquivo(fat)})`, icone: 'impressoes', acao: 'kx-imprimir', attrs: id });
  if (fat && pc) lista.push({ rotulo: `Abrir o fatiado no Anycubic Slicer Next`, icone: 'abrir', acao: 'abrir-em', attrs: `data-programa="anycubic" ${dadosCaminho(fat)}` });
  if (arq && !arq.pasta && ehFatiavel(arq.caminho) && pc) lista.push({ rotulo: `Fatiar aqui (${nomeFatiador()})`, icone: 'fatiador', acao: 'fatiar-arquivo', attrs: `${dadosCaminho(arq.caminho)} ${id}` });
  if (arq && arq.pasta) lista.push({ rotulo: 'Abrir a pasta', icone: 'pasta', acao: 'pasta', attrs: dadosCaminho(arq.caminho) });
  if (arq && !arq.pasta) {
    lista.push({ rotulo: `Abrir o modelo no ${nomeAbrir(padraoAbrir())} (padrão)`, icone: 'abrir', acao: 'abrir-fatiador', attrs: dadosCaminho(arq.caminho) });
    lista.push({ rotulo: 'Abrir no outro fatiador / mudar o padrão', icone: 'opcoes', acao: 'escolher-fatiador', attrs: dadosCaminho(arq.caminho) });
  }
  if (['pronto para fatiar', 'fatiado'].includes(r.Status)) lista.push({ rotulo: 'Comecei a imprimir (marcar imprimindo)', icone: 'impressoes', acao: 'fila-imprimir', attrs: id });
  if (!fim) lista.push({ rotulo: 'Registrar impressão (concluída ou falhou)', icone: 'check', acao: 'fila-registrar', attrs: id });
  lista.push({ rotulo: 'Estimativa do fatiador (gramas e tempo)', icone: 'relogio', acao: 'estimar', attrs: id });
  lista.push({ rotulo: 'Editar a peça', icone: 'editar', acao: 'fila-editar', attrs: id });
  const p = proximoPasso(r);
  return p ? lista.filter((a) => !(a.acao === p.acao && a.attrs === p.attrs)) : lista;
}

// princ-v02: o "Rolos (data, ordem por rolo): …" das Observações vira uma linha própria (o que carregar e o que devolver)
function rolosDe(obs) {
  const m = /Rolos(?:\s*\([^)]*\))?:\s*(.+?)(?:\.\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ])|\.\s*$|$)/.exec(String(obs || '').replace(/`/g, ''));
  return m ? m[1].trim() : '';
}
// os 4 passos de uma peça, com o atual marcado (cartão "Peça da vez")
const PASSOS_PECA = ['Modelo', 'Fatiar', 'Imprimir', 'Registrar'];
function passosDaPeca(r) {
  const i = { 'aguardando modelo': 0, 'pronto para fatiar': 1, fatiado: 2, imprimindo: 3 }[r.Status];
  if (i == null) return '';
  const atual = r.Status === 'imprimindo' ? 2 : i; // imprimindo: o passo "Imprimir" está em andamento
  return `<ol class="passos-peca">${PASSOS_PECA.map((p, k) => `<li class="${k < atual ? 'feito' : k === atual ? 'atual' : ''}"><i>${k < atual ? '✓' : k + 1}</i>${p}</li>`).join('')}</ol>`;
}

// D-a: amarelo (primario) só no passo da peça da vez; nas outras, botão de contorno
const botaoPasso = (p, classe = 'pequeno', destaque = true) => (p
  ? `<button class="botao ${destaque ? 'primario' : 'contorno'} ${classe} passo" data-acao="${p.acao}" ${p.attrs}>${ICONE[p.icone] || ''}${esc(p.rotulo)}</button>` : '');

// a peça que vem agora: a que está imprimindo, senão a primeira fatiada ou pronta para fatiar, senão a primeira ativa
function pecaDaVez() {
  const f = fila();
  const ativos = f.filter((r) => !FILA_FIM.has(r.Status));
  return f.find((r) => r.Status === 'imprimindo') || f.find((r) => ['fatiado', 'pronto para fatiar'].includes(r.Status)) || ativos[0] || null;
}

function abrirMenuPeca(r) {
  if (!r) return;
  const p = proximoPasso(r);
  abrirModal({
    titulo: `${r.ID} · ${r['Peça']}`,
    sub: `Status: ${r.Status}${p ? ` · próximo passo: ${p.rotulo}` : ''}`,
    corpo: `<div class="menu-peca">${p ? botaoPasso(p, 'menu-item') : ''}${acoesDaPeca(r).map((a) => `
      <button class="botao menu-item" data-acao="${a.acao}" data-fechar-menu="1" ${a.attrs}>${ICONE[a.icone] || ''}${esc(a.rotulo)}</button>`).join('')}</div>`,
    acoes: [{ rotulo: 'Fechar' }],
  });
  $$('#modal .menu-peca .passo').forEach((b) => { b.dataset.fecharMenu = '1'; });
}

// D-c: grupos pelos dias do Plano ("Imprimindo agora", "dom 22/11", …, "Sem estimativa", "Aguardando modelo", "Concluídas")
function gruposDaFila(lista) {
  const pl = planoImpressoes();
  const dia = new Map(pl.itens.map((i) => [i.r.ID, i]));
  const grupos = new Map();
  const por = (chave, titulo, extra = '') => { if (!grupos.has(chave)) grupos.set(chave, { titulo, extra, itens: [], min: 0 }); return grupos.get(chave); };
  for (const r of lista) {
    const i = dia.get(r.ID);
    if (r.Status === 'imprimindo') por('0', 'Imprimindo agora').itens.push(r);
    else if (FILA_FIM.has(r.Status)) por('9', 'Concluídas e falhas').itens.push(r);
    else if (i) {
      const rotulo = rotuloDia(i.ini);
      const g = por('1' + `${i.ini.getFullYear()}-${String(i.ini.getMonth() + 1).padStart(2, '0')}-${String(i.ini.getDate()).padStart(2, '0')}`, rotulo); // dia local
      g.itens.push(r); g.min += i.min;
    } else if (r.Status === 'aguardando modelo') por('8', 'Aguardando modelo', 'fora do plano até ter o arquivo').itens.push(r);
    else por('7', 'Sem estimativa', 'fatie para entrar no plano').itens.push(r);
  }
  return [...grupos.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, g]) => g);
}
function rotuloDia(d) {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const dif = Math.round((x - hoje) / 86400000);
  const base = fmtQuando(d).slice(0, 9);
  return dif === 0 ? `Hoje · ${base}` : dif === 1 ? `Amanhã · ${base}` : base;
}

function listaFila() {
  const lista = filaFiltrada();
  const todas = fila();
  const cab = `<div class="item cab"><div>ID</div><div>Peça</div><div>Cores</div><div>Prio.</div><div>Status</div><div class="col-janela">Janela</div><div style="text-align:right">Ações</div></div>`;
  if (!lista.length) return cab + '<div class="vazio">Nenhuma peça com esses filtros.</div>';
  const daVez = pecaDaVez();
  const linha = (r) => linhaFila(r, todas, daVez);
  if (!pref.ler('filaAgrupar', true)) return cab + lista.map(linha).join('');
  return cab + gruposDaFila(lista).map((g) => `
    <div class="grupo-fila"><b>${esc(g.titulo)}</b><small>${g.itens.length} peça(s)${g.min ? ` · ≈ ${fmtMin(g.min)}` : ''}${g.extra ? ` · ${esc(g.extra)}` : ''}</small></div>
    ${g.itens.map(linha).join('')}`).join('');
}

function linhaFila(r, todas, daVez) {
  {
    const pos = todas.indexOf(r);
    const arqs = r._arquivos || [];
    const arq = arqs.find((a) => a.existe && !a.pasta) || arqs.find((a) => a.existe);
    const caminhos = arqs.length
      ? arqs.map((a) => `<span title="${a.existe ? 'arquivo encontrado' : 'não encontrado na pasta'}"><span class="pont ${a.existe ? '' : 'falta'}"></span>${esc(a.caminho)}</span>`).join(' + ')
      : `<span class="fraco">${esc(r['Arquivo (caminho relativo)'] || '—')}</span>`;
    const j = janela(r['Observações']);
    return `
    <div class="item ${FILA_FIM.has(r.Status) ? 'esmaecido' : ''}">
      <div class="id">${esc(r.ID)}</div>
      <div class="com-mini">${arq && !arq.pasta ? miniHtml(arquivoDe(arq.caminho), 'mini-p') : ''}<div style="min-width:0">
        <div class="nome-item"><span class="id-cel">${esc(r.ID)}</span>${esc(r['Peça'])}</div>
        <div class="linha-2" title="${esc(r['Arquivo (caminho relativo)'])}">${caminhos}</div>
        ${rolosDe(r['Observações']) && !FILA_FIM.has(r.Status) ? `<div class="rolos-linha"><b>Rolos</b>${esc(rolosDe(r['Observações']))}</div>` : ''}
        <div class="obs" title="${esc(r['Observações'])}">${textoMd(r['Observações'])}</div>
      </div></div>
      <div><div class="cores">${bolinhas(r['Filamento/cor'])}</div><div class="linha-2 quebra">${esc(r['Filamento/cor'])}</div>
        ${(() => {
          const re = resumoEstimativa(estimativaDe(r.ID));
          if (!re) return FILA_FIM.has(r.Status) ? '' : `<button class="link-est" data-acao="estimar" data-id="${esc(r.ID)}">+ estimativa</button>`;
          const pg = purgaDe(r.ID);
          return `<button class="link-est tem" data-acao="estimar" data-id="${esc(r.ID)}" title="Editar estimativa">${re.g ? fmtNum(re.g) + ' g' : ''}${re.min ? ' · ' + fmtMin(re.min) : ''}${re.custo !== null ? ' · ' + fmtReais(re.custo) : ''}${pg ? ` · purga ${fmtNum(pg)} g` : ''}</button>`;
        })()}</div>
      <div><span class="etiqueta prio ${+r.Prioridade <= 2 ? 'floresta' : ''}" title="${esc(PRIORIDADES[r.Prioridade] || '')}">P${esc(r.Prioridade)}</span></div>
      <div>${seletorStatus('fila-status', r.ID, r.Status, FILA_STATUS, 'title="Escolher concluído ou falhou abre o registro da impressão"')}</div>
      <div class="col-janela">${j ? `<span class="etiqueta fantasma">${esc(j)}</span>` : ''}</div>
      <div class="acoes">
        ${botaoIcone('fila-mover', 'cima', 'Subir na fila', `data-id="${esc(r.ID)}" data-direcao="cima"`, pos === 0)}
        ${botaoIcone('fila-mover', 'baixo', 'Descer na fila', `data-id="${esc(r.ID)}" data-direcao="baixo"`, pos === todas.length - 1)}
        ${botaoPasso(proximoPasso(r), 'pequeno', r === daVez)}
        ${botaoIcone('menu-peca', 'opcoes', 'Mais ações (com nome)', `data-id="${esc(r.ID)}"`)}
      </div>
    </div>`;
  }
}

// D2: Estoque e Compras juntos, com duas sub-abas
const subAbasEstoque = (atual) => `<div class="sub-abas">
  <button class="${atual === 'estoque' ? 'ativo' : ''}" data-acao="aba" data-aba="estoque">${ICONE.estoque}Rolos e insumos</button>
  <button class="${atual === 'compras' ? 'ativo' : ''}" data-acao="aba" data-aba="compras">${ICONE.compras}Compras${(() => { const n = linhas('compras').filter((c) => ['pedido', 'a caminho'].includes(c.Status)).length; return n ? ` <span class="contagem">${n}</span>` : ''; })()}</button></div>`;

// A16: Referências e Buscar (a antiga aba Pesquisa) ficam juntas, com duas sub-abas
const subAbasReferencias = (atual) => `<div class="sub-abas">
  <button class="${atual === 'referencias' ? 'ativo' : ''}" data-acao="aba" data-aba="referencias">${ICONE.referencias}Referências salvas</button>
  <button class="${atual === 'pesquisa' ? 'ativo' : ''}" data-acao="aba" data-aba="pesquisa">${ICONE.pesquisa}Buscar nos sites</button></div>`;

// F8: gramas de purga (trocas de cor) anotados pelo fatiador nas Observações da estimativa
function purgaDe(id) {
  const e = estimativaDe(id);
  const m = e && /purga\s+([\d.,]+)\s*g/i.exec(e['Observações'] || '');
  return m ? numero(m[1]) : null;
}

// A16: resumo do que já foi impresso (gramas e custo), mostrado também no Estoque
function resumoImpressoes() {
  const hist = linhas('impressoes');
  const gramas = hist.reduce((s, h) => s + (numero(h.Gramas) || 0), 0);
  const custo = hist.reduce((s, h) => s + (numero(h['Custo (R$)']) || 0), 0);
  const falhas = hist.filter((h) => h.Resultado === 'falhou');
  const gFalhas = falhas.reduce((s, h) => s + (numero(h.Gramas) || 0), 0);
  return { n: hist.length, gramas, custo, falhas: falhas.length, gFalhas };
}

