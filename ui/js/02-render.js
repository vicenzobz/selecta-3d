'use strict';
// Selecta 3D — interface, parte 2 de 22: 02-render.js. Os arquivos de ui/js/ são carregados em ordem pelo
// index.html e dividem o mesmo escopo global (scripts comuns, sem compilação). Dividido do antigo ui/app.js em fila-v27 (A17).
// ------------------------------------------------------------------ renderização
function faixasDoApp() {
  let h = '';
  const n = E.esperando.ops.length, f = E.esperando.falhas.length;
  if (E.semPC) {
    h += `<div class="faixa-aviso faixa-sem-pc"><b>Sem conexão com o PC.</b> Mostrando os dados guardados em ${esc(quandoGuardado(E.semPC))}. O que você mudar fica guardado no celular e vai para o PC quando ele voltar (mudar a ordem da fila e buscar dados de links só com o PC).</div>`;
  }
  if (n) {
    h += `<div class="faixa-aviso faixa-sem-pc faixa-acao"><span><b>${n} ${n === 1 ? 'mudança esperando' : 'mudanças esperando'} o PC.</b> ${E.semPC ? 'Vão sozinhas quando ele voltar.' : 'Enviando…'}</span><button class="botao pequeno" data-acao="espera-ver">Ver</button></div>`;
  }
  if (f) {
    h += `<div class="faixa-aviso faixa-acao"><span><b>${f} ${f === 1 ? 'mudança feita sem o PC não foi gravada' : 'mudanças feitas sem o PC não foram gravadas'}</b>, quase sempre porque a mesma linha mudou no PC nesse meio-tempo.</span><button class="botao pequeno" data-acao="espera-ver">Ver</button></div>`;
  }
  if (E.dados.remoto && E.clipEstado === 'prompt' && !pref.ler('clipDispensado', false)) {
    h += `<div class="faixa-aviso faixa-sem-pc faixa-acao"><span>Quer que o app perceba quando você copiar um link e pergunte se vai para <b>Referências</b> ou <b>Compras</b>?</span>
      <span class="faixa-botoes"><button class="botao pequeno primario" data-acao="clip-permitir">Permitir</button><button class="botao pequeno" data-acao="clip-dispensar">Agora não</button></span></div>`;
  }
  return h;
}

function render() {
  if (!E.dados) return;
  const ativo = document.activeElement;
  const foco = ativo && ativo.id ? { id: ativo.id, ini: ativo.selectionStart, fim: ativo.selectionEnd } : null;
  const rolagem = $('#conteudo').scrollTop;

  renderMenu();
  const tela = { painel: telaPainel, fila: telaFila, impressoes: telaImpressoes, estoque: telaEstoque, compras: telaCompras, projetos: telaProjetos, referencias: telaReferencias, pesquisa: telaPesquisa, arquivos: telaArquivos, fatiador: telaFatiador }[E.aba] || telaPainel;
  const avisos = faixasDoApp() + (E.dados.avisos || []).map((a) => `<div class="faixa-aviso">${esc(a)}</div>`).join('');
  document.body.classList.toggle('remoto', !!E.dados.remoto);
  document.body.dataset.aba = E.aba; // D-f: título grande só no Painel
  $('#conteudo').innerHTML = `<div class="pagina">${avisos}${tela()}</div>`;
  $('#conteudo').scrollTop = rolagem;
  observarMiniaturas();

  if (foco) {
    const el = document.getElementById(foco.id);
    if (el) { el.focus(); try { el.setSelectionRange(foco.ini, foco.fim); } catch { /* não é texto */ } }
  }
}

function renderMenu() {
  const ativos = fila().filter((r) => !FILA_FIM.has(r.Status)).length;
  const baixos = linhas('filamentos').filter((r) => r.Status !== 'acabou' && (numero(r['Restante (g)']) ?? 9999) < ROLO_BAIXO).length;
  const caminho = linhas('compras').filter((c) => ['pedido', 'a caminho'].includes(c.Status)).length;
  const faltaCor = previsao().lista.filter((c) => c.falta > 0).length;
  const faltaMat = linhas('materiais').filter((m) => statusMaterial(m).s === 'falta').length;
  const cont = { fila: ativos, estoque: (baixos + faltaCor) || '', compras: caminho || '', projetos: faltaMat || '' };
  // D-e: no celular, barra embaixo com Painel, Fila, Kobra X, Estoque e Mais (o resto abre em "Mais")
  const NO_CELULAR = new Set(['painel', 'fila', 'estoque']);
  const daVez = (ABAS.find((x) => x.id === E.aba) || {}).dentro || E.aba;
  $('#menu').innerHTML = ABAS.filter((a) => !a.dentro && (a.id !== 'fatiador' || !(E.dados && E.dados.remoto))).map((a) => `
    <button class="${a.id === daVez ? 'ativo' : ''} ${NO_CELULAR.has(a.id) ? '' : 'nao-celular'}" data-acao="aba" data-aba="${a.id}">
      ${ICONE[a.id]}<span>${a.id === 'fatiador' ? nomeFatiador() : a.nome}</span>${cont[a.id] ? `<span class="contagem">${cont[a.id]}</span>` : ''}
    </button>`).join('') + `
    <button class="so-celular" data-acao="aba-kx">${ICONE.impressoes}<span>Kobra X</span></button>
    <button class="so-celular ${NO_CELULAR.has(daVez) ? '' : 'ativo'}" data-acao="menu-mais">${ICONE.opcoes}<span>Mais</span></button>`;
}

function abrirMenuMais() {
  const NO_CELULAR = new Set(['painel', 'fila', 'estoque']);
  const itens = ABAS.filter((a) => !a.dentro && !NO_CELULAR.has(a.id) && (a.id !== 'fatiador' || !E.dados.remoto));
  abrirModal({
    titulo: 'Mais',
    corpo: `<div class="menu-peca">${itens.map((a) => `<button class="botao menu-item" data-acao="aba" data-aba="${a.id}" data-fechar-menu="1">${ICONE[a.id]}${esc(a.id === 'fatiador' ? nomeFatiador() : a.nome)}</button>`).join('')}
      <button class="botao menu-item" data-acao="aba" data-aba="compras" data-fechar-menu="1">${ICONE.compras}Compras</button>
      <button class="botao menu-item" data-acao="aba" data-aba="pesquisa" data-fechar-menu="1">${ICONE.pesquisa}Buscar nos sites</button>
      ${E.dados.remoto ? '' : `<button class="botao menu-item" data-acao="celular" data-fechar-menu="1">${ICONE.celular || ''}Acesso pelo celular</button>`}</div>`,
    acoes: [{ rotulo: 'Fechar' }],
  });
}

function irPara(aba) {
  E.aba = aba;
  pref.gravar('aba', aba);
  $('#conteudo').scrollTop = 0;
  if (aba === 'pesquisa' && !P.sites) carregarSitesPesquisa();
  if ((aba === 'arquivos' || aba === 'projetos' || aba === 'fatiador') && !E.arquivos) {
    carregarArquivos().then(render);
  }
  if (aba === 'fatiador' && E.dados && !E.dados.remoto) carregarFatiador().then(render);
  render();
}

const cabecalho = (titulo, sub, direita = '') => `
  <header class="titulo-pagina">
    <div><h1>${titulo}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div>
    <div class="barra">${direita}</div>
  </header>`;

const etiquetaStatus = (s) => `<span class="etiqueta ${tom(s).replace('tom-', '')}">${esc(s || '—')}</span>`;
function seletorStatus(acao, id, atual, opcoes, extra = '') {
  const lista = opcoes.includes(atual) || !atual ? opcoes : [atual, ...opcoes];
  return `<select class="status ${tom(atual)}" data-acao="${acao}" data-id="${esc(id)}" ${extra}>
    ${lista.map((o) => `<option ${o === atual ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
}
const botaoIcone = (acao, icone, titulo, dados = '', desligado = false) =>
  `<button class="icone" data-acao="${acao}" ${dados} title="${esc(titulo)}" aria-label="${esc(titulo)}" ${desligado ? 'disabled' : ''}>${ICONE[icone]}</button>`;
const dadosCaminho = (c) => `data-caminho="${esc(c)}"`;
const eh3D = (c) => /\.(stl|3mf)$/i.test(c || '');
const VERSAO_MINI = 'v2'; // a mesma de visualizador.js e dados.py
const chaveMini = (a) => `${VERSAO_MINI}|${a.caminho}|${a.modificado}|${a.tamanho}`;
const arquivoDe = (caminho) => (E.arquivos || []).find((a) => a.caminho === caminho);
// miniatura de um arquivo 3D (grade, lista de arquivos e fila); clicar abre em 3D
function miniHtml(a, classe = '') {
  if (!a || !eh3D(a.caminho)) return '';
  return `<div class="mini ${classe}" data-mini="${esc(a.caminho)}" data-chave="${esc(chaveMini(a))}" data-tamanho="${a.tamanho}" data-acao="ver3d" ${dadosCaminho(a.caminho)} title="Ver em 3D"></div>`;
}

