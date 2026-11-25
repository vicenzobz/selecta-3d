'use strict';
// Selecta 3D — interface, parte 21 de 22: 21-eventos.js. Os arquivos de ui/js/ são carregados em ordem pelo
// index.html e dividem o mesmo escopo global (scripts comuns, sem compilação). Dividido do antigo ui/app.js em fila-v27 (A17).
// ------------------------------------------------------------------ eventos
document.addEventListener('click', async (ev) => {
  const ma = ev.target.closest('[data-modal-acao]');
  if (ma) return acaoModal(+ma.dataset.modalAcao);
  if (ev.target.id === 'fundo-modal') return fecharModal();
  const b = ev.target.closest('[data-acao]');
  if (!b || b.tagName === 'SELECT' || b.tagName === 'INPUT') return;
  if (b.tagName === 'A') ev.preventDefault();
  const d = { ...b.dataset };
  if (d.fecharMenu && b.closest('#modal')) fecharModal();
  switch (d.acao) {
    case 'aba': return irPara(d.aba);
    case 'aba-kx': irPara('painel'); return setTimeout(() => { const c = $('#cartao-impressora'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 80);
    case 'menu-peca': return abrirMenuPeca(acharFila(d.id));
    case 'plano-tudo': return abrirLinhaDoTempo();
    case 'timelapse-cfg': return abrirTimelapseCfg(); // F4
    case 'camada1-ok':
      await api('/api/impressora/camada1-visto', {}).catch(() => {});
      return atualizarImpressora();
    case 'ver-foto': return abrirModal({ titulo: 'Foto', largo: true, corpo: `<img class="timelapse" src="${urlMidia(d.caminho)}" alt="Foto">`, acoes: [{ rotulo: 'Fechar' }] });
    case 'ver-timelapse': return verTimelapse(d.chave);
    case 'imprimir-de-novo': return imprimirDeNovo(linhas('impressoes')[+d.indice]); // F3
    case 'menu-mais': return abrirMenuMais(); // D-e
    case 'plano-horarios': return abrirHorariosJanelas();
    case 'kx-slot-rolo': return abrirRoloSlot(+d.slot);
    case 'avisos': return abrirAvisos();
    case 'deteccao-cfg': return abrirDeteccaoCfg();
    case 'det-continuar':
      await api('/api/deteccao/visto', {}).catch(() => {});
      return kxAcao('continuar', 'Continuando…');
    case 'det-falso': {
      const nota = prompt('Falso alarme: o que a câmera viu? (opcional)') || '';
      try { await api('/api/deteccao/falso-alarme', { nota }); aviso('Anotado em IMPRESSOES/falhas/falsos-alarmes.md. A impressão continua pausada: use Continuar no cartão.'); } catch (e) { aviso(e.message, true); }
      return atualizarImpressora();
    }
    case 'avisos-ligar':
      try {
        const p = await Notification.requestPermission();
        pref.gravar('avisos_navegador', p === 'granted');
        aviso(p === 'granted' ? 'Avisos ligados neste aparelho.' : 'O navegador não deixou mostrar avisos.', p !== 'granted');
        if (p === 'granted') notificar('Selecta 3D', 'Avisos ligados neste aparelho.');
      } catch (e) { aviso('Este navegador não mostra avisos.', true); }
      fecharModal(); return abrirAvisos();
    case 'avisos-desligar': pref.gravar('avisos_navegador', false); fecharModal(); return abrirAvisos();
    case 'aviso-pc': return aviso('Fatiar e abrir o fatiador só funcionam na janela do PC.');
    case 'abrir': return abrirNoWindows(d.caminho, 'abrir');
    case 'pasta': return abrirNoWindows(d.caminho, 'pasta');
    case 'ver3d': return abrirVisualizador(d.caminho);
    case 'fila-nova': return abrirFormulario('fila');
    case 'fila-editar': return abrirFormulario('fila', acharFila(d.id));
    case 'fila-registrar': return abrirRegistrar(acharFila(d.id));
    case 'fila-mover': return salvar(() => api('/api/fila/mover', { id: d.id, direcao: d.direcao })).catch(() => {});
    case 'fila-imprimir': {
      const r = acharFila(d.id);
      return salvar(() => api('/api/fila/atualizar', { id: r.ID, campos: { Status: 'imprimindo' }, antes: { Status: r.Status } }), `${r.ID}: imprimindo.`).catch(() => {});
    }
    case 'novo': return abrirFormulario(d.tipo);
    case 'editar': {
      const F = FORMS[d.tipo];
      if (F.semId) return abrirFormulario(d.tipo, linhas(F.lista)[+d.indice], +d.indice);
      return abrirFormulario(d.tipo, linhas(F.lista).find((r) => r.ID === d.id));
    }
    case 'rolo-movimentar': return abrirMovimentarRolo(linhas('filamentos').find((r) => r.ID === d.id));
    case 'insumo-mais':
    case 'insumo-menos': {
      const r = linhas('insumos').find((x) => x.ID === d.id);
      if (numero(r.Quantidade) === null) return abrirFormulario('insumo', r);
      return salvar(() => api('/api/estoque/movimentar', { secao: 'Insumos e peças', id: r.ID, delta: d.acao === 'insumo-mais' ? 1 : -1, motivo: 'ajuste rápido' })).catch(() => {});
    }
    case 'compra-entrada': return abrirEntrada(linhas('compras').find((c) => c.ID === d.id));
    case 'projeto-fila':
      E.filtros.fila = { busca: '', status: '', prio: '', projeto: d.id, concluidas: true };
      pref.gravar('filtros', E.filtros);
      return irPara('fila');
    case 'projeto-arquivos':
      E.filtros.arquivos = { busca: '', projeto: d.id, ext: '', fila: '' };
      pref.gravar('filtros', E.filtros);
      return irPara('arquivos');
    case 'recarregar-arquivos':
      await carregarArquivos(); render(); return aviso(`${E.arquivos.length} arquivos encontrados.`);
    case 'consumo-mais':
      $('#consumo').insertAdjacentHTML('beforeend', linhaConsumo(''));
      return;
    case 'consumo-tirar':
      b.closest('.linha').remove();
      return;
    case 'estimar': return abrirEstimar(acharFila(d.id));
    case 'fat-fatiar': return fatiarAgora();
    case 'fat-estimar': return estimarDoFatiamento(d.id);
    case 'kx-imprimir': return abrirImprimirKX(d.id ? acharFila(d.id) : null, d.caminho);
    case 'kx-ligar': return kxAcao('ligar', 'Ligando a ponte…');
    case 'kx-desligar': return kxAcao('desligar', 'Ponte desligada.');
    case 'kx-pausar': return kxAcao('pausar', 'Pausando…');
    case 'kx-continuar': return kxAcao('continuar', 'Continuando…');
    case 'kx-cancelar':
      if (!confirm('Cancelar a impressão na Kobra X? Não dá para continuar depois.')) return;
      return kxAcao('cancelar', 'Cancelando…');
    case 'kx-registrar-fim': return registrarFimKX();
    case 'kx-mais': return abrirMaisKX();
    case 'kx-diagnostico': return salvarDiagnosticoKX();
    case '1dia':
      try { IMP.estado = await api('/api/impressora/primeiro-dia', { passo: d.passo, valor: d.valor === '1' ? true : d.valor }); } catch (e) { aviso(e.message, true); }
      return desenharPrimeiroDia();
    case '1dia-planob': return abrirModal({ titulo: 'Plano B: Anycubic Slicer Next', sub: 'Se a ponte não funcionar de primeira (decisão de 22/11)', corpo: PLANO_B_1DIA });
    case 'abrir-fatiador': return abrirNoFatiador(d.caminho);
    case 'escolher-fatiador': return escolherFatiador(d.caminho);
    case 'abrir-em': fecharModal(); return abrirNoFatiador(d.caminho, d.programa);
    case 'fat-orca': try { const r = await api('/api/fatiador/orca', { caminho: d.caminho || '' }); aviso(`Abrindo no ${r.programa || 'fatiador'}…`); } catch (e) { aviso(e.message, true); } return;
    case 'fatiar-arquivo':
      FAT.form = { ...FAT.form, caminho: d.caminho, peca: d.id !== undefined ? d.id : undefined, modo: undefined };
      pref.gravar('fatiador', { ...FAT.form, peca: undefined });
      return irPara('fatiador');
    case 'est-mais':
      $('#est-cores').insertAdjacentHTML('beforeend', E.linhaCorEst('', ''));
      return;
    case 'etiquetas': return abrirEtiquetas();
    case 'celular': return abrirCelular();
    case 'pesq-buscar': return pesquisar();
    case 'pesq-chaves': return abrirChavesPesquisa();
    case 'pesq-verificar': return verificarSitePesquisa(d.site);
    case 'pesq-salvar': return salvarResultadoPesquisa(+d.i);
    case 'pesq-sugestao':
      $('#pesq-termo').value = d.termo;
      return pesquisar();
    case 'material-novo': return abrirFormulario('material', null, null, { Projeto: d.id });
    case 'material-comprar': return comprarMaterial(+d.indice);
    case 'origem': return abrirOrigem(d.caminho);
    case 'ref-nova': return abrirReferencia();
    case 'ref-editar': return abrirReferencia(linhas('referencias').find((r) => r.ID === d.id));
    case 'ref-baixar': {
      const ref = linhas('referencias').find((x) => x.ID === d.id);
      return ref && abrirBaixar({ referencia: ref.ID, link: ref.Link, titulo: ref['Título'], autor: ref.Autor, site: ref.Site,
        projeto: (ref.Projeto || '').split(' ')[0] });
    }
    case 'pesq-baixar': {
      const it = (P.lista || [])[+d.i];
      if (!it) return;
      const ref = refDoLink(it.link);
      return abrirBaixar({ link: it.link, titulo: it.titulo, autor: it.autor, site: it.nome_site, referencia: ref ? ref.ID : undefined,
        projeto: ref ? (ref.Projeto || '').split(' ')[0] : '' });
    }
    case 'licencas': return abrirLicencas();
    case 'lic-salvar': return salvarLicencaLinha(b.closest('.lic-linha'));
    case 'lic-procurar': return procurarLicencaLinha(b.closest('.lic-linha'));
    case 'lic-pagina': return lerLicencaNaPagina(b.closest('.lic-linha'));
    case 'lic-lote': return conferirLicencasLote();
    case 'lic-lote-parar': return pararLicencasLote();
    case 'lic-lote-salvar': return salvarLicencasLote();
    case 'ref-fila': return abrirRefParaFila(linhas('referencias').find((r) => r.ID === d.id));
    case 'ref-buscar': return buscarDadosRef();
    case 'ref-tag-usar': return usarTagSugerida(d.tag);
    case 'ref-revisar-imagens':
      E.semImagemPuladas = new Set();
      return revisarSemImagem();
    case 'ref-usar-imagem':
      E.refImagem = { url: d.url };
      mostrarPreviaRef(d.url);
      $$('.ref-mini').forEach((b) => b.classList.toggle('ativo', b.dataset.url === d.url));
      return;
    case 'ref-escolher-pagina': return escolherNaPagina();
    case 'ref-tag': {
      const t = norm(d.tag), sel = tagsEscolhidas();
      E.filtros.referencias.tag = (sel.includes(t) ? sel.filter((x) => x !== t) : [...sel, t]).join(',');
      pref.gravar('filtros', E.filtros);
      return render();
    }
    case 'ref-tags-limpar':
      E.filtros.referencias.tag = '';
      pref.gravar('filtros', E.filtros);
      return render();
    case 'ref-tags-todas':
      E.tagsTodas = !E.tagsTodas;
      return render();
    case 'espera-ver': return abrirEsperando();
    case 'inicio-alternar':
      return api('/api/inicializacao', { ativo: !!d.ativo })
        .then((r) => { aviso(r.ligado ? 'O Selecta 3D vai ligar junto com o Windows, perto do relógio.' : 'Não liga mais junto com o Windows.'); abrirCelular(); })
        .catch((e) => aviso(e.message, true));
    case 'espera-descartar':
      descartarEsperando(d.tipo, Number(d.n));
      return gravarEspera().then(() => { E.forcarLeitura = false; return carregar(); }).then(() => {
        if (E.esperando.ops.length || E.esperando.falhas.length) abrirEsperando(); else fecharModal();
      });
    case 'clip-permitir': return verificarAreaDeTransferencia(true);
    case 'clip-dispensar':
      pref.gravar('clipDispensado', true);
      return render();
    case 'ref-link':
      if (E.dados.remoto) return window.open(d.url, '_blank', 'noopener');
      return api('/api/link', { url: d.url }).catch((e) => aviso(e.message, true));
    case 'projeto-refs':
      E.filtros.referencias = { ...E.filtros.referencias, busca: '', tipo: '', status: '', site: '', tag: '', projeto: d.id };
      pref.gravar('filtros', E.filtros);
      return irPara('referencias');
    case 'vista':
      E.filtros.arquivos.vista = d.vista;
      pref.gravar('filtros', E.filtros);
      return render();
    default:
  }
});

document.addEventListener('change', async (ev) => {
  const el = ev.target;
  if (el.dataset && el.dataset.acao === 'fila-agrupar') { pref.gravar('filaAgrupar', el.checked); return render(); } // D-c
  if (el.dataset.filtro) return mudarFiltro(el);
  if (el.dataset.fat) {
    FAT.form = { ...FAT.form, [el.dataset.fat]: el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value };
    // outro modelo: as cores mudam, então a escolha de filamento por cor (fil0, fil1…) volta ao automático
    if (el.dataset.fat === 'caminho') { FAT.form.modo = undefined; FAT.form.peca = undefined; for (const k of Object.keys(FAT.form)) if (/^fil\d$/.test(k)) delete FAT.form[k]; }
    pref.gravar('fatiador', { ...FAT.form, peca: undefined });
    return render();
  }
  if (el.id === 'ref-arquivo') return lerImagemRef(el.files[0]);
  if (el.dataset.acao === 'pesq-site') return alternarSitePesquisa(el.dataset.site);
  if (el.id === 'fat-padrao') return definirPadraoFatiador(el.value);
  if (el.id === 'kx-auto') return kxAcao('auto', el.checked ? 'A ponte vai ligar junto com o Selecta 3D.' : 'A ponte não liga mais sozinha.', { ligado: el.checked });
  if (el.id === 'pesq-ordem') { P.ordem = el.value; pref.gravar('pesqOrdem', P.ordem); return desenharResultados(); }
  if (el.name === 'final') { $('#reg-falha').style.display = el.value === 'falhou' ? '' : 'none'; return; }
  if (el.name === 'mov') {
    const pesar = el.value === 'pesei';
    $('#mov-rot-tara').style.display = pesar ? '' : 'none';
    $('#mov-rot-qtd').firstChild.textContent = pesar ? 'Peso na balança (g)' : 'Gramas';
    $('#mov-qtd').placeholder = pesar ? 'rolo + carretel' : 'ex.: 107';
    return;
  }
  const d = el.dataset;
  if (d.acao === 'fila-status') {
    const r = acharFila(d.id);
    const novo = el.value;
    if (FILA_FIM.has(novo)) { el.value = r.Status; return abrirRegistrar(r, novo); }
    return salvar(() => api('/api/fila/atualizar', { id: r.ID, campos: { Status: novo }, antes: { Status: r.Status } }), `${r.ID}: ${novo}.`).catch(() => {});
  }
  const tabelas = {
    'compra-status': ['compras.md', 'Compras', 'compras'],
    'rolo-status': ['estoque.md', 'Filamentos', 'filamentos'],
    'projeto-status': ['projetos.md', 'Projetos', 'projetos'],
    'ref-status': ['referencias.md', 'Referências', 'referencias'],
  };
  if (tabelas[d.acao]) {
    const [arquivo, secao, lista] = tabelas[d.acao];
    const r = linhas(lista).find((x) => x.ID === d.id);
    return salvar(() => api('/api/tabela/atualizar', { arquivo, secao, id: r.ID, campos: { Status: el.value }, antes: { Status: r.Status } }), `${r.ID}: ${el.value}.`).catch(() => {});
  }
});

document.addEventListener('input', (ev) => {
  if (ev.target.dataset.filtro && ev.target.classList.contains('campo-busca')) mudarFiltro(ev.target);
});

function mudarFiltro(el) {
  const [grupo, chave] = el.dataset.filtro.split('.');
  E.filtros[grupo][chave] = el.type === 'checkbox' ? el.checked : el.value;
  pref.gravar('filtros', E.filtros);
  const corpo = $('#corpo-lista');
  if (corpo && el.classList.contains('campo-busca')) {
    corpo.innerHTML = grupo === 'fila' ? listaFila() : grupo === 'referencias' ? listaReferencias() : listaArquivos();
    if (grupo === 'referencias' && $('#tags-refs')) $('#tags-refs').innerHTML = nuvemTags();
    observarMiniaturas();
  } else {
    render();
  }
}

document.addEventListener('keydown', (ev) => {
  if (!modalAberto() && ev.key === 'Enter' && ev.target.id === 'pesq-termo') { ev.preventDefault(); pesquisar(); return; }
  if (!modalAberto()) return;
  if (ev.key === 'Escape') { ev.preventDefault(); fecharModal(); }
  if (ev.key === 'Enter' && ev.target.id === 'ref-link') { ev.preventDefault(); buscarDadosRef(); return; }
  if (ev.key === 'Enter' && ev.target.tagName === 'INPUT' && ev.target.type !== 'checkbox' && ev.target.type !== 'radio' && !ev.target.list) {
    const i = E.modalAcoes.findIndex((a) => a.primario && a.fn);
    if (i >= 0) { ev.preventDefault(); acaoModal(i); }
  }
});


// D-b: cartões recolhíveis do Painel guardam se ficaram abertos (neste aparelho)
document.addEventListener('toggle', (ev) => {
  const d = ev.target;
  if (d && d.dataset && d.dataset.recolher) pref.gravar('aberto_' + d.dataset.recolher, d.open);
}, true);
