// Selecta 3D — service worker do app do celular.
// Sempre tenta o PC primeiro; se o PC não responder, mostra a última cópia guardada
// (só para consultar). Gravações (POST) não passam por aqui: vão direto ao PC ou, sem o PC,
// a própria tela guarda e manda depois. A exceção é o "Compartilhar" do Android (POST /compartilhar).
const CACHE = 'org3d-v7'; // v7: Selecta 3D, visual novo e fontes novas (princ-v02), 2026-11-23
const CACHE_COMPARTILHADO = 'org3d-compartilhado';
const ESPERA_MS = 6000;
const CASCA = ['/index.html', '/estilo.css', '/js/01-base.js', '/js/02-render.js', '/js/03-painel.js', '/js/04-fila.js', '/js/05-impressoes.js', '/js/06-estoque.js', '/js/07-compras.js', '/js/08-projetos.js', '/js/09-referencias.js', '/js/10-arquivos.js', '/js/11-fatiador.js', '/js/12-formularios.js', '/js/13-dialogos.js', '/js/14-pesquisa.js', '/js/15-kx.js', '/js/16-abrir-fatiador.js', '/js/17-baixar.js', '/js/18-cores.js', '/js/19-miniaturas.js', '/js/20-modal.js', '/js/21-eventos.js', '/js/22-inicio.js', '/visualizador.js', '/vendor/qrcode/qrcode.js',
  '/icone-192.png', '/icone.svg', '/favicon-32.png',
  '/vendor/fontes/bowlby-one-latin-400-normal.woff2', '/vendor/fontes/archivo-latin-wght-normal.woff2', '/vendor/fontes/archivo-narrow-latin-700-normal.woff2', '/vendor/fontes/jetbrains-mono-latin-wght-normal.woff2'];
const API_GUARDAR = ['/api/tudo', '/api/versao', '/api/imagem', '/api/miniatura'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(CASCA.map((u) => c.add(u).catch(() => null)))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE && k !== CACHE_COMPARTILHADO) await caches.delete(k);
    await self.clients.claim();
  })());
});

function comPrazo(req) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ESPERA_MS);
  // um pedido de navegação não pode ser copiado com opções; refaz pelo endereço
  const alvo = req.mode === 'navigate' ? new Request(req.url, { credentials: 'same-origin' }) : req;
  return fetch(alvo, { signal: ctl.signal }).finally(() => clearTimeout(t));
}

// recebe uma cópia feita antes de a resposta ir para a tela (depois o corpo já foi lido)
async function guardar(chave, copia, api) {
  const c = await caches.open(CACHE);
  if (!api) { await c.put(chave, copia); return; }
  const cab = new Headers(copia.headers);
  cab.set('X-Org3d-Guardado', String(Date.now()));
  await c.put(chave, new Response(await copia.blob(), { status: 200, headers: cab }));
}

// "Compartilhar" de outro app (link, texto ou imagem): guarda e abre a tela, que pergunta o destino
async function receberCompartilhado(req) {
  try {
    const f = await req.formData();
    const c = await caches.open(CACHE_COMPARTILHADO);
    const dados = { titulo: f.get('titulo') || '', texto: f.get('texto') || '', link: f.get('link') || '', quando: Date.now() };
    await c.put('/compartilhado/dados', new Response(JSON.stringify(dados), { headers: { 'Content-Type': 'application/json' } }));
    const img = f.get('imagem');
    if (img && img.size) await c.put('/compartilhado/imagem', new Response(img, { headers: { 'Content-Type': img.type || 'image/jpeg' } }));
    else await c.delete('/compartilhado/imagem');
  } catch (e) { /* chega sem nada: a tela abre normal */ }
  return Response.redirect('/?compartilhado=1', 303);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method === 'POST' && url.origin === location.origin && url.pathname === '/compartilhar') {
    e.respondWith(receberCompartilhado(req));
    return;
  }
  if (req.method !== 'GET') return;
  if (url.origin !== location.origin || url.pathname === '/manifest.webmanifest') return;
  const api = url.pathname.startsWith('/api/');
  if (api && !API_GUARDAR.includes(url.pathname)) return;
  const navegacao = req.mode === 'navigate';
  const chave = navegacao ? '/index.html' : (api ? req.url : url.pathname);

  e.respondWith((async () => {
    try {
      const resp = await comPrazo(req);
      if (resp.status >= 500) throw new Error('PC fora do ar: ' + resp.status);
      if (resp.status === 200) e.waitUntil(guardar(chave, resp.clone(), api).catch(() => null));
      return resp;
    } catch (erro) {
      const guardada = await caches.match(chave);
      if (guardada) return guardada;
      if (navegacao) {
        return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
          + '<body style="background:#15110c;color:#f2e6c9;font:16px system-ui;padding:32px">'
          + '<h2>Sem conexão com o PC</h2><p>Ligue o PC e abra o Selecta 3D (com o acesso pelo celular ligado). '
          + 'Confira também se o Tailscale está ligado no celular.</p></body>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
      throw erro;
    }
  })());
});
