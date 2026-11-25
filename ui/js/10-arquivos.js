'use strict';
// Selecta 3D — interface, parte 10 de 22: 10-arquivos.js. Os arquivos de ui/js/ são carregados em ordem pelo
// index.html e dividem o mesmo escopo global (scripts comuns, sem compilação). Dividido do antigo ui/app.js em fila-v27 (A17).
// ------------------------------------------------------------------ ARQUIVOS
function telaArquivos() {
  const f = E.filtros.arquivos;
  if (!E.arquivos) return `${cabecalho('Arquivos', 'Procurando arquivos 3D na pasta…')}`;
  const exts = [...new Set(E.arquivos.map((a) => a.ext))].sort();
  const barra = `
    <input class="campo-busca" id="busca-arquivos" placeholder="Buscar nome ou pasta…" value="${esc(f.busca)}" data-filtro="arquivos.busca">
    <select class="seletor" data-filtro="arquivos.projeto"><option value="">Todos os projetos</option>${linhas('projetos').map((p) => `<option value="${esc(p.ID)}" ${p.ID === f.projeto ? 'selected' : ''}>${esc(p.Projeto)}</option>`).join('')}</select>
    <select class="seletor" data-filtro="arquivos.ext"><option value="">Todos os tipos</option>${exts.map((x) => `<option ${x === f.ext ? 'selected' : ''}>${x}</option>`).join('')}</select>
    <select class="seletor" data-filtro="arquivos.fila"><option value="">Na fila ou não</option><option value="sim" ${f.fila === 'sim' ? 'selected' : ''}>Só os que estão na fila</option><option value="nao" ${f.fila === 'nao' ? 'selected' : ''}>Só os fora da fila</option></select>
    <span class="espaco"></span>
    <span class="alternador">
      <button class="icone ${f.vista !== 'grade' ? 'ligado' : ''}" data-acao="vista" data-vista="lista" title="Lista">${ICONE.lista}</button>
      <button class="icone ${f.vista === 'grade' ? 'ligado' : ''}" data-acao="vista" data-vista="grade" title="Miniaturas">${ICONE.grade}</button>
    </span>
    <button class="botao" data-acao="recarregar-arquivos">${ICONE.recarregar}Procurar de novo</button>`;
  return `
    ${cabecalho('Arquivos', `${E.arquivos.length} arquivos 3D na pasta (STL, 3MF, STEP, SCAD…). Origem e licença em <code>modelos.md</code>. As pastas <code>PROGRAMAS/SELECTA-3D</code>, <code>PROGRAMAS/REGGAE-SLICER</code> e <code>.claude</code> ficam de fora.`)}
    <div class="barra">${barra}</div>
    <section class="${f.vista === 'grade' ? 'grade-arquivos' : 'lista arquivos-lista'}" id="corpo-lista">${listaArquivos()}</section>`;
}

function chipOrigem(a) {
  const o = origemDe(a.caminho);
  if (!o) return `<button class="link-est" data-acao="origem" ${dadosCaminho(a.caminho)}>+ origem</button>`;
  const lic = o['Licença'] || '?';
  return `<button class="etiqueta ${lic === '?' ? 'alerta' : /própria/i.test(lic) ? 'fantasma' : 'menta'} chip-botao" data-acao="origem" ${dadosCaminho(a.caminho)}
    title="${esc(`${o.Origem}${o.Autor ? ' — ' + o.Autor : ''}${o['Observações'] ? ' · ' + o['Observações'] : ''} (vale para ${o._caminho})`)}">${esc(lic)}</button>`;
}

function listaArquivos() {
  const f = E.filtros.arquivos;
  const busca = norm(f.busca);
  const projeto = linhas('projetos').find((p) => p.ID === f.projeto);
  const pastaP = projeto ? pastaDoProjeto(projeto) : '';
  const lista = E.arquivos.filter((a) => {
    if (f.ext && a.ext !== f.ext) return false;
    if (pastaP && !a.caminho.startsWith(pastaP + '/')) return false;
    if (busca && !busca.split(/\s+/).every((p) => norm(a.caminho).includes(p))) return false;
    if (f.fila) {
      const naFila = filaDoArquivo(a.caminho).total > 0;
      if ((f.fila === 'sim') !== naFila) return false;
    }
    return true;
  });
  const chipsFila = (a) => {
    const { exatos, pasta } = filaDoArquivo(a.caminho);
    return `${exatos.map((id) => `<span class="etiqueta floresta">${esc(id)}</span>`).join('')}${pasta.length ? `<span class="etiqueta fantasma" title="Peças da fila que apontam para a pasta inteira: ${esc(pasta.join(', '))}">pasta · ${pasta.length}</span>` : ''}`;
  };
  const botoes = (a) => `
        ${eh3D(a.caminho) ? botaoIcone('ver3d', 'ver', 'Ver em 3D', dadosCaminho(a.caminho)) : ''}
        ${botaoIcone('abrir', 'abrir', 'Abrir no programa padrão', dadosCaminho(a.caminho))}
        ${botaoIcone('pasta', 'pasta', 'Mostrar na pasta', dadosCaminho(a.caminho))}
        ${ehFatiavel(a.caminho) && !E.dados.remoto ? botaoIcone('fatiar-arquivo', 'fatiador', 'Fatiar no Selecta 3D', dadosCaminho(a.caminho)) : ''}
        ${ehFatiavel(a.caminho) && !E.dados.remoto ? botaoIcone('fat-orca', 'editar', `Abrir no ${nomeFatiador()}`, dadosCaminho(a.caminho)) : ''}`;
  if (f.vista === 'grade') {
    if (!lista.length) return '<div class="vazio">Nenhum arquivo com esses filtros.</div>';
    return lista.map((a) => `<article class="arq-cartao">
      ${eh3D(a.caminho) ? miniHtml(a) : `<div class="mini"><span class="mini-ext">${esc(a.ext)}</span></div>`}
      <div class="arq-info">
        <div class="nome-item" title="${esc(a.nome)}">${esc(a.nome)}</div>
        <div class="linha-2" title="${esc(a.pasta)}">${esc(a.pasta || '(raiz)')}</div>
        <div class="cores" style="margin-top:8px">${a.versao ? `<span class="etiqueta menta">${esc(a.versao)}</span>` : ''}${chipsFila(a)}${chipOrigem(a)}</div>
        <div class="arq-rodape"><span class="fraco">${esc(a.ext)} · ${fmtTamanho(a.tamanho)}</span><span class="acoes">${botoes(a)}</span></div>
      </div>
    </article>`).join('');
  }
  const cab = `<div class="item cab"><div>Arquivo</div><div>Tipo</div><div>Versão</div><div style="text-align:right">Tamanho</div><div class="col-data">Modificado</div><div>Na fila</div><div>Licença</div><div style="text-align:right">Ações</div></div>`;
  if (!lista.length) return cab + '<div class="vazio">Nenhum arquivo com esses filtros.</div>';
  return cab + lista.map((a) => {
    return `<div class="item">
      <div class="com-mini">${eh3D(a.caminho) ? miniHtml(a, 'mini-p') : `<div class="mini mini-p"><span class="mini-ext">${esc(a.ext)}</span></div>`}<div style="min-width:0"><div class="nome-item" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(a.nome)}">${esc(a.nome)}</div><div class="linha-2" title="${esc(a.pasta)}">${esc(a.pasta || '(raiz)')}</div></div></div>
      <div><span class="etiqueta fantasma">${esc(a.ext)}</span></div>
      <div>${a.versao ? `<span class="etiqueta menta">${esc(a.versao)}</span>` : ''}</div>
      <div class="muted" style="text-align:right">${fmtTamanho(a.tamanho)}</div>
      <div class="muted col-data">${esc(a.modificado)}</div>
      <div class="cores">${chipsFila(a)}</div>
      <div>${chipOrigem(a)}</div>
      <div class="acoes">
        ${eh3D(a.caminho) ? botaoIcone('ver3d', 'ver', 'Ver em 3D', dadosCaminho(a.caminho)) : ''}
        ${botaoIcone('abrir', 'abrir', 'Abrir no programa padrão', dadosCaminho(a.caminho))}
        ${botaoIcone('pasta', 'pasta', 'Mostrar na pasta', dadosCaminho(a.caminho))}
        ${ehFatiavel(a.caminho) && !E.dados.remoto ? botaoIcone('fatiar-arquivo', 'fatiador', 'Fatiar no Selecta 3D', dadosCaminho(a.caminho)) : ''}
        ${ehFatiavel(a.caminho) && !E.dados.remoto ? botaoIcone('fat-orca', 'editar', `Abrir no ${nomeFatiador()}`, dadosCaminho(a.caminho)) : ''}
      </div>
    </div>`;
  }).join('');
}

