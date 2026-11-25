'use strict';
// Selecta 3D — interface, parte 20 de 22: 20-modal.js. Os arquivos de ui/js/ são carregados em ordem pelo
// index.html e dividem o mesmo escopo global (scripts comuns, sem compilação). Dividido do antigo ui/app.js em fila-v27 (A17).
// ------------------------------------------------------------------ modal e avisos
function abrirModal({ titulo, sub, corpo, acoes, largo }) {
  const m = $('#modal');
  m.className = 'modal' + (largo ? ' largo' : '');
  E.modalAcoes = acoes || [{ rotulo: 'Fechar', primario: true }];
  m.innerHTML = `<h2>${esc(titulo)}</h2>${sub ? `<p class="sub">${esc(sub)}</p>` : ''}${corpo}
    <div class="modal-acoes">${E.modalAcoes.map((a, i) => `<button class="botao ${a.primario ? 'primario' : ''}" data-modal-acao="${i}">${esc(a.rotulo)}</button>`).join('')}</div>`;
  $('#fundo-modal').hidden = false;
  const primeiro = $('input:not([type=radio]):not([type=checkbox]):not([type=color]), textarea, select', m);
  if (primeiro) primeiro.focus();
}
const modalAberto = () => !$('#fundo-modal').hidden;
function fecharModal() {
  if (E.vis) { try { E.vis.destruir(); } catch { /* já fechado */ } E.vis = null; }
  $('#fundo-modal').hidden = true;
  $('#modal').innerHTML = '';
  if (E.pendente) { E.pendente = false; carregar(); }
  const depois = E.aoFecharModal; // ex.: voltar para a próxima referência sem imagem
  E.aoFecharModal = null;
  if (depois) setTimeout(depois, 120);
}
async function acaoModal(i) {
  const a = E.modalAcoes[i];
  if (!a) return;
  if (!a.fn) return fecharModal();
  const botoes = $$('#modal .modal-acoes button');
  botoes.forEach((b) => { b.disabled = true; });
  try {
    const fechar = await a.fn();
    if (fechar !== false) fecharModal();
  } catch {
    // o aviso de erro já apareceu; mantém o modal aberto para corrigir
  } finally {
    botoes.forEach((b) => { b.disabled = false; });
  }
}

function aviso(texto, erro = false) {
  const el = document.createElement('div');
  el.className = 'aviso' + (erro ? ' erro' : '');
  el.textContent = texto;
  $('#avisos').appendChild(el);
  setTimeout(() => el.remove(), erro ? 7000 : 3200);
}

async function abrirNoWindows(caminho, modo) {
  try { await api('/api/abrir', { caminho, modo }); } catch (e) { aviso(e.message, true); }
}

