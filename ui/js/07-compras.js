'use strict';
// Selecta 3D — interface, parte 7 de 22: 07-compras.js. Os arquivos de ui/js/ são carregados em ordem pelo
// index.html e dividem o mesmo escopo global (scripts comuns, sem compilação). Dividido do antigo ui/app.js em fila-v27 (A17).
// ------------------------------------------------------------------ COMPRAS
function telaCompras() {
  const compras = linhas('compras');
  const f = E.filtros.compras;
  const lista = compras.filter((c) => !f.status || c.Status === f.status);
  const gasto = gastoDe(compras);
  const semValor = compras.filter((c) => !['a comprar', 'devolvido'].includes(c.Status) && numero(c['Valor (R$)']) === null).length;
  const caminho = compras.filter((c) => ['pedido', 'a caminho'].includes(c.Status));
  const conferir = compras.filter((c) => c.Status === 'a conferir').length;
  const nomeProj = Object.fromEntries(linhas('projetos').map((p) => [p.ID, p.Projeto]));

  const cab = `<div class="item cab"><div>ID</div><div class="col-data">Data</div><div>Item</div><div style="text-align:right">Valor</div><div>Status</div><div>Chegada</div><div class="col-projeto">Projeto</div><div style="text-align:right">Ações</div></div>`;
  const linhasHtml = lista.length ? lista.map((c) => {
    const v = numero(c['Valor (R$)']);
    const d = diasAte(c['Chegada prevista']);
    const projs = (c.Projeto || '').split(/[\s,]+/).filter(Boolean);
    return `<div class="item ${['devolvido'].includes(c.Status) ? 'esmaecido' : ''}">
      <div class="id">${esc(c.ID)}</div>
      <div class="muted col-data">${esc(c.Data)}</div>
      <div style="min-width:0"><div class="nome-item">${esc(c.Item)}</div>
        <div class="linha-2" title="${esc(c['Observações'])}">${esc(c.Loja)}${c.Pagamento && c.Pagamento !== '?' ? ' · ' + esc(c.Pagamento) : ''}</div>
        <div class="obs" title="${esc(c['Observações'])}">${textoMd(c['Observações'])}</div></div>
      <div style="text-align:right" class="${v === null ? 'fraco' : 'nome-item'}">${v === null ? esc(c['Valor (R$)'] || '—') : fmtReais(v)}</div>
      <div>${seletorStatus('compra-status', c.ID, c.Status, COMPRA_STATUS)}</div>
      <div>${c['Chegada prevista'] ? `${fmtData(c['Chegada prevista'])}<div class="linha-2">${['recebido', 'devolvido'].includes(c.Status) ? '' : textoDias(d)}</div>` : '<span class="fraco">—</span>'}</div>
      <div class="cores col-projeto">${projs.map((p) => `<span class="etiqueta fantasma" title="${esc(nomeProj[p] || '')}">${esc(p)}</span>`).join('') || '<span class="fraco">geral</span>'}</div>
      <div class="acoes">
        ${c.Link ? `<a class="icone" href="${esc(c.Link)}" target="_blank" rel="noopener" data-acao="ref-link" data-url="${esc(c.Link)}" title="Abrir a página do produto">${ICONE.abrir}</a>` : ''}
        ${botaoIcone('compra-entrada', 'entrada', 'Dar entrada no estoque', `data-id="${esc(c.ID)}"`)}
        ${botaoIcone('editar', 'editar', 'Editar', `data-tipo="compra" data-id="${esc(c.ID)}"`)}
      </div>
    </div>`;
  }).join('') : '<div class="vazio">Nenhuma compra com esse filtro.</div>';

  const prazos = linhas('prazos').map((p, i) => ({ ...p, _i: i })).sort((a, b) => (diasAte(a.Data) ?? 99999) - (diasAte(b.Data) ?? 99999));
  const prazosHtml = prazos.length ? prazos.map((p) => {
    const d = diasAte(p.Data);
    const passou = d !== null && d < 0;
    return `<div class="item ${passou ? 'esmaecido' : ''}">
      <div class="data-grande">${fmtData(p.Data)}</div>
      <div><span class="etiqueta ${passou ? 'fantasma' : d !== null && d <= 3 ? 'erro' : 'menta'}">${textoDias(d) || esc(p.Data)}</span></div>
      <div class="id">${esc(p.Compra)}</div>
      <div>${textoMd(p['O que vence'])}</div>
      <div class="acoes">${botaoIcone('editar', 'editar', 'Editar', `data-tipo="prazo" data-indice="${p._i}"`)}</div>
    </div>`;
  }).join('') : '<div class="vazio">Nenhum prazo.</div>';

  return `
    ${subAbasEstoque('compras')}
    ${cabecalho('Compras', 'Pedidos, valores e prazos, em <code>compras.md</code>. Números de pedido, rastreio e endereço ficam só nos documentos da pasta de cada compra.',
      `<button class="botao primario" data-acao="novo" data-tipo="compra">${ICONE.mais}Nova compra</button>`)}
    <section class="numeros">
      <div><div class="valor lima" style="font-size:52px">${fmtReais(gasto)}</div><div class="legenda">gasto registrado${semValor ? ` · ${semValor} compra(s) sem valor` : ''}</div></div>
      <div><div class="valor">${caminho.length}</div><div class="legenda">pedidos a caminho</div></div>
      <div><div class="valor ${conferir ? 'erro' : ''}">${conferir}</div><div class="legenda">compras a conferir</div></div>
    </section>
    <div class="barra">
      <select class="seletor" data-filtro="compras.status"><option value="">Todos os status</option>${COMPRA_STATUS.map((s) => `<option ${s === f.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
    </div>
    <section class="lista compras-lista">${cab}${linhasHtml}</section>
    <section class="cartao">
      <h2 class="secao" style="justify-content:space-between">Prazos <button class="botao pequeno" data-acao="novo" data-tipo="prazo">${ICONE.mais}Novo prazo</button></h2>
      <div class="lista prazos-lista">${prazosHtml}</div>
    </section>`;
}

