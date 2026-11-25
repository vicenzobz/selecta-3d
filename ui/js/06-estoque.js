'use strict';
// Selecta 3D — interface, parte 6 de 22: 06-estoque.js. Os arquivos de ui/js/ são carregados em ordem pelo
// index.html e dividem o mesmo escopo global (scripts comuns, sem compilação). Dividido do antigo ui/app.js em fila-v27 (A17).
// ------------------------------------------------------------------ ESTOQUE
function telaEstoque() {
  const rolos = linhas('filamentos');
  const ativos = rolos.filter((r) => r.Status !== 'acabou');
  const totalG = ativos.reduce((s, r) => s + (numero(r['Restante (g)']) || 0), 0);
  const baixos = ativos.filter((r) => (numero(r['Restante (g)']) ?? 9999) < ROLO_BAIXO);
  const insumos = linhas('insumos');
  const faltando = insumos.filter((r) => numero(r['Mínimo']) !== null && numero(r.Quantidade) !== null && numero(r.Quantidade) <= numero(r['Mínimo']));

  const cartoes = rolos.map((r) => {
    const rest = numero(r['Restante (g)']), peso = numero(r['Peso (g)']) || 1000;
    const pct = rest === null ? 0 : Math.max(0, Math.min(100, (rest / peso) * 100));
    const baixo = rest !== null && rest < ROLO_BAIXO;
    return `
    <article class="rolo ${r.Status === 'acabou' ? 'acabou' : ''}">
      <div class="rolo-topo">
        <span class="bolinha g" style="background:${esc(r.Hex)}"></span>
        <div><div class="rolo-nome">${esc(r.Cor)}</div><div class="rolo-sub">${esc(r.ID)} · ${esc(r.Marca)} · ${esc(r.Material)}${custoGrama(r) !== null ? ` · ${fmtReais(custoGrama(r) * 1000)}/kg` : ''}</div></div>
      </div>
      <div>
        <div class="rolo-peso"><b class="${baixo ? 'baixo' : ''}">${rest === null ? '?' : fmtNum(rest)}<small style="font-size:18px"> g</small></b><span class="fraco">de ${fmtNum(peso)} g</span></div>
        <div class="barra-prog ${baixo ? 'baixa' : ''}" style="margin-top:10px"><i style="width:${pct}%"></i></div>
      </div>
      <div class="rolo-rodape">
        ${seletorStatus('rolo-status', r.ID, r.Status, ROLO_STATUS, 'style="width:auto"')}
        <div class="acoes">
          ${botaoIcone('rolo-movimentar', 'balanca', 'Usei / entrou / pesei', `data-id="${esc(r.ID)}"`)}
          ${botaoIcone('editar', 'editar', 'Editar', `data-tipo="filamento" data-id="${esc(r.ID)}"`)}
        </div>
      </div>
      ${r.Local || r['Observações'] ? `<div class="linha-2 quebra" title="${esc(r['Observações'])}">${esc(r.Local)}${r.Local && r['Observações'] ? ' · ' : ''}${textoMd(r['Observações'])}</div>` : ''}
    </article>`;
  }).join('');

  const insumosHtml = insumos.length ? insumos.map((r) => {
    const q = numero(r.Quantidade), min = numero(r['Mínimo']);
    const falta = q !== null && min !== null && q <= min;
    return `<div class="item">
      <div class="id">${esc(r.ID)}</div>
      <div style="min-width:0"><div class="nome-item">${esc(r.Item)}</div><div class="linha-2" title="${esc(r['Observações'])}">${textoMd(r['Observações'])}</div></div>
      <div><span class="etiqueta fantasma">${esc(r.Categoria || '—')}</span></div>
      <div style="display:flex;align-items:center;gap:6px">
        ${botaoIcone('insumo-menos', 'menos', 'Tirar 1', `data-id="${esc(r.ID)}"`)}
        <b class="${falta ? '' : ''}" style="min-width:44px;text-align:center;color:${falta ? 'var(--erro)' : 'var(--menta)'}">${esc(r.Quantidade || '?')}</b>
        ${botaoIcone('insumo-mais', 'mais', 'Pôr 1', `data-id="${esc(r.ID)}"`)}
        <span class="fraco">${esc(r.Unidade)}</span>
      </div>
      <div class="muted">${esc(r.Local)}${min !== null ? ` <span class="fraco">· mín. ${esc(r['Mínimo'])}</span>` : ''}</div>
      <div class="acoes">${botaoIcone('editar', 'editar', 'Editar', `data-tipo="insumo" data-id="${esc(r.ID)}"`)}</div>
    </div>`;
  }).join('') : '<div class="vazio">Nenhum insumo cadastrado.</div>';

  const movs = linhas('movimentacoes').slice().reverse().slice(0, 14);
  const movsHtml = movs.length ? movs.map((m) => `<div class="item">
      <div class="muted">${esc(m.Data)}</div><div>${esc(m.Item)}</div>
      <div class="nome-item">${esc(m.Quantidade)}</div><div class="muted">${esc(m.Motivo)}</div><div class="fraco">${esc(m.Quem)}</div></div>`).join('')
    : '<div class="vazio">Sem movimentações.</div>';

  return `
    ${subAbasEstoque('estoque')}
    ${cabecalho('Estoque', 'Filamentos, insumos e peças, em <code>estoque.md</code>. Ao registrar uma impressão na fila, as gramas saem daqui sozinhas.',
      `<button class="botao" data-acao="etiquetas">${ICONE.etiqueta}Etiquetas com QR</button>
       <button class="botao" data-acao="novo" data-tipo="insumo">${ICONE.mais}Novo insumo</button>
       <button class="botao primario" data-acao="novo" data-tipo="filamento">${ICONE.mais}Novo rolo</button>`)}
    <section class="numeros">
      <div><div class="valor">${fmtNum(totalG / 1000, 1)}<small>kg</small></div><div class="legenda">de filamento no estoque</div></div>
      <div><div class="valor">${ativos.length}</div><div class="legenda">rolos em uso ou lacrados</div></div>
      <div><div class="valor ${baixos.length ? 'erro' : 'lima'}">${baixos.length}</div><div class="legenda">rolos com menos de ${ROLO_BAIXO} g</div></div>
      <div><div class="valor ${faltando.length ? 'erro' : ''}">${faltando.length}</div><div class="legenda">insumos no mínimo</div></div>
    </section>
    ${(() => { const ri = resumoImpressoes(); return ri.n ? `<div class="resumo-consumo">Já impresso (registrado em <code>impressoes.md</code>): <b>${fmtNum(ri.gramas)} g</b> em ${ri.n} impressão(ões)${ri.custo ? ` · ${fmtReais(ri.custo)} de material` : ''}${ri.falhas ? ` · ${ri.falhas} falha(s), ${fmtNum(ri.gFalhas)} g` : ''} · <a href="#" data-acao="aba" data-aba="impressoes">ver Impressões</a></div>` : ''; })()}
    ${(() => {
      const prev = previsao();
      const comFalta = prev.lista.filter((c) => c.falta > 0);
      return `<section class="cartao">
        <h2 class="secao">Previsão por cor <small>gramas que as peças ativas da fila pedem (pelas estimativas) × o que resta nos rolos</small></h2>
        ${comFalta.length ? `<div class="faixa-aviso erro-faixa" style="margin-bottom:14px">Vai faltar: ${comFalta.map((c) => `${esc(c.nome)} (${fmtNum(c.falta)} g; peças ${esc(c.pecas.join(', '))})`).join(' · ')}</div>` : ''}
        <div class="prev-grade">${prev.lista.map(barraPrevisao).join('')}</div>
        <div class="linha-2 quebra" style="margin-top:12px">Linha clara = o que tem; marca = o que a fila pede. ${prev.semEstimativa.length ? `${prev.semEstimativa.length} peça(s) ativa(s) ainda sem estimativa (não entram na conta). ` : ''}${prev.semCor ? `${fmtNum(prev.semCor)} g estimados sem cor definida (${esc(prev.semCorPecas.join(', '))}).` : ''}</div>
      </section>`;
    })()}
    <section><h2 class="secao">Filamentos</h2><div class="rolos">${cartoes || '<div class="vazio">Nenhum rolo.</div>'}</div></section>
    <section class="cartao"><h2 class="secao">Insumos e peças</h2><div class="lista insumos-lista">${insumosHtml}</div></section>
    <section class="cartao"><h2 class="secao">Movimentações <small>mais recentes primeiro</small></h2><div class="lista mov-lista">${movsHtml}</div></section>`;
}

