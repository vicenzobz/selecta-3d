'use strict';
// Selecta 3D — interface, parte 3 de 22: 03-painel.js. Os arquivos de ui/js/ são carregados em ordem pelo
// index.html e dividem o mesmo escopo global (scripts comuns, sem compilação). Dividido do antigo ui/app.js em fila-v27 (A17).
// ------------------------------------------------------------------ PAINEL
function telaPainel() {
  const f = fila();
  const ativos = f.filter((r) => !FILA_FIM.has(r.Status));
  const proxima = pecaDaVez();
  const conta = (s) => f.filter((r) => s.includes(r.Status)).length;

  const prazosProj = linhas('projetos').filter((p) => ['ativo', 'ideia'].includes(p.Status) && diasAte(p.Prazo) !== null && diasAte(p.Prazo) >= 0)
    .sort((a, b) => diasAte(a.Prazo) - diasAte(b.Prazo));
  const marco = prazosProj[0];

  let destaque = '';
  if (proxima) {
    const arq = (proxima._arquivos || []).find((a) => a.existe && !a.pasta);
    const j = janela(proxima['Observações']);
    const rolos = rolosDe(proxima['Observações']);
    const re = resumoEstimativa(estimativaDe(proxima.ID));
    destaque = `
    <section class="destaque" data-canhoto="${esc(proxima.ID)}${re && re.min ? ` · ${esc(fmtMin(re.min))}` : ''}${j ? ` · ${esc(j)}` : ''}">
      <div>
        <div class="rotulo">${proxima.Status === 'imprimindo' ? 'Imprimindo agora' : 'Peça da vez'}</div>
        <div class="vez-topo">${arq ? miniHtml(arquivoDe(arq.caminho), 'mini-vez') : ''}
          <div class="nome"><span>${esc(proxima.ID)}</span> ${esc(proxima['Peça'])}</div></div>
        ${passosDaPeca(proxima)}
        <div class="meta">
          ${etiquetaStatus(proxima.Status)}
          <span class="cores">${bolinhas(proxima['Filamento/cor'])}</span>
          <span>${esc(proxima['Filamento/cor'])}</span>
          ${re && (re.g || re.min) ? `<span>${re.g ? fmtNum(re.g) + ' g' : ''}${re.g && re.min ? ' · ' : ''}${re.min ? fmtMin(re.min) : ''}</span>` : ''}
        </div>
        ${rolos ? `<div class="rolos-linha"><b>Rolos</b>${esc(rolos)}</div>` : ''}
      </div>
      <div class="botoes">
        ${botaoPasso(proximoPasso(proxima), '')}
        <button class="botao" data-acao="menu-peca" data-id="${esc(proxima.ID)}" title="Outras ações desta peça">${ICONE.opcoes}Mais</button>
      </div>
    </section>`;
  }

  const seguintes = ativos.filter((r) => r !== proxima).slice(0, 7);
  const proximasHtml = seguintes.length ? seguintes.map((r) => `
      <div class="item" style="grid-template-columns: 50px 1fr auto auto">
        <div class="id">${esc(r.ID)}</div>
        <div><div class="nome-item">${esc(r['Peça'])}</div>
          <div class="linha-2 cores">${bolinhas(r['Filamento/cor'])}<span class="texto-cor">${esc(janela(r['Observações']))}</span></div></div>
        <span class="etiqueta prio ${+r.Prioridade <= 2 ? 'floresta' : ''}">P${esc(r.Prioridade)}</span>
        ${etiquetaStatus(r.Status)}
      </div>`).join('') : '<div class="vazio">Nada mais na fila.</div>';

  const prazos = [
    ...linhas('prazos').map((p) => ({ data: p.Data, texto: p['O que vence'], de: p.Compra })),
    ...linhas('projetos').filter((p) => !['concluído', 'cancelado'].includes(p.Status)).map((p) => ({ data: p.Prazo, texto: `Prazo do projeto: ${p.Projeto}`, de: p.ID })),
  ].filter((p) => diasAte(p.data) !== null && diasAte(p.data) >= -1)
    .sort((a, b) => diasAte(a.data) - diasAte(b.data)).slice(0, 6);
  const prazosHtml = prazos.length ? prazos.map((p) => {
    const d = diasAte(p.data);
    return `<div class="item" style="grid-template-columns: 74px 1fr">
      <div class="data-grande">${fmtData(p.data)}<small>${textoDias(d)}</small></div>
      <div><div class="${d <= 3 ? 'nome-item' : ''}">${esc(p.texto)}</div><div class="linha-2">${esc(p.de || '')}</div></div>
    </div>`;
  }).join('') : '<div class="vazio">Nenhum prazo à frente.</div>';

  const prev = previsao();
  const rolosHtml = prev.lista.map(barraPrevisao).join('');
  const notaPrev = [
    prev.semEstimativa.length ? `${prev.semEstimativa.length} peça(s) ativas sem estimativa` : '',
    prev.semCor ? `${fmtNum(prev.semCor)} g sem cor definida (${prev.semCorPecas.join(', ')})` : '',
  ].filter(Boolean).join(' · ');

  const diario = (E.dados.diario || []).map((d) => {
    const feito = (d.linhas.find((l) => l.includes('**Feito:**')) || d.linhas[0] || '').replace(/^- \*\*Feito:\*\*\s*/, '').replace(/\*\*/g, '').replace(/`/g, '');
    return `<div class="diario-entrada"><div class="quando">${esc(d.titulo)}</div><p>${esc(feito)}</p></div>`;
  }).join('') || '<div class="vazio">Diário vazio.</div>';

  const hoje = dataISO(E.dados.hoje) || new Date();
  const dataLonga = hoje.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

  // D-b: primeiro "Agora" (a peça da vez ao lado da Kobra X), depois os números e o Plano; o resto recolhível
  const recolhe = (id, titulo, corpo, aberto = false) => `<details class="cartao recolhivel" data-recolher="${id}" ${pref.ler('aberto_' + id, aberto) ? 'open' : ''}>
      <summary><h2 class="secao">${titulo}</h2></summary>${corpo}</details>`;
  return `
    ${cabecalho('Painel', `${esc(dataLonga.charAt(0).toUpperCase() + dataLonga.slice(1))} · dados em <code>${esc(E.dados.raiz)}</code>`)}
    <div class="agora">
      ${destaque || '<section class="destaque" data-canhoto="Selecta 3D"><div><div class="rotulo">Fila</div><div class="nome">Nada na fila</div></div></section>'}
      <section class="cartao cartao-impressora" id="cartao-impressora">${htmlImpressora()}</section>
    </div>
    <section class="cartao primeiro-dia" id="cartao-primeiro-dia" ${htmlPrimeiroDia() ? '' : 'hidden'}>${htmlPrimeiroDia()}</section>
    <section class="numeros">
      <div><div class="valor">${ativos.length}</div><div class="legenda">peças na fila</div></div>
      <div><div class="valor lima">${conta(['pronto para fatiar', 'fatiado'])}</div><div class="legenda">prontas para fatiar ou fatiadas</div></div>
      <div><div class="valor">${conta(['aguardando modelo'])}</div><div class="legenda">aguardando modelo</div></div>
      <div><div class="valor">${fmtNum(prev.minutosTotal / 60, 0)}<small>h</small></div><div class="legenda">de impressão previstas${prev.semEstimativa.length ? ` · ${prev.semEstimativa.length} sem estimativa` : ''}</div></div>
      ${marco ? `<div><div class="valor ${diasAte(marco.Prazo) <= 7 ? 'erro' : ''}">${diasAte(marco.Prazo)}<small>d</small></div><div class="legenda">até ${fmtData(marco.Prazo)} · ${esc(marco.Projeto)}</div></div>` : ''}
    </section>
    <section class="cartao cartao-plano" id="cartao-plano">${htmlPlano()}</section>
    <div class="grade-2">
      <section class="cartao"><h2 class="secao">Em seguida <small>na ordem da fila</small></h2><div class="lista">${proximasHtml}</div></section>
      <section class="cartao"><h2 class="secao">Previsão por cor <small>o que a fila pede × o que tem</small></h2>${rolosHtml || '<div class="vazio">Nenhum rolo cadastrado.</div>'}
        ${notaPrev ? `<div class="linha-2 quebra" style="margin-top:12px">${esc(notaPrev)}. <a href="#" data-acao="aba" data-aba="impressoes">Completar estimativas</a></div>` : ''}</section>
    </div>
    <div class="grade-2">
      ${recolhe('prazos', `Prazos <small>${prazos.length ? `próximo: ${fmtData(prazos[0].data)}` : ''}</small>`, `<div class="lista">${prazosHtml}</div>`)}
      ${recolhe('diario', 'Diário <small>últimas sessões das duas contas</small>', diario)}
    </div>`;
}

