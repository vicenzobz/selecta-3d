'use strict';
// Selecta 3D — interface, parte 13 de 22: 13-dialogos.js. Os arquivos de ui/js/ são carregados em ordem pelo
// index.html e dividem o mesmo escopo global (scripts comuns, sem compilação). Dividido do antigo ui/app.js em fila-v27 (A17).
// ------------------------------------------------------------------ diálogos específicos
function opcoesRolos(selecionado) {
  return linhas('filamentos').map((r) => `<option value="${esc(r.ID)}" ${r.ID === selecionado ? 'selected' : ''}>${esc(r.ID)} · ${esc(r.Cor)} (${esc(r['Restante (g)'])} g)${r.Status === 'acabou' ? ' · acabou' : ''}</option>`).join('');
}
const linhaConsumo = (rolo, g = '') => `<div class="linha">
  <select data-consumo="rolo"><option value="">— rolo —</option>${opcoesRolos(rolo)}</select>
  <input data-consumo="gramas" inputmode="decimal" placeholder="gramas" value="${esc(g ?? '')}">
  ${botaoIcone('consumo-tirar', 'x', 'Tirar esta linha')}
</div>`;

function abrirEntrada(c) {
  abrirModal({
    titulo: `Entrada ${c.ID}`,
    sub: `${c.Item} — cria o item no estoque e marca a compra como recebida.`,
    corpo: `
      <div class="formulario">
        <label class="inteiro">O que chegou
          <div class="escolha">
            <label><input type="radio" name="tipo-entrada" value="rolo" checked>Rolo de filamento</label>
            <label><input type="radio" name="tipo-entrada" value="insumo">Insumo ou peça</label>
          </div>
        </label>
        <label class="inteiro">Nome (cor do rolo ou nome do item)<input id="ent-nome" value="${esc(c.Item)}"></label>
        <label>Quantidade<input id="ent-qtd" inputmode="decimal" value="1000"><span class="dica">Rolo: gramas líquidas. Insumo: quantidade.</span></label>
        <label>Unidade (insumo)<input id="ent-unid" value="un"></label>
        <label>Material / categoria<input id="ent-mat" placeholder="PLA 1,75 mm · ferramenta · rabeca…"></label>
        <label>Marca (rolo) / local<input id="ent-marca"></label>
        <label>Cor do rolo<input id="ent-hex" type="color" value="#9fe870"></label>
      </div>`,
    acoes: [
      { rotulo: 'Cancelar' },
      {
        rotulo: 'Dar entrada', primario: true,
        fn: async () => {
          const tipo = $('input[name=tipo-entrada]:checked').value;
          const qtd = numero($('#ent-qtd').value);
          const nome = $('#ent-nome').value.trim();
          if (!nome || qtd === null) { aviso('Preencha nome e quantidade.', true); return false; }
          E.salvando = true;
          try {
            let id;
            if (tipo === 'rolo') {
              ({ id } = await api('/api/tabela/adicionar', { arquivo: 'estoque.md', secao: 'Filamentos', campos: {
                Material: $('#ent-mat').value || 'PLA 1,75 mm', Marca: $('#ent-marca').value, Cor: nome,
                Hex: $('#ent-hex').value.toUpperCase(), 'Peso (g)': String(qtd), 'Restante (g)': '0', Status: 'lacrado',
                'Observações': `Compra ${c.ID}.` } }));
              await api('/api/estoque/movimentar', { secao: 'Filamentos', id, delta: qtd, motivo: `entrada da compra ${c.ID}` });
            } else {
              ({ id } = await api('/api/tabela/adicionar', { arquivo: 'estoque.md', secao: 'Insumos e peças', campos: {
                Item: nome, Categoria: $('#ent-mat').value, Quantidade: '0', Unidade: $('#ent-unid').value || 'un',
                Local: $('#ent-marca').value, 'Observações': `Compra ${c.ID}.` } }));
              await api('/api/estoque/movimentar', { secao: 'Insumos e peças', id, delta: qtd, motivo: `entrada da compra ${c.ID}` });
            }
            if (c.Status !== 'recebido') {
              await api('/api/tabela/atualizar', { arquivo: 'compras.md', secao: 'Compras', id: c.ID, campos: { Status: 'recebido' }, antes: { Status: c.Status } });
            }
            aviso(`${id} criado no estoque.`);
          } catch (e) {
            aviso(e.message, true);
          } finally {
            E.salvando = false;
            await carregar();
          }
          return true;
        },
      },
    ],
  });
}

async function abrirVisualizador(caminho) {
  const nome = caminho.split('/').pop();
  abrirModal({
    titulo: nome.replace(/\.[^.]+$/, ''),
    sub: caminho,
    largo: true,
    corpo: `<div class="visualizador" id="vis"><div class="carregando">Carregando o modelo…</div></div><div class="vis-info" id="vis-info"></div>`,
    acoes: [
      { rotulo: 'Fundo claro', fn: () => {
        if (!E.vis) return false;
        const claro = E.vis.alternarFundo();
        const b = $$('#modal .modal-acoes button')[0];
        if (b) setTimeout(() => { b.textContent = claro ? 'Fundo escuro' : 'Fundo claro'; }, 0);
        return false;
      } },
      { rotulo: 'Mostrar na pasta', fn: () => { abrirNoWindows(caminho, 'pasta'); return false; } },
      { rotulo: `Abrir no ${nomeAbrir(padraoAbrir())}`, fn: () => { abrirNoFatiador(caminho); return false; } },
      { rotulo: 'Fechar', primario: true },
    ],
  });
  try {
    const m = await import(new URL('visualizador.js', document.baseURI).href) /* relativo à página, não a ui/js/ */;
    E.vis = await m.mostrarModelo($('#vis'), `/api/modelo?caminho=${encodeURIComponent(caminho)}&t=${encodeURIComponent(TOKEN)}`, caminho, (info) => {
      const cabe = info.x <= 260 && info.y <= 260 && info.z <= 260;
      const bFundo = $$('#modal .modal-acoes button')[0];
      if (bFundo) bFundo.textContent = info.claro ? 'Fundo escuro' : 'Fundo claro';
      $('#vis-info').innerHTML = `
        <span class="etiqueta menta">${fmtNum(info.x, 1)} × ${fmtNum(info.y, 1)} × ${fmtNum(info.z, 1)} mm</span>
        <span class="etiqueta ${cabe ? 'lima' : 'erro'}">${cabe ? 'Cabe na mesa 260 × 260 × 260' : 'Não cabe na mesa de 260 mm'}</span>
        <span class="etiqueta fantasma">${fmtNum(info.triangulos)} triângulos</span>
        ${info.partes > 1 ? `<span class="etiqueta fantasma">${info.partes} partes</span>` : ''}
        <span class="fraco">Arraste para girar · roda do mouse para zoom · botão direito para mover. A grade é a mesa de 260 mm.</span>`;
    });
  } catch (e) {
    const v = $('#vis');
    if (v) v.innerHTML = `<div class="carregando">Não consegui abrir o modelo: ${esc(e.message)}</div>`;
  }
}

function abrirRegistrar(r, statusInicial = 'concluído', extra = {}) {
  const est = estimativaDe(r.ID);
  const partesEst = est ? partesEstimativa(est['Gramas por cor']).filter((p) => corPorNome(p.cor)) : [];
  const cores = partesEst.length
    ? partesEst.map((p) => ({ c: corPorNome(p.cor), g: p.g }))
    : coresDoTexto(r['Filamento/cor']).map((c) => ({ c, g: '' }));
  // A07: o rolo de cada cor vem do slot do ACE (rolo ligado ao slot), senão o primeiro rolo aberto dessa cor
  const noSlot = Object.values(rolosDosSlots());
  const linhasConsumo = cores.map(({ c, g }) => {
    const ativos = linhas('filamentos').filter((f) => c.ids.includes(f.ID) && f.Status !== 'acabou');
    const doSlot = noSlot.find((id) => c.ids.includes(id));
    return linhaConsumo(doSlot || (ativos[0] || {}).ID || c.ids[0], g);
  });
  abrirModal({
    titulo: `Registrar ${r.ID}`,
    sub: `${r['Peça']} · status atual: ${r.Status}${est ? ` · estimativa: ${est['Gramas por cor']}${est.Tempo ? ', ' + est.Tempo : ''}` : ''}`,
    corpo: `
      <div class="formulario">
        <label class="inteiro">Como foi
          <div class="escolha" id="reg-final">
            <label><input type="radio" name="final" value="concluído" ${statusInicial === 'concluído' ? 'checked' : ''}>Concluída</label>
            <label><input type="radio" name="final" value="falhou" ${statusInicial === 'falhou' ? 'checked' : ''}>Falhou</label>
          </div>
        </label>
        <label>Tempo real<input id="reg-tempo" value="${esc(extra.tempo || '')}" placeholder="${esc(est && est.Tempo ? 'estimado ' + est.Tempo : 'ex.: 3h34')}"></label>
        <span></span>
        <label class="inteiro">Filamento gasto
          <div class="consumo-tabela" id="consumo">${(linhasConsumo.length ? linhasConsumo : [linhaConsumo('')]).join('')}</div>
          <span class="dica">${partesEst.length ? 'Preenchido com a estimativa do fatiador; ajuste se pesou ou se parou no meio.' : 'Gramas por cor, do fatiador (tecla L na pré-visualização) ou da balança.'} Em branco = não desconta do estoque. Falha também gasta.</span>
          <div><button class="botao pequeno" data-acao="consumo-mais" type="button">${ICONE.mais}Outro rolo</button></div>
        </label>
        <div class="inteiro formulario" id="reg-falha" style="grid-template-columns:1fr 1fr;${statusInicial === 'falhou' ? '' : 'display:none'}">
          <label>Motivo da falha<input id="reg-motivo" placeholder="ex.: descolou da mesa, entupiu, imprimiu no ar"></label>
          <label>Solução (se souber)<input id="reg-solucao" placeholder="ex.: limpar a chapa, 220 °C em todas as camadas"></label>
          <label class="inteiro" style="display:flex;flex-direction:row;align-items:center;gap:10px;font-weight:400;color:var(--texto)">
            <input type="checkbox" id="reg-anotar" style="height:auto;accent-color:var(--lima)"> Anotar em <code>impressora.md</code>, em Problemas conhecidos e soluções</label>
        </div>
        <label class="inteiro">Nota<textarea id="reg-nota" placeholder="O que deu certo ou errado (opcional)">${esc(extra.nota || '')}</textarea></label>
      </div>`,
    acoes: [
      { rotulo: 'Cancelar' },
      {
        rotulo: 'Registrar', primario: true,
        fn: async () => {
          const status = ($('input[name=final]:checked') || {}).value || 'concluído';
          const consumoLido = $$('#consumo .linha').map((l) => ({ id: $('[data-consumo=rolo]', l).value, gramas: $('[data-consumo=gramas]', l).value.trim() }))
            .filter((c) => c.id && c.gramas);
          await salvar(() => api('/api/fila/registrar', {
            id: r.ID, status, tempo: $('#reg-tempo').value, consumo: consumoLido, nota: $('#reg-nota').value,
            motivo_falha: $('#reg-motivo').value, solucao: $('#reg-solucao').value, anotar_problema: $('#reg-anotar').checked,
            fatiado: extra.fatiado || '',
            antes: { Status: r.Status, 'Observações': r['Observações'] },
          }), `${r.ID} registrada como ${status}.`);
          if (extra.aoRegistrar) extra.aoRegistrar();
          setTimeout(() => abrirSugestoesProxima(r.ID), 400); // F6
          return true;
        },
      },
    ],
  });
}

// F6: depois de registrar, as 3 melhores próximas peças: cabem nos rolos carregados, já fatiadas, na janela de agora
function janelaAgora(d = new Date()) {
  return Object.keys(JANELAS_PADRAO).find((j) => naJanela(d, j)) || '';
}
function sugestoesProxima(excluir) {
  const st = IMP.estado || {};
  const carregadas = new Set((st.slots || []).filter((x) => x.carregado && x.cor).map((x) => norm(corParecida(x.cor))));
  const jan = janelaAgora();
  const lista = fila().filter((r) => r.ID !== excluir && ['fatiado', 'pronto para fatiar'].includes(r.Status));
  return lista.map((r, ordem) => {
    const cores = coresDoTexto(r['Filamento/cor']).map((c) => norm(c.nome));
    const faltam = carregadas.size ? cores.filter((c) => !carregadas.has(c)) : [];
    const j = janela(r['Observações']) || 'Em casa';
    const pontos = (carregadas.size && cores.length && !faltam.length ? 4 : 0) + (r.Status === 'fatiado' ? 2 : 0) + (jan && j === jan ? 1 : 0);
    return { r, faltam, j, pontos, ordem };
  }).sort((a, b) => b.pontos - a.pontos || a.ordem - b.ordem).slice(0, 3);
}
function abrirSugestoesProxima(excluir) {
  if (modalAberto()) return;
  const sug = sugestoesProxima(excluir);
  if (!sug.length) return;
  const jan = janelaAgora();
  const temSlots = !!((IMP.estado || {}).slots || []).length;
  abrirModal({
    titulo: 'O que imprimir agora?', largo: true,
    sub: `Três sugestões${jan ? ` para a janela de agora (${jan})` : ''}${temSlots ? ', pelos rolos carregados no ACE' : ''}. Nada começa sozinho: limpe a mesa e escolha.`,
    corpo: `<div class="lista">${sug.map(({ r, faltam, j }) => {
      const re = resumoEstimativa(estimativaDe(r.ID));
      return `<div class="item sugestao" style="grid-template-columns:56px minmax(0,1fr) auto">
        <div class="id">${esc(r.ID)}</div>
        <div><div class="nome-item">${esc(r['Peça'])}</div><div class="linha-2 cores">${bolinhas(r['Filamento/cor'])}<span class="texto-cor">${esc(j)}${re && re.min ? ` · ${fmtMin(Math.round(re.min * fatorDe(r)))}` : ''} · ${esc(r.Status)}</span></div>
          ${temSlots ? `<div class="linha-2">${faltam.length ? `<span class="etiqueta alerta">trocar rolo: ${esc(faltam.join(', '))}</span>` : '<span class="etiqueta lima">cabe nos rolos carregados</span>'}</div>` : ''}</div>
        <div>${botaoPasso(proximoPasso(r), 'pequeno')}</div></div>`;
    }).join('')}</div>`,
    acoes: [{ rotulo: 'Agora não' }],
  });
  $$('#modal .sugestao .passo').forEach((b) => { b.dataset.fecharMenu = '1'; });
}

function abrirMovimentarRolo(r) {
  abrirModal({
    titulo: `${r.Cor}`,
    sub: `${r.ID} · restam ${r['Restante (g)']} g de ${r['Peso (g)']} g${r['Tara (g)'] ? ` · carretel vazio ${r['Tara (g)']} g` : ''}`,
    corpo: `
      <div class="formulario">
        <label class="inteiro">O que aconteceu
          <div class="escolha" id="mov-modo">
            <label><input type="radio" name="mov" value="pesei" checked>Pesei na balança</label>
            <label><input type="radio" name="mov" value="usei">Usei (sai do estoque)</label>
            <label><input type="radio" name="mov" value="entrou">Entrou (somar)</label>
          </div>
        </label>
        <label id="mov-rot-qtd">Peso na balança (g)<input id="mov-qtd" inputmode="decimal" placeholder="rolo + carretel"></label>
        <label id="mov-rot-tara">Carretel vazio (g)<input id="mov-tara" inputmode="decimal" value="${esc(r['Tara (g)'] || '')}" placeholder="pese um carretel vazio uma vez"><span class="dica">Fica guardado no rolo para as próximas pesagens.</span></label>
        <label class="inteiro">Motivo<input id="mov-motivo" placeholder="ex.: pesagem, teste de cor, purga"></label>
      </div>`,
    acoes: [
      { rotulo: 'Cancelar' },
      {
        rotulo: 'Gravar', primario: true,
        fn: async () => {
          const modo = $('input[name=mov]:checked').value;
          const q = numero($('#mov-qtd').value);
          if (q === null) { aviso('Informe as gramas.', true); return false; }
          if (modo === 'pesei') {
            await salvar(() => api('/api/estoque/pesar', { id: r.ID, balanca: q, tara: $('#mov-tara').value, motivo: $('#mov-motivo').value }), `${r.Cor}: pesado.`);
          } else {
            await salvar(() => api('/api/estoque/movimentar', { secao: 'Filamentos', id: r.ID, delta: modo === 'usei' ? -q : q, motivo: $('#mov-motivo').value || modo }), `${r.Cor}: estoque atualizado.`);
          }
          return true;
        },
      },
    ],
  });
}

function abrirEstimar(r, inicial = null) {
  const est = estimativaDe(r.ID);
  const partes = inicial ? inicial.partes : est ? partesEstimativa(est['Gramas por cor']) : coresDoTexto(r['Filamento/cor']).map((c) => ({ cor: c.nome, g: '' }));
  const linhaCor = (cor, g) => `<div class="linha" style="grid-template-columns:1fr 120px 34px">
    <select data-est="cor"><option value="total" ${cor === 'total' ? 'selected' : ''}>total (sem separar por cor)</option>
      ${indiceCores().filter((c) => c.chave === norm(c.nome)).map((c) => `<option ${norm(c.nome) === norm(cor) ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select>
    <input data-est="g" inputmode="decimal" placeholder="gramas" value="${esc(g ?? '')}">
    ${botaoIcone('consumo-tirar', 'x', 'Tirar esta linha')}
  </div>`;
  abrirModal({
    titulo: `Estimativa ${r.ID}`,
    sub: `${r['Peça']} · ${r['Filamento/cor']}${inicial && est ? ' · substitui a estimativa atual' : ''}`,
    corpo: `
      <div class="formulario">
        <label class="inteiro">Gramas por cor
          <div class="consumo-tabela" id="est-cores">${(partes.length ? partes : [{ cor: 'total', g: '' }]).map((p) => linhaCor(p.cor, p.g)).join('')}</div>
          <span class="dica">Do fatiador: na pré-visualização, a tecla L mostra o uso por filamento. Sem a purga.</span>
          <div><button class="botao pequeno" type="button" data-acao="est-mais">${ICONE.mais}Outra cor</button></div>
        </label>
        <label>Tempo previsto<input id="est-tempo" value="${esc(inicial ? inicial.tempo : est ? est.Tempo : '')}" placeholder="ex.: 5h12"></label>
        <label>Fonte<input id="est-fonte" value="${esc(inicial ? inicial.fonte : est ? est.Fonte : 'fatiador')}"></label>
        <label class="inteiro">Observações<textarea id="est-obs">${esc(inicial ? inicial.obs : est ? est['Observações'] : '')}</textarea></label>
        ${inicial && inicial.fatiado && !FILA_FIM.has(r.Status) && r.Status !== 'imprimindo' ? `<div class="inteiro escolha"><label><input type="checkbox" id="est-fatiado" checked>
          ${r.Status === 'fatiado' ? `Anotar o arquivo fatiado nas Observações de ${esc(r.ID)}` : `Marcar ${esc(r.ID)} como fatiado (hoje: ${esc(r.Status)}) e anotar o arquivo nas Observações`}</label></div>` : ''}
      </div>`,
    acoes: [
      ...(est ? [{ rotulo: 'Apagar estimativa', fn: async () => {
        await salvar(() => api('/api/estimativa/salvar', { peca: r.ID, gramas: '', tempo: '', fonte: '', obs: '' }), 'Estimativa apagada.');
        return true;
      } }] : []),
      { rotulo: 'Cancelar' },
      {
        rotulo: 'Salvar', primario: true,
        fn: async () => {
          const gramas = $$('#est-cores .linha').map((l) => [$('[data-est=cor]', l).value, numero($('[data-est=g]', l).value)])
            .filter(([, g]) => g !== null).map(([c, g]) => `${c} ${fmtNum(g, g % 1 ? 1 : 0).replace(/\./g, '')}`).join('; ');
          if (!gramas && !$('#est-tempo').value.trim()) { aviso('Preencha as gramas ou o tempo.', true); return false; }
          const marcar = !!(inicial && inicial.fatiado && $('#est-fatiado') && $('#est-fatiado').checked);
          await salvar(async () => {
            await api('/api/estimativa/salvar', { peca: r.ID, gramas, tempo: $('#est-tempo').value, fonte: $('#est-fonte').value, obs: $('#est-obs').value });
            if (marcar) {
              // a peça fica "fatiado" e o caminho do arquivo vai para as Observações, com a data
              const obs = String(r['Observações'] || '').trim();
              const frase = inicial.fatiado.frase;
              await api('/api/fila/atualizar', { id: r.ID, campos: { Status: 'fatiado', 'Observações': obs ? `${obs} ${frase}` : frase },
                antes: { Status: r.Status, 'Observações': r['Observações'] } });
            }
          }, marcar ? `Estimativa salva e ${r.ID} marcada como fatiada.` : `Estimativa de ${r.ID} salva.`);
          return true;
        },
      },
    ],
  });
  E.linhaCorEst = linhaCor;
}

async function abrirEtiquetas() {
  let cel = null;
  try { cel = await api('/api/celular'); } catch { /* sem celular */ }
  const itens = [
    ...linhas('filamentos').map((r) => ({ id: r.ID, nome: r.Cor, hex: r.Hex, acabou: r.Status === 'acabou' })),
    ...linhas('insumos').map((r) => ({ id: r.ID, nome: r.Item })),
  ];
  abrirModal({
    titulo: 'Etiquetas com QR',
    sub: 'Abre uma página no navegador para imprimir (folha A4, 70 × 34 mm por etiqueta). O QR abre o item no celular.',
    corpo: `
      ${cel && !cel.ativo ? '<div class="faixa-aviso" style="margin-bottom:16px">O acesso pelo celular está desligado: o QR só abre quando ele estiver ligado (botão Celular, no menu).</div>' : ''}
      ${cel && !cel.bases.length ? '<div class="faixa-aviso" style="margin-bottom:16px">Não achei o endereço do PC na rede; as etiquetas sairão sem QR.</div>' : ''}
      <div class="escolha" id="etq-itens">${itens.map((x) => `<label><input type="checkbox" value="${esc(x.id)}" ${x.acabou ? '' : 'checked'}>${x.hex ? `<span class="bolinha" style="background:${esc(x.hex)}"></span>` : ''}${esc(x.id)} · ${esc(x.nome)}</label>`).join('')}</div>`,
    acoes: [
      { rotulo: 'Cancelar' },
      {
        rotulo: 'Abrir para imprimir', primario: true,
        fn: async () => {
          const ids = $$('#etq-itens input:checked').map((i) => i.value).join(',');
          if (!ids) { aviso('Escolha ao menos um item.', true); return false; }
          await api('/api/pagina', { pagina: 'etiquetas.html', consulta: { ids, base: cel && cel.bases[0] ? cel.bases[0] : '' } });
          aviso('Etiquetas abertas no navegador.');
          return true;
        },
      },
    ],
  });
}

