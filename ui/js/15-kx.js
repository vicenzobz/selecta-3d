'use strict';
// Selecta 3D — interface, parte 15 de 22: 15-kx.js. Os arquivos de ui/js/ são carregados em ordem pelo
// index.html e dividem o mesmo escopo global (scripts comuns, sem compilação). Dividido do antigo ui/app.js em fila-v27 (A17).
// ------------------------------------------------------------------ IMPRESSORA PELA REDE (KX-Bridge)
// O PC conversa com a ponte KX-Bridge (PROGRAMAS/REGGAE-SLICER/KX-BRIDGE.md). Aqui: cartão no Painel (andamento, temperaturas,
// câmera, slots do ACE), botão Imprimir (só na janela do PC, com confirmação) e o registro preenchido no fim.
const IMP = { estado: null, foto: 0, avisado: '' };
const ROTULO_KX = { standby: 'Parada', printing: 'Imprimindo', paused: 'Pausada', complete: 'Concluída', error: 'Com erro', cancelled: 'Cancelada' };
const podeImprimirKX = () => !E.dados.remoto && !!(IMP.estado && (IMP.estado.online || IMP.estado.instalada));
// ocupada: imprimindo, pausada ou com um arquivo enviado que a impressora ainda não começou (princ-v02)
const kxImprimindo = () => !!(IMP.estado && IMP.estado.online && (IMP.estado.aguardando_inicio || ['printing', 'paused'].includes((IMP.estado.impressora || {}).estado)));
const roteiroConcluido = () => !!(IMP.estado && IMP.estado.primeiro_dia && IMP.estado.primeiro_dia.concluido);

// arquivo fatiado da peça: a coluna Fatiado (A02); se vazia, o próprio arquivo, se for .gcode(.3mf),
// ou (reserva) o último fatiado anotado entre crases nas Observações
function fatiadoDe(r) {
  if (!r) return '';
  const col = String(r.Fatiado || '').replace(/`/g, '').trim();
  if (col && col !== '—' && /\.gcode(?:\.3mf)?$/i.test(col)) return col;
  const arq = String(r['Arquivo (caminho relativo)'] || '');
  const m1 = arq.match(/`?([^`]+?\.gcode(?:\.3mf)?)`?/i);
  if (m1 && !/[+]/.test(arq)) return m1[1].trim();
  const todos = [...String(r['Observações'] || '').matchAll(/`([^`]+?\.gcode(?:\.3mf)?)`/gi)].map((m) => m[1]);
  return todos.length ? todos[todos.length - 1] : '';
}

async function atualizarImpressora() {
  if (!E.dados) return;
  try { IMP.estado = await api('/api/impressora'); } catch { IMP.estado = null; }
  IMP.foto = Date.now();
  // botões Imprimir dependem da ponte: redesenha a tela quando ela aparece, some ou começa/termina de imprimir
  const marca = `${podeImprimirKX()}|${kxImprimindo()}`;
  if (marca !== IMP.marca) {
    // B1: só dá a mudança por vista depois de redesenhar; com uma janela aberta, tenta de novo na próxima rodada
    if (!['painel', 'fila', 'fatiador'].includes(E.aba)) IMP.marca = marca;
    else if (!modalAberto() && !E.salvando) { IMP.marca = marca; render(); }
  }
  // F7: foto da 1ª camada (placas e peças grandes)
  const c1 = IMP.estado && IMP.estado.camada1;
  if (c1 && IMP.notifC1 !== c1.quando) {
    IMP.notifC1 = c1.quando;
    const rc = c1.peca ? acharFila(c1.peca) : null;
    notificar('Confira a 1ª camada', `${rc ? `${rc.ID} · ${rc['Peça']}` : 'Kobra X'}: a 1ª camada terminou. Veja a foto e pause se não estiver grudando bem.`);
  }
  const el = $('#cartao-impressora');
  if (el && E.aba === 'painel') el.innerHTML = htmlImpressora();
  if (E.aba === 'painel') desenharPrimeiroDia();
  const ev = IMP.estado && IMP.estado.evento;
  const dev = IMP.estado && IMP.estado.deteccao && IMP.estado.deteccao.evento;
  if (dev && IMP.notifDet !== dev.quando) {
    IMP.notifDet = dev.quando;
    notificar('Possível falha na impressão', `${dev.peca || 'Kobra X'}: ${dev.pausou ? 'pausei a impressão' : 'NÃO consegui pausar'}. Confira a câmera.`);
  }
  if (ev && IMP.notificado !== ev.quando) {
    IMP.notificado = ev.quando;
    const r = ev.peca ? acharFila(ev.peca) : null;
    if (ev.resultado === 'não começou') notificar('A Kobra X não começou', `${r ? `${r.ID} · ${r['Peça']}` : (ev.gcode || 'arquivo')}: confira a tela da impressora.`);
    else notificar(`Impressão ${ev.resultado}`, `${r ? `${r.ID} · ${r['Peça']}` : (ev.gcode || 'Kobra X')} · ${minutosTexto(ev.minutos)}`);
  }
  if (ev && IMP.avisado !== ev.quando && !modalAberto()) { IMP.avisado = ev.quando; avisarFimKX(ev); }
}
setInterval(() => { if (!document.hidden) atualizarImpressora(); }, 5000);
setTimeout(atualizarImpressora, 1500);

const minutosTexto = (m) => (m == null ? '' : m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m} min`);
const grau = (v) => (typeof v === 'number' ? `${Math.round(v)}°` : '—');

function htmlImpressora() {
  const st = IMP.estado;
  const remoto = E.dados && E.dados.remoto;
  const titulo = `<h2 class="secao">Kobra X <small>pela rede (KX-Bridge)</small></h2>`;
  if (!st) return `${titulo}<div class="vazio">Lendo a impressora…</div>`;
  if (!st.online) {
    const dica = !st.instalada && !remoto ? 'O KX-Bridge não está instalado neste PC (ver <code>PROGRAMAS/REGGAE-SLICER/KX-BRIDGE.md</code>).'
      : 'A ponte está desligada ou a impressora ainda não foi cadastrada nela.';
    return `${titulo}<div class="kx-linha"><span class="etiqueta">desligada</span><span class="fraco">${dica}</span>
      ${!remoto && st.instalada ? `<button class="botao pequeno primario" data-acao="kx-ligar">Ligar a ponte</button>` : ''}
      ${!remoto ? `<label class="alternar"><input type="checkbox" id="kx-auto" ${st.auto ? 'checked' : ''}>Ligar junto com o Selecta 3D</label>` : ''}</div>`;
  }
  const p = st.impressora || {};
  const ativa = ['printing', 'paused'].includes(p.estado);
  const esperando = !!st.aguardando_inicio && !ativa;
  const naoComecou = st.evento && st.evento.resultado === 'não começou';
  const atual = st.atual || {};
  const r = atual.peca ? acharFila(atual.peca) : null;
  const pct = Math.round((p.progresso || 0) * 100);
  const rs = rolosDosSlots();
  const slots = (st.slots || []).map((s) => `<button type="button" class="kx-slot ${s.carregado ? '' : 'vazio'}" data-acao="kx-slot-rolo" data-slot="${s.slot + 1}" title="${esc(s.nome || s.material || 'vazio')} · clique para dizer qual rolo do estoque está aqui">
      <i style="background:${esc(s.cor || 'transparent')};--c:${esc(s.cor || 'transparent')}"></i><span>${s.slot != null ? s.slot + 1 : '?'} · ${esc(s.carregado ? (s.material || '?') : 'vazio')}${s.carregado && s.cor ? ` <small>${esc(corParecida(s.cor))}</small>` : ''}${rs[String(s.slot + 1)] ? ` <b class="rolo-slot">${esc(rs[String(s.slot + 1)])}</b>` : ''}</span></button>`).join('');
  return `${titulo}
    <div class="kx-grade">
      <div class="kx-foto"><img src="/api/impressora/foto?t=${encodeURIComponent(TOKEN)}&n=${IMP.foto}" alt="Câmera da impressora" onerror="this.parentNode.classList.add('sem')"><span>sem câmera</span></div>
      <div class="kx-info">
        <div class="kx-linha"><span class="etiqueta ${esperando ? 'alerta' : p.estado === 'printing' ? 'lima' : p.estado === 'error' ? 'erro' : p.estado === 'paused' ? 'alerta' : ''}">${esperando ? 'Enviado' : esc(ROTULO_KX[p.estado] || p.estado)}</span>
          ${ativa || esperando ? `<b>${esc(r ? `${r.ID} · ${r['Peça']}` : (atual.gcode || p.arquivo || ''))}</b>` : '<span class="fraco">pronta para imprimir</span>'}</div>
        ${esperando ? `<div class="kx-linha fraco">Esperando a Kobra X começar${st.aguardando_min ? ` · há ${minutosTexto(st.aguardando_min)}` : ''}. Ela aquece e nivela antes; se a tela dela pedir alguma confirmação, responda lá. Depois de 15 min sem começar, a peça volta para "fatiado".</div>` : ''}
        ${ativa ? `<div class="kx-barra" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%;--p:${pct}%"></i></div>
          <div class="kx-linha fraco"><b class="kx-pct">${pct}%</b>${p.camadas ? `camada ${p.camada || 0} de ${p.camadas}` : ''}
            ${st.decorrido_min != null ? ` · ${minutosTexto(st.decorrido_min)} imprimindo` : ''}${st.restante_min != null ? ` · faltam ≈ ${minutosTexto(st.restante_min)}` : ''}</div>` : ''}
        <div class="kx-linha fraco">Bico ${grau(p.bico)}${p.bico_alvo ? ` / ${grau(p.bico_alvo)}` : ''} · Mesa ${grau(p.mesa)}${p.mesa_alvo ? ` / ${grau(p.mesa_alvo)}` : ''}${st.versao ? ` · ponte ${esc(st.versao)}` : ''}</div>
        ${slots ? `<div class="kx-slots">${slots}</div>` : ''}
        <div class="kx-linha">
          ${p.estado === 'printing' ? '<button class="botao pequeno" data-acao="kx-pausar">Pausar</button>' : ''}
          ${p.estado === 'paused' ? '<button class="botao pequeno primario" data-acao="kx-continuar">Continuar</button>' : ''}
          ${ativa || esperando ? '<button class="botao pequeno perigo" data-acao="kx-cancelar">Cancelar</button>' : ''}
          ${st.evento ? `<button class="botao pequeno primario" data-acao="kx-registrar-fim">${naoComecou ? 'A impressora não começou: ver o que fazer' : 'Registrar a impressão que terminou'}</button>` : ''}
          ${!remoto ? `<label class="alternar"><input type="checkbox" id="kx-auto" ${st.auto ? 'checked' : ''}>Ligar junto com o Selecta 3D</label>` : ''}
          ${!remoto && st.ligada_por_nos && !ativa ? '<button class="botao pequeno" data-acao="kx-desligar">Desligar a ponte</button>' : ''}
          ${roteiroConcluido() ? `<button class="botao pequeno" data-acao="avisos">Avisos</button>
          <button class="botao pequeno" data-acao="deteccao-cfg">Detecção de falhas</button>
          <button class="botao pequeno" data-acao="timelapse-cfg">Timelapse${st.timelapse && !st.timelapse.ligado ? ' (desligado)' : ''}</button>` : ''}
          <button class="botao pequeno" data-acao="kx-mais">${ICONE.opcoes}Mais</button>
        </div>
        ${roteiroConcluido() || (st.deteccao && st.deteccao.evento) ? htmlDeteccao(st) : ''}
      </div>
    </div>
    ${htmlCamada1(st)}`;
}

// ------------------------------------------------------------------ PLANO / LINHA DO TEMPO (A09) e TROCA DE ROLO (A10)
// Encaixa as peças ativas, na ordem da fila (não reordena nada), nas janelas Em casa / Trabalho / Madrugada,
// usando as estimativas. Horários das janelas: guardados neste navegador (botão "Horários").
const JANELAS_PADRAO = { 'Em casa': [18, 23], 'Trabalho': [8, 17], 'Madrugada': [23, 7] };
const INTERVALO_MIN = 15; // tirar a peça e limpar a mesa entre uma impressão e outra
const janelasCfg = () => ({ ...JANELAS_PADRAO, ...(pref.ler('janelas', {}) || {}) });
function naJanela(d, jan) {
  const [a, b] = janelasCfg()[jan] || [0, 24];
  const h = d.getHours() + d.getMinutes() / 60;
  return a < b ? h >= a && h < b : h >= a || h < b;
}
function proximoNaJanela(t, jan) {
  const d = new Date(t);
  d.setSeconds(0, 0);
  const resto = d.getMinutes() % 15;
  if (resto) d.setMinutes(d.getMinutes() + 15 - resto);
  for (let i = 0; i < 4 * 24 * 7; i++) { // procura até uma semana à frente, de 15 em 15 min
    if (naJanela(d, jan)) return d;
    d.setMinutes(d.getMinutes() + 15);
  }
  return new Date(t);
}
// prazo das peças de prioridade 2: o projeto ativo com o prazo mais próximo (null = nenhum projeto com prazo)
function prazoProjeto() {
  const p = linhas('projetos').filter((x) => !/conclu|cancel/i.test(x.Status || '') && dataISO(x.Prazo))
    .sort((a, b) => dataISO(a.Prazo) - dataISO(b.Prazo))[0];
  return p ? { nome: p.Projeto || p.ID, prazo: p.Prazo } : null;
}
// F2: tempo real ÷ estimado das impressões já registradas, por tipo de peça (placa, lembrancinha, outra)
function tipoDaPeca(r) {
  const a = String((r && r['Arquivo (caminho relativo)']) || '').toUpperCase();
  if (a.includes('PLACAS')) return 'placa';
  if (a.includes('PROJETOS/LEMBRANCINHA')) return 'lembrancinha';
  return 'outra';
}
const NOME_TIPO = { placa: 'placas', lembrancinha: 'lembrancinhas', outra: 'outras peças' };
function fatoresAprendidos() {
  const por = { placa: [], lembrancinha: [], outra: [] }, todos = [];
  for (const h of linhas('impressoes')) {
    if (h.Resultado !== 'concluído') continue;
    const est = minutos(h['Tempo estimado']), real = minutos(h['Tempo real']);
    if (!est || !real || est < 5) continue;
    const f = real / est;
    if (f < 0.4 || f > 3) continue; // registro estranho (pausa longa, tempo errado): fica de fora
    por[tipoDaPeca(acharFila(h['Peça']))].push(f);
    todos.push(f);
  }
  const mediana = (v) => { const o = [...v].sort((a, b) => a - b); const m = o.length >> 1; return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2; };
  const res = { geral: todos.length ? { f: mediana(todos), n: todos.length } : null };
  for (const [k, v] of Object.entries(por)) res[k] = v.length ? { f: mediana(v), n: v.length } : null;
  return res;
}
function fatorDe(r, fat = fatoresAprendidos()) {
  const t = fat[tipoDaPeca(r)] || fat.geral;
  return t ? t.f : 1;
}
function htmlFatores(fat = fatoresAprendidos()) {
  const partes = Object.keys(NOME_TIPO).filter((k) => fat[k]).map((k) => `${NOME_TIPO[k]} ×${fmtNum(fat[k].f, 2)} (${fat[k].n})`);
  return partes.length ? `<div class="linha-2 quebra fator-aprendido">Tempos corrigidos pelo que já foi impresso: ${partes.join(' · ')}.</div>` : '';
}

function planoImpressoes(agora = new Date()) {
  let t = new Date(agora);
  const st = IMP.estado || {};
  if (kxImprimindo() && st.restante_min != null) t = new Date(+t + (st.restante_min + INTERVALO_MIN) * 60000);
  const itens = [], sem = [];
  const fat = fatoresAprendidos();
  for (const r of fila()) {
    if (FILA_FIM.has(r.Status) || r.Status === 'imprimindo') continue;
    const re = resumoEstimativa(estimativaDe(r.ID));
    if (!re || !re.min) { sem.push(r); continue; }
    const jan = janela(r['Observações']) || 'Em casa';
    const ini = proximoNaJanela(t, jan);
    const min = Math.round(re.min * fatorDe(r, fat));
    const fim = new Date(+ini + min * 60000);
    itens.push({ r, jan, ini, fim, min, minEst: re.min });
    t = new Date(+fim + INTERVALO_MIN * 60000);
  }
  const cas = itens.filter((i) => +i.r.Prioridade === 2);
  return { itens, sem, fimCasamento: cas.length ? cas[cas.length - 1].fim : null, semCasamento: sem.filter((r) => +r.Prioridade === 2), prazo: prazoProjeto() };
}
const fmtQuando = (d) => `${['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][d.getDay()]} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}h${String(d.getMinutes()).padStart(2, '0')}`;

function htmlFimCasamento(pl) {
  if (!pl.prazo) return '';
  const prazo = dataISO(pl.prazo.prazo);
  if (!pl.fimCasamento) return pl.semCasamento.length ? `<div class="plano-fim aviso-slots">Nenhuma peça de prioridade 2 tem estimativa ainda (${pl.semCasamento.length} sem): fatie para ver a data prevista.</div>` : '';
  const limite = new Date(prazo); limite.setHours(23, 59, 0, 0);
  const folga = Math.round((limite - pl.fimCasamento) / 86400000);
  const ok = pl.fimCasamento <= limite;
  return `<div class="plano-fim ${ok ? 'tudo-certo' : 'aviso-slots'}"><b>Prioridade 2: fim previsto ${fmtQuando(pl.fimCasamento)}</b> ·
    prazo ${fmtData(pl.prazo.prazo)} (${esc(pl.prazo.nome)}) · ${ok ? `${folga} dia(s) de folga` : `${-folga} dia(s) depois do prazo`}
    ${pl.semCasamento.length ? `<br><small>Sem contar ${pl.semCasamento.length} peça(s) de prioridade 2 sem estimativa (${pl.semCasamento.map((r) => esc(r.ID)).join(', ')}): a data real é mais tarde.</small>` : ''}</div>`;
}

function htmlPlano(max = 6) {
  const pl = planoImpressoes();
  const tr = sugestaoTroca();
  const linhasHtml = pl.itens.slice(0, max).map((i) => `
    <div class="item plano-item"><div class="quando-plano"><b>${fmtQuando(i.ini).slice(0, 9)}</b><small>${fmtQuando(i.ini).slice(10)}–${String(i.fim.getHours()).padStart(2, '0')}h${String(i.fim.getMinutes()).padStart(2, '0')}</small></div>
      <div><div class="nome-item"><span class="id-mini">${esc(i.r.ID)}</span> ${esc(i.r['Peça'])}</div><div class="linha-2 cores">${bolinhas(i.r['Filamento/cor'])}<span class="texto-cor">${esc(i.jan)} · ${i.min !== i.minEst ? `estimado ${fmtMin(i.minEst)} → provável ${fmtMin(i.min)}` : fmtMin(i.min)}</span></div></div>
    </div>`).join('') || '<div class="vazio">Nenhuma peça ativa com estimativa.</div>';
  return `<h2 class="secao">Plano <small>na ordem da fila, nas janelas · não muda a ordem</small></h2>
    ${htmlFimCasamento(pl)}${htmlFatores()}
    <div class="lista">${linhasHtml}</div>
    ${pl.sem.length ? `<div class="linha-2 quebra" style="margin-top:10px">${pl.sem.length} peça(s) sem estimativa ficaram de fora: ${pl.sem.slice(0, 12).map((r) => esc(r.ID)).join(', ')}${pl.sem.length > 12 ? '…' : ''}</div>` : ''}
    ${tr && tr.melhor ? `<div class="troca-rolo"><b>Troca de rolo sugerida:</b> slot ${tr.melhor.slot} de ${esc(tr.melhor.de)} para <b>${esc(tr.melhor.para)}</b> libera ${tr.melhor.pecas.length} peça(s), ≈ ${fmtMin(tr.melhor.h * 60)} (${tr.melhor.pecas.map((r) => esc(r.ID)).join(', ')}).${tr.melhor.perde.length ? ` Deixam de caber: ${tr.melhor.perde.map((r) => esc(r.ID)).join(', ')}.` : ''}</div>` : ''}
    <div class="kx-linha"><button class="botao pequeno" data-acao="plano-tudo">${ICONE.relogio}Linha do tempo inteira</button>
      <button class="botao pequeno" data-acao="plano-horarios">Horários das janelas</button></div>`;
}

function abrirLinhaDoTempo() {
  const pl = planoImpressoes();
  const dias = new Map();
  for (const i of pl.itens) {
    const k = fmtQuando(i.ini).slice(0, 9);
    if (!dias.has(k)) dias.set(k, []);
    dias.get(k).push(i);
  }
  const html = [...dias.entries()].map(([dia, its]) => `<h3 class="dia-plano">${esc(dia)} <small>${fmtMin(its.reduce((s, i) => s + i.min, 0))}</small></h3>
    ${its.map((i) => `<div class="linha-tempo"><span class="hora">${fmtQuando(i.ini).slice(10)}</span>
      <span class="barra-tempo ${+i.r.Prioridade === 2 ? 'casamento' : ''}" style="width:${Math.max(8, Math.min(100, i.min / 6))}%"></span>
      <span><b>${esc(i.r.ID)}</b> ${esc(i.r['Peça'])} · ${esc(i.jan)} · ${fmtMin(i.min)} · até ${fmtQuando(i.fim).slice(10)}</span></div>`).join('')}`).join('');
  abrirModal({
    titulo: 'Linha do tempo', largo: true,
    sub: `Peças ativas na ordem da fila, encaixadas nas janelas, com ${INTERVALO_MIN} min entre uma e outra. Só uma previsão: nada é reordenado.`,
    corpo: `${htmlFimCasamento(pl)}${html || '<div class="vazio">Nenhuma peça ativa com estimativa.</div>'}
      ${pl.sem.length ? `<p class="dica">Sem estimativa (fora da conta): ${pl.sem.map((r) => `${esc(r.ID)} ${esc(r['Peça'])}`).join('; ')}.</p>` : ''}`,
  });
}

function abrirHorariosJanelas() {
  const j = janelasCfg();
  const campo = (nome) => `<label>${esc(nome)}<span class="horas-janela"><input type="number" min="0" max="23" id="jan-${norm(nome).replace(/ /g, '-')}-a" value="${j[nome][0]}"> às
    <input type="number" min="0" max="24" id="jan-${norm(nome).replace(/ /g, '-')}-b" value="${j[nome][1]}"> h</span></label>`;
  abrirModal({
    titulo: 'Horários das janelas', sub: 'Hora em que uma impressão dessa janela pode começar. Guardado só neste navegador.',
    corpo: `<div class="formulario">${Object.keys(JANELAS_PADRAO).map(campo).join('')}</div>`,
    acoes: [{ rotulo: 'Voltar ao padrão', fn: () => { pref.gravar('janelas', {}); render(); } }, { rotulo: 'Cancelar' },
      { rotulo: 'Salvar', primario: true, fn: () => {
        const novo = {};
        for (const nome of Object.keys(JANELAS_PADRAO)) {
          const k = norm(nome).replace(/ /g, '-');
          const a = +$(`#jan-${k}-a`).value, b = +$(`#jan-${k}-b`).value;
          if (!(a >= 0 && a <= 23 && b >= 0 && b <= 24 && a !== b)) { aviso(`Horário inválido em ${nome}.`, true); throw new Error('horário'); }
          novo[nome] = [a, b];
        }
        pref.gravar('janelas', novo); render(); return true;
      } }],
  });
}

// A10: qual troca de UM slot libera mais horas das próximas peças (prontas para fatiar ou fatiadas), pela cor
function sugestaoTroca() {
  const st = IMP.estado;
  if (!st || !(st.slots || []).length) return null;
  const slots = st.slots.map((s) => ({ n: s.slot + 1, cor: s.carregado ? norm(corParecida(s.cor)) : '' }));
  const proximas = fila().filter((r) => ['pronto para fatiar', 'fatiado'].includes(r.Status)).slice(0, 20);
  const horas = (r) => ((resumoEstimativa(estimativaDe(r.ID)) || {}).min || 60) / 60; // sem estimativa conta 1 h
  const coresR = (r) => coresDoTexto(r['Filamento/cor']).map((c) => norm(c.nome));
  const cabe = (conj, r) => { const c = coresR(r); return c.length > 0 && c.every((x) => conj.has(x)); };
  const atual = new Set(slots.map((s) => s.cor).filter(Boolean));
  const candidatas = new Set(proximas.flatMap(coresR).filter((c) => !atual.has(c)));
  let melhor = null;
  for (const s of slots) {
    if (s.cor === 'branco quente') continue; // rolo fixo (fila-impressao.md)
    for (const c of candidatas) {
      const conj = new Set(atual); if (s.cor) conj.delete(s.cor); conj.add(c);
      const lib = proximas.filter((r) => cabe(conj, r) && !cabe(atual, r));
      const perde = proximas.filter((r) => cabe(atual, r) && !cabe(conj, r));
      const h = lib.reduce((a, r) => a + horas(r), 0) - perde.reduce((a, r) => a + horas(r), 0);
      if (lib.length && (!melhor || h > melhor.h)) melhor = { slot: s.n, de: s.cor || 'vazio', para: c, pecas: lib, perde, h };
    }
  }
  return { prontas: proximas.filter((r) => cabe(atual, r)), melhor: melhor && melhor.h > 0 ? melhor : null };
}

// ------------------------------------------------------------------ ROLO DO ESTOQUE NO SLOT (A08)
function rolosDosSlots() { return (IMP.estado && IMP.estado.rolos_slots) || {}; }
function abrirRoloSlot(n) {
  const st = IMP.estado || {};
  const s = (st.slots || []).find((x) => x.slot + 1 === n) || {};
  const corSlot = s.carregado ? corParecida(s.cor) : '';
  const atual = rolosDosSlots()[String(n)] || '';
  const rolos = linhas('filamentos').filter((r) => r.Status !== 'acabou')
    .map((r) => ({ r, sug: corSlot && norm(r.Cor) === norm(corSlot) }))
    .sort((a, b) => (b.sug - a.sug) || String(a.r.ID).localeCompare(String(b.r.ID)));
  abrirModal({
    titulo: `Slot ${n} do ACE`,
    sub: s.carregado ? `A impressora diz: ${s.material || '?'} · cor parecida com ${corSlot || '?'}` : 'Vazio, segundo a impressora',
    corpo: `<label class="inteiro">Rolo do estoque neste slot
      <select class="seletor" id="slot-rolo"><option value="">— nenhum —</option>
      ${rolos.map(({ r, sug }) => `<option value="${esc(r.ID)}" ${r.ID === atual ? 'selected' : ''}>${esc(r.ID)} · ${esc(r.Cor)} · ${esc(r.Material || '')} · ${esc(r['Restante (g)'] || '?')} g${sug ? ' (sugerido pela cor)' : ''}</option>`).join('')}</select></label>
      <p class="dica">Escolha à mão; a cor do slot só sugere. No registro da impressão, as gramas dessa cor já vêm neste rolo. O estoque só baixa quando você confirma o registro.</p>`,
    acoes: [{ rotulo: 'Cancelar' }, { rotulo: 'Salvar', primario: true, fn: async () => {
      IMP.estado = await api('/api/impressora/rolo-slot', { slot: n, rolo: $('#slot-rolo').value });
      const el = $('#cartao-impressora'); if (el) el.innerHTML = htmlImpressora();
      return true;
    } }],
  });
}

// ------------------------------------------------------------------ AVISOS NO CELULAR (A11)
// Notificação do navegador/app do celular (cada aparelho liga a sua) e, opcional, Telegram mandado pelo PC.
const avisosNavegador = () => pref.ler('avisos_navegador', false) && 'Notification' in window && Notification.permission === 'granted';
async function notificar(titulo, corpo) {
  if (!avisosNavegador()) return;
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (reg && reg.showNotification) await reg.showNotification(titulo, { body: corpo, icon: 'icone-192.png', tag: 'org3d-' + titulo });
    else new Notification(titulo, { body: corpo, icon: 'icone-192.png' });
  } catch (e) { console.warn('notificação', e); }
}
async function abrirAvisos() {
  let tg = { telegram: false };
  try { tg = await api('/api/avisos/estado', {}); } catch { /* sem o módulo de avisos */ }
  const remoto = E.dados.remoto;
  const suporta = 'Notification' in window;
  abrirModal({
    titulo: 'Avisos', sub: 'Quando a impressão termina, falha, é cancelada ou a câmera vê uma falha.',
    corpo: `<div class="formulario">
      <div class="inteiro"><b>Neste aparelho</b> (notificação do navegador ou do app do celular):
        ${!suporta ? 'este navegador não mostra notificações.' : avisosNavegador() ? '<span class="etiqueta lima">ligado</span>'
          : Notification.permission === 'denied' ? 'bloqueado nas configurações do navegador.' : '<button class="botao pequeno primario" data-acao="avisos-ligar" type="button">Ligar</button>'}
        ${avisosNavegador() ? '<button class="botao pequeno" data-acao="avisos-desligar" type="button">Desligar</button>' : ''}
        <span class="dica">No celular só funciona pelo endereço do Tailscale (https), com o Selecta 3D aberto ou instalado como app.</span></div>
      <div class="inteiro"><b>Telegram</b> (mandado pelo PC, chega mesmo com o celular bloqueado): ${tg.telegram ? '<span class="etiqueta lima">configurado</span>' : 'desligado'}</div>
      ${remoto ? '<p class="inteiro dica">O Telegram só se configura na janela do PC.</p>' : `
      <label>Token do bot<input id="tg-token" placeholder="${tg.telegram ? '(guardado; deixe em branco para manter)' : '123456:ABC…'}" autocomplete="off"></label>
      <label>Número do chat<input id="tg-chat" placeholder="ex.: 123456789" autocomplete="off"></label>
      <p class="inteiro dica">Fica só em <code>%LOCALAPPDATA%\\Organizador3D\\config.json</code>, nunca na pasta. Mande /start para o bot antes de testar.</p>`}
    </div>`,
    acoes: remoto ? [{ rotulo: 'Fechar' }] : [
      { rotulo: 'Apagar Telegram', fn: async () => { await api('/api/avisos/configurar', { apagar: true }); aviso('Telegram desligado.'); } },
      { rotulo: 'Testar', fn: async () => { try { await api('/api/avisos/testar', {}); aviso('Mensagem de teste enviada.'); } catch (e) { aviso(e.message, true); } return false; } },
      { rotulo: 'Fechar' },
      { rotulo: 'Salvar', primario: true, fn: async () => {
        const token = $('#tg-token').value.trim(), chat = $('#tg-chat').value.trim();
        if (!token && !chat) return true;
        try { await api('/api/avisos/configurar', { token: token || undefined, chat: chat || undefined }); aviso('Telegram salvo.'); } catch (e) { aviso(e.message, true); throw e; }
        return true;
      } }],
  });
}

// ------------------------------------------------------------------ DETECÇÃO DE FALHAS PELA CÂMERA (A12)
// O PC analisa a foto da câmera com o modelo do Obico (serviço local, PROGRAMAS/SELECTA-3D/deteccao/). Na falha, pausa e avisa;
// continuar ou cancelar é com o usuário. Sem o serviço instalado, só aparece "não instalada".
function htmlDeteccao(st) {
  const d = st && st.deteccao;
  if (!d) return '';
  const ev = d.evento;
  const linha = `<div class="kx-linha fraco deteccao-linha">Detecção de falhas: ${!d.ligada ? 'desligada'
    : d.servico ? `<b>ligada</b> · sensibilidade ${esc(d.sensibilidade)}${d.ultimo && d.ultimo.p != null ? ` · última foto ${esc(String(d.ultimo.p))}${d.ultimo.nivel === 1 ? ' <span class="etiqueta alerta">atenção</span>' : ''}` : ''}`
    : 'não instalada · <a href="#" data-acao="deteccao-cfg">Como instalar</a>'}</div>`;
  if (!ev) return linha;
  return `${linha}<div class="deteccao-alerta">
    ${ev.foto ? `<img src="${urlImagem(ev.foto)}" alt="Foto da falha">` : ''}
    <div><b>${ev.pausou ? 'Pausei a impressão' : 'NÃO consegui pausar'}: possível falha vista pela câmera</b>
      <div class="linha-2">${esc(ev.quando)}${ev.peca ? ` · ${esc(ev.peca)}` : ''}${ev.foto ? ` · foto em <code>${esc(ev.foto)}</code>` : ''}</div>
      <div class="kx-linha">
        <button class="botao pequeno primario" data-acao="det-continuar">Continuar a impressão</button>
        <button class="botao pequeno perigo" data-acao="kx-cancelar">Cancelar…</button>
        <button class="botao pequeno" data-acao="det-falso">Falso alarme</button>
      </div></div></div>`;
}
async function abrirDeteccaoCfg() {
  const d = (IMP.estado && IMP.estado.deteccao) || {};
  const remoto = E.dados.remoto;
  abrirModal({
    titulo: 'Detecção de falhas', sub: 'Modelo aberto do Obico (AGPL-3.0) rodando neste PC, na placa de vídeo.',
    corpo: `<div class="formulario">
      <p class="inteiro">Serviço: ${d.servico ? '<span class="etiqueta lima">respondendo</span>' : 'não instalado ou parado. Para instalar: botão direito em <code>PROGRAMAS\SELECTA-3D\deteccao\instalar_deteccao.ps1</code> → Executar com o PowerShell (ver o LEIA-ME da pasta).'}</p>
      <label class="inteiro marcar-linha"><input type="checkbox" id="det-ligada" ${d.ligada ? 'checked' : ''} ${remoto ? 'disabled' : ''}> Analisar a câmera durante as impressões</label>
      <label>Sensibilidade<select class="seletor" id="det-sens" ${remoto ? 'disabled' : ''}>${['baixa', 'média', 'alta'].map((s) => `<option ${s === d.sensibilidade ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      <p class="inteiro dica">A cada 10 s uma foto; a média de várias fotos decide (como no Obico), então uma foto ruim sozinha não pausa. Os primeiros 5 minutos de cada impressão não contam. Na falha: <b>pausa</b>, guarda a foto em <code>IMPRESSOES/falhas/</code> e avisa (botão Avisos). Muitos falsos alarmes: baixe a sensibilidade.</p>
    </div>`,
    acoes: remoto ? [{ rotulo: 'Fechar' }] : [{ rotulo: 'Cancelar' }, { rotulo: 'Salvar', primario: true, fn: async () => {
      await api('/api/deteccao/configurar', { ligada: $('#det-ligada').checked, sensibilidade: $('#det-sens').value });
      await atualizarImpressora(); return true;
    } }],
  });
}

// ------------------------------------------------------------------ PRIMEIRO DIA DA KOBRA X (A06)
// Roteiro com ✓/✗ por passo, guardado em %LOCALAPPDATA%\Organizador3D\config.json. Some depois de concluído.
// O mesmo roteiro está em PROGRAMAS/REGGAE-SLICER/KX-BRIDGE.md. Um ✗ mostra o plano B (Anycubic Slicer Next).
// O passo "f0" é provisório: a primeira peça vai pelo Anycubic Slicer Next, registrada fora da fila (PROJETOS/KOBRA-X/teste-f0/).
const CAMINHO_F0 = 'PROJETOS/KOBRA-X/teste-f0/f0-teste.stl';
const PASSOS_1DIA = [
  { id: 'f0', titulo: 'Primeira peça pelo Anycubic (F0)', texto: 'Impressora já no lugar definitivo, em móvel firme, e a calibração inicial feita (leva uns 40 min; mudou de lugar, calibre de novo). Abra o F0 no Anycubic Slicer Next, fatie com o perfil padrão de PLA e mande imprimir pela rede da Anycubic, com o modo LAN ainda desligado. Leva poucos minutos e gasta menos de 1 g. Anote o resultado em PROJETOS/KOBRA-X/teste-f0/LEIA-ME.md; o F0 não entra na fila.',
    botao: () => (E.dados && !E.dados.remoto ? `<button class="botao pequeno" data-acao="abrir-em" data-programa="anycubic" ${dadosCaminho(CAMINHO_F0)}>${ICONE.abrir}Abrir o F0 no Anycubic Slicer Next</button>` : '') },
  { id: 'instalar', titulo: 'Instalar e configurar a ponte', texto: 'Só agora: IP fixo no roteador, modo LAN no painel da impressora (com ele ligado, o app da Anycubic no celular e o envio pelo Anycubic Slicer Next param), KX-Bridge aberto e a impressora cadastrada em http://127.0.0.1:7125 (passos 1–7 do KX-BRIDGE.md).', auto: (st) => st.instalada },
  { id: 'online', titulo: 'Ponte online no Selecta 3D', texto: 'No cartão Kobra X, "Ligar a ponte". O cartão deve sair de "desligada".', auto: (st) => st.online },
  { id: 'status', titulo: 'Status e temperaturas', texto: 'O cartão mostra "Parada" e as temperaturas do bico e da mesa parecidas com as da tela da impressora.', auto: (st) => st.online && !!(st.impressora || {}).estado },
  { id: 'slots', titulo: 'Slots do ACE', texto: 'As 4 cores do ACE aparecem com a cor certa. Se não aparecerem, a ponte não tem /kx/filament/slots: dá para seguir, conferindo as cores na impressora. Aproveite e salve o diagnóstico da ponte (botão abaixo): ele mostra o que a versão instalada responde.', auto: (st) => (st.slots || []).length > 0 },
  { id: 'foto', titulo: 'Foto da câmera', texto: 'A foto do cartão atualiza a cada 5 s e mostra a mesa.' },
  { id: 'benchy', titulo: 'Enviar o Benchy (F01)', texto: 'Mesa limpa com álcool e a cor da F01 (PLA azul) no slot que a janela de envio indicar. Na Fila, F01 → "Imprimir na Kobra X". O cartão fica em "Enviado" enquanto a impressora aquece e nivela, e depois passa para "Imprimindo"; acompanhe a primeira camada.' },
  { id: 'pausar', titulo: 'Pausar e continuar', texto: 'Com o Benchy imprimindo, "Pausar" no cartão; a cabeça para e se afasta. Depois "Continuar".' },
  { id: 'fim', titulo: 'Fim e registro', texto: 'Quando terminar, o Selecta 3D avisa e abre o registro com o tempo real. Confira os gramas e registre. Medir o Benchy (60,00 × 31,00 mm).' },
];
// Roteiro geral (princ-v08), para pastas que não são a do autor (sem o F0 e o KX-BRIDGE.md): como ligar a Kobra X ao
// Selecta 3D. Usa os mesmos ids dos passos, então o que já foi marcado continua valendo.
const KX_BRIDGE_URL = 'https://gitea.it-drui.de/viewit/KX-Bridge-Release';
const PASSOS_CONECTAR = [
  { id: 'instalar', titulo: 'Instalar o KX-Bridge e preparar a impressora', texto: 'O Selecta 3D conversa com a Kobra X pela rede de casa através do KX-Bridge, um programa da comunidade (GPL-3.0, sem ligação com a Anycubic). Instale-o em %LOCALAPPDATA%\KX-Bridge (o kx-bridge.exe fica direto nessa pasta). Reserve um IP fixo para a impressora no roteador e ligue o modo LAN no painel dela; com o modo LAN ligado, o app da Anycubic no celular e o envio pelo Anycubic Slicer Next param. No KX-Bridge, cadastre a impressora (a ponte responde em http://127.0.0.1:7125).',
    auto: (st) => st.instalada,
    botao: () => `<button class="botao pequeno" data-acao="ref-link" data-url="${KX_BRIDGE_URL}">${ICONE.abrir}Página do KX-Bridge</button>` },
  { id: 'online', titulo: 'Ponte online no Selecta 3D', texto: 'No cartão Kobra X, "Ligar a ponte". O cartão deve sair de "desligada".', auto: (st) => st.online },
  { id: 'status', titulo: 'Status e temperaturas', texto: 'O cartão mostra "Parada" e as temperaturas do bico e da mesa parecidas com as da tela da impressora.', auto: (st) => st.online && !!(st.impressora || {}).estado },
  { id: 'slots', titulo: 'Slots do ACE', texto: 'As cores do ACE aparecem no cartão. Se não aparecerem, a versão do KX-Bridge não informa os slots: dá para seguir, conferindo as cores na impressora. O botão "Salvar o diagnóstico da ponte" mostra o que ela responde.', auto: (st) => (st.slots || []).length > 0 },
  { id: 'foto', titulo: 'Foto da câmera', texto: 'A foto do cartão atualiza a cada 5 s e mostra a mesa.' },
  { id: 'benchy', titulo: 'Primeira impressão pela rede', texto: 'Escolha uma peça pequena e já fatiada na Fila e use "Imprimir na Kobra X"; a janela de envio confere a cor de cada slot. O cartão fica em "Enviado" enquanto a impressora aquece e nivela, e depois passa para "Imprimindo".' },
  { id: 'pausar', titulo: 'Pausar e continuar', texto: 'Com a peça imprimindo, "Pausar" no cartão; a cabeça para e se afasta. Depois "Continuar".' },
  { id: 'fim', titulo: 'Fim e registro', texto: 'Quando terminar, o Selecta 3D avisa e abre o registro com o tempo real. Confira os gramas e registre: o estoque baixa sozinho.' },
];
const PLANO_B_1DIA = `<ol class="plano-b">
  <li>Abrir o arquivo no <b>Anycubic Slicer Next</b> (menu "…" da peça → "Abrir o fatiado no Anycubic Slicer Next", ou o modelo).</li>
  <li>Enviar para a Kobra X pelo próprio Anycubic Slicer Next (rede da Anycubic, com o modo LAN <b>desligado</b> na impressora) ou por pendrive.</li>
  <li>No Selecta 3D, menu "…" da peça → "Comecei a imprimir"; no fim, "Registrar impressão".</li>
  <li>Anotar em <code>impressora.md</code> (configurações testadas) em qual passo a ponte falhou e a mensagem que apareceu.</li>
</ol>`;

function htmlPrimeiroDia() {
  const st = IMP.estado || {};
  const pd = st.primeiro_dia || { passos: {}, quando: {} };
  if (pd.concluido) return '';
  const doAutor = !!pd.tem_f0; // pasta do autor: roteiro do primeiro dia; as outras: como conectar a Kobra X
  const PASSOS = doAutor ? PASSOS_1DIA : PASSOS_CONECTAR;
  const feitos = PASSOS.filter((p) => pd.passos[p.id] === 'ok').length;
  const falhou = PASSOS.find((p) => pd.passos[p.id] === 'falhou');
  const linhasHtml = PASSOS.map((p, i) => {
    const v = pd.passos[p.id] || '';
    const parece = !v && p.auto && IMP.estado && p.auto(st);
    return `<div class="passo-1dia ${v}">
      <span class="num">${v === 'ok' ? '✓' : v === 'falhou' ? '✗' : i + 1}</span>
      <div><b>${esc(p.titulo)}</b>${parece ? ' <span class="etiqueta lima">parece certo</span>' : ''}<div class="linha-2 quebra">${esc(p.texto)}</div>
        ${p.botao && v !== 'ok' ? `<div class="kx-linha">${p.botao()}</div>` : ''}
        ${pd.quando[p.id] ? `<small class="fraco">${v === 'ok' ? 'deu certo' : 'falhou'} em ${esc(pd.quando[p.id])}</small>` : ''}</div>
      <div class="acoes">
        <button class="botao pequeno ${v === 'ok' ? 'primario' : ''}" data-acao="1dia" data-passo="${p.id}" data-valor="${v === 'ok' ? '' : 'ok'}" title="Deu certo">✓</button>
        <button class="botao pequeno ${v === 'falhou' ? 'perigo' : ''}" data-acao="1dia" data-passo="${p.id}" data-valor="${v === 'falhou' ? '' : 'falhou'}" title="Não deu certo">✗</button>
      </div></div>`;
  }).join('');
  // D-b: recolhível (fica como o usuário deixou; some de vez ao concluir o roteiro)
  return `<details class="recolhivel" data-recolher="1dia" ${pref.ler('aberto_1dia', true) ? 'open' : ''}><summary><h2 class="secao">${doAutor ? 'Primeiro dia da Kobra X' : 'Conectar a Kobra X'} <small>${feitos} de ${PASSOS.length} passos${pd.tem_roteiro ? ' · roteiro também em PROGRAMAS/REGGAE-SLICER/KX-BRIDGE.md' : ' · opcional: o resto do Selecta 3D funciona sem a impressora na rede'}</small></h2></summary>
    <div class="lista-1dia">${linhasHtml}</div>
    ${falhou && doAutor ? `<div class="plano-b-caixa"><b>Plano B${doAutor ? ' (decidido em 22/11)' : ''}:</b> o passo "${esc(falhou.titulo)}" falhou. Até resolver, imprima pelo Anycubic Slicer Next:${PLANO_B_1DIA}</div>` : ''}
    <div class="kx-linha">${feitos === PASSOS.length ? '<button class="botao pequeno primario" data-acao="1dia" data-passo="concluido" data-valor="1">Concluir o roteiro (o cartão some)</button>' : ''}
      ${doAutor ? '<button class="botao pequeno" data-acao="1dia-planob">Ver o plano B</button>' : ''}
      ${E.dados && !E.dados.remoto && st.online ? '<button class="botao pequeno" data-acao="kx-diagnostico">Salvar o diagnóstico da ponte</button>' : ''}</div></details>`;
}

function desenharPrimeiroDia() {
  const el = $('#cartao-primeiro-dia');
  if (!el) return;
  const h = htmlPrimeiroDia();
  el.hidden = !h;
  if (el._h !== h) { el._h = h; el.innerHTML = h; } // compara com o último texto (o navegador reescreve atributos como open)
}

// F7: foto da 1ª camada, com Pausar / Está boa
function htmlCamada1(st) {
  const c = st && st.camada1;
  if (!c) return '';
  const r = c.peca ? acharFila(c.peca) : null;
  const imprimindo = st.impressora && st.impressora.estado === 'printing';
  return `<div class="camada1-alerta">
    ${c.foto ? `<img src="/api/imagem?caminho=${encodeURIComponent(c.foto)}&t=${encodeURIComponent(TOKEN)}" alt="Foto da 1ª camada" data-acao="ver-foto" data-caminho="${esc(c.foto)}">` : ''}
    <div><b>Confira a 1ª camada</b> · ${esc(r ? `${r.ID} · ${r['Peça']}` : 'Kobra X')} · ${esc(c.quando)}
      <div class="linha-2 quebra">Linhas bem grudadas e retas, sem falhas nem bolhas? Se não estiver boa, pause e confira antes de seguir.</div>
      <div class="kx-linha">${imprimindo ? '<button class="botao pequeno" data-acao="kx-pausar">Pausar</button>' : ''}
        <button class="botao pequeno primario" data-acao="camada1-ok">Está boa</button></div></div></div>`;
}

async function abrirTimelapseCfg() {
  const tl = (IMP.estado && IMP.estado.timelapse) || { ligado: true, minutos: 2 };
  abrirModal({
    titulo: 'Timelapse e fotos',
    sub: 'Durante a impressão, uma foto da câmera a cada tantos minutos (em IMPRESSOES/timelapse/). No fim, a foto final vai para o histórico e, se o ffmpeg estiver no PC, as fotos viram um vídeo.',
    corpo: `<div class="formulario">
      <label class="inteiro" style="display:flex;flex-direction:row;align-items:center;gap:10px;font-weight:400"><input type="checkbox" id="tl-ligado" ${tl.ligado ? 'checked' : ''} style="height:auto;accent-color:var(--lima)"> Tirar fotos para o timelapse</label>
      <label>Uma foto a cada (minutos)<input type="number" id="tl-min" min="1" max="30" value="${tl.minutos}"></label>
      <span class="dica inteiro">Uma impressão de 5 h com uma foto a cada 2 min gera ≈ 150 fotos. A foto do fim e a da 1ª camada (placas e peças grandes) são tiradas sempre.</span></div>`,
    acoes: [{ rotulo: 'Cancelar' }, { rotulo: 'Salvar', primario: true, fn: async () => {
      try { IMP.estado = { ...(await api('/api/impressora/timelapse', { ligado: $('#tl-ligado').checked, minutos: +$('#tl-min').value })), remoto: E.dados.remoto }; }
      catch (e) { aviso(e.message, true); throw e; }
      const el = $('#cartao-impressora'); if (el) el.innerHTML = htmlImpressora();
      return true;
    } }],
  });
}

async function kxAcao(acao, msg, corpo = {}) {
  try {
    if (msg) aviso(msg);
    IMP.estado = { ...(await api('/api/impressora/' + acao, corpo)), remoto: E.dados.remoto };
  } catch (e) { aviso(e.message, true); }
  const el = $('#cartao-impressora');
  if (el) el.innerHTML = htmlImpressora();
}

// A05: confere as cores da peça com os slots do ACE (cor do slot → cor mais parecida do estoque)
function conferirSlots(cores, slots) {
  const carregados = (slots || []).filter((s) => s.carregado);
  const usados = new Set();
  const ok = [], faltam = [];
  for (const cor of cores) {
    const s = carregados.find((x) => !usados.has(x.slot) && norm(corParecida(x.cor)) === norm(cor));
    if (s) { usados.add(s.slot); ok.push({ cor, slot: s.slot + 1, material: s.material || '' }); } else faltam.push(cor);
  }
  const vazios = (slots || []).filter((s) => !s.carregado).map((s) => s.slot + 1);
  const livres = carregados.filter((s) => !usados.has(s.slot)).map((s) => ({ slot: s.slot + 1, cor: corParecida(s.cor) }));
  return { ok, faltam, vazios, livres };
}

function htmlConferirSlots(cf, temSlots) {
  if (!temSlots) return '<div class="inteiro conferir-slots aviso-slots">Não consegui ler os slots do ACE: confira as cores na tela da impressora.</div>';
  const sug = [...cf.vazios.map((n) => `slot ${n} (vazio)`), ...cf.livres.map((l) => `slot ${l.slot} (${esc(l.cor)}, a peça não usa)`)];
  return `<div class="inteiro conferir-slots ${cf.faltam.length ? 'aviso-slots' : 'tudo-certo'}">
    <b>${cf.faltam.length ? `Falta${cf.faltam.length > 1 ? 'm' : ''} ${cf.faltam.length} cor${cf.faltam.length > 1 ? 'es' : ''} nos slots` : 'As cores da peça estão nos slots'}</b>
    <ul>${cf.ok.map((o) => `<li>✓ ${esc(o.cor)} → slot ${o.slot}${o.material ? ` (${esc(o.material)})` : ''}</li>`).join('')}
    ${cf.faltam.map((c) => `<li>✗ ${esc(c)}: não está carregada${sug.length ? ` — dá para pôr no ${sug.join(' ou ')}` : ''}</li>`).join('')}</ul>
    <small>A cor do slot é comparada com a cor mais parecida do estoque. Confira a ordem dos slots no fatiado.</small></div>`;
}

// princ-v02: o fatiado diz quais filamentos usa, na ordem do fatiador. A ponte não recebe mapa nenhum no envio:
// o filamento N sai do slot N do ACE. A tela mostra esse par e compara as cores antes de mandar.
function mapaDeSlots(fios, slots) {
  return (fios || []).map((f) => {
    const s = (slots || []).find((x) => x.slot + 1 === f.id);
    const carregado = !!(s && s.carregado);
    const corF = f.cor ? corParecida(f.cor) : '';
    const corS = carregado ? corParecida(s.cor) : '';
    return { ...f, carregado, corF, corS, hexS: carregado ? s.cor : '', material: carregado ? (s.material || '') : '',
      ok: carregado && !!corF && norm(corF) === norm(corS) };
  });
}
function htmlMapaDeSlots(mapa, temSlots) {
  const ruins = mapa.filter((m) => !m.ok);
  const linha = (m) => `<li class="${m.ok ? '' : 'ruim'}"><span class="kx-slot"><i style="background:${esc(m.cor || 'transparent')}"></i>filamento ${m.id} · ${esc(m.tipo || '?')} <small>${esc(m.corF || '?')}${m.gramas ? ` · ${fmtNum(m.gramas, 1)} g` : ''}</small></span>
    <b class="seta-slot">→</b>
    <span class="kx-slot ${m.carregado ? '' : 'vazio'}"><i style="background:${esc(m.hexS || 'transparent')}"></i>slot ${m.id} · ${m.carregado ? `${esc(m.material || '?')} <small>${esc(m.corS)}</small>` : (temSlots ? 'vazio' : 'não li')}</span>
    <b>${m.ok ? '✓' : '✗'}</b></li>`;
  return `<div class="inteiro conferir-slots ${ruins.length ? 'aviso-slots' : 'tudo-certo'}">
    <b>${!temSlots ? 'Não consegui ler os slots do ACE: confira na tela da impressora' : ruins.length ? `${ruins.length} filamento${ruins.length > 1 ? 's não batem' : ' não bate'} com o slot` : 'Cada filamento do fatiado está no slot certo'}</b>
    <ul class="mapa-slots">${mapa.map(linha).join('')}</ul>
    <small>O filamento N do fatiado sai do slot N do ACE. A cor do slot é comparada com a cor mais parecida do estoque${mapa.length === 1 ? '; em peça de uma cor só, a ponte usa o "slot padrão" configurado nela (de fábrica, o 1)' : ''}. Na primeira impressão colorida, confira também na tela da impressora antes de sair de perto.</small></div>`;
}

async function abrirImprimirKX(r, caminho) {
  caminho = caminho || fatiadoDe(r);
  if (!caminho) { aviso('Essa peça ainda não tem arquivo fatiado: use Fatiar aqui antes.', true); return; }
  const st = IMP.estado || {};
  if (!st.online) { aviso('A ponte KX-Bridge está desligada: ligue no cartão da Kobra X, no Painel.', true); return; }
  if (st.aguardando_inicio) { aviso('Já mandei um arquivo e a Kobra X ainda não começou. Espere ou cancele no cartão dela, no Painel.', true); return; }
  if (kxImprimindo()) { aviso('A Kobra X já está imprimindo.', true); return; }
  let fios = [];
  try { fios = (await api('/api/impressora/filamentos', { caminho })).filamentos || []; } catch { /* arquivo sem a lista: cai na conferência por cor */ }
  const coresPeca = r ? coresDoTexto(r['Filamento/cor']).map((c) => c.nome) : [];
  const temSlots = (st.slots || []).length > 0;
  const slots = (st.slots || []).filter((s) => s.carregado);
  const mapa = mapaDeSlots(fios, st.slots);
  const conf = !fios.length && temSlots ? conferirSlots(coresPeca, st.slots) : { ok: [], faltam: [], vazios: [], livres: [] };
  const naoBate = fios.length ? (temSlots ? mapa.filter((m) => !m.ok).map((m) => `filamento ${m.id} (${m.corF || '?'})`) : []) : conf.faltam;
  // purga maior quando uma cor clara entra depois de uma escura (All3DP; decisão de 23/11)
  const claras = mapa.filter((m) => /branc|amarel|bege|creme|natural|transparente/i.test(m.corF));
  const purga = mapa.length > 1 && claras.length ? `<div class="inteiro dica">Cor clara no meio de escuras (${claras.map((m) => esc(m.corF)).join(', ')}): se a cor clara sair manchada, aumente o volume de purga dessa troca no fatiador e fatie de novo.</div>` : '';
  abrirModal({
    titulo: 'Imprimir na Kobra X',
    sub: `${r ? `${r.ID} · ${r['Peça']} · ` : ''}${nomeArquivo(caminho)}`,
    corpo: `<div class="formulario">
      ${fios.length ? htmlMapaDeSlots(mapa, temSlots) : `
      ${coresPeca.length ? `<div class="inteiro"><b>Cores da peça:</b> ${coresPeca.map(esc).join(', ')}</div>` : ''}
      ${slots.length ? `<div class="inteiro"><b>No ACE agora:</b><div class="kx-slots">${slots.map((s) => `<span class="kx-slot"><i style="background:${esc(s.cor)}"></i>${s.slot + 1} · ${esc(s.material)} <small>${esc(corParecida(s.cor))}</small></span>`).join('')}</div></div>` : ''}
      ${coresPeca.length ? htmlConferirSlots(conf, temSlots) : ''}`}
      ${purga}
      <label class="inteiro marcar-linha"><input type="checkbox" id="kx-mesa"> A mesa está limpa e livre</label>
      <label class="inteiro marcar-linha"><input type="checkbox" id="kx-fios"> Conferi os slots acima com o que está no ACE</label>
      ${naoBate.length ? '<label class="inteiro marcar-linha aviso-slots"><input type="checkbox" id="kx-mesmo-assim"> Imprimir mesmo assim (sei que as cores não batem com os slots)</label>' : ''}
      <p class="dica inteiro">O G-code vai pela rede e a impressora começa sozinha, depois de aquecer e nivelar. Fique por perto nos primeiros minutos. ${r ? `A peça ${esc(r.ID)} passa para "imprimindo"; no fim, o programa abre o registro já preenchido (o estoque só baixa quando você confirmar).` : ''}</p>
    </div>`,
    acoes: [
      { rotulo: 'Cancelar' },
      { rotulo: 'Imprimir', primario: true, fn: async () => {
        if (!$('#kx-mesa').checked || !$('#kx-fios').checked) { aviso('Confira a mesa e os slots e marque as duas caixas.', true); throw new Error('falta confirmar'); }
        if (naoBate.length && !($('#kx-mesmo-assim') || {}).checked) { aviso(`Não bate: ${naoBate.join(', ')}. Troque o rolo ou marque "Imprimir mesmo assim".`, true); throw new Error('cores'); }
        E.salvando = true;
        try {
          await api('/api/impressora/imprimir', { caminho, peca: r ? r.ID : '' });
          aviso('Enviado. Esperando a Kobra X começar.');
        } catch (e) {
          // o envio falhou: nada mudou na fila; mostra o que fazer, com o plano B à mão
          setTimeout(() => abrirFalhaEnvio(r, caminho, e.message), 150);
        } finally {
          E.salvando = false;
          await carregar();
        }
        IMP.estado = null;
        setTimeout(atualizarImpressora, 800);
        return true;
      } },
    ],
  });
}

// o envio não deu certo: mensagem da ponte, diagnóstico e o plano B (Anycubic Slicer Next) na mesma janela
function abrirFalhaEnvio(r, caminho, mensagem) {
  abrirModal({
    titulo: 'Não consegui enviar para a Kobra X',
    sub: `${r ? `${r.ID} · ${r['Peça']} · ` : ''}${nomeArquivo(caminho)}`,
    corpo: `<div class="conferir-slots aviso-slots"><b>${esc(mensagem || 'A ponte não aceitou o arquivo.')}</b></div>
      <p>Nada mudou na fila${r ? `: a peça ${esc(r.ID)} continua como "${esc(r.Status)}"` : ''}. Dá para tentar de novo ou imprimir pelo plano B:</p>${PLANO_B_1DIA}`,
    acoes: [
      { rotulo: 'Salvar o diagnóstico', fn: async () => { await salvarDiagnosticoKX(); return false; } },
      { rotulo: 'Tentar de novo', fn: () => { setTimeout(() => abrirImprimirKX(r, caminho), 150); } },
      { rotulo: 'Fechar' },
      { rotulo: 'Abrir no Anycubic Slicer Next', primario: true, fn: () => { setTimeout(() => abrirNoFatiador(caminho, 'anycubic'), 150); } },
    ],
  });
}

async function salvarDiagnosticoKX() {
  try {
    const d = await api('/api/impressora/diagnostico', {});
    aviso(`Diagnóstico salvo em ${d.arquivo} (${d.respondeu} de ${d.total} consultas responderam).`);
  } catch (e) { aviso(e.message, true); }
}

// botões menos usados do cartão da Kobra X
function abrirMaisKX() {
  const st = IMP.estado || {};
  const pc = E.dados && !E.dados.remoto;
  const item = (acao, icone, rotulo) => `<button class="botao menu-item" data-acao="${acao}" data-fechar-menu="1">${ICONE[icone] || ''}${rotulo}</button>`;
  abrirModal({
    titulo: 'Kobra X', sub: st.versao ? `ponte ${st.versao}` : 'pela rede (KX-Bridge)',
    corpo: `<div class="menu-peca">
      ${item('avisos', 'sino', 'Avisos no celular e no Telegram')}
      ${item('deteccao-cfg', 'ver', 'Detecção de falhas pela câmera')}
      ${item('timelapse-cfg', 'relogio', `Timelapse e fotos${st.timelapse && !st.timelapse.ligado ? ' (desligado)' : ''}`)}
      ${pc && st.online ? item('kx-diagnostico', 'arquivos', 'Salvar o diagnóstico da ponte') : ''}
      ${item('1dia-planob', 'abrir', 'Plano B: imprimir pelo Anycubic Slicer Next')}</div>`,
    acoes: [{ rotulo: 'Fechar' }],
  });
}

function avisarFimKX(ev) {
  const r = ev.peca ? acharFila(ev.peca) : null;
  if (ev.resultado === 'não começou') {
    const visto = () => api('/api/impressora/visto', {}).then(atualizarImpressora).catch(() => {});
    const caminho = ev.arquivo || (r ? fatiadoDe(r) : '');
    return abrirModal({
      titulo: 'A Kobra X não começou',
      sub: `${r ? `${r.ID} · ${r['Peça']}` : (ev.gcode || 'arquivo')} · ${ev.quando}`,
      corpo: `<p>${ev.cancelada ? 'O envio foi cancelado antes de a impressora começar.' : 'Mandei o arquivo e, em 15 minutos, a impressora não começou a imprimir.'}
        ${r ? `A peça ${esc(r.ID)} voltou para "fatiado" e nada saiu do estoque.` : 'Nada foi registrado.'}</p>
        ${ev.cancelada ? '' : `<p>Olhe a tela da impressora: ela pode estar pedindo uma confirmação, sem filamento no slot, com a mesa ocupada ou fora do modo LAN. Se ela estiver imprimindo e o cartão não mostrou, anote isso e use "Comecei a imprimir" no menu da peça.</p>`}`,
      acoes: [
        ...(caminho && !E.dados.remoto ? [{ rotulo: 'Plano B: abrir no Anycubic', fn: () => { visto(); setTimeout(() => abrirNoFatiador(caminho, 'anycubic'), 150); } }] : []),
        ...(caminho && !E.dados.remoto ? [{ rotulo: 'Tentar de novo', fn: async () => { await visto(); setTimeout(() => abrirImprimirKX(r, caminho), 150); } }] : []),
        { rotulo: 'Entendi', primario: true, fn: visto },
      ],
    });
  }
  abrirModal({
    titulo: `Impressão ${ev.resultado}`,
    sub: `${r ? `${r.ID} · ${r['Peça']}` : (ev.gcode || 'arquivo')} · ${minutosTexto(ev.minutos)} · ${ev.quando}`,
    corpo: `<p>${r ? 'Registre agora para atualizar a fila e descontar o filamento do estoque (você confere os gramas antes).'
      : 'Essa impressão não foi mandada por uma peça da fila. Escolha a peça para registrar, ou deixe para depois.'}</p>
      ${r ? '' : `<label>Peça<select class="seletor" id="kx-fim-peca">${fila().filter((x) => !FILA_FIM.has(x.Status)).map((x) => `<option value="${esc(x.ID)}" ${x.Status === 'imprimindo' ? 'selected' : ''}>${esc(x.ID)} · ${esc(x['Peça'])}</option>`).join('')}</select></label>`}`,
    acoes: [
      { rotulo: 'Agora não', fn: () => { aviso('O botão "Registrar a impressão que terminou" fica no cartão da Kobra X, no Painel.'); } },
      { rotulo: 'Esquecer', fn: async () => { await api('/api/impressora/visto', {}); await atualizarImpressora(); } },
      { rotulo: 'Registrar', primario: true, fn: () => {
        const id = r ? r.ID : ($('#kx-fim-peca') || {}).value;
        setTimeout(() => registrarFimKX(id), 150);
      } },
    ],
  });
}

function registrarFimKX(id) {
  const ev = IMP.estado && IMP.estado.evento;
  if (!ev) return;
  const r = acharFila(id || ev.peca);
  if (!r || ev.resultado === 'não começou') { avisarFimKX(ev); return; }
  const status = ev.resultado === 'concluída' ? 'concluído' : 'falhou';
  abrirRegistrar(r, status, { tempo: minutosTexto(ev.minutos), nota: ev.resultado === 'cancelada' ? 'Cancelada na Kobra X.' : '',
    fatiado: /\.gcode(?:\.3mf)?$/i.test(ev.arquivo || '') ? ev.arquivo : '',
    aoRegistrar: () => api('/api/impressora/visto', {}).then(atualizarImpressora).catch(() => {}) });
}

