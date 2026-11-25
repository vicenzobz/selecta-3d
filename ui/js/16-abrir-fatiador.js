'use strict';
// Selecta 3D — interface, parte 16 de 22: 16-abrir-fatiador.js. Os arquivos de ui/js/ são carregados em ordem pelo
// index.html e dividem o mesmo escopo global (scripts comuns, sem compilação). Dividido do antigo ui/app.js em fila-v27 (A17).
// ------------------------------------------------------------------ ABRIR NO FATIADOR (Anycubic ou Reggae Slicer)
// Os botões "Abrir no …" do Painel, da Fila e do visualizador usam o padrão (guardado no PC); o "…" ao lado escolhe o outro.
const nomeAbrir = (p) => (p === 'anycubic' ? 'Anycubic' : nomeFatiador());
const padraoAbrir = () => (FAT.estado && FAT.estado.abrir_padrao) || 'anycubic';

async function abrirNoFatiador(caminho, programa) {
  programa = programa || padraoAbrir();
  try {
    const r = await api('/api/fatiador/abrir', { caminho, programa });
    aviso(`Abrindo no ${r.programa || nomeAbrir(programa)}…`);
  } catch (e) { aviso(e.message, true); }
}

function escolherFatiador(caminho) {
  const st = FAT.estado || {};
  const pad = padraoAbrir();
  const opcao = (id, nome, ok, falta) => `
    <button class="tema-opcao fat-opcao ${id === pad ? 'ativo' : ''}" data-acao="abrir-em" data-programa="${id}" ${dadosCaminho(caminho)} ${ok ? '' : 'disabled'}>
      <span>${esc(nome)}${id === pad ? ' <span class="etiqueta lima">padrão</span>' : ''}<small>${ok ? 'Abrir este arquivo aqui' : esc(falta)}</small></span>
    </button>`;
  abrirModal({
    titulo: 'Abrir no fatiador',
    sub: nomeArquivo(caminho),
    corpo: `<div class="temas">
        ${opcao('anycubic', 'Anycubic Slicer Next', st.anycubic !== false, 'Não achei o Anycubic Slicer Next instalado')}
        ${opcao('reggae', nomeFatiador(), st.disponivel !== false, 'Não achei o fatiador em PROGRAMAS/REGGAE-SLICER')}
      </div>
      <label class="inteiro" style="display:block;margin-top:18px">Padrão dos botões "Abrir" (Painel, Fila e visualizador)
        <select class="seletor" id="fat-padrao" style="display:block;margin-top:6px">
          <option value="anycubic" ${pad === 'anycubic' ? 'selected' : ''}>Anycubic Slicer Next</option>
          <option value="reggae" ${pad === 'reggae' ? 'selected' : ''}>${esc(nomeFatiador())}</option>
        </select></label>`,
    acoes: [{ rotulo: 'Fechar' }],
  });
}

async function definirPadraoFatiador(programa) {
  try {
    await api('/api/fatiador/padrao', { programa });
    if (FAT.estado) FAT.estado.abrir_padrao = programa;
    aviso(`Padrão: ${programa === 'anycubic' ? 'Anycubic Slicer Next' : nomeFatiador()}.`);
    render();
    const ativo = $('#modal [data-acao="abrir-em"][data-programa="' + programa + '"]');
    $$('#modal .fat-opcao').forEach((b) => b.classList.toggle('ativo', b === ativo));
  } catch (e) { aviso(e.message, true); }
}

