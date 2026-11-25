'use strict';
// Selecta 3D — interface, parte 5 de 22: 05-impressoes.js. Os arquivos de ui/js/ são carregados em ordem pelo
// index.html e dividem o mesmo escopo global (scripts comuns, sem compilação). Dividido do antigo ui/app.js em fila-v27 (A17).
// ------------------------------------------------------------------ IMPRESSÕES
// F4: fotos e timelapses guardados pelo PC (IMPRESSOES/fotos e IMPRESSOES/timelapse), por data e peça
const MIDIA = { dados: null, carregando: false };
async function carregarMidia() {
  if (MIDIA.carregando) return;
  MIDIA.carregando = true;
  try { MIDIA.dados = await api('/api/impressoes/midia'); } catch { MIDIA.dados = {}; }
  MIDIA.carregando = false;
  if (E.aba === 'impressoes' && !modalAberto()) render();
}
function midiaDe(h) {
  const m = MIDIA.dados || {};
  const cands = Object.entries(m).filter(([, v]) => v.peca === h['Peça'] && v.data === h.Data);
  return cands.length ? cands[cands.length - 1] : null;
}
const urlMidia = (rel) => `/api/imagem?caminho=${encodeURIComponent(rel)}&t=${encodeURIComponent(TOKEN)}`;
function verTimelapse(chave) {
  const v = (MIDIA.dados || {})[chave];
  if (!v) return;
  const q = v.quadros || [];
  abrirModal({
    titulo: `Timelapse · ${v.peca || 'sem peça'} · ${v.data || ''} ${v.hora || ''}`, largo: true,
    sub: v.video ? 'Vídeo montado pelo ffmpeg no fim da impressão.' : `${q.length} foto(s) em sequência${q.length ? '' : ' (o timelapse estava desligado ou a câmera não respondeu)'}.`,
    corpo: v.video ? `<video class="timelapse" src="${urlMidia(v.video)}" controls autoplay loop playsinline></video>`
      : q.length ? `<img class="timelapse" id="tl-quadro" src="${urlMidia(q[0])}" alt="Timelapse"><input type="range" id="tl-pos" min="0" max="${q.length - 1}" value="0" style="width:100%">`
        : (v.fim ? `<img class="timelapse" src="${urlMidia(v.fim)}" alt="Foto do fim">` : '<div class="vazio">Sem fotos.</div>'),
    acoes: [{ rotulo: 'Fechar' }],
  });
  if (!v.video && q.length > 1) {
    let i = 0;
    const img = $('#tl-quadro'), pos = $('#tl-pos');
    const t = setInterval(() => { if (!document.body.contains(img)) return clearInterval(t); if (pos.matches(':active')) return; i = (i + 1) % q.length; img.src = urlMidia(q[i]); pos.value = i; }, 120);
    pos.addEventListener('input', () => { i = +pos.value; img.src = urlMidia(q[i]); });
  }
}
// F3: nova peça com o mesmo arquivo (e o mesmo fatiado) de uma impressão do histórico
function imprimirDeNovo(h) {
  const r = acharFila(h['Peça']);
  if (!r) return aviso('Essa peça não está mais na fila.', true);
  const fat = fatiadoDe(r);
  const j = janela(r['Observações']);
  abrirModal({
    titulo: `Imprimir ${r.ID} de novo`,
    sub: `${r['Peça']} · impressão de ${h.Data} (${h.Resultado}). Entra no fim da fila como peça nova, com o mesmo arquivo${fat ? ' e o mesmo fatiado' : ''}; a original não muda.`,
    corpo: `<div class="formulario"><label class="inteiro">Nome da peça nova<input id="nd-nome" value="${esc(r['Peça'])} (de novo)"></label>
      <label class="inteiro">Observações<textarea id="nd-obs">${esc(`Reimpressão de ${r.ID} (impressão de ${h.Data}, ${h.Resultado}).${j ? ` ${j}.` : ''}`)}</textarea></label></div>`,
    acoes: [{ rotulo: 'Cancelar' }, { rotulo: 'Pôr na fila', primario: true, fn: async () => {
      const campos = { 'Peça': $('#nd-nome').value.trim(), 'Arquivo (caminho relativo)': r['Arquivo (caminho relativo)'], 'Filamento/cor': r['Filamento/cor'],
        Prioridade: r.Prioridade, Status: fat ? 'fatiado' : 'pronto para fatiar', 'Observações': $('#nd-obs').value.trim() };
      if ('Fatiado' in r) campos.Fatiado = fat ? `\`${fat}\`` : '—';
      const res = await salvar(() => api('/api/fila/adicionar', { campos }));
      if (res && res.id && estimativaDe(r.ID)) { // a estimativa vale para a cópia também
        const e = estimativaDe(r.ID);
        await api('/api/estimativa/salvar', { peca: res.id, gramas: e['Gramas por cor'], tempo: e.Tempo, fonte: e.Fonte, obs: `Copiada de ${r.ID}. ${e['Observações'] || ''}`.trim() }).catch(() => {});
        await carregar();
      }
      aviso(`${res && res.id ? res.id : 'Peça'} no fim da fila.`);
      return true;
    } }],
  });
}

function telaImpressoes() {
  if (!MIDIA.dados && !MIDIA.carregando) carregarMidia();
  const hist = linhas('impressoes');
  const ok = hist.filter((h) => h.Resultado === 'concluído').length;
  const falhas = hist.filter((h) => h.Resultado === 'falhou');
  const minReais = hist.reduce((s, h) => s + (minutos(h['Tempo real']) || 0), 0);
  const gramas = hist.reduce((s, h) => s + (numero(h.Gramas) || 0), 0);
  const custo = hist.reduce((s, h) => s + (numero(h['Custo (R$)']) || 0), 0);
  const comparaveis = hist.filter((h) => minutos(h['Tempo estimado']) && minutos(h['Tempo real']));
  const desvio = comparaveis.length
    ? comparaveis.reduce((s, h) => s + (minutos(h['Tempo real']) - minutos(h['Tempo estimado'])) / minutos(h['Tempo estimado']), 0) / comparaveis.length * 100
    : null;
  const nomePeca = (id) => (acharFila(id) || {})['Peça'] || '';

  const histHtml = hist.length ? hist.map((h, i) => ({ ...h, _i: i })).reverse().map((h) => {
    const est = minutos(h['Tempo estimado']), real = minutos(h['Tempo real']);
    const dif = est && real ? Math.round(((real - est) / est) * 100) : null;
    const md = midiaDe(h);
    const foto = md && (md[1].fim || md[1].camada1);
    return `<div class="item">
      <div class="muted">${esc(h.Data)}${foto ? `<img class="foto-hist" src="${urlMidia(foto)}" alt="Foto do fim" data-acao="ver-timelapse" data-chave="${esc(md[0])}" title="Ver fotos e timelapse">` : ''}</div>
      <div style="min-width:0"><div class="nome-item"><span class="id" style="font-size:18px;margin-right:6px">${esc(h['Peça'])}</span>${esc(nomePeca(h['Peça']))}</div>
        <div class="linha-2" title="${esc(h.Rolos)}">${esc(h.Rolos || '')}</div>
        ${h['Motivo da falha'] ? `<div class="obs" style="color:var(--erro)">Falha: ${esc(h['Motivo da falha'])}</div>` : ''}
        ${h['Observações'] ? `<div class="obs">${textoMd(h['Observações'])}</div>` : ''}</div>
      <div>${etiquetaStatus(h.Resultado)}</div>
      <div>${esc(h['Tempo real'] || '—')}<div class="linha-2">${est ? `estimado ${fmtMin(est)}${dif !== null ? ` · ${dif > 0 ? '+' : ''}${dif}%` : ''}` : 'sem estimativa'}</div></div>
      <div style="text-align:right">${h.Gramas ? esc(h.Gramas) + ' g' : '—'}</div>
      <div style="text-align:right" class="${numero(h['Custo (R$)']) === null ? 'fraco' : 'nome-item'}">${numero(h['Custo (R$)']) === null ? (h['Custo (R$)'] || '—') : fmtReais(numero(h['Custo (R$)']))}</div>
      <div class="acoes">${md ? botaoIcone('ver-timelapse', 'ver', 'Fotos e timelapse', `data-chave="${esc(md[0])}"`) : ''}
        ${acharFila(h['Peça']) ? botaoIcone('imprimir-de-novo', 'mais', 'Imprimir de novo (peça nova no fim da fila)', `data-indice="${h._i}"`) : ''}
        ${botaoIcone('editar', 'editar', 'Editar', `data-tipo="impressao" data-indice="${h._i}"`)}</div>
    </div>`;
  }).join('') : `<div class="vazio vazio-acao"><b>Nenhuma impressão registrada ainda.</b> Quando uma impressão terminar (pela Kobra X ou marcando concluída/falhou na Fila), ela aparece aqui com o tempo real, os gramas, a foto do fim e o timelapse.
      <div class="kx-linha"><button class="botao pequeno" data-acao="aba" data-aba="fila">Ir para a Fila</button></div></div>`;

  const prev = previsao();
  const semEst = prev.semEstimativa;
  const estHtml = linhas('estimativas').map((e) => {
    const r = acharFila(e['Peça']);
    const re = resumoEstimativa(e);
    return `<div class="item ${r && FILA_FIM.has(r.Status) ? 'esmaecido' : ''}">
      <div class="id">${esc(e['Peça'])}</div>
      <div style="min-width:0"><div class="nome-item">${esc(r ? r['Peça'] : '(peça não está na fila)')}</div>
        <div class="linha-2 cores">${re.partes.map((p) => { const c = corPorNome(p.cor); return `<span class="bolinha" style="background:${esc(c ? c.hex : 'transparent')};${c ? '' : 'box-shadow:inset 0 0 0 1px var(--texto-3)'}" title="${esc(p.cor)}"></span><span class="texto-cor">${esc(p.cor)} ${fmtNum(p.g)} g</span>`; }).join(' ')}</div></div>
      <div style="text-align:right">${fmtNum(re.g)} g</div>
      <div>${esc(e.Tempo || '—')}</div>
      <div style="text-align:right" class="muted">${re.custo !== null ? fmtReais(re.custo) : '—'}</div>
      <div class="linha-2 quebra" title="${esc(e['Observações'])}">${textoMd(e.Fonte)}</div>
      <div class="acoes">${botaoIcone('estimar', 'editar', 'Editar estimativa', `data-id="${esc(e['Peça'])}"`)}</div>
    </div>`;
  }).join('') || '<div class="vazio">Nenhuma estimativa.</div>';

  // F5: estatísticas (como o histórico do Mainsail) e acerto por projeto
  const tempos = hist.map((h) => minutos(h['Tempo real']) || 0).filter(Boolean);
  const maisLonga = tempos.length ? Math.max(...tempos) : 0;
  const media = tempos.length ? tempos.reduce((a, b) => a + b, 0) / tempos.length : 0;
  const porProj = {};
  for (const h of hist) {
    const r = acharFila(h['Peça']);
    const projs = r ? projetosDaPeca(r) : [];
    for (const pid of (projs.length ? projs : ['—'])) {
      const nome = pid === '—' ? 'sem projeto' : ((linhas('projetos').find((p) => p.ID === pid) || {}).Projeto || pid);
      porProj[nome] = porProj[nome] || { ok: 0, n: 0 };
      porProj[nome].n++;
      if (h.Resultado === 'concluído') porProj[nome].ok++;
    }
  }
  const estatHtml = hist.length ? `<section class="cartao"><h2 class="secao">Estatísticas</h2>
    <div class="estat-linha"><div><b>${maisLonga ? fmtMin(maisLonga) : '—'}</b><small>impressão mais longa</small></div>
      <div><b>${media ? fmtMin(Math.round(media)) : '—'}</b><small>média por impressão</small></div>
      <div><b>${fmtNum(gramas)} g</b><small>filamento no total</small></div>
      <div><b>${hist.length}</b><small>impressões</small></div></div>
    <div class="estat-proj">${Object.entries(porProj).map(([n, v]) => `<div><span>${esc(n)}</span><div class="kx-barra"><i style="width:${Math.round(v.ok / v.n * 100)}%"></i></div><small>${v.ok} de ${v.n} deram certo (${Math.round(v.ok / v.n * 100)}%)</small></div>`).join('')}</div></section>` : '';

  const motivos = {};
  for (const f of falhas) { const m = f['Motivo da falha'] || 'sem motivo anotado'; motivos[m] = (motivos[m] || 0) + 1; }

  return `
    ${cabecalho('Impressões', 'Estimativas do fatiador e o histórico do que já foi impresso, em <code>impressoes.md</code>. Custo só do material (preço do rolo ÷ peso).')}
    <section class="numeros">
      <div><div class="valor">${hist.length}</div><div class="legenda">impressões registradas</div></div>
      <div><div class="valor lima">${hist.length ? Math.round((ok / hist.length) * 100) : 0}<small>%</small></div><div class="legenda">deram certo · ${falhas.length} falha(s)</div></div>
      <div><div class="valor">${fmtNum(minReais / 60, 1)}<small>h</small></div><div class="legenda">de impressão real</div></div>
      <div><div class="valor">${fmtNum(gramas / 1000, 2)}<small>kg</small></div><div class="legenda">de filamento usado${custo ? ` · ${fmtReais(custo)}` : ''}</div></div>
      <div><div class="valor ${desvio !== null && Math.abs(desvio) > 15 ? 'erro' : ''}">${desvio === null ? '—' : `${desvio > 0 ? '+' : ''}${fmtNum(desvio, 0)}<small>%</small>`}</div><div class="legenda">tempo real × estimado (média)</div></div>
    </section>
    ${estatHtml}
    ${falhas.length ? `<section class="cartao"><h2 class="secao">Motivos de falha</h2><div class="cores">${Object.entries(motivos).sort((a, b) => b[1] - a[1]).map(([m, n]) => `<span class="etiqueta erro">${esc(m)} · ${n}</span>`).join(' ')}</div>
      <div class="linha-2 quebra" style="margin-top:10px">Ao registrar uma falha, marque "anotar em impressora.md" para ela entrar em Problemas conhecidos.</div></section>` : ''}
    <section class="cartao"><h2 class="secao">Histórico <small>mais recentes primeiro</small></h2>
      <div class="lista hist-lista"><div class="item cab"><div>Data</div><div>Peça</div><div>Resultado</div><div>Tempo</div><div style="text-align:right">Gramas</div><div style="text-align:right">Custo</div><div></div></div>${histHtml}</div></section>
    <section class="cartao"><h2 class="secao">Estimativas <small>do fatiador, por peça</small></h2>
      ${semEst.length ? `<div class="faixa-aviso faixa-acao" style="margin-bottom:14px"><span><b>${semEst.length} peça(s) ativas sem estimativa</b>: o Plano e a previsão por cor ficam incompletos.
        <details class="ver-quais"><summary>ver quais</summary>${semEst.map((r) => `<button class="link-est" data-acao="estimar" data-id="${esc(r.ID)}">${esc(r.ID)}</button>`).join(' ')}</details></span></div>` : ''}
      <div class="lista est-lista"><div class="item cab"><div>Peça</div><div>Gramas por cor</div><div style="text-align:right">Total</div><div>Tempo</div><div style="text-align:right">Custo</div><div>Fonte</div><div></div></div>${estHtml}</div></section>`;
}

