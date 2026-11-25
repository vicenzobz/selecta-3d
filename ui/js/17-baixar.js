'use strict';
// Selecta 3D — interface, parte 17 de 22: 17-baixar.js. Os arquivos de ui/js/ são carregados em ordem pelo
// index.html e dividem o mesmo escopo global (scripts comuns, sem compilação). Dividido do antigo ui/app.js em fila-v27 (A17).
// ------------------------------------------------------------------ BAIXAR MODELOS E LICENÇAS
// Baixar: o Thingiverse (com a chave da Pesquisa) o programa baixa direto; nos outros sites abre a página e a
// extensão do navegador guarda o arquivo quando o download terminar, já com o projeto escolhido aqui.
const LICENCAS = ['CC BY 4.0', 'CC BY-SA 4.0', 'CC BY-NC 4.0', 'CC BY-NC-SA 4.0', 'CC BY-ND 4.0', 'CC BY-NC-ND 4.0', 'CC0',
  'Standard Digital File License', 'GNU GPL', 'uso pessoal (licença do site)'];
const semLicenca = (v) => !String(v || '').trim() || String(v).trim() === '?';
const precisaLicenca = (r) => semLicenca(r['Licença']) && r.Status !== 'descartado' && (r.Tipo === 'quero fazer' || !!r.Arquivos);

function pendenciasLicenca() {
  const refs = linhas('referencias').filter(precisaLicenca);
  const ligados = new Set(refs.flatMap((r) => crases(r.Arquivos)));
  const modelos = linhas('modelos').filter((m) => semLicenca(m['Licença']) && !ligados.has(crases(m.Caminho)[0]));
  return { refs, modelos, total: refs.length + modelos.length };
}

function abrirBaixar(dados) {
  const projetos = linhas('projetos').filter((p) => !['concluído', 'cancelado'].includes(p.Status));
  const sug = dados.projeto && projetos.some((p) => p.ID === dados.projeto) ? dados.projeto : '';
  const tv = /thingiverse\.com/i.test(dados.link || '');
  abrirModal({
    titulo: 'Baixar modelo',
    sub: dados.titulo || dados.link,
    corpo: `<div class="formulario">
      <label class="inteiro">Em qual projeto salvar?<select id="bx-projeto">
        <option value="" ${sug ? '' : 'selected'} disabled>Escolha…</option>
        ${projetos.map((p) => `<option value="${esc(p.ID)}" ${p.ID === sug ? 'selected' : ''}>${esc(p.ID)} · ${esc(p.Projeto)}</option>`).join('')}
        <option value="__sem">Sem projeto (pasta BAIXADOS)</option>
      </select></label>
      <p class="dica inteiro">${tv
        ? 'O Thingiverse deixa o programa baixar direto, com a chave da aba Pesquisa: os arquivos 3MF, STL, STEP e OBJ vão para <code>pasta do projeto\\baixados</code> com a licença do site. Sem a chave, abro a página.'
        : 'Vou abrir a página do modelo no navegador. Lá, clique no botão de baixar do site (por exemplo <b>Baixar 3MF</b>). A extensão percebe o download, já com este projeto escolhido, lê a licença da página e guarda o arquivo em <code>pasta do projeto\\baixados</code>.'}</p>
    </div>`,
    acoes: [
      { rotulo: 'Cancelar' },
      { rotulo: tv ? 'Baixar' : 'Abrir a página', primario: true, fn: async () => {
        const v = $('#bx-projeto').value;
        if (!v) { aviso('Escolha o projeto.', true); throw new Error('sem projeto'); }
        const r = await salvar(() => api('/api/baixados/baixar', { ...dados, projeto: v === '__sem' ? '' : v }));
        if (r.abriu) aviso('Abri a página no navegador. Clique em baixar no site; a extensão guarda o arquivo no projeto.');
        else aviso(`Baixado: ${r.baixou.join(', ')} · licença ${r.licenca}.`);
      } },
    ],
  });
}

function abrirLicencas() {
  const { refs, modelos, total } = pendenciasLicenca();
  const comLink = refs.filter((r) => r.Link).length + modelos.filter((m) => /https?:\/\//.test(m['Observações'] || '')).length;
  const opcoes = (atual) => `<option value="">Escolha…</option>${LICENCAS.map((l) => `<option ${l === atual ? 'selected' : ''}>${esc(l)}</option>`).join('')}`;
  const linha = (titulo, detalhe, link, dadosAttr) => `
    <div class="lic-linha" ${dadosAttr}>
      <div class="lic-nome"><b>${esc(titulo)}</b><small>${esc(detalhe)}</small></div>
      <span class="lic-acoes">
        ${link ? `<button class="botao pequeno primario" data-acao="lic-pagina" data-url="${esc(link)}" title="Abre a página numa janela do programa e lê a licença sozinho">${ICONE.abrir}Conferir na página</button>
          <button class="botao pequeno" data-acao="lic-procurar" data-url="${esc(link)}" title="Tenta ler a licença sem abrir a página (alguns sites não deixam)">Procurar</button>` : ''}
        <select class="seletor lic-escolha">${opcoes('')}</select>
        <button class="botao pequeno" data-acao="lic-salvar">Salvar</button>
      </span>
      <small class="lic-estado"></small>
    </div>`;
  abrirModal({
    titulo: 'Licenças a conferir',
    sub: total ? `${total} sem licença. "Conferir na página" abre o site numa janela do programa e lê a licença sozinho: confira e clique em "Usar" lá na janela, que ela é salva aqui. Se não achar, selecione o texto da licença na página ou escolha na lista.` : 'Tudo com licença anotada.',
    largo: true,
    corpo: `${comLink ? `<div class="lic-lote-barra">
        <button class="botao pequeno primario" data-acao="lic-lote" title="Abre cada página escondida, lê a licença e fecha; nada é salvo sem você clicar em Salvar">${ICONE.abrir}Conferir todas (${comLink})</button>
        <button class="botao pequeno" data-acao="lic-lote-parar" style="display:none">Parar</button>
        <button class="botao pequeno primario" data-acao="lic-lote-salvar" style="display:none">Salvar as achadas</button>
        <small class="lic-lote-estado">Abre as páginas em segundo plano, duas por vez, e mostra a licença que achar em cada linha.</small>
      </div>` : ''}
    <div class="lic-lista">
      ${refs.length ? '<p class="lic-grupo">Referências que você quer fazer ou já baixou</p>' : ''}
      ${refs.map((r) => linha(`${r.ID} · ${r['Título'] || ''}`, [r.Site, crases(r.Arquivos).join(', ')].filter(Boolean).join(' · '), r.Link, `data-ref="${esc(r.ID)}"`)).join('')}
      ${modelos.length ? '<p class="lic-grupo">Arquivos em modelos.md</p>' : ''}
      ${modelos.map((m) => {
        const c = crases(m.Caminho)[0] || m.Caminho;
        const link = ((m['Observações'] || '').match(/https?:\/\/\S+/) || [''])[0].replace(/[).,]+$/, '');
        return linha(c, [m.Origem, m.Autor !== '?' ? m.Autor : ''].filter(Boolean).join(' · '), link, `data-caminho="${esc(c)}"`);
      }).join('')}
    </div>`,
  });
  aplicarLoteLic();
}

// ------------------------------------------------------------------ CONFERIR TODAS (trab-v01)
// Mesma leitura do "Conferir na página", mas em janelas escondidas (app/seletor.py, conferir_lote): abre cada
// página, lê a licença e fecha. Nada é gravado sozinho: o que achou vai para a lista de cada linha e
// "Salvar as achadas" grava as de certeza alta ou média (as de certeza baixa ficam para conferir uma a uma).
const idLinhaLic = (el) => (el.dataset.ref ? 'ref:' + el.dataset.ref : 'arq:' + el.dataset.caminho);
const urlLinhaLic = (el) => { const b = $('[data-acao="lic-pagina"]', el); return b ? b.dataset.url : ''; };

function marcarLicLinha(el, lic) {
  const sel = $('.lic-escolha', el);
  if (!sel) return;
  if (![...sel.options].some((o) => o.value === lic)) sel.insertAdjacentHTML('beforeend', `<option>${esc(lic)}</option>`);
  sel.value = lic;
}

function aplicarLoteLic() {
  const L = E.licLote;
  const barra = $('.lic-lote-barra');
  if (!L || !barra) return;
  const rodando = L.estado === 'rodando';
  let achadas = 0;
  for (const el of $$('.lic-linha')) {
    const id = idLinhaLic(el);
    const r = L.resultados[id];
    const s = $('.lic-estado', el);
    if (!r) {
      if (rodando && (L.atuais || []).includes(id) && s) { s.textContent = 'Lendo a página em segundo plano…'; s.style.color = 'var(--texto-3)'; }
      continue;
    }
    if (r.estado === 'achada') {
      const sel = $('.lic-escolha', el);
      if (sel && el.dataset.lote !== L.chave) { marcarLicLinha(el, r.licenca); el.dataset.lote = L.chave; }
      const baixa = r.certeza === 'baixa';
      if (!baixa && sel && sel.value === r.licenca) achadas++;
      if (s) {
        s.textContent = baixa ? `Li ${r.licenca} no texto da página, sem certeza (pode ser de outro modelo): confira em "Conferir na página".`
          : `Li na página: ${r.licenca} (${r.fonte}).`;
        s.style.color = baixa ? 'var(--alerta, #ffb020)' : 'var(--lima)';
      }
    } else if (s) {
      s.textContent = r.estado === 'parado' ? 'Parado antes de terminar.'
        : `Não achei sozinho (${r.erro || 'sem licença na página'}). Use "Conferir na página" ou escolha na lista.`;
      s.style.color = 'var(--texto-3)';
    }
  }
  const est = $('.lic-lote-estado', barra);
  const n = Object.values(L.resultados).filter((r) => r.estado === 'achada').length;
  est.textContent = rodando ? `Conferindo ${L.feitos} de ${L.total}… ${n} achada(s) até agora. Pode fechar esta janela: continua no PC.`
    : `${L.estado === 'parado' ? 'Parado' : 'Pronto'}: ${L.feitos} de ${L.total} conferidas, ${n} com licença lida. Confira as linhas e salve.`;
  // .botao tem display próprio, que venceria o atributo hidden
  const mostrar = (b, sim) => { b.style.display = sim ? '' : 'none'; };
  mostrar($('[data-acao="lic-lote"]', barra), !rodando);
  mostrar($('[data-acao="lic-lote-parar"]', barra), rodando);
  const bs = $('[data-acao="lic-lote-salvar"]', barra);
  mostrar(bs, achadas > 0);
  bs.textContent = `Salvar as ${achadas} achadas`;
}

async function conferirLicencasLote() {
  const itens = $$('.lic-linha').map((el) => ({ id: idLinhaLic(el), url: urlLinhaLic(el) })).filter((i) => i.url);
  if (!itens.length) return aviso('Nenhuma linha tem link da página.', true);
  let r;
  try { r = await api('/api/licencas/lote', { itens }); } catch (e) { return aviso(e.message, true); }
  const L = E.licLote = { chave: r.chave, estado: 'rodando', total: r.total, feitos: 0, atuais: [], resultados: {} };
  aplicarLoteLic();
  while (E.licLote === L && L.estado === 'rodando') {
    await new Promise((ok) => setTimeout(ok, 1500));
    let e;
    try { e = await api('/api/licencas/lote/estado', { chave: L.chave }); } catch { continue; }
    if (e.estado === 'desconhecido') { L.estado = 'parado'; break; }
    Object.assign(L, e);
    aplicarLoteLic();
  }
  aplicarLoteLic();
  if (E.licLote === L && !$('.lic-lote-barra')) {
    const n = Object.values(L.resultados).filter((x) => x.estado === 'achada').length;
    aviso(`Conferência das licenças terminou: ${n} de ${L.total} lidas. Abra "Licenças a conferir" para salvar.`);
  }
}

async function pararLicencasLote() {
  const L = E.licLote;
  if (L) { try { await api('/api/licencas/lote/parar', { chave: L.chave }); } catch (e) { aviso(e.message, true); } }
}

async function salvarLicencasLote() {
  const L = E.licLote;
  if (!L) return;
  const fila = $$('.lic-linha').map((el) => {
    const r = L.resultados[idLinhaLic(el)];
    const licenca = $('.lic-escolha', el).value;
    return r && r.estado === 'achada' && r.certeza !== 'baixa' && licenca === r.licenca
      ? { licenca, referencia: el.dataset.ref, caminho: el.dataset.caminho } : null;
  }).filter(Boolean);
  if (!fila.length) return;
  let ok = 0;
  try {
    await salvar(async () => {
      for (const d of fila) { await api('/api/baixados/licenca', d); ok++; }
    }, `${fila.length} licença(s) salvas.`);
  } catch { aviso(`Salvei ${ok} de ${fila.length}; o resto ficou na lista.`, true); }
  if (pendenciasLicenca().total) abrirLicencas(); else fecharModal();
}

// "Conferir na página": como o "Escolher na página" das referências — a página abre numa janela do programa,
// que lê a licença sozinha (app/seletor.py, JS_LICENCA); o usuário confirma lá e a licença é salva aqui.
async function lerLicencaNaPagina(el) {
  if (!el) return;
  const url = $('[data-acao="lic-pagina"]', el).dataset.url;
  const estado = (t, cor = '') => { const s = $('.lic-estado', el); if (s) { s.textContent = t; s.style.color = cor; } };
  const marcar = (lic) => {
    const sel = $('.lic-escolha', el);
    if (!sel) return;
    if (![...sel.options].some((o) => o.value === lic)) sel.insertAdjacentHTML('beforeend', `<option>${esc(lic)}</option>`);
    sel.value = lic;
  };
  let r;
  try { r = await api('/api/seletor/licenca', { url }); } catch (e) {
    // fora da janela do programa (navegador, celular): abre a página por fora, como antes
    estado('A janela de leitura só abre no programa do PC; abri a página no navegador. Escolha a licença na lista.', 'var(--alerta, #ffb020)');
    api('/api/link', { url }).catch(() => window.open(url, '_blank'));
    return;
  }
  const chave = r.chave;
  E.licencaChave = chave;
  estado('Abri a página numa janela: estou lendo a licença…', 'var(--lima)');
  let achada = '';
  const inicio = Date.now();
  while (E.licencaChave === chave && document.body.contains(el) && Date.now() - inicio < 15 * 60 * 1000) {
    await new Promise((ok) => setTimeout(ok, 800));
    let e;
    try { e = await api('/api/seletor?chave=' + encodeURIComponent(chave)); } catch { continue; }
    if (e.estado === 'achada' && e.licenca !== achada) {
      achada = e.licenca;
      marcar(achada);
      estado(`Li na página: ${achada} (${e.fonte}). Confira lá e clique em "Usar".`, 'var(--lima)');
    }
    if (e.estado === 'pronto') {
      marcar(e.licenca);
      estado(`Licença confirmada na página: ${e.licenca}. Salvando…`, 'var(--lima)');
      return salvarLicencaLinha(el);
    }
    if (e.estado === 'cancelado') {
      return estado(achada ? `Janela fechada. Li ${achada}: confira e clique em Salvar.` : 'Janela fechada sem licença. Escolha na lista ou tente "Procurar".');
    }
  }
}

async function procurarLicencaLinha(el) {
  if (!el) return;
  const url = $('[data-acao="lic-procurar"]', el).dataset.url;
  try {
    const r = await api('/api/referencia/ler', { url });
    if (r.licenca) {
      const sel = $('.lic-escolha', el);
      if (![...sel.options].some((o) => o.value === r.licenca)) sel.insertAdjacentHTML('beforeend', `<option>${esc(r.licenca)}</option>`);
      sel.value = r.licenca;
      aviso(`Achei: ${r.licenca}. Confira e clique em Salvar.`);
    } else aviso('Não achei a licença (o site pode bloquear o programa). Abra a página e escolha na lista.', true);
  } catch (e) { aviso(e.message, true); }
}

async function salvarLicencaLinha(el) {
  if (!el) return;
  const licenca = $('.lic-escolha', el).value;
  if (!licenca) { aviso('Escolha a licença.', true); return; }
  try {
    await salvar(() => api('/api/baixados/licenca', { licenca, referencia: el.dataset.ref, caminho: el.dataset.caminho }), 'Licença salva.');
    if (pendenciasLicenca().total) abrirLicencas(); else fecharModal();
  } catch { /* aviso já mostrado */ }
}

