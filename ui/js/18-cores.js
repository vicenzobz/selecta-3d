'use strict';
// Selecta 3D — interface, parte 18 de 22: 18-cores.js. Os arquivos de ui/js/ são carregados em ordem pelo
// index.html e dividem o mesmo escopo global (scripts comuns, sem compilação). Dividido do antigo ui/app.js em fila-v27 (A17).
// ------------------------------------------------------------------ CELULAR E EXTENSÃO
// O programa tem um visual só desde princ-v02 (os temas "Reggae" e "Verde pinho" e o botão Cores saíram, a pedido do usuário).
try { localStorage.removeItem('org3d.tema'); } catch { /* sem armazenamento */ }

async function abrirCelular() {
  let cel, inicio = null;
  try { cel = await api('/api/celular'); } catch (e) { aviso(e.message, true); return; }
  try { inicio = await api('/api/inicializacao'); } catch { /* versão sem segundo plano */ }
  const qr = (texto) => {
    if (!window.qrcode) return '';
    const q = window.qrcode(0, 'M'); q.addData(texto); q.make();
    return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  };
  const ts = cel.tailscale || {};
  const casa = cel.enderecos[0];
  const copiar = (id, texto) => `<button class="botao pequeno" data-copiar="${esc(texto)}" id="${id}">Copiar</button>`;
  let blocoTs = '';
  if (cel.ativo && ts.endereco) {
    blocoTs = `<div class="celular-qr"><div class="qr-caixa">${qr(ts.endereco)}</div>
      <div><p class="celular-titulo">App do celular · de qualquer lugar</p>
      <p>Com o Tailscale ligado no celular, aponte a câmera para o QR e abra no Chrome. Depois toque em <b>⋮ → Instalar app</b> (ou "Adicionar à tela inicial"): o ícone do Selecta 3D fica na tela do celular.</p>
      <p><code style="word-break:break-all">${esc(ts.endereco)}</code> ${copiar('cop-ts', ts.endereco)}</p></div></div>`;
  } else if (cel.ativo && ts.instalado) {
    blocoTs = `<div class="faixa-aviso" style="margin-bottom:16px"><b>Fora de casa (Tailscale):</b> ${ts.conectado === false ? 'o Tailscale deste PC está desligado; ligue-o.' : `falta ativar o endereço seguro, uma vez só. No PC, rode <code>tailscale serve --bg ${esc(cel.porta)}</code> e abra o link que ele mostrar para ativar o HTTPS na sua conta.`}</div>`;
  } else if (cel.ativo) {
    blocoTs = '<div class="faixa-aviso" style="margin-bottom:16px">Para usar fora de casa e instalar como app, instale o Tailscale no PC e no celular (veja o LEIA-ME).</div>';
  }
  const blocoCasa = cel.ativo && casa ? (ts.endereco
    ? `<p class="fraco">Na rede de casa, sem Tailscale: <code style="word-break:break-all">${esc(casa)}</code></p>`
    : `<div class="celular-qr"><div class="qr-caixa">${qr(casa)}</div>
        <div><p class="celular-titulo">Na rede de casa</p><p>Aponte a câmera do celular para o QR, ou digite no navegador do celular:</p><p><code style="word-break:break-all">${esc(casa)}</code></p>
        ${cel.enderecos.length > 1 ? `<p class="fraco">Outros endereços deste PC: ${cel.enderecos.slice(1).map((e) => `<code>${esc(e.split('/?')[0])}</code>`).join(' ')}</p>` : ''}</div></div>`) : '';
  const blocoExt = cel.ativo ? `<p class="celular-titulo" style="margin-top:18px">Extensão do navegador (Brave)</p>
      <p>Cole este endereço na extensão "Selecta 3D", na primeira vez: <code style="word-break:break-all">${esc(cel.extensao)}</code> ${copiar('cop-ext', cel.extensao)}</p>` : '';
  abrirModal({
    titulo: 'Celular e extensão',
    sub: cel.ativo ? 'Ligado: o app do celular e a extensão do navegador conversam com este programa.' : 'Desligado: o programa só abre neste PC (sem app do celular nem extensão).',
    corpo: `
      ${cel.erro ? `<div class="faixa-aviso" style="margin-bottom:16px">${esc(cel.erro)}</div>` : ''}
      ${blocoTs}${blocoCasa}${blocoExt}
      ${inicio ? `<div class="linha-inicio"><span><b>Ligar junto com o Windows</b> (em segundo plano, só o ícone perto do relógio): ${inicio.ligado ? 'ligado' : 'desligado'}.</span>
        <button class="botao pequeno ${inicio.ligado ? '' : 'primario'}" data-acao="inicio-alternar" data-ativo="${inicio.ligado ? '' : '1'}">${inicio.ligado ? 'Desligar' : 'Ligar'}</button></div>` : ''}
      <ul class="lista-notas">
        <li>Funciona enquanto o programa estiver rodando no PC. Fechar a janela não fecha o programa: ele fica perto do relógio. Para fechar de vez: botão direito no ícone → Sair do Selecta 3D.</li>
        <li>Sem o PC, o app do celular mostra a última cópia dos dados; o que você mudar fica guardado no celular e vai quando o PC voltar.</li>
        <li>Na primeira vez, o Windows pergunta sobre o firewall: permita <b>só em redes privadas</b>.</li>
        <li>Quem tiver o QR (ou o endereço com o código <code>t=</code>) consegue ver e mudar os dados. Não compartilhe.</li>
        <li>Pelo celular não dá para abrir arquivos no PC nem ligar ou desligar este acesso.</li>
        <li>As etiquetas com QR dos rolos usam o endereço da rede de casa.</li>
      </ul>`,
    acoes: [
      { rotulo: 'Fechar' },
      {
        rotulo: cel.ativo ? 'Desligar' : 'Ligar celular e extensão', primario: !cel.ativo,
        fn: async () => {
          try {
            await api('/api/celular', { ativo: !cel.ativo });
          } catch (e) { aviso(e.message, true); return false; }
          setTimeout(abrirCelular, 50);
          return true;
        },
      },
    ],
  });
}

async function comprarMaterial(indice) {
  const m = linhas('materiais')[indice];
  if (!m) return;
  E.salvando = true;
  try {
    const { id } = await api('/api/tabela/adicionar', { arquivo: 'compras.md', secao: 'Compras', campos: {
      Data: E.dados.hoje, Item: `${m.Quantidade} ${m.Unidade} ${m.Item}`.trim(), Status: 'a comprar', Projeto: m.Projeto,
      'Observações': `Criada a partir dos materiais do ${m.Projeto}.` } });
    await api('/api/tabela/atualizar', { arquivo: 'projetos.md', secao: 'Materiais', indice, campos: { Compra: id }, antes: semInternos(m) });
    aviso(`${id} criada em Compras como "a comprar".`);
  } catch (e) {
    aviso(e.message, true);
  } finally {
    E.salvando = false;
    await carregar();
  }
}

function abrirOrigem(caminho) {
  const o = origemDe(caminho);
  if (o) return abrirFormulario('origem', linhas('modelos')[o._i], o._i);
  const pasta = caminho.includes('/') ? caminho.slice(0, caminho.lastIndexOf('/')) : caminho;
  return abrirFormulario('origem', null, null, { Caminho: '`' + pasta + '`' });
}

