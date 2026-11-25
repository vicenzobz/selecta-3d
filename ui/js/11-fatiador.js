'use strict';
// Selecta 3D — interface, parte 11 de 22: 11-fatiador.js. Os arquivos de ui/js/ são carregados em ordem pelo
// index.html e dividem o mesmo escopo global (scripts comuns, sem compilação). Dividido do antigo ui/app.js em fila-v27 (A17).
// ------------------------------------------------------------------ fatiador (OrcaSlicer oficial, por linha de comando)
const FAT = { estado: null, form: pref.ler('fatiador', {}), erro: '', info: {} };
// 3MF: traz configurações salvas para a Kobra X? (só esses podem fatiar com "as do 3MF")
async function infoArquivoFat(caminho) {
  if (!/\.3mf$/i.test(caminho || '') || FAT.info[caminho]) return;
  FAT.info[caminho] = { carregando: true };
  try { FAT.info[caminho] = await api('/api/fatiador/info?caminho=' + encodeURIComponent(caminho)); } catch { FAT.info[caminho] = {}; }
  render();
}
async function carregarFatiador() {
  try { FAT.estado = await api('/api/fatiador'); FAT.erro = ''; } catch (e) { FAT.erro = e.message; }
  if (FAT.estado) { const n = nomeFatiador(); if (n !== pref.ler('nome_fatiador', '')) { pref.gravar('nome_fatiador', n); if (E.dados) renderMenu(); } }
}
const ehFatiavel = (c) => /\.(stl|3mf|obj|step|stp|amf)$/i.test(c || '');
// A15: um nome só em toda a interface. Desde princ-v08 (pedido do usuário) é sempre "Reggae Slicer", mesmo quando o que
// está instalado é o OrcaSlicer oficial (o Reggae Slicer é um fork dele e os dois funcionam do mesmo jeito)
const nomeFatiador = () => 'Reggae Slicer';
const GITHUB_REGGAE = 'https://github.com/vicenzobz/reggae-slicer';
const RELEASES_ORCA = 'https://github.com/OrcaSlicer/OrcaSlicer/releases/tag/v2.5.2';

// sem fatiador na pasta: como ligar o Reggae Slicer (ou o OrcaSlicer) ao Selecta 3D
function telaIntegrarReggae() {
  const sep = (E.dados.raiz || '').includes('/') ? '/' : String.fromCharCode(92); // barra invertida do Windows
  const base = `${E.dados.raiz || ''}${sep}PROGRAMAS${sep}REGGAE-SLICER`;
  const pReggae = `${base}${sep}reggae-slicer`, pOrca = `${base}${sep}orca-oficial`;
  const caminho = (c) => `<span class="fat-caminho"><code>${esc(c)}</code><button class="botao pequeno" data-acao="fat-copiar" data-texto="${esc(c)}">Copiar</button></span>`;
  return `${cabecalho('Reggae Slicer', 'O fatiador do Selecta 3D. Ainda não está ligado a esta pasta.')}
    <section class="cartao fat-integrar">
      <h2 class="secao">Ligar o Reggae Slicer <small>uma vez só · leva uns 5 minutos</small></h2>
      <p>Com ele na pasta, o Selecta 3D fatia as peças da fila e guarda a estimativa (gramas por cor, tempo e custo), abre os modelos direto nele, e o Reggae Slicer mostra na página inicial a fila, os projetos e os filamentos do seu estoque.</p>
      <div class="kx-linha"><button class="botao primario" data-acao="ref-link" data-url="${GITHUB_REGGAE}">${ICONE.abrir}Abrir o Reggae Slicer no GitHub</button>
        <span class="dica">${esc(GITHUB_REGGAE.replace('https://', ''))}</span></div>
      <ol class="fat-passos">
        <li>No GitHub, abra a aba <b>Actions</b> e a última execução verde de <b>Reggae Slicer - Windows</b>. Em <b>Artifacts</b>, baixe <code>ReggaeSlicer_…_Windows_x64_portable</code> (precisa estar logado no GitHub).</li>
        <li>Extraia o zip nesta pasta, de modo que o <code>reggae-slicer.exe</code> fique direto dentro dela:${caminho(pReggae)}</li>
        <li>Volte aqui e clique em <b>Procurar de novo</b>. Os perfis da Kobra X já vêm com o Selecta 3D.</li>
        <li>Abra o Reggae Slicer uma vez pelo botão <b>Abrir o Reggae Slicer</b> desta aba e escolha a Kobra X. As configurações dele ficam na pasta <code>dados-orca</code>, ao lado, e os filamentos do seu estoque passam a aparecer nele em alguns segundos.</li>
      </ol>
      <div class="kx-linha"><button class="botao" data-acao="fat-procurar">${ICONE.recarregar}Procurar de novo</button></div>
    </section>
    <section class="cartao fat-orca-nota">
      <h2 class="secao">Funciona com o OrcaSlicer também</h2>
      <p>O Reggae Slicer é um <b>fork do OrcaSlicer 2.5.2</b>: muda o visual e a ligação com o Selecta 3D, mas fatia igual e abre os mesmos arquivos. Se preferir o OrcaSlicer oficial, baixe a versão <b>portátil</b> (Windows, <code>…_portable.zip</code>) e extraia em:${caminho(pOrca)}</p>
      <div class="kx-linha"><button class="botao" data-acao="ref-link" data-url="${RELEASES_ORCA}">${ICONE.abrir}OrcaSlicer 2.5.2 no GitHub</button></div>
      <p class="dica">A aba continua se chamando Reggae Slicer. Projeto pessoal, sem suporte: para adaptar a outra impressora, use um agente de IA como o Claude Code ou o Codex.</p>
    </section>`;
}
const nomeArquivo = (c) => String(c || '').split('/').pop();

// cor de cada filamento para a estimativa: as cores da peça na fila (na ordem) ou o rolo de cor mais parecida
function hexRgb(h) { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '').trim()); return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null; }
function corParecida(hex) {
  const a = hexRgb(hex);
  if (!a) return '';
  let melhor = '', dist = Infinity;
  for (const c of indiceCores()) {
    const b = hexRgb(c.hex);
    if (!b) continue;
    const d = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
    if (d < dist) { dist = d; melhor = c.nome; }
  }
  return melhor;
}
// um filamento por cor do modelo: rolo do estoque de cor mais parecida, ou o perfil escolhido antes
function filamentoParaCor(st, hex) {
  const a = hexRgb(hex);
  let melhor = '', dist = Infinity;
  for (const e of (a ? st.estoque || [] : [])) {
    const b = hexRgb(e.hex);
    if (!b) continue;
    const d = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
    if (d < dist) { dist = d; melhor = e.arquivo; }
  }
  return melhor;
}
function escolhasFat(st, f, cores) {
  const n = Math.max(1, cores.length);
  return Array.from({ length: n }, (_, i) => f['fil' + i] || (cores[i] && filamentoParaCor(st, cores[i].hex)) || f.filamento || st.padrao.filamento);
}
const nomeFilFat = (st, arq) => ((st.estoque || []).find((e) => e.arquivo === arq) || st.filamentos.find((p) => p.arquivo === arq) || {}).nome || '';
const perfilFat = (st, t) => [(st.processos.find((p) => p.arquivo === t.processo) || {}).nome,
  ((t.escolhas && t.escolhas.length ? t.escolhas : [t.filamento]).map((a) => nomeFilFat(st, a)).filter(Boolean).join(' + '))].filter(Boolean).join(', ');
function partesDoFatiamento(t, r) {
  const fil = t.filamentos || [];
  const daFila = r ? coresDoTexto(r['Filamento/cor']).map((c) => c.nome) : [];
  if (fil.length === 1) return [{ cor: daFila[0] || corParecida(fil[0].hex) || 'total', g: fil[0].gramas }];
  return fil.map((f, i) => ({ cor: (daFila.length === fil.length ? daFila[i] : '') || corParecida(f.hex) || `filamento ${f.id}`, g: f.gramas }));
}

function telaFatiador() {
  if (E.dados.remoto) return `${cabecalho(nomeFatiador(), '')}<div class="faixa-aviso">O fatiador só funciona na janela do PC.</div>`;
  if (FAT.erro) return `${cabecalho(nomeFatiador(), '')}<div class="faixa-aviso">Não consegui falar com o fatiador: ${esc(FAT.erro)}</div>`;
  const st = FAT.estado;
  if (!st && !FAT.carregando) { FAT.carregando = true; carregarFatiador().then(() => { FAT.carregando = false; render(); }); }
  if (!E.arquivos && !FAT.carregandoArq) { FAT.carregandoArq = true; carregarArquivos().then(() => { FAT.carregandoArq = false; render(); }); }
  if (!st || !E.arquivos) return `${cabecalho(nomeFatiador(), 'Carregando…')}`;
  if (!st.disponivel) return telaIntegrarReggae();
  const f = FAT.form;
  const modelos = E.arquivos.filter((a) => ehFatiavel(a.caminho));
  if (f.caminho && !modelos.some((a) => a.caminho === f.caminho)) f.caminho = '';
  const arq = arquivoDe(f.caminho);
  const eh3mf = /\.3mf$/i.test(f.caminho || '');
  const info = eh3mf ? (FAT.info[f.caminho] || (infoArquivoFat(f.caminho), {})) : {};
  // padrão: sempre a configuração da Kobra X; "as do 3MF" só para 3MF salvo para a Kobra X
  const modo = eh3mf && info.kobra_x ? (f.modo || 'perfil') : 'perfil';
  const proc = f.processo || st.padrao.processo;
  const cores = (info.cores || []);
  const escolhas = escolhasFat(st, f, cores);
  const salvarAuto = f.salvar !== '0';
  const ativas = fila().filter((r) => !FILA_FIM.has(r.Status));
  const sugeridas = f.caminho ? filaDoArquivo(f.caminho).exatos : [];
  const peca = f.peca !== undefined ? f.peca : (sugeridas[0] || '');
  const opc = (lista, atual) => lista.map((p) => `<option value="${esc(p.arquivo)}" ${p.arquivo === atual ? 'selected' : ''}>${esc(p.nome)}</option>`).join('');
  const opcFil = (atual) => ((st.estoque || []).length ? `<optgroup label="Estoque">${opc(st.estoque, atual)}</optgroup><optgroup label="Perfis da Kobra X">${opc(st.filamentos, atual)}</optgroup>` : opc(st.filamentos, atual));
  const amostra = (hex) => (hex ? `<span class="fat-cor" style="background:${esc(hex)}"></span>` : '');
  // um seletor por cor do modelo (3MF de duas cores: corpo e texto); STL e 3MF de uma cor: um só
  const seletoresFil = escolhas.map((e, i) => {
    const c = cores[i];
    const rotulo = escolhas.length > 1 ? `Cor ${i + 1}${c && c.nome ? ' · ' + esc(c.nome) : ''} ${amostra(c && c.hex)}` : 'Filamento';
    return `<label>${rotulo}<select id="fat-fil-${i}" data-fat="fil${i}">${opcFil(e)}</select></label>`;
  }).join('');

  const aviso = !st.disponivel
    ? `<div class="faixa-aviso">Fatiador não encontrado. Instale o Reggae Slicer em <code>PROGRAMAS/REGGAE-SLICER/reggae-slicer</code> ou extraia o OrcaSlicer 2.5.2 portátil em <code>PROGRAMAS/REGGAE-SLICER/orca-oficial</code>.</div>` : '';
  const form = `
    <section class="cartao">
      <h2 class="secao">Fatiar <small>${esc(st.versao)} · perfis oficiais da Kobra X · não envia nada para a impressora</small></h2>
      <div class="formulario">
        <label class="inteiro">Modelo
          <select id="fat-caminho" data-fat="caminho"><option value="">Escolha um arquivo da pasta…</option>
            ${modelos.map((a) => `<option value="${esc(a.caminho)}" ${a.caminho === f.caminho ? 'selected' : ''}>${esc(a.caminho)}</option>`).join('')}</select>
          ${arq ? `<span class="dica">${esc(a3(arq))}</span>` : ''}
        </label>
        ${eh3mf && info.kobra_x ? `<label class="inteiro">Configurações
          <select id="fat-modo" data-fat="modo">
            <option value="perfil" ${modo === 'perfil' ? 'selected' : ''}>Perfis da Kobra X escolhidos aqui</option>
            <option value="projeto" ${modo === 'projeto' ? 'selected' : ''}>As salvas neste 3MF (ele foi preparado para a Kobra X)</option></select>
          <span class="dica">Use "as salvas neste 3MF" quando você mesmo ajustou o projeto no fatiador (cores, suportes, velocidades).</span></label>`
        : eh3mf && info.tem_configuracao ? `<div class="inteiro dica">Este 3MF foi salvo para <b>${esc(info.impressora || 'outra impressora')}</b>; ele é fatiado com os perfis da Kobra X.</div>` : ''}
        ${modo === 'perfil' ? `
        <label>Qualidade<select id="fat-processo" data-fat="processo">${opc(st.processos, proc)}</select></label>
        ${seletoresFil}
        ${escolhas.length > 1 ? `<div class="inteiro dica">${escolhas.length} cores no modelo: cada uma sai no filamento escolhido, na ordem dos slots (cor 1 no slot 1).</div>` : ''}` : ''}
        <label class="inteiro">Peça da fila <span class="dica">opcional: para salvar o resultado como estimativa da peça</span>
          <select id="fat-peca" data-fat="peca"><option value="">nenhuma</option>
            ${ativas.map((r) => `<option value="${esc(r.ID)}" ${r.ID === peca ? 'selected' : ''}>${esc(r.ID)} · ${esc(curto(r['Peça'], 60))}${sugeridas.includes(r.ID) ? ' (usa este arquivo)' : ''}</option>`).join('')}</select>
        </label>
        ${peca ? `<label class="inteiro fat-salvar"><input type="checkbox" id="fat-salvar" data-fat="salvar" ${salvarAuto ? 'checked' : ''}>Salvar estimativa: ao terminar, gravar tempo e gramas em ${esc(peca)} e marcá-la como fatiada</label>` : ''}
      </div>
      <div class="modal-acoes" style="margin-top:18px">
        <button class="botao" data-acao="fat-orca" ${dadosCaminho(f.caminho || '')} ${!st.disponivel || !f.caminho ? 'disabled' : ''} title="Abre o modelo na janela do ${nomeFatiador()} para pintar cores, girar, pôr suporte ou mudar qualquer configuração">${ICONE.abrir}Abrir no ${nomeFatiador()}</button>
        <button class="botao primario" data-acao="fat-fatiar" ${!st.disponivel || !f.caminho || st.ocupado || FAT.iniciando ? 'disabled' : ''}>${FAT.iniciando ? 'Iniciando…' : st.ocupado ? 'Fatiando…' : 'Fatiar'}</button>
      </div>
      ${trabalhoAtivo() ? htmlAndamento(trabalhoAtivo()) : FAT.iniciando ? htmlAndamento({ caminho: f.caminho, inicio: Date.now() / 1000, etapa: 'Iniciando o fatiador…' }) : ''}
    </section>`;

  const linhaTrab = (t) => {
    const r = t.peca ? acharFila(t.peca) : null;
    const quando = new Date(t.inicio * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const perfil = t.modo === 'projeto' ? 'configurações do 3MF' : perfilFat(st, t);
    let res = '';
    if (t.status === 'fatiando') res = '<span class="etiqueta alerta">fatiando…</span><div class="linha-2">acompanhe na barra acima</div>';
    else if (t.status === 'erro') res = `<span class="etiqueta erro">erro</span><div class="linha-2 quebra">${esc(t.mensagem)}</div>`;
    else {
      const cores = partesDoFatiamento(t, r).map((p) => `${esc(p.cor)} ${fmtNum(p.g, 1)} g`).join(' · ');
      res = `<b>${esc(t.tempo)}</b> · ${fmtNum(t.gramas_total, 1)} g · ${t.camadas} camadas<div class="linha-2">${cores}</div>`
        + (t.salvo ? `<div class="linha-2"><span class="etiqueta menta">${esc(t.salvo)}</span></div>` : '')
        + (t.aviso_salvar ? `<div class="linha-2 quebra"><span class="etiqueta erro">${esc(t.aviso_salvar)}</span></div>` : '');
    }
    return `<div class="item" style="grid-template-columns:minmax(0,1.4fr) minmax(0,1.3fr) auto">
      <div style="min-width:0"><div class="nome-item" title="${esc(t.caminho)}">${esc(nomeArquivo(t.caminho))}</div>
        <div class="linha-2">${quando} · ${esc(perfil)}${t.peca ? ' · ' + esc(t.peca) : ''}</div></div>
      <div>${res}</div>
      <div class="acoes">
        ${t.status === 'concluido' && t.peca ? `<button class="botao pequeno ${t.salvo ? '' : 'primario'}" data-acao="fat-estimar" data-id="${esc(t.id)}">${t.salvo ? 'Ajustar estimativa' : `Salvar estimativa de ${esc(t.peca)}`}</button>` : ''}
        ${t.status === 'concluido' && t.arquivo && podeImprimirKX() ? botaoIcone('kx-imprimir', 'impressoes', 'Imprimir na Kobra X', `${dadosCaminho(t.arquivo)} data-id="${esc(t.peca || '')}"`) : ''}
        ${t.status === 'concluido' ? botaoIcone('fat-orca', 'ver', `Ver as camadas no ${nomeFatiador()}`, dadosCaminho(t.arquivo)) : ''}
        ${t.pasta ? botaoIcone('pasta', 'pasta', 'Mostrar na pasta (arquivo e log)', dadosCaminho(t.arquivo || t.pasta)) : ''}
      </div>
    </div>`;
  };
  const trabalhos = st.trabalhos.length ? st.trabalhos.map(linhaTrab).join('') : '';
  // B2: os últimos fatiados ficam mesmo depois de reabrir o programa (lidos de PROGRAMAS/REGGAE-SLICER/saidas)
  const daSessao = new Set(st.trabalhos.map((t) => t.arquivo).filter(Boolean));
  const recentes = (st.recentes || []).filter((x) => !daSessao.has(x.arquivo)).map((x) => `<div class="item" style="grid-template-columns:minmax(0,1.4fr) minmax(0,1.3fr) auto">
      <div style="min-width:0"><div class="nome-item" title="${esc(x.arquivo)}">${esc(nomeArquivo(x.arquivo))}</div><div class="linha-2">${esc(x.quando)}${x.peca ? ' · ' + esc(x.peca) : ''}</div></div>
      <div class="linha-2">${x.peca ? esc((acharFila(x.peca) || {})['Peça'] || '') : 'sem peça ligada'}</div>
      <div class="acoes">
        ${podeImprimirKX() ? botaoIcone('kx-imprimir', 'impressoes', 'Imprimir na Kobra X', `${dadosCaminho(x.arquivo)} data-id="${esc(x.peca || '')}"`) : ''}
        ${botaoIcone('fat-orca', 'ver', `Ver as camadas no ${nomeFatiador()}`, dadosCaminho(x.arquivo))}
        ${botaoIcone('pasta', 'pasta', 'Mostrar na pasta (arquivo e log)', dadosCaminho(x.arquivo))}</div></div>`).join('');
  return `
    ${cabecalho(nomeFatiador(), `O básico para a Kobra X: escolher qualidade e filamento, fatiar e guardar a estimativa da peça. Para pintar cores, girar, pôr suporte ou qualquer ajuste fino, abra no ${nomeFatiador()}. Salvar a estimativa não mexe no estoque; o estoque só baixa ao registrar a impressão.`,
      `<button class="botao" data-acao="fat-orca" data-caminho="">${ICONE.abrir}Abrir o ${nomeFatiador()}</button>`)}
    ${aviso}
    ${form}
    <section class="cartao" style="margin-top:18px"><h2 class="secao">Últimos fatiados <small>arquivos em PROGRAMAS/REGGAE-SLICER/saidas</small></h2>
      <div class="lista">${trabalhos + recentes || '<div class="vazio">Nada fatiado ainda. Use "Fatiar" acima.</div>'}</div></section>`;
}
const a3 = (a) => `${a.ext} · ${fmtTamanho(a.tamanho)} · modificado ${a.modificado}`;

async function fatiarAgora() {
  const st = FAT.estado, f = FAT.form;
  const eh3mf = /\.3mf$/i.test(f.caminho || '');
  const info = eh3mf ? (FAT.info[f.caminho] || {}) : {};
  const filamentos = escolhasFat(st, f, info.cores || []);
  const corpo = {
    caminho: f.caminho, modo: eh3mf && info.kobra_x ? (f.modo || 'perfil') : 'perfil',
    processo: f.processo || st.padrao.processo, filamentos,
    filamento: filamentos.find((a) => !a.startsWith('estoque/')) || st.padrao.filamento,
    peca: f.peca !== undefined ? f.peca : (filaDoArquivo(f.caminho).exatos[0] || ''),
    salvar: f.salvar !== '0',
  };
  FAT.iniciando = true; // a barra aparece já no clique, antes de o servidor responder
  render();
  try {
    await api('/api/fatiador/fatiar', corpo);
    await carregarFatiador();
  } catch (e) { aviso(e.message, true); }
  FAT.iniciando = false;
  render();
  mostrarAndamento(trabalhoAtivo());
}

function estimarDoFatiamento(jid) {
  const t = FAT.estado.trabalhos.find((x) => x.id === jid);
  const r = t && acharFila(t.peca);
  if (!r) return aviso('Peça não encontrada na fila.', true);
  const st = FAT.estado;
  const perfil = t.modo === 'projeto' ? 'configurações salvas no 3MF' : perfilFat(st, t);
  const d = new Date(t.inicio * 1000);
  const dia = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  abrirEstimar(r, {
    partes: partesDoFatiamento(t, r),
    tempo: t.tempo,
    fonte: `${st.versao} (Selecta 3D)`,
    obs: `Arquivo \`${t.arquivo}\`; ${perfil}; ${t.camadas} camadas.`,
    fatiado: { frase: `Fatiado em ${dia} (${st.versao}, ${perfil}, ${t.tempo}, ${fmtNum(t.gramas_total, 1)} g): \`${t.arquivo}\`.` },
  });
}

// andamento do fatiamento: barra no painel Fatiar e uma faixa no alto da janela nas outras abas
const trabalhoAtivo = () => FAT.estado && FAT.estado.trabalhos.find((t) => t.status === 'fatiando');
const decorrido = (t) => { const s = Math.max(0, Date.now() / 1000 - t.inicio); return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };
function htmlAndamento(t) {
  const pct = Math.round(t.progresso || 0);
  return `<div class="fat-andamento" data-fat-andamento>
      <div class="fat-andamento-topo"><b>Fatiando ${esc(nomeArquivo(t.caminho))}</b><span class="mono">${pct}% · ${decorrido(t)}</span></div>
      <div class="fat-barra"><span style="width:${Math.max(pct, 2)}%"></span></div>
      <div class="dica">${esc(t.etapa || 'Começando…')}</div></div>`;
}
function mostrarAndamento(t) {
  let topo = $('#fat-topo');
  if (!topo) {
    topo = document.createElement('button');
    topo.id = 'fat-topo'; topo.className = 'fat-topo'; topo.dataset.acao = 'aba'; topo.dataset.aba = 'fatiador';
    document.body.appendChild(topo);
  }
  topo.hidden = !t || E.aba === 'fatiador';
  if (!t) return;
  const pct = Math.round(t.progresso || 0);
  topo.title = 'Ver no painel Fatiar';
  topo.innerHTML = `<span class="fat-barra"><span style="width:${Math.max(pct, 2)}%"></span></span><span class="fat-topo-texto">Fatiando ${esc(nomeArquivo(t.caminho))} · ${pct}% · ${decorrido(t)}</span>`;
  const el = document.querySelector('[data-fat-andamento]');
  if (el) el.outerHTML = htmlAndamento(t);
}
setInterval(async () => {
  const ativo = trabalhoAtivo();
  if (!ativo) return mostrarAndamento(null);
  if (document.hidden) return;
  let t;
  try { t = await api('/api/fatiador/trabalho?id=' + encodeURIComponent(ativo.id)); } catch { return; }
  Object.assign(ativo, t);
  if (t.status === 'fatiando') return mostrarAndamento(t);
  mostrarAndamento(null);
  await carregarFatiador();
  if (!modalAberto() && E.aba === 'fatiador') render();
  aviso(t.status === 'concluido' ? `Fatiado: ${t.tempo}, ${fmtNum(t.gramas_total, 1)} g${t.salvo ? ` (${t.salvo})` : ''}.` : 'O fatiamento deu erro.', t.status !== 'concluido' || !!t.aviso_salvar);
  if (t.salvo) carregar(); // a fila e as estimativas mudaram
}, 1000);


// O fatiamento em lote (F1, "Fatiar todas as prontas") saiu em princ-v02, a pedido do usuário: peça colorida precisa da
// pré-visualização do fatiador antes de imprimir.
