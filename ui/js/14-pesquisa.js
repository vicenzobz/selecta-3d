'use strict';
// Selecta 3D — interface, parte 14 de 22: 14-pesquisa.js. Os arquivos de ui/js/ são carregados em ordem pelo
// index.html e dividem o mesmo escopo global (scripts comuns, sem compilação). Dividido do antigo ui/app.js em fila-v27 (A17).
// ------------------------------------------------------------------ PESQUISA
// Busca um tema em todos os sites das referências que têm busca. Thingiverse, MyMiniFactory e Cults3D pela
// busca oficial (com chave); MakerWorld, Printables e Thangs o PC abre a busca do site numa janela escondida
// e lê os resultados. Ranqueia pela nota da comunidade (curtidas, impressões, downloads e coleções).
const P = {
  sites: null,
  termo: pref.ler('pesqTermo', ''),
  desligados: new Set(pref.ler('pesqDesligados', [])),
  ordem: pref.ler('pesqOrdem', 'nota'),
  buscas: {}, // site → { estado, itens, erro }
  rodada: 0,
};
const PESQ_ORDENS = { nota: 'Mais bem avaliados', curtidas: 'Mais curtidos', downloads: 'Mais baixados', site: 'Ordem de cada site' };

async function carregarSitesPesquisa() {
  try { P.sites = (await api('/api/pesquisa/sites')).sites; } catch (e) { P.sites = []; P.erroSites = e.message; }
  if (E.aba === 'pesquisa') render();
}

// sites das referências: pelo nome na coluna Site e pelos links da tabela
function sitesDasReferencias() {
  const refs = linhas('referencias');
  const texto = refs.map((r) => `${r.Link || ''} ${r['Observações'] || ''}`).join(' ').toLowerCase();
  const nomes = new Set(refs.map((r) => (r.Site || '').toLowerCase()));
  const comBusca = (P.sites || []).filter((s) => nomes.has(s.nome.toLowerCase()) || nomes.has(s.nome.toLowerCase().replace('3d', ''))
    || s.dominios.some((d) => texto.includes(d)));
  const conhecidos = new Set(comBusca.map((s) => s.nome.toLowerCase()).concat(['cults']));
  const semBusca = [...new Set(refs.map((r) => r.Site).filter((n) => n && !conhecidos.has(n.toLowerCase())))].sort();
  return { comBusca, semBusca };
}

function alternarSitePesquisa(id) {
  if (P.desligados.has(id)) P.desligados.delete(id); else P.desligados.add(id);
  pref.gravar('pesqDesligados', [...P.desligados]);
  render();
}

async function pesquisar() {
  const campo = $('#pesq-termo');
  const termo = (campo ? campo.value : P.termo).trim().replace(/\s+/g, ' ');
  if (termo.length < 2) { aviso('Escreva o tema da pesquisa.', true); return; }
  if (!P.sites) await carregarSitesPesquisa();
  P.termo = termo;
  pref.gravar('pesqTermo', termo);
  const rodada = ++P.rodada;
  P.buscas = {};
  const alvos = sitesDasReferencias().comBusca.filter((s) => !P.desligados.has(s.id));
  if (!alvos.length) { aviso('Nenhum site ligado para pesquisar.', true); return; }
  for (const s of alvos) P.buscas[s.id] = { estado: s.pronto ? 'buscando' : (s.modo === 'api' ? 'sem_chave' : 'indisponivel') };
  render();
  await Promise.all(alvos.filter((s) => s.pronto).map((s) => buscarNoSite(s.id, termo, rodada)));
}

async function buscarNoSite(site, termo, rodada) {
  const atualizar = (v) => { if (rodada === P.rodada) { P.buscas[site] = v; desenharResultados(); } };
  try {
    let r = await api('/api/pesquisa/buscar', { site, termo });
    const chave = r.chave;
    while (chave && r.estado === 'buscando') {
      await new Promise((ok) => setTimeout(ok, 1300));
      if (rodada !== P.rodada) return;
      r = await api('/api/pesquisa/estado?chave=' + encodeURIComponent(chave));
    }
    atualizar(r);
  } catch (e) {
    atualizar({ estado: 'erro', erro: e.message, itens: [] });
  }
}

function resultadosPesquisa() {
  const todos = [];
  for (const [site, b] of Object.entries(P.buscas)) for (const it of b.itens || []) todos.push({ ...it, site });
  const val = (it, k) => (typeof it[k] === 'number' ? it[k] : -1);
  const porSite = (a, b) => a.posicao - b.posicao || a.site.localeCompare(b.site);
  const cmp = {
    nota: (a, b) => (b.nota ?? -1) - (a.nota ?? -1) || porSite(a, b),
    curtidas: (a, b) => val(b, 'curtidas') - val(a, 'curtidas') || porSite(a, b),
    downloads: (a, b) => val(b, 'downloads') - val(a, 'downloads') || porSite(a, b),
    site: porSite,
  }[P.ordem] || porSite;
  return todos.sort(cmp);
}

const numCurto = (n) => (typeof n !== 'number' ? '' : n >= 1e6 ? fmtNum(n / 1e6, 1) + ' mi' : n >= 1e4 ? fmtNum(n / 1e3, 0) + ' mil' : n >= 1e3 ? fmtNum(n / 1e3, 1) + ' mil' : fmtNum(n));

function estadoSitePesquisa(s) {
  const b = P.buscas[s.id];
  const remoto = E.dados.remoto;
  if (!b) return s.pronto ? '' : `<span class="fraco">${esc(s.motivo)}</span>`;
  const abrir = `<button class="link-est" data-acao="ref-link" data-url="${esc(s.pagina.replace('{q}', encodeURIComponent(P.termo)))}">abrir no site</button>`;
  switch (b.estado) {
    case 'buscando': return '<span class="pesq-girando">buscando…</span>';
    case 'pronto': return `<b>${(b.itens || []).length}</b> ${(b.itens || []).length === 1 ? 'resultado' : 'resultados'} · ${abrir}`;
    case 'sem_chave': return remoto ? '<span class="fraco">falta a chave (configure no PC)</span>' : '<button class="link-est" data-acao="pesq-chaves">colocar a chave</button>';
    case 'verificacao': return remoto
      ? `<span class="alerta-txt">o site pediu verificação: faça no PC</span> · ${abrir}`
      : `<button class="link-est alerta-txt" data-acao="pesq-verificar" data-site="${esc(s.id)}">fazer a verificação do site</button> · ${abrir}`;
    case 'indisponivel': return `<span class="fraco">${esc(s.motivo)}</span> · ${abrir}`;
    default: return `<span class="erro-txt" title="${esc(b.erro || '')}">${esc(b.erro || 'erro')}</span> · ${abrir}`;
  }
}

function htmlResultadosPesquisa() {
  const { comBusca } = sitesDasReferencias();
  const ligados = comBusca.filter((s) => !P.desligados.has(s.id));
  const estados = ligados.filter((s) => P.buscas[s.id]).map((s) => `
    <div class="pesq-estado"><span class="pesq-estado-nome">${esc(s.nome)}</span><span>${estadoSitePesquisa(s)}</span></div>`).join('');
  const lista = resultadosPesquisa();
  P.lista = lista;
  const buscando = Object.values(P.buscas).some((b) => b.estado === 'buscando');
  let grade;
  if (!Object.keys(P.buscas).length) {
    const tags = [...new Set(linhas('referencias').flatMap((r) => (r.Tags || '').split(',').map((t) => t.trim()).filter(Boolean)))].slice(0, 14);
    grade = `<div class="vazio">Escreva um tema e aperte <b>Pesquisar</b>. ${tags.length ? 'Ideias das suas referências:' : ''}</div>
      ${tags.length ? `<div class="pesq-sugestoes">${tags.map((t) => `<button class="etiqueta fantasma chip-botao" data-acao="pesq-sugestao" data-termo="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}`;
  } else if (!lista.length) {
    grade = `<div class="vazio">${buscando ? 'Procurando nos sites… os resultados aparecem aqui conforme cada site responde.' : 'Nenhum resultado. Tente outras palavras (em inglês os sites costumam achar mais).'}</div>`;
  } else {
    grade = `<div class="grade-pesq">${lista.map((it, i) => {
      const salva = refDoLink(it.link);
      const nums = [
        typeof it.curtidas === 'number' ? `<span title="curtidas">${ICONE.coracao}${numCurto(it.curtidas)}</span>` : '',
        typeof it.downloads === 'number' ? `<span title="downloads">${ICONE.entrada}${numCurto(it.downloads)}</span>` : '',
        typeof it.impressoes === 'number' ? `<span title="impressões (makes)">${ICONE.impressoes}${numCurto(it.impressoes)}</span>` : '',
      ].join('');
      return `<article class="ref-cartao pesq-cartao">
        <div class="pesq-imagem" data-acao="ref-link" data-url="${esc(it.link)}" title="Abrir no site">
          ${it.imagem ? `<img src="${esc(it.imagem)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
          <span class="pesq-posicao">${i + 1}</span>
          ${salva ? `<span class="etiqueta lima pesq-salva">${esc(salva.ID)}</span>` : ''}
        </div>
        <div class="ref-corpo">
          <div class="ref-site"><span>${esc(it.nome_site)}</span>${it.autor ? `<span class="pesq-autor">${esc(it.autor)}</span>` : ''}</div>
          <h3 class="pesq-titulo" title="${esc(it.titulo)}">${esc(it.titulo)}</h3>
          <div class="pesq-numeros">${nums || '<span class="fraco">o site não mostrou os números</span>'}</div>
          <div class="ref-rodape">
            <button class="botao pequeno" data-acao="ref-link" data-url="${esc(it.link)}">${ICONE.abrir}Abrir</button>
            ${E.dados.remoto ? '' : `<button class="botao pequeno" data-acao="pesq-baixar" data-i="${i}" title="Baixar o modelo para um projeto">${ICONE.entrada}Baixar</button>`}
            ${salva ? `<button class="botao pequeno" data-acao="ref-editar" data-id="${esc(salva.ID)}">Ver ${esc(salva.ID)}</button>`
              : `<button class="botao pequeno primario" data-acao="pesq-salvar" data-i="${i}">${ICONE.mais}Salvar</button>`}
          </div>
        </div>
      </article>`;
    }).join('')}</div>`;
  }
  return `${estados ? `<div class="pesq-estados">${estados}</div>` : ''}${grade}`;
}

function desenharResultados() {
  const el = $('#pesq-resultados');
  if (el && E.aba === 'pesquisa') el.innerHTML = htmlResultadosPesquisa();
}

function telaPesquisa() {
  if (!P.sites) {
    if (!P.carregando) { P.carregando = true; carregarSitesPesquisa().finally(() => { P.carregando = false; }); }
    return subAbasReferencias('pesquisa') + cabecalho('Buscar', 'Carregando os sites…');
  }
  const { comBusca, semBusca } = sitesDasReferencias();
  const chips = comBusca.map((s) => {
    const ligado = !P.desligados.has(s.id);
    const aviso = !s.pronto ? ` <small>${s.modo === 'api' ? '· sem chave' : '· só no PC'}</small>` : '';
    return `<label class="alternar"><input type="checkbox" data-acao="pesq-site" data-site="${esc(s.id)}" ${ligado ? 'checked' : ''}>${esc(s.nome)}${aviso}</label>`;
  }).join('');
  return `
    ${subAbasReferencias('pesquisa')}
    ${cabecalho('Buscar', 'Procura um tema nos sites das suas referências e mostra primeiro os modelos mais bem avaliados pela comunidade (curtidas, impressões e downloads).',
      E.dados.remoto ? '' : `<button class="botao" data-acao="pesq-chaves">${ICONE.chave}Chaves de busca</button>`)}
    <div class="pesq-busca">
      <input class="campo-busca" id="pesq-termo" placeholder="Tema: pandeiro, violin, kalimba, suporte de rolo…" value="${esc(P.termo)}" autocomplete="off">
      <button class="botao primario" data-acao="pesq-buscar">${ICONE.pesquisa}Pesquisar</button>
      <select class="seletor" id="pesq-ordem">${Object.entries(PESQ_ORDENS).map(([k, v]) => `<option value="${k}" ${k === P.ordem ? 'selected' : ''}>${v}</option>`).join('')}</select>
    </div>
    <div class="barra pesq-sites">${chips || '<span class="fraco">Nenhum site com busca nas referências.</span>'}</div>
    ${semBusca.length ? `<p class="fraco pesq-sem">Sem busca (blogs, vídeos e lojas): ${semBusca.map(esc).join(', ')}.</p>` : ''}
    <div id="pesq-resultados">${htmlResultadosPesquisa()}</div>`;
}

async function verificarSitePesquisa(site) {
  try {
    await api('/api/pesquisa/verificar', { site, termo: P.termo });
    aviso('Abri a busca do site numa janela. Faça a verificação, feche a janela e pesquise de novo.');
  } catch (e) { aviso(e.message, true); }
}

function salvarResultadoPesquisa(i) {
  const it = (P.lista || [])[i];
  if (!it) return;
  const dup = refDoLink(it.link);
  if (dup) { aviso(`Esse modelo já está salvo como ${dup.ID}.`); return abrirReferencia(dup); }
  const nota = [typeof it.curtidas === 'number' ? `${fmtNum(it.curtidas)} curtidas` : '', typeof it.downloads === 'number' ? `${fmtNum(it.downloads)} downloads` : '',
    typeof it.impressoes === 'number' ? `${fmtNum(it.impressoes)} impressões` : ''].filter(Boolean).join(', ');
  abrirReferencia(null, { Link: it.link, 'Título': it.titulo, Site: it.nome_site, Autor: it.autor,
    Tags: P.termo.toLowerCase(), 'Observações': `Achado na Pesquisa por "${P.termo}"${nota ? ` (${nota} em ${new Date().toLocaleDateString('pt-BR')})` : ''}.` });
  if (it.imagem) { E.refImagem = { url: it.imagem }; mostrarPreviaRef(it.imagem); }
}

function abrirChavesPesquisa() {
  if (E.dados.remoto) { aviso('As chaves são colocadas na janela do programa no PC.', true); return; }
  const apis = (P.sites || []).filter((s) => s.modo === 'api');
  const campo = (s, k, rotulo) => `<label class="inteiro">${rotulo}<input id="chave-${k}" type="password" autocomplete="off" value="${s.chaves[k] ? '••••' : ''}" placeholder="cole aqui"></label>`;
  const nomes = { thingiverse_token: 'App Token', mmf_chave: 'API Key', cults_usuario: 'Seu usuário do Cults3D', cults_chave: 'Chave da API' };
  abrirModal({
    titulo: 'Chaves de busca',
    sub: 'Thingiverse, MyMiniFactory e Cults3D só deixam programas pesquisar com uma chave gratuita da sua conta. Ela fica guardada só neste PC, fora da pasta compartilhada.',
    largo: true,
    corpo: `<div class="formulario">${apis.map((s) => `
      <div class="inteiro pesq-chave-bloco"><b>${esc(s.nome)}</b> ${s.pronto ? '<span class="etiqueta lima">pronta</span>' : ''}<p class="dica">${esc(s.como)}</p></div>
      ${Object.keys(s.chaves).map((k) => campo(s, k, nomes[k] || k)).join('')}`).join('')}</div>`,
    acoes: [
      { rotulo: 'Cancelar' },
      { rotulo: 'Salvar', primario: true, fn: async () => {
        const chaves = {};
        for (const s of apis) for (const k of Object.keys(s.chaves)) { const el = $('#chave-' + k); if (el) chaves[k] = el.value; }
        try { P.sites = (await api('/api/pesquisa/chaves', { chaves })).sites; } catch (e) { aviso(e.message, true); throw e; }
        aviso('Chaves guardadas.');
        render();
      } },
    ],
  });
}

