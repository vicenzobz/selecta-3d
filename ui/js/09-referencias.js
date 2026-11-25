'use strict';
// Selecta 3D — interface, parte 9 de 22: 09-referencias.js. Os arquivos de ui/js/ são carregados em ordem pelo
// index.html e dividem o mesmo escopo global (scripts comuns, sem compilação). Dividido do antigo ui/app.js em fila-v27 (A17).
// ------------------------------------------------------------------ REFERÊNCIAS
const REF_TIPOS = ['quero fazer', 'referência'];
const REF_STATUS = ['salvo', 'baixado', 'na fila', 'feito', 'descartado'];
Object.assign(TONS, { 'salvo': 'menta', 'baixado': 'floresta', 'na fila': 'lima', 'feito': 'neutro', 'descartado': 'apagado' });
const tagsDe = (r) => String(r.Tags || '').split(/[,;]+/).map((t) => t.trim()).filter(Boolean);
const projetosDe = (texto) => String(texto || '').split(/[\s,]+/).filter((p) => /^P\d+$/.test(p));

// ------------------------------------------------------------------ tags sugeridas ao preencher
const semAcento = (t) => norm(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// ordena as tags que já existem: primeiro as relacionadas com o que está sendo preenchido
// (andam junto com as já escolhidas, são dos mesmos projetos, aparecem no nome/link/notas), depois as mais usadas
function sugerirTags({ escolhidas = [], texto = '', projetos = [], site = '' }) {
  const refs = linhas('referencias');
  const ja = new Set(escolhidas.map(semAcento));
  const total = new Map(), pontos = new Map();
  for (const r of refs) for (const t of new Set(tagsDe(r).map(norm))) total.set(t, (total.get(t) || 0) + 1);
  const somar = (t, p) => { if (!ja.has(semAcento(t))) pontos.set(t, (pontos.get(t) || 0) + p); };
  for (const r of refs) {
    const ts = new Set(tagsDe(r).map(norm));
    const comuns = [...ts].filter((t) => ja.has(semAcento(t))).length;
    if (comuns) ts.forEach((t) => somar(t, 3 * comuns));
    if (projetos.length && projetosDe(r.Projeto).some((x) => projetos.includes(x))) ts.forEach((t) => somar(t, 2));
    if (site && r.Site === site) ts.forEach((t) => somar(t, 0.5));
  }
  const alvo = ' ' + semAcento(texto).replace(/[^a-z0-9]+/g, ' ') + ' ';
  for (const t of total.keys()) {
    const tt = semAcento(t).replace(/[^a-z0-9]+/g, ' ').trim();
    if (tt.length >= 3 && (alvo.includes(' ' + tt + ' ') || alvo.includes(' ' + tt.replace(/s$/, '') + ' '))) somar(t, 5);
  }
  return [...total.keys()].filter((t) => !ja.has(semAcento(t)))
    .sort((a, b) => (pontos.get(b) || 0) - (pontos.get(a) || 0) || total.get(b) - total.get(a) || a.localeCompare(b, 'pt-BR'))
    .map((t) => ({ tag: t, n: total.get(t), relacionada: (pontos.get(t) || 0) >= 1 }));
}

// "a, b, pan" → escolhidas [a, b] e o pedaço "pan" sendo digitado; "a, pandeiro" → as duas escolhidas
function lerCampoTags(valor) {
  const partes = String(valor || '').split(',').map((t) => t.trim());
  const ultimo = partes.pop() || '';
  const existentes = new Set(linhas('referencias').flatMap(tagsDe).map(semAcento));
  const completo = !ultimo || existentes.has(semAcento(ultimo));
  return { escolhidas: [...partes.filter(Boolean), ...(completo && ultimo ? [ultimo] : [])], fragmento: completo ? '' : ultimo };
}

function atualizarSugestoesTags(abrir = false) {
  const el = $('#ref-tags-sug'), inp = $('#ref-tags');
  if (!el || !inp) return;
  if (!abrir && !el.dataset.aberto) return; // aparece quando o campo Tags é tocado
  el.dataset.aberto = '1';
  const campo = lerCampoTags(inp.value);
  const fragmento = semAcento(campo.fragmento);
  const lista = sugerirTags({
    escolhidas: campo.escolhidas,
    texto: [$('#ref-titulo') && $('#ref-titulo').value, $('#ref-link') && $('#ref-link').value, $('#ref-obs') && $('#ref-obs').value].join(' '),
    projetos: $$('#ref-projetos input:checked').map((i) => i.value),
    site: $('#ref-site') ? $('#ref-site').value.trim() : '',
  }).filter((x) => !fragmento || semAcento(x.tag).includes(fragmento));
  const mostrar = fragmento ? lista : lista.slice(0, 18);
  const rel = mostrar.filter((x) => x.relacionada), outras = mostrar.filter((x) => !x.relacionada);
  const chip = (x) => `<button type="button" class="chip-tag ${x.relacionada ? 'relacionada' : ''}" data-acao="ref-tag-usar" data-tag="${esc(x.tag)}">#${esc(x.tag)}<span>${x.n}</span></button>`;
  el.innerHTML = !lista.length ? (fragmento ? '<div class="dica">Tag nova: ela será criada ao salvar.</div>' : '')
    : (rel.length ? `<div class="tags-grupo">Relacionadas</div><div class="tags-linha">${rel.map(chip).join('')}</div>` : '')
      + (outras.length ? `<div class="tags-grupo">${rel.length ? 'Outras' : 'Já usadas'}</div><div class="tags-linha">${outras.map(chip).join('')}</div>` : '');
}

function usarTagSugerida(tag) {
  const inp = $('#ref-tags');
  if (!inp) return;
  const { escolhidas } = lerCampoTags(inp.value); // o pedaço que estava sendo digitado vira a tag tocada
  inp.value = [...escolhidas, tag].join(', ') + ', ';
  inp.focus();
  atualizarSugestoesTags(true);
}
const urlImagem = (rel) => `/api/imagem?caminho=${encodeURIComponent(rel)}&t=${encodeURIComponent(TOKEN)}&v=${encodeURIComponent((E.dados.versao || {})['referencias.md'] || '')}`;

// tags escolhidas no filtro (várias: a referência precisa ter todas)
const tagsEscolhidas = () => String(E.filtros.referencias.tag || '').split(',').map(norm).filter(Boolean);

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
  } catch { return String(u || '').trim().toLowerCase(); }
}
const refDoLink = (link) => linhas('referencias').find((r) => r.Link && chaveLink(r.Link) === chaveLink(link));

function referenciasFiltradas(ignorarTags = false) {
  const f = E.filtros.referencias;
  const busca = norm(f.busca);
  const escolhidas = ignorarTags ? [] : tagsEscolhidas();
  return linhas('referencias').filter((r) => {
    if (f.ocultarDescartadas && r.Status === 'descartado' && f.status !== 'descartado') return false;
    if (f.tipo && r.Tipo !== f.tipo) return false;
    if (f.status && r.Status !== f.status) return false;
    if (f.site && r.Site !== f.site) return false;
    if (f.projeto && !projetosDe(r.Projeto).includes(f.projeto)) return false;
    if (escolhidas.length) { const ts = tagsDe(r).map(norm); if (!escolhidas.every((t) => ts.includes(t))) return false; }
    if (busca) {
      const alvo = norm([r.ID, r['Título'], r.Site, r.Tags, r.Autor, r['Observações'], r.Link].join(' '));
      if (!busca.split(/\s+/).every((p) => alvo.includes(p))) return false;
    }
    return true;
  });
}

function telaReferencias() {
  const f = E.filtros.referencias;
  const todas = linhas('referencias');
  const sites = [...new Set(todas.map((r) => r.Site).filter(Boolean))].sort();
  const conta = (fn) => todas.filter(fn).length;
  const barra = `
    <input class="campo-busca" id="busca-referencias" placeholder="Buscar nome, tag, site, nota…" value="${esc(f.busca)}" data-filtro="referencias.busca">
    <select class="seletor" data-filtro="referencias.tipo"><option value="">Fazer e referência</option>${REF_TIPOS.map((t) => `<option ${t === f.tipo ? 'selected' : ''}>${t}</option>`).join('')}</select>
    <select class="seletor" data-filtro="referencias.status"><option value="">Todos os status</option>${REF_STATUS.map((t) => `<option ${t === f.status ? 'selected' : ''}>${t}</option>`).join('')}</select>
    <select class="seletor" data-filtro="referencias.projeto"><option value="">Todos os projetos</option>${linhas('projetos').map((p) => `<option value="${esc(p.ID)}" ${p.ID === f.projeto ? 'selected' : ''}>${esc(p.Projeto)}</option>`).join('')}</select>
    <select class="seletor" data-filtro="referencias.site"><option value="">Todos os sites</option>${sites.map((s) => `<option ${s === f.site ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
    <label class="alternar"><input type="checkbox" data-filtro="referencias.ocultarDescartadas" ${f.ocultarDescartadas ? 'checked' : ''}>Esconder descartadas</label>`;
  return `
    ${subAbasReferencias('referencias')}
    ${cabecalho('Referências', 'Projetos de outros sites para fazer no futuro ou para usar como referência em outros projetos, em <code>referencias.md</code>. Cole um link e o programa tenta trazer nome e imagem.',
      `${pendenciasLicenca().total ? `<button class="botao" data-acao="licencas" title="Modelos e referências sem licença">Licenças a conferir (${pendenciasLicenca().total})</button>` : ''}${refsSemImagem().length ? `<button class="botao" data-acao="ref-revisar-imagens" title="Uma por vez, com opção de pular">Completar imagens (${refsSemImagem().length})</button>` : ''}<button class="botao primario" data-acao="ref-nova">${ICONE.mais}Nova referência</button>`)}
    <p class="dica-colar">Dica: com um link copiado, é só apertar <b>Ctrl+V</b> aqui na aba para abrir uma referência nova já preenchida.</p>
    <section class="numeros">
      <div><div class="valor">${todas.length}</div><div class="legenda">referências salvas</div></div>
      <div><div class="valor lima">${conta((r) => r.Tipo === 'quero fazer' && !['feito', 'descartado'].includes(r.Status))}</div><div class="legenda">quero fazer</div></div>
      <div><div class="valor">${conta((r) => r.Tipo === 'referência' && r.Status !== 'descartado')}</div><div class="legenda">para consulta</div></div>
      <div><div class="valor">${conta((r) => r.Status === 'na fila')}</div><div class="legenda">já na fila</div></div>
      <div><div class="valor">${conta((r) => r.Status === 'feito')}</div><div class="legenda">feitas</div></div>
    </section>
    <div class="barra">${barra}</div>
    <div class="tags-refs" id="tags-refs">${nuvemTags()}</div>
    <section class="grade-refs" id="corpo-lista">${listaReferencias()}</section>`;
}

const TAGS_VISIVEIS = 14;
function nuvemTags() {
  const escolhidas = tagsEscolhidas();
  const total = new Map();
  for (const r of linhas('referencias')) for (const t of new Set(tagsDe(r).map(norm))) total.set(t, (total.get(t) || 0) + 1);
  if (!total.size) return '';
  // quantas sobrariam se a tag fosse somada ao filtro de agora
  const aqui = new Map();
  for (const r of referenciasFiltradas()) for (const t of new Set(tagsDe(r).map(norm))) aqui.set(t, (aqui.get(t) || 0) + 1);
  const ordem = [...total.keys()].sort((a, b) => (escolhidas.includes(b) - escolhidas.includes(a))
    || (total.get(b) - total.get(a)) || a.localeCompare(b, 'pt-BR'));
  const visiveis = E.tagsTodas ? ordem : ordem.filter((t, i) => i < TAGS_VISIVEIS || escolhidas.includes(t));
  const chip = (t) => {
    const ativa = escolhidas.includes(t), n = aqui.get(t) || 0;
    return `<button class="chip-tag ${ativa ? 'ativo' : ''} ${!ativa && !n ? 'vazio' : ''}" data-acao="ref-tag" data-tag="${esc(t)}" title="${ativa ? 'Tirar do filtro' : 'Mostrar só as com esta tag'}">#${esc(t)}<span>${ativa ? '✕' : n}</span></button>`;
  };
  return visiveis.map(chip).join('')
    + (ordem.length > visiveis.length ? `<button class="chip-tag mais" data-acao="ref-tags-todas">+${ordem.length - visiveis.length} tags</button>` : '')
    + (E.tagsTodas && ordem.length > TAGS_VISIVEIS ? '<button class="chip-tag mais" data-acao="ref-tags-todas">menos tags</button>' : '')
    + (escolhidas.length ? '<button class="chip-tag limpar" data-acao="ref-tags-limpar">Limpar tags</button>' : '');
}

function listaReferencias() {
  const lista = referenciasFiltradas();
  if (!lista.length) {
    return linhas('referencias').length
      ? '<div class="vazio">Nenhuma referência com esses filtros.</div>'
      : '<div class="vazio">Nenhuma referência ainda. Use "Nova referência" e cole o link de um projeto (Printables, MakerWorld, Thingiverse, YouTube…).</div>';
  }
  const nomeProj = Object.fromEntries(linhas('projetos').map((p) => [p.ID, p.Projeto]));
  return lista.map((r) => {
    const img = crases(r.Imagem)[0];
    const arq = crases(r.Arquivos)[0];
    return `<article class="ref-cartao ${r.Status === 'descartado' ? 'esmaecido' : ''}">
      <div class="ref-imagem" ${img ? `style="background-image:url('${esc(urlImagem(img))}')"` : ''} data-acao="ref-editar" data-id="${esc(r.ID)}">
        ${img ? '' : `<span class="mini-ext">${esc(r.Site || 'sem imagem')}<small style="display:block;font-weight:400;opacity:.7;margin-top:4px">sem imagem · clique para completar</small></span>`}
        <span class="ref-tipo etiqueta ${r.Tipo === 'quero fazer' ? 'lima' : 'menta'}">${esc(r.Tipo || '—')}</span>
      </div>
      <div class="ref-corpo">
        <div class="ref-site"><span>${esc(r.ID)} · ${esc(r.Site || '')}</span>${r['Licença'] && r['Licença'] !== '?' ? `<span class="fraco" title="Licença">${esc(r['Licença'])}</span>`
          : precisaLicenca(r) ? '<button class="lic-falta" data-acao="licencas" title="Licença a conferir">licença?</button>' : ''}</div>
        <h3 title="${esc(r['Título'])}">${esc(r['Título'] || '(sem nome)')}</h3>
        ${r.Autor ? `<div class="linha-2">por ${esc(r.Autor)}</div>` : ''}
        ${r['Observações'] ? `<div class="obs" title="${esc(r['Observações'])}">${textoMd(r['Observações'])}</div>` : ''}
        <div class="cores">
          ${projetosDe(r.Projeto).map((p) => `<span class="etiqueta floresta" title="${esc(nomeProj[p] || '')}">${esc(p)}</span>`).join('')}
          ${tagsDe(r).map((t) => `<button class="etiqueta fantasma chip-botao" data-acao="ref-tag" data-tag="${esc(t)}">#${esc(t)}</button>`).join('')}
          ${r.Fila ? `<span class="etiqueta lima">${esc(r.Fila)}</span>` : ''}
        </div>
        <div class="ref-rodape">
          ${seletorStatus('ref-status', r.ID, r.Status, REF_STATUS, 'style="width:auto"')}
          <span class="acoes">
            ${r.Link ? `<a class="icone" href="${esc(r.Link)}" target="_blank" rel="noopener" data-acao="ref-link" data-url="${esc(r.Link)}" title="Abrir o link">${ICONE.abrir}</a>` : ''}
            ${arq ? botaoIcone('pasta', 'pasta', 'Arquivos baixados', dadosCaminho(arq)) : ''}
            ${r.Link && !E.dados.remoto ? botaoIcone('ref-baixar', 'entrada', 'Baixar o modelo para um projeto', `data-id="${esc(r.ID)}"`) : ''}
            ${r.Tipo === 'quero fazer' && !r.Fila ? botaoIcone('ref-fila', 'fila', 'Mandar para a fila', `data-id="${esc(r.ID)}"`) : ''}
            ${botaoIcone('ref-editar', 'editar', 'Editar', `data-id="${esc(r.ID)}"`)}
          </span>
        </div>
      </div>
    </article>`;
  }).join('');
}

function abrirReferencia(r, inicial = {}) {
  const novo = !r;
  const v = r || { Tipo: 'quero fazer', Status: 'salvo', Projeto: E.filtros.referencias.projeto || '', ...inicial };
  E.refImagem = null;
  const img = crases(v.Imagem)[0];
  const marcados = new Set(projetosDe(v.Projeto));
  abrirModal({
    titulo: novo ? 'Nova referência' : v.ID,
    sub: novo ? 'Cole o link e clique em Buscar: o programa tenta trazer nome, imagem, autor e licença.' : (v.Link || ''),
    largo: true,
    corpo: `
      <div class="ref-form">
        <div>
          <div class="ref-previa" id="ref-previa" ${img ? `style="background-image:url('${esc(urlImagem(img))}')"` : ''}>${img ? '' : '<span>Sem imagem</span>'}</div>
          <div class="ref-imagens" id="ref-imagens"></div>
          <div class="dica" style="margin-top:8px">${E.dados.remoto
            ? '<b>Buscar dados</b> mostra as imagens da página: toque na que quiser. Também dá para escolher da <b>galeria ou câmera</b> (um print da página serve) ou compartilhar uma imagem de outro app com o Selecta 3D.'
            : '<b>Buscar dados</b> mostra as imagens da página para escolher. <b>Escolher na página</b> abre o link numa janela: clique na foto que quer. Também dá para colar (<b>Ctrl+V</b>), arrastar uma imagem do navegador até aqui ou escolher um arquivo.'}</div>
          <div class="ref-botoes-img">
            <button class="botao pequeno primario" type="button" data-acao="ref-escolher-pagina">${ICONE.abrir}Escolher na página</button>
            <label class="botao pequeno ${E.dados.remoto ? 'primario' : ''}">${ICONE.mais}${E.dados.remoto ? 'Galeria ou câmera' : 'Arquivo'}<input type="file" id="ref-arquivo" accept="image/*" hidden></label>
          </div>
        </div>
        <div class="formulario">
          <label class="inteiro">Link
            <span style="display:flex;gap:8px"><input id="ref-link" value="${esc(v.Link || '')}" placeholder="https://www.printables.com/model/…" style="flex:1">
            <button class="botao pequeno" type="button" data-acao="ref-buscar">Buscar dados</button></span>
            <span class="dica" id="ref-aviso"></span></label>
          <label class="inteiro">Nome<input id="ref-titulo" value="${esc(v['Título'] || '')}"></label>
          <label>Site<input id="ref-site" value="${esc(v.Site || '')}"></label>
          <label>Autor<input id="ref-autor" value="${esc(v.Autor || '')}"></label>
          <label>Tipo<select id="ref-tipo">${REF_TIPOS.map((t) => `<option ${t === v.Tipo ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
          <label>Status<select id="ref-status">${REF_STATUS.map((t) => `<option ${t === v.Status ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
          <label class="inteiro">Projetos relacionados
            <div class="escolha" id="ref-projetos">${linhas('projetos').map((p) => `<label><input type="checkbox" value="${esc(p.ID)}" ${marcados.has(p.ID) ? 'checked' : ''}>${esc(p.ID)} · ${esc(p.Projeto)}</label>`).join('')}</div></label>
          <label class="inteiro">Tags<input id="ref-tags" value="${esc(v.Tags || '')}" placeholder="ex.: articulado, presente, organização" autocomplete="off"><span class="dica">Separadas por vírgula. Toque numa tag abaixo para usar.</span>
            <div class="tags-sugestoes" id="ref-tags-sug"></div></label>
          <label>Licença<input id="ref-licenca" value="${esc(v['Licença'] || '')}" placeholder="ex.: CC BY-NC 4.0"></label>
          <label class="inteiro">Arquivos baixados<input id="ref-arquivos" list="lista-pastas-ref" value="${esc(v.Arquivos || '')}" placeholder="pasta ou arquivo na pasta de impressão 3D">
            <datalist id="lista-pastas-ref">${[...new Set((E.arquivos || []).map((a) => a.pasta).filter(Boolean))].map((p) => `<option value="\`${esc(p)}\`"></option>`).join('')}</datalist></label>
          <label class="inteiro">Observações<textarea id="ref-obs" placeholder="Por que salvou, o que aproveitar, ajustes que quer fazer…">${esc(v['Observações'] || '')}</textarea></label>
        </div>
      </div>`,
    acoes: [
      { rotulo: 'Cancelar' },
      {
        rotulo: novo ? 'Salvar referência' : 'Salvar', primario: true,
        fn: async () => {
          const link = $('#ref-link').value.trim();
          const titulo = $('#ref-titulo').value.trim();
          if (!titulo && !link) { aviso('Informe ao menos o link ou o nome.', true); return false; }
          let arquivos = $('#ref-arquivos').value.trim();
          if (arquivos && !arquivos.includes('`')) arquivos = '`' + arquivos.replace(/\/+$/, '') + '`';
          const campos = {
            'Título': titulo, Link: link, Site: $('#ref-site').value.trim(), Autor: $('#ref-autor').value.trim(),
            Tipo: $('#ref-tipo').value, Status: $('#ref-status').value,
            Projeto: $$('#ref-projetos input:checked').map((i) => i.value).join(' '),
            Tags: $('#ref-tags').value.split(',').map((t) => t.trim()).filter(Boolean).join(', '), 'Licença': $('#ref-licenca').value.trim(),
            Arquivos: arquivos, 'Observações': $('#ref-obs').value.trim(),
          };
          E.salvando = true;
          let id = v.ID;
          try {
            if (novo) {
              ({ id } = await api('/api/tabela/adicionar', { arquivo: 'referencias.md', secao: 'Referências', campos }));
            } else {
              const mud = {}, antes = {};
              for (const [k, val] of Object.entries(campos)) if ((v[k] ?? '') !== val) { mud[k] = val; antes[k] = v[k] ?? ''; }
              if (Object.keys(mud).length) await api('/api/tabela/atualizar', { arquivo: 'referencias.md', secao: 'Referências', id, campos: mud, antes });
            }
            if (E.refImagem) {
              try {
                await api('/api/referencia/imagem', { id, ...E.refImagem, pagina: link });
              } catch (e) { aviso(`Referência salva, mas a imagem não: ${e.message}`, true); }
            }
            aviso(novo ? `${id} salva.` : `${id} atualizada.`);
          } catch (e) {
            aviso(e.message, true);
            return false;
          } finally {
            E.salvando = false;
            await carregar();
          }
          return true;
        },
      },
    ],
  });
  if (novo && v.Link) buscarDadosRef();
  else if (novo) $('#ref-link').focus();
}

// ------------------------------------------------------------------ referências sem imagem (ao abrir no PC)
const refsSemImagem = () => linhas('referencias').filter((r) => !crases(r.Imagem)[0] && r.Status !== 'descartado');

function revisarSemImagem() {
  E.semImagemPuladas = E.semImagemPuladas || new Set();
  const todas = refsSemImagem();
  const lista = todas.filter((r) => !E.semImagemPuladas.has(r.ID));
  if (!lista.length) {
    if (E.revisandoImagens) aviso(todas.length ? 'Fim da lista: as que você pulou continuam sem imagem.' : 'Todas as referências têm imagem.');
    E.revisandoImagens = false;
    return;
  }
  E.revisandoImagens = true;
  const r = lista[0];
  const guardarPref = () => { const c = $('#revisar-nao-mostrar'); if (c) pref.gravar('semImagemAoAbrir', !c.checked); };
  abrirModal({
    titulo: 'Referências sem imagem',
    sub: `${todas.length} ${todas.length === 1 ? 'referência está' : 'referências estão'} sem imagem. Escolha uma agora ou pule.`,
    corpo: `<div class="revisar-ref">
        <div class="ref-site"><span>${esc(r.ID)} · ${esc(r.Site || 'sem site')}</span><span class="fraco">${esc(r.Tipo || '')}</span></div>
        <h3>${esc(r['Título'] || '(sem nome)')}</h3>
        ${r.Link ? `<p class="fraco" style="word-break:break-all">${esc(r.Link)}</p>` : '<p class="fraco">Sem link: escolha uma imagem do computador.</p>'}
        <p class="fraco">${lista.length > 1 ? `Depois desta, ${lista.length - 1 === 1 ? 'mais uma' : `mais ${lista.length - 1}`}.` : 'É a última.'}</p>
      </div>
      <label class="alternar" style="margin-top:14px"><input type="checkbox" id="revisar-nao-mostrar" ${pref.ler('semImagemAoAbrir', true) ? '' : 'checked'}>Não mostrar ao abrir o programa (o botão "Completar imagens", na tela Referências, abre esta lista)</label>`,
    acoes: [
      { rotulo: 'Parar', fn: () => { guardarPref(); E.revisandoImagens = false; return true; } },
      { rotulo: 'Descartar', fn: () => { guardarPref(); setTimeout(() => confirmarDescarte(r), 60); return true; } },
      { rotulo: 'Pular', fn: () => { guardarPref(); E.semImagemPuladas.add(r.ID); setTimeout(revisarSemImagem, 60); return true; } },
      {
        rotulo: r.Link ? 'Abrir a referência' : 'Escolher imagem', primario: !r.Link,
        fn: () => {
          guardarPref();
          setTimeout(() => {
            abrirReferencia(r);
            if (r.Link) buscarDadosRef(); // mostra as imagens da página para escolher
            // ao salvar ou cancelar, segue para a próxima (esta não volta nesta rodada)
            E.aoFecharModal = () => { E.semImagemPuladas.add(r.ID); if (E.revisandoImagens) revisarSemImagem(); };
          }, 60);
          return true;
        },
      },
      // abre o site numa janela do programa: clicou na foto, salva e vai para a próxima
      ...(r.Link ? [{
        rotulo: 'Escolher na página', primario: true,
        fn: () => {
          guardarPref();
          setTimeout(() => {
            abrirReferencia(r);
            E.aoFecharModal = () => { E.semImagemPuladas.add(r.ID); if (E.revisandoImagens) revisarSemImagem(); };
            escolherNaPagina(true);
          }, 60);
          return true;
        },
      }] : []),
    ],
  });
}

// descartar = status "descartado" (a linha continua em referencias.md e pode voltar)
function confirmarDescarte(r) {
  abrirModal({
    titulo: `Descartar ${r.ID}?`,
    sub: r['Título'] || '',
    corpo: `<p>A referência fica com o status <b>descartado</b>: some das listas e desta revisão, mas continua em <code>referencias.md</code>. Para ver de novo, desmarque "Esconder descartadas" na tela Referências e mude o status.</p>`,
    acoes: [
      { rotulo: 'Voltar', fn: () => { setTimeout(revisarSemImagem, 60); return true; } },
      {
        rotulo: 'Descartar', primario: true,
        fn: async () => {
          try {
            await api('/api/tabela/atualizar', { arquivo: 'referencias.md', secao: 'Referências', id: r.ID,
              campos: { Status: 'descartado' }, antes: { Status: r.Status } });
            aviso(`${r.ID} descartada.`);
          } catch (e) { aviso(e.message, true); }
          await carregar();
          setTimeout(revisarSemImagem, 60);
          return true;
        },
      },
    ],
  });
}

// mostra a lista uma vez quando o programa abre no PC (com a janela à vista)
function agendarRevisaoImagens() {
  if (!E.dados || E.dados.remoto || E.revisaoAgendada || !pref.ler('semImagemAoAbrir', true)) return;
  E.revisaoAgendada = true;
  const mostrar = () => {
    if (!refsSemImagem().length) return;
    if (modalAberto()) { setTimeout(mostrar, 3000); return; }
    revisarSemImagem();
  };
  if (document.hasFocus()) setTimeout(mostrar, 800);
  else window.addEventListener('focus', () => setTimeout(mostrar, 800), { once: true });
}

// link colado na aba Referências (ou compartilhado pelo celular): abre a referência nova já buscando os dados
function abrirLinkColado(link, titulo = '', imagem = null) {
  link = limparLink(link);
  const dup = refDoLink(link);
  if (E.aba !== 'referencias') irPara('referencias');
  if (dup) { aviso(`Esse link já está salvo como ${dup.ID}.`); return abrirReferencia(dup); }
  abrirReferencia(null, { Link: link, 'Título': titulo });
  if (imagem) anexarImagemRef(imagem);
}

function anexarImagemRef(imagem) {
  E.refImagem = imagem;
  mostrarPreviaRef(imagem.dados);
}

function nomeDoSite(url) {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { return ''; }
  for (const [trecho, nome] of (E.dados && E.dados.sites) || []) if (host.includes(trecho)) return nome;
  return host.replace(/^www\./, '');
}
const compraDoLink = (link) => linhas('compras').find((c) => c.Link && chaveLink(c.Link) === chaveLink(link));

// link (copiado ou compartilhado) → nova compra "a comprar" já com loja, link e, se der, o nome do produto
async function abrirCompraDoLink(link, titulo = '') {
  link = limparLink(link);
  const dup = compraDoLink(link);
  if (E.aba !== 'compras') irPara('compras');
  if (dup) { aviso(`Esse link já está nas compras como ${dup.ID}.`); return abrirFormulario('compra', dup); }
  abrirFormulario('compra', null, null, { Link: link, Loja: nomeDoSite(link), Item: titulo });
  if (titulo || E.semPC) return;
  try {
    const d = await api('/api/referencia/ler', { url: link });
    const item = $('#modal [data-col="Item"]');
    if (item && !item.value.trim() && d.titulo) item.value = d.titulo;
  } catch { /* sem o nome: a pessoa escreve */ }
}

// pergunta onde guardar um link que chegou de fora (área de transferência ou "Compartilhar")
function perguntarDestino(link, extra = {}) {
  link = limparLink(link);
  const site = nomeDoSite(link);
  const loja = (E.dados.lojas || []).includes(site);
  const ref = refDoLink(link), compra = compraDoLink(link);
  const ja = [ref && `nas referências como ${ref.ID}`, compra && `nas compras como ${compra.ID}`].filter(Boolean).join(' e ');
  const depois = (fn) => () => { setTimeout(fn, 60); return true; };
  abrirModal({
    titulo: extra.origem === 'compartilhado' ? 'Link compartilhado' : 'Link copiado',
    sub: 'Onde você quer guardar?',
    corpo: `<div class="link-destino"><b>${esc(site || 'Link')}</b><span>${esc(link)}</span></div>
      ${extra.titulo ? `<p class="link-destino-titulo">${esc(extra.titulo)}</p>` : ''}
      ${extra.imagem ? '<p class="fraco">Com a imagem compartilhada (vai para a referência).</p>' : ''}
      ${ja ? `<div class="faixa-aviso" style="margin-top:12px">Esse link já está ${esc(ja)}.</div>` : ''}`,
    acoes: [
      { rotulo: 'Agora não' },
      { rotulo: 'Lista de compras', primario: loja, fn: depois(() => abrirCompraDoLink(link, extra.titulo || '')) },
      { rotulo: 'Referências', primario: !loja, fn: depois(() => abrirLinkColado(link, extra.titulo || '', extra.imagem)) },
    ],
  });
}

// ------------------------------------------------------------------ área de transferência (app do celular)
async function estadoClipboard() {
  try { return (await navigator.permissions.query({ name: 'clipboard-read' })).state; } catch { return 'indisponivel'; }
}

async function verificarAreaDeTransferencia(pedido = false) {
  if (!E.dados || !E.dados.remoto || !navigator.clipboard || !navigator.clipboard.readText || E.lendoClip) return;
  if (!pedido && (modalAberto() || document.hidden)) return;
  E.lendoClip = true;
  try {
    const antes = E.clipEstado;
    E.clipEstado = await estadoClipboard();
    if (!pedido && E.clipEstado !== 'granted') { if (antes !== E.clipEstado) render(); return; }
    let texto = '';
    try { texto = await navigator.clipboard.readText(); } catch {
      // celular sem foco ainda, ou permissão negada
      const agora = await estadoClipboard();
      if (agora !== E.clipEstado) { E.clipEstado = agora; render(); }
      if (pedido && agora === 'denied') aviso('O celular não deixou o app ver o que foi copiado. Dá para liberar nas configurações do site, no Chrome.', true);
      return;
    }
    if (pedido) { E.clipEstado = 'granted'; render(); }
    const m = String(texto || '').match(/https?:\/\/[^\s<>"']+/);
    if (!m) { if (pedido) aviso('Pronto: quando você copiar um link e voltar para o app, ele pergunta onde guardar.'); return; }
    const link = limparLink(m[0]);
    if (link === pref.ler('ultimoLinkCopiado', '')) return; // já perguntou por este
    pref.gravar('ultimoLinkCopiado', link);
    if (refDoLink(link) || compraDoLink(link)) return; // já está salvo: não incomoda
    perguntarDestino(link, { origem: 'copiado', titulo: texto.replace(m[0], '').trim().slice(0, 140) });
  } finally {
    E.lendoClip = false;
  }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(() => verificarAreaDeTransferencia(), 350); });
window.addEventListener('focus', () => setTimeout(() => verificarAreaDeTransferencia(), 350));
window.addEventListener('online', () => setTimeout(enviarEsperando, 1000));

function mostrarPreviaRef(fonte) {
  const p = $('#ref-previa');
  if (!p) return;
  p.style.backgroundImage = `url("${fonte}")`;
  p.innerHTML = '';
}

async function buscarDadosRef() {
  const link = $('#ref-link').value.trim();
  if (!link) return aviso('Cole o link primeiro.', true);
  const btn = $('[data-acao=ref-buscar]');
  btn.disabled = true;
  btn.textContent = 'Buscando…';
  try {
    const d = await api('/api/referencia/ler', { url: link });
    const por = (sel, valor) => { if (valor && !$(sel).value.trim()) $(sel).value = valor; };
    por('#ref-titulo', d.titulo);
    por('#ref-autor', d.autor);
    por('#ref-licenca', d.licenca);
    $('#ref-site').value = $('#ref-site').value.trim() || d.site || '';
    if (d.link && d.link !== link) $('#ref-link').value = d.link;
    const jaTemImagem = !!($('#ref-previa') && $('#ref-previa').style.backgroundImage);
    if (d.imagem && !E.refImagem && !jaTemImagem) { E.refImagem = { url: d.imagem }; mostrarPreviaRef(d.imagem); }
    mostrarImagensPagina(d.imagens && d.imagens.length ? d.imagens : (d.imagem ? [d.imagem] : []));
    if (d.descricao && !$('#ref-obs').value.trim()) $('#ref-obs').placeholder = d.descricao;
    $('#ref-aviso').textContent = d.erro || (d.licenca ? 'Licença detectada na página: confira no site.' : 'Dados trazidos do link.');
    $('#ref-aviso').style.color = d.erro ? 'var(--alerta)' : '';
    atualizarSugestoesTags();
    const dup = refDoLink(link) || (d.link && refDoLink(d.link));
    if (dup) { $('#ref-aviso').textContent = `Esse link já está salvo como ${dup.ID}. ` + $('#ref-aviso').textContent; $('#ref-aviso').style.color = 'var(--alerta)'; }
  } catch (e) {
    aviso(e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Buscar dados';
  }
}

async function escolherNaPagina(salvarSozinho = false) {
  const link = $('#ref-link').value.trim();
  if (!link) return aviso('Cole o link da referência primeiro.', true);
  let r;
  try { r = await api('/api/seletor/abrir', { url: link }); } catch (e) { return aviso(e.message, true); }
  const chave = r.chave;
  E.seletorChave = chave;
  const msg = (t, cor = '') => { const a = $('#ref-aviso'); if (a) { a.textContent = t; a.style.color = cor; } };
  msg('Abri a página numa janela: navegue se precisar e clique na foto que quer usar.', 'var(--lima)');
  const inicio = Date.now();
  while (E.seletorChave === chave && $('#ref-previa') && Date.now() - inicio < 15 * 60 * 1000) {
    await new Promise((ok) => setTimeout(ok, 800));
    let e;
    try { e = await api('/api/seletor?chave=' + encodeURIComponent(chave)); } catch { continue; }
    if (e.estado === 'pronto') {
      E.refImagem = { dados: e.dados, nome: e.nome };
      mostrarPreviaRef(e.dados);
      if (salvarSozinho) { // veio da revisão das referências sem imagem: salva e segue para a próxima
        msg('Imagem escolhida. Salvando…', 'var(--lima)');
        const i = E.modalAcoes.findIndex((a) => a.primario && a.fn);
        if (i >= 0) return acaoModal(i);
      }
      return msg('Imagem escolhida. Clique em Salvar.', 'var(--lima)');
    }
    if (e.estado === 'cancelado') return msg('Escolha cancelada.');
  }
}

// fotos do celular costumam ter vários MB: reduz para no máximo 1600 px antes de guardar ou mandar
const EXT_IMAGEM = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
async function reduzirImagem(blob, nome = 'imagem') {
  const LADO = 1600;
  const paraDados = (b) => new Promise((ok, erro) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = () => erro(fr.error); fr.readAsDataURL(b); });
  let bmp = null;
  try { bmp = await createImageBitmap(blob); } catch { /* formato que o navegador não abre */ }
  if (!bmp && !EXT_IMAGEM[blob.type]) throw new Error('Formato de imagem não aceito: use JPG, PNG ou WebP.');
  if (!bmp || blob.type === 'image/gif' || (Math.max(bmp.width, bmp.height) <= LADO && blob.size <= 1.5 * 1024 * 1024)) {
    if (blob.size > 8 * 1024 * 1024) throw new Error('Imagem grande demais (máximo 8 MB).');
    return { dados: await paraDados(blob), nome: nome + (EXT_IMAGEM[blob.type] || '.jpg') };
  }
  const k = Math.min(1, LADO / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0, c.width, c.height);
  return { dados: c.toDataURL('image/jpeg', 0.86), nome: nome + '.jpg' };
}

async function lerImagemRef(arquivo) {
  if (!arquivo || !arquivo.type.startsWith('image/')) return;
  try {
    const img = await reduzirImagem(arquivo);
    E.refImagem = img;
    mostrarPreviaRef(img.dados);
    $$('.ref-mini').forEach((b) => b.classList.remove('ativo'));
  } catch (e) { aviso(e.message, true); }
}

// imagens encontradas na página do link: toque para usar
function mostrarImagensPagina(lista) {
  const el = $('#ref-imagens');
  if (!el) return;
  const atual = E.refImagem && E.refImagem.url;
  el.innerHTML = lista.length ? `<div class="dica">Imagens da página (${lista.length}): toque na que quer usar.</div>
    <div class="ref-minis">${lista.map((u) => `<button type="button" class="ref-mini ${u === atual ? 'ativo' : ''}" data-acao="ref-usar-imagem" data-url="${esc(u)}" title="Usar esta imagem"><img src="${esc(u)}" alt="" loading="lazy" referrerpolicy="no-referrer"></button>`).join('')}</div>` : '';
}
// miniatura que o site não deixa carregar some da lista
document.addEventListener('error', (ev) => {
  const b = ev.target && ev.target.closest && ev.target.closest('.ref-mini');
  if (b) b.remove();
}, true);

function abrirRefParaFila(r) {
  abrirModal({
    titulo: `${r.ID} para a fila`,
    sub: `Cria uma peça nova no fim da fila (${r.Arquivos ? 'pronto para fatiar' : 'aguardando modelo'}) com o link da referência nas observações.`,
    corpo: `<div class="formulario">
      <label class="inteiro">Peça<input id="rf-peca" value="${esc(r['Título'])}"></label>
      <label>Filamento/cor<input id="rf-cor" placeholder="ex.: PLA preto"></label>
      <label>Prioridade<select id="rf-prio">${Object.entries(PRIORIDADES).map(([k, t]) => `<option value="${k}" ${k === '4' ? 'selected' : ''}>${k} · ${t}</option>`).join('')}</select></label>
      <label class="inteiro">Observações<textarea id="rf-obs" placeholder="Janela (Em casa / Trabalho / Madrugada) e o que mais precisar"></textarea></label>
    </div>`,
    acoes: [
      { rotulo: 'Cancelar' },
      {
        rotulo: 'Mandar para a fila', primario: true,
        fn: async () => {
          const res = await salvar(() => api('/api/referencia/fila', { id: r.ID, campos: {
            'Peça': $('#rf-peca').value, 'Filamento/cor': $('#rf-cor').value, Prioridade: $('#rf-prio').value, 'Observações': $('#rf-obs').value,
          } }));
          aviso(`${res.id} criada no fim da fila.`);
          return true;
        },
      },
    ],
  });
}

