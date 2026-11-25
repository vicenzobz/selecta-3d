'use strict';
// Selecta 3D — interface, parte 12 de 22: 12-formularios.js. Os arquivos de ui/js/ são carregados em ordem pelo
// index.html e dividem o mesmo escopo global (scripts comuns, sem compilação). Dividido do antigo ui/app.js em fila-v27 (A17).
// ------------------------------------------------------------------ formulários
const OPC_PRIO = Object.keys(PRIORIDADES);
const FORMS = {
  fila: {
    titulo: 'peça', novo: 'Nova peça', arquivo: 'fila-impressao.md', secao: 'Fila', lista: 'fila',
    campos: [
      { c: 'Peça', inteiro: true },
      { c: 'Arquivo (caminho relativo)', inteiro: true, tipo: 'arquivo', dica: 'Entre crases, a partir da pasta de impressão 3D. Ex.: `PROJETOS/PROJETINHOS/peca.3mf`. Use — se ainda não houver arquivo.' },
      { c: 'Fatiado', inteiro: true, dica: 'Arquivo fatiado (.gcode.3mf) que vai para a impressora. O fatiador do Selecta 3D preenche sozinho ao salvar a estimativa.' },
      { c: 'Filamento/cor', inteiro: true, dica: 'Ex.: azul, branco quente, ciano. As cores viram bolinhas e entram no registro da impressão.' },
      { c: 'Prioridade', tipo: 'select', opcoes: OPC_PRIO, rotulos: PRIORIDADES },
      { c: 'Status', tipo: 'select', opcoes: FILA_STATUS },
      { c: 'Observações', tipo: 'area', inteiro: true, dica: 'Comece com a janela (Em casa / Trabalho / Madrugada) para ela aparecer na lista.' },
    ],
  },
  filamento: {
    titulo: 'rolo', novo: 'Novo rolo', arquivo: 'estoque.md', secao: 'Filamentos', lista: 'filamentos',
    campos: [
      { c: 'Cor' }, { c: 'Hex', tipo: 'cor' },
      { c: 'Material', padrao: 'PLA 1,75 mm' }, { c: 'Marca' },
      { c: 'Peso (g)', tipo: 'numero', padrao: '1000', dica: 'Filamento líquido do rolo novo (rótulo).' }, { c: 'Restante (g)', tipo: 'numero', padrao: '1000' },
      { c: 'Tara (g)', tipo: 'numero', dica: 'Peso do carretel vazio, para pesar na balança.' }, { c: 'Preço (R$)', dica: 'Quanto custou o rolo. Ex.: 89,90' },
      { c: 'Local' }, { c: 'Status', tipo: 'select', opcoes: ROLO_STATUS },
      { c: 'Observações', tipo: 'area', inteiro: true },
    ],
  },
  insumo: {
    titulo: 'insumo', novo: 'Novo insumo', arquivo: 'estoque.md', secao: 'Insumos e peças', lista: 'insumos',
    campos: [
      { c: 'Item', inteiro: true }, { c: 'Categoria', dica: 'Ex.: armazenamento, ferramenta, peça da impressora, rabeca' },
      { c: 'Local' }, { c: 'Quantidade', tipo: 'numero' }, { c: 'Unidade', padrao: 'un' },
      { c: 'Mínimo', tipo: 'numero', dica: 'Avisa quando a quantidade chegar nele.' },
      { c: 'Observações', tipo: 'area', inteiro: true },
    ],
  },
  compra: {
    titulo: 'compra', novo: 'Nova compra', arquivo: 'compras.md', secao: 'Compras', lista: 'compras',
    campos: [
      { c: 'Item', inteiro: true }, { c: 'Data', dica: 'AAAA-MM-DD' }, { c: 'Loja' },
      { c: 'Link', inteiro: true, dica: 'Página do produto (a extensão do navegador preenche).' },
      { c: 'Valor (R$)', dica: 'Ex.: 2.706,99' }, { c: 'Pagamento', dica: 'Ex.: cartão, 9x de 300,77' },
      { c: 'Status', tipo: 'select', opcoes: COMPRA_STATUS }, { c: 'Chegada prevista', dica: 'AAAA-MM-DD' },
      { c: 'Projeto', tipo: 'projetos', inteiro: true },
      { c: 'Observações', tipo: 'area', inteiro: true, dica: 'Sem número de pedido completo, rastreio, endereço ou dados do cartão.' },
    ],
  },
  prazo: {
    titulo: 'prazo', novo: 'Novo prazo', arquivo: 'compras.md', secao: 'Prazos', lista: 'prazos', semId: true,
    campos: [
      { c: 'Data', dica: 'AAAA-MM-DD' }, { c: 'Compra', tipo: 'compra' },
      { c: 'O que vence', tipo: 'area', inteiro: true },
    ],
  },
  projeto: {
    titulo: 'projeto', novo: 'Novo projeto', arquivo: 'projetos.md', secao: 'Projetos', lista: 'projetos',
    campos: [
      { c: 'Projeto', inteiro: true }, { c: 'Pasta', tipo: 'pasta', dica: 'Pasta do projeto a partir da raiz, entre crases. Ex.: `PROJETOS/PLACAS-CASAMENTO`' },
      { c: 'Status', tipo: 'select', opcoes: PROJ_STATUS }, { c: 'Prazo', dica: 'AAAA-MM-DD ou texto (ex.: 2027)' },
      { c: 'Fila (IDs extras)', dica: 'Peças da fila sem arquivo na pasta. Ex.: F03, F28–F31' },
      { c: 'Descrição', tipo: 'area', inteiro: true }, { c: 'Observações', tipo: 'area', inteiro: true },
    ],
  },
};

Object.assign(FORMS, {
  material: {
    titulo: 'material', novo: 'Novo material', arquivo: 'projetos.md', secao: 'Materiais', lista: 'materiais', semId: true,
    campos: [
      { c: 'Projeto', tipo: 'projeto1' }, { c: 'Item' },
      { c: 'Quantidade', tipo: 'numero', padrao: '1' }, { c: 'Unidade', padrao: 'un' },
      { c: 'Estoque', tipo: 'insumo', dica: 'Insumo do estoque que atende este item (quando existir).' },
      { c: 'Compra', tipo: 'compra', dica: 'Compra que vai trazer este item.' },
      { c: 'Observações', tipo: 'area', inteiro: true },
    ],
  },
  origem: {
    titulo: 'origem', novo: 'Origem do modelo', arquivo: 'modelos.md', secao: 'Origem dos modelos', lista: 'modelos', semId: true,
    campos: [
      { c: 'Caminho', inteiro: true, dica: 'Arquivo ou pasta, entre crases. Uma pasta vale para tudo dentro dela.' },
      { c: 'Origem', dica: 'Site e nome do modelo, ou "Próprio"' }, { c: 'Autor' },
      { c: 'Licença', dica: 'Ex.: CC BY-SA 4.0, CC BY-NC 4.0, própria, ?' },
      { c: 'Observações', tipo: 'area', inteiro: true },
    ],
  },
  impressao: {
    titulo: 'impressão', novo: 'Nova impressão', arquivo: 'impressoes.md', secao: 'Impressões', lista: 'impressoes', semId: true,
    campos: [
      { c: 'Data' }, { c: 'Peça' }, { c: 'Resultado', tipo: 'select', opcoes: ['concluído', 'falhou'] },
      { c: 'Tempo estimado' }, { c: 'Tempo real' }, { c: 'Gramas', tipo: 'numero' }, { c: 'Custo (R$)' },
      { c: 'Rolos', inteiro: true }, { c: 'Motivo da falha', inteiro: true }, { c: 'Observações', tipo: 'area', inteiro: true },
    ],
  },
});

function campoHtml(def, valor, i) {
  const id = `campo-${i}`;
  const v = valor ?? '';
  let entrada;
  switch (def.tipo) {
    case 'area':
      entrada = `<textarea id="${id}" data-col="${esc(def.c)}">${esc(v)}</textarea>`; break;
    case 'select': {
      const ops = def.opcoes.includes(v) || !v ? def.opcoes : [v, ...def.opcoes];
      entrada = `<select id="${id}" data-col="${esc(def.c)}">${ops.map((o) => `<option value="${esc(o)}" ${o === v ? 'selected' : ''}>${esc(def.rotulos && def.rotulos[o] ? `${o} · ${def.rotulos[o]}` : o)}</option>`).join('')}</select>`;
      break;
    }
    case 'cor':
      entrada = `<input id="${id}" type="color" data-col="${esc(def.c)}" value="${/^#[0-9a-f]{6}$/i.test(v) ? esc(v) : '#9fe870'}">`; break;
    case 'numero':
      entrada = `<input id="${id}" inputmode="decimal" data-col="${esc(def.c)}" value="${esc(v)}">`; break;
    case 'arquivo':
      entrada = `<input id="${id}" list="lista-arquivos" data-col="${esc(def.c)}" value="${esc(v)}">
        <datalist id="lista-arquivos">${(E.arquivos || []).map((a) => `<option value="\`${esc(a.caminho)}\`"></option>`).join('')}</datalist>`; break;
    case 'pasta': {
      const pastas = [...new Set((E.arquivos || []).map((a) => a.caminho.split('/')[0]).filter((p) => !p.includes('.')))];
      entrada = `<input id="${id}" list="lista-pastas" data-col="${esc(def.c)}" value="${esc(v)}">
        <datalist id="lista-pastas">${pastas.map((p) => `<option value="\`${esc(p)}\`"></option>`).join('')}</datalist>`; break;
    }
    case 'compra':
      entrada = `<select id="${id}" data-col="${esc(def.c)}"><option value="">—</option>${linhas('compras').map((c) => `<option value="${esc(c.ID)}" ${c.ID === v ? 'selected' : ''}>${esc(c.ID)} · ${esc(c.Item.slice(0, 50))}</option>`).join('')}</select>`; break;
    case 'projeto1':
      entrada = `<select id="${id}" data-col="${esc(def.c)}">${linhas('projetos').map((p) => `<option value="${esc(p.ID)}" ${p.ID === v ? 'selected' : ''}>${esc(p.ID)} · ${esc(p.Projeto)}</option>`).join('')}</select>`; break;
    case 'insumo':
      entrada = `<select id="${id}" data-col="${esc(def.c)}"><option value="">—</option>${linhas('insumos').map((x) => `<option value="${esc(x.ID)}" ${x.ID === v ? 'selected' : ''}>${esc(x.ID)} · ${esc(x.Item.slice(0, 50))} (${esc(x.Quantidade)} ${esc(x.Unidade)})</option>`).join('')}</select>`; break;
    case 'projetos': {
      const marcados = new Set(String(v).split(/[\s,]+/).filter(Boolean));
      entrada = `<div class="escolha" data-col="${esc(def.c)}" data-tipo="projetos">${linhas('projetos').map((p) => `<label><input type="checkbox" value="${esc(p.ID)}" ${marcados.has(p.ID) ? 'checked' : ''}>${esc(p.ID)} · ${esc(p.Projeto)}</label>`).join('')}</div>`; break;
    }
    default:
      entrada = `<input id="${id}" data-col="${esc(def.c)}" value="${esc(v)}">`;
  }
  return `<label class="${def.inteiro ? 'inteiro' : ''}">${esc(def.c)}${entrada}${def.dica ? `<span class="dica">${esc(def.dica)}</span>` : ''}</label>`;
}

function lerFormulario(raiz) {
  const res = {};
  for (const el of $$('[data-col]', raiz)) {
    const col = el.dataset.col;
    if (el.dataset.tipo === 'projetos') {
      res[col] = $$('input:checked', el).map((i) => i.value).join(' ');
    } else if (el.type === 'color') {
      res[col] = el.value.toUpperCase();
    } else {
      res[col] = el.value.trim();
    }
  }
  return res;
}

function semInternos(r) {
  const o = {};
  for (const [k, v] of Object.entries(r)) if (!k.startsWith('_')) o[k] = v;
  return o;
}

function abrirFormulario(tipo, registro, indice, preset) {
  const F = FORMS[tipo];
  const novo = !registro;
  const valores = registro || { ...Object.fromEntries(F.campos.map((d) => [d.c, d.padrao ?? (d.tipo === 'select' ? d.opcoes[0] : '')])), ...(preset || {}) };
  if (novo && tipo === 'fila') { valores.Prioridade = '4'; valores.Status = 'aguardando modelo'; valores['Arquivo (caminho relativo)'] = ''; }
  if (novo && (tipo === 'compra')) { valores.Data = E.dados.hoje; valores.Status = 'a comprar'; }
  if (novo && tipo === 'projeto') valores.Status = 'ativo';
  if (novo && tipo === 'prazo') valores.Data = E.dados.hoje;
  if ((tipo === 'fila' || tipo === 'projeto') && !E.arquivos) carregarArquivos();

  const corpo = `<div class="formulario">${F.campos.map((d, i) => campoHtml(d, valores[d.c], i)).join('')}</div>`;
  abrirModal({
    titulo: novo ? F.novo : (registro.ID || `Editar ${F.titulo}`),
    sub: novo ? `Vai para o fim da tabela em ${F.arquivo}${F.semId ? '' : ', com o próximo ID livre'}.`
      : `Editando ${F.titulo} em ${F.arquivo}. Só os campos que você mudar são gravados.`,
    corpo,
    acoes: [
      { rotulo: 'Cancelar' },
      {
        rotulo: novo ? 'Adicionar' : 'Salvar', primario: true,
        fn: async () => {
          const lidos = lerFormulario($('#modal'));
          if (tipo === 'fila') {
            const a = lidos['Arquivo (caminho relativo)'];
            if (a && a !== '—' && !a.includes('`')) lidos['Arquivo (caminho relativo)'] = '`' + a + '`';
            const fz = (lidos.Fatiado || '').trim();
            if (fz && fz !== '—' && !fz.includes('`')) lidos.Fatiado = '`' + fz + '`';
            if (!(E.dados.fila.colunas || []).includes('Fatiado')) delete lidos.Fatiado;
          }
          if (tipo === 'projeto' && lidos.Pasta && !lidos.Pasta.includes('`')) lidos.Pasta = '`' + lidos.Pasta + '`';
          if (tipo === 'origem' && lidos.Caminho && !lidos.Caminho.includes('`')) lidos.Caminho = '`' + lidos.Caminho.replace(/\/+$/, '') + '`';
          if (novo) {
            if (tipo === 'fila') {
              const r = await salvar(() => api('/api/fila/adicionar', { campos: lidos }));
              aviso(`${r.id} adicionada no fim da fila.`);
            } else {
              const r = await salvar(() => api('/api/tabela/adicionar', { arquivo: F.arquivo, secao: F.secao, campos: lidos }));
              aviso(r.id ? `${r.id} adicionado.` : 'Adicionado.');
            }
            return true;
          }
          const campos = {}, antes = {};
          for (const [k, v] of Object.entries(lidos)) {
            if ((registro[k] ?? '') !== v) { campos[k] = v; antes[k] = registro[k] ?? ''; }
          }
          if (!Object.keys(campos).length) return true;
          if (tipo === 'fila') {
            await salvar(() => api('/api/fila/atualizar', { id: registro.ID, campos, antes }), `${registro.ID} salva.`);
          } else if (F.semId) {
            await salvar(() => api('/api/tabela/atualizar', { arquivo: F.arquivo, secao: F.secao, indice, campos, antes: semInternos(registro) }), 'Salvo.');
          } else {
            await salvar(() => api('/api/tabela/atualizar', { arquivo: F.arquivo, secao: F.secao, id: registro.ID, campos, antes }), `${registro.ID} salvo.`);
          }
          return true;
        },
      },
    ],
  });
}

