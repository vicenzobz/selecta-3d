'use strict';
// Selecta 3D — interface, parte 8 de 22: 08-projetos.js. Os arquivos de ui/js/ são carregados em ordem pelo
// index.html e dividem o mesmo escopo global (scripts comuns, sem compilação). Dividido do antigo ui/app.js em fila-v27 (A17).
// ------------------------------------------------------------------ PROJETOS
function telaProjetos() {
  const compras = linhas('compras');
  const cartoes = linhas('projetos').map((p, i) => {
    const pecas = pecasDoProjeto(p);
    const feitas = pecas.filter((r) => r.Status === 'concluído').length;
    const prontas = pecas.filter((r) => ['pronto para fatiar', 'fatiado', 'imprimindo'].includes(r.Status)).length;
    const pct = pecas.length ? Math.round((feitas / pecas.length) * 100) : 0;
    const pasta = pastaDoProjeto(p);
    const arqs = E.arquivos ? E.arquivos.filter((a) => a.caminho.startsWith(pasta + '/')).length : null;
    const gasto = gastoDe(compras.filter((c) => (c.Projeto || '').split(/[\s,]+/).includes(p.ID)));
    const idsPecas = new Set(pecas.map((r) => r.ID));
    const filamentoGasto = linhas('impressoes').filter((h) => idsPecas.has(h['Peça'])).reduce((s, h) => s + (numero(h['Custo (R$)']) || 0), 0);
    const d = diasAte(p.Prazo);
    return `
    <article class="projeto ${p.Status === 'ativo' && i === 0 ? 'ativo-destaque' : ''}">
      <div class="projeto-topo">
        <div><div class="fraco" style="font-weight:600;margin-bottom:8px">${esc(p.ID)} · <code>${esc(pasta || '—')}</code></div><h3>${esc(p.Projeto)}</h3></div>
        ${seletorStatus('projeto-status', p.ID, p.Status, PROJ_STATUS, 'style="width:auto"')}
      </div>
      <p class="desc">${textoMd(p['Descrição'])}</p>
      ${p.Prazo ? `<div><span class="etiqueta ${d !== null && d >= 0 && d <= 14 ? 'lima' : 'menta'}">Prazo ${dataISO(p.Prazo) ? fmtData(p.Prazo) : esc(p.Prazo)}${d !== null ? ' · ' + textoDias(d) : ''}</span></div>` : ''}
      <div>
        <div style="display:flex;justify-content:space-between;margin-bottom:8px"><span class="muted">${feitas} de ${pecas.length} peças concluídas</span><b style="color:var(--menta)">${pct}%</b></div>
        <div class="barra-prog"><i style="width:${pct}%"></i></div>
      </div>
      <div class="linha-numeros">
        <div><b>${pecas.length}</b><span>na fila</span></div>
        <div><b>${prontas}</b><span>prontas / imprimindo</span></div>
        <div><b>${arqs === null ? '…' : arqs}</b><span>arquivos 3D</span></div>
        <div><b>${gasto ? fmtNum(gasto, 0) : '—'}</b><span>R$ em compras${filamentoGasto ? ` · ${fmtReais(filamentoGasto)} em filamento` : ''}</span></div>
      </div>
      ${(() => {
        const mats = linhas('materiais').map((m, k) => ({ ...m, _i: k })).filter((m) => m.Projeto === p.ID);
        const faltam = mats.filter((m) => statusMaterial(m).s === 'falta').length;
        return `<div class="materiais">
          <div class="materiais-topo"><b>Materiais</b><span class="fraco">${mats.length ? `${mats.length} item(ns)${faltam ? ` · ${faltam} em falta` : ''}` : 'nenhum cadastrado'}</span>
            <button class="botao pequeno" data-acao="material-novo" data-id="${esc(p.ID)}">${ICONE.mais}Material</button></div>
          ${mats.map((m) => {
            const st = statusMaterial(m);
            return `<div class="material">
              <span class="etiqueta ${st.t}">${esc(st.s)}</span>
              <span class="material-nome" title="${esc(m['Observações'])}">${esc(m.Quantidade)} ${esc(m.Unidade)} · ${esc(m.Item)}</span>
              <span class="acoes">
                ${st.s === 'falta' ? botaoIcone('material-comprar', 'carrinho', 'Criar compra "a comprar"', `data-indice="${m._i}"`) : ''}
                ${botaoIcone('editar', 'editar', 'Editar', `data-tipo="material" data-indice="${m._i}"`)}
              </span>
            </div>`;
          }).join('')}
        </div>`;
      })()}
      ${p['Observações'] ? `<div class="muted" style="font-size:13px">${textoMd(p['Observações'])}</div>` : ''}
      <div class="botoes">
        <button class="botao pequeno" data-acao="projeto-fila" data-id="${esc(p.ID)}">${ICONE.fila}Ver na fila</button>
        <button class="botao pequeno" data-acao="projeto-arquivos" data-id="${esc(p.ID)}">${ICONE.arquivos}Arquivos</button>
        <button class="botao pequeno" data-acao="projeto-refs" data-id="${esc(p.ID)}">${ICONE.referencias}Referências${(() => { const n = linhas('referencias').filter((r) => projetosDe(r.Projeto).includes(p.ID)).length; return n ? ` · ${n}` : ''; })()}</button>
        ${pasta ? `<button class="botao pequeno" data-acao="pasta" ${dadosCaminho(pasta)}>${ICONE.pasta}Abrir pasta</button>` : ''}
        <button class="botao pequeno" data-acao="editar" data-tipo="projeto" data-id="${esc(p.ID)}">${ICONE.editar}Editar</button>
      </div>
    </article>`;
  }).join('');
  return `
    ${cabecalho('Projetos', 'Cada projeto junta as peças da fila, os arquivos da pasta dele e as compras. Dados em <code>projetos.md</code>.',
      `<button class="botao primario" data-acao="novo" data-tipo="projeto">${ICONE.mais}Novo projeto</button>`)}
    <section class="projetos">${cartoes || '<div class="vazio">Nenhum projeto.</div>'}</section>`;
}

