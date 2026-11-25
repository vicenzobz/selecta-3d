"""Pesquisa de modelos nos sites das referências.

Dois jeitos de buscar, um por site:
- "api": a busca oficial do site para programas (Thingiverse, MyMiniFactory, Cults3D). Precisa de uma
  chave gratuita que o usuário cria no site e cola no programa; a chave fica em config.json, fora da pasta.
- "janela": sites sem busca oficial (MakerWorld, Printables, Thangs). O programa abre a página de busca
  do site numa janela escondida (pywebview, o mesmo motor da janela do programa), espera os resultados
  aparecerem e lê o que a página mostra. Se o site pedir uma verificação de "não sou robô", a busca para
  e a tela oferece abrir a janela para o próprio usuário fazer a verificação (os cookies ficam guardados).

Cada busca roda numa linha de execução própria: a tela pede, recebe uma chave e pergunta o estado
de tempos em tempos (assim o app do celular não estoura o tempo de espera).
"""
import base64
import json
import logging
import math
import re
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from .dados import CABECALHOS_WEB, ErroDados

log = logging.getLogger("organizador")

# ---------------------------------------------------------------- sites
# "dominios": como reconhecer o site nos links de referencias.md (a tela usa para saber quais estão lá)
SITES_BUSCA = {
    "makerworld": {
        "nome": "MakerWorld", "modo": "janela", "dominios": ["makerworld.com"],
        "pagina": "https://makerworld.com/en/search/models?keyword={q}",
        "modelo": r"makerworld\.com/(?:[a-z]{2}(?:-[a-z]{2})?/)?models/(\d+)",
        "link": "https://makerworld.com/en/models/{id}",
        "midia": "",
    },
    "printables": {
        "nome": "Printables", "modo": "janela", "dominios": ["printables.com"],
        "pagina": "https://www.printables.com/search/models?q={q}",
        "modelo": r"printables\.com/(?:[a-z]{2}/)?model/(\d+)",
        "link": "https://www.printables.com/model/{id}",
        "midia": "https://media.printables.com/",
    },
    "thangs": {
        "nome": "Thangs", "modo": "janela", "dominios": ["thangs.com"],
        "pagina": "https://thangs.com/search/{q}?scope=all",
        "modelo": r"thangs\.com/(?:.*?/)?(?:m/|3d-model/.*?-)(\d{3,})",
        "link": "https://thangs.com/m/{id}",
        "midia": "",
    },
    "thingiverse": {
        "nome": "Thingiverse", "modo": "api", "dominios": ["thingiverse.com"],
        "chaves": ["thingiverse_token"],
        "pagina": "https://www.thingiverse.com/search?q={q}&type=things&sort=popular",
        "como": "Em thingiverse.com/developers, crie um app (\"Create an App\" → Web App) e copie o App Token.",
    },
    "myminifactory": {
        "nome": "MyMiniFactory", "modo": "api", "dominios": ["myminifactory.com"],
        "chaves": ["mmf_chave"],
        "pagina": "https://www.myminifactory.com/search?query={q}",
        "como": "Em myminifactory.com/settings/developer, crie uma aplicação e copie a API Key.",
    },
    "cults": {
        "nome": "Cults3D", "modo": "api", "dominios": ["cults3d.com"],
        "chaves": ["cults_usuario", "cults_chave"],
        "pagina": "https://cults3d.com/en/search?q={q}",
        "como": "Em cults3d.com/en/api/keys, gere uma chave. Use o seu nome de usuário do Cults junto com ela.",
    },
}
CHAVES = ["thingiverse_token", "mmf_chave", "cults_usuario", "cults_chave"]
POR_SITE = 30
VALIDADE_CACHE = 30 * 60
ESPERA_JANELA = 25  # segundos para a página de busca mostrar os resultados


def nota_comunidade(item):
    """Uma nota só para comparar sites diferentes: escala logarítmica, curtidas e impressões pesam mais."""
    pesos = {"curtidas": 1.0, "impressoes": 0.9, "downloads": 0.45, "colecoes": 0.35}
    soma, tem = 0.0, False
    for chave, peso in pesos.items():
        v = item.get(chave)
        if isinstance(v, (int, float)) and v >= 0:
            soma += peso * math.log1p(v)
            tem = True
    return round(soma, 2) if tem else None


def _num(v):
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, (int, float)):
        return v
    m = re.fullmatch(r"\s*([\d.,]+)\s*([kKmM])?\s*", str(v))
    if not m:
        return None
    try:
        base = float(m.group(1).replace(",", ".") if m.group(2) else m.group(1).replace(".", "").replace(",", ""))
    except ValueError:
        return None
    return base * (1000 if (m.group(2) or "").lower() == "k" else 1_000_000 if m.group(2) else 1)


def _pegar(d, *chaves):
    for c in chaves:
        cur = d
        for parte in c.split("."):
            if isinstance(cur, list):
                cur = cur[0] if cur else None
            cur = cur.get(parte) if isinstance(cur, dict) else None
        if cur not in (None, "", []):
            return cur
    return None


def normalizar(site, bruto, posicao):
    """Item no formato da tela, com a nota calculada."""
    item = {
        "site": site, "nome_site": SITES_BUSCA[site]["nome"],
        "titulo": str(bruto.get("titulo") or "").strip()[:200],
        "link": str(bruto.get("link") or ""),
        "imagem": str(bruto.get("imagem") or ""),
        "autor": str(bruto.get("autor") or "").strip()[:80],
        "posicao": posicao,
    }
    for c in ("curtidas", "downloads", "impressoes", "colecoes"):
        v = _num(bruto.get(c))
        item[c] = int(v) if v is not None else None
    item["nota"] = nota_comunidade(item)
    return item


# ---------------------------------------------------------------- buscas oficiais
def _json_web(url, cab=None, dados=None, prazo=15):
    cabec = {**CABECALHOS_WEB, "Accept": "application/json", **(cab or {})}
    corpo = None
    if dados is not None:
        corpo = json.dumps(dados).encode("utf-8")
        cabec["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=corpo, headers=cabec)
    try:
        with urllib.request.urlopen(req, timeout=prazo) as r:
            return json.loads(r.read(5_000_000).decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            raise ErroDados("o site recusou a chave (confira se colou a chave certa)")
        raise ErroDados(f"o site respondeu com erro {e.code}")
    except (urllib.error.URLError, OSError, ValueError) as e:
        raise ErroDados(f"não consegui falar com o site ({getattr(e, 'reason', '') or e})")


def buscar_thingiverse(termo, chaves):
    q = urllib.parse.quote(termo, safe="")
    j = _json_web(f"https://api.thingiverse.com/search/{q}?type=things&per_page={POR_SITE}&sort=popular",
                  {"Authorization": "Bearer " + chaves["thingiverse_token"]})
    hits = j.get("hits") if isinstance(j, dict) else j
    saida = []
    for h in hits or []:
        if not isinstance(h, dict):
            continue
        saida.append({
            "titulo": h.get("name"),
            "link": h.get("public_url") or (f"https://www.thingiverse.com/thing:{h['id']}" if h.get("id") else ""),
            "imagem": _pegar(h, "preview_image", "thumbnail", "default_image.url"),
            "autor": _pegar(h, "creator.name", "creator.first_name"),
            "curtidas": _pegar(h, "like_count", "likes_count"),
            "colecoes": _pegar(h, "collect_count"),
            "impressoes": _pegar(h, "make_count", "makes_count"),
            "downloads": _pegar(h, "download_count"),
        })
    return saida


def buscar_myminifactory(termo, chaves):
    q = urllib.parse.urlencode({"q": termo, "per_page": POR_SITE, "sort": "popularity", "key": chaves["mmf_chave"]})
    j = _json_web(f"https://www.myminifactory.com/api/v2/search?{q}")
    saida = []
    for h in (j.get("items") if isinstance(j, dict) else None) or []:
        if not isinstance(h, dict):
            continue
        saida.append({
            "titulo": h.get("name"),
            "link": h.get("url") or "",
            "imagem": _pegar(h, "images.thumbnail.url", "images.standard.url", "images.original.url"),
            "autor": _pegar(h, "designer.name", "designer.username"),
            "curtidas": _pegar(h, "likes", "like_count"),
            "downloads": _pegar(h, "download_count", "downloads"),
            "impressoes": _pegar(h, "makes", "make_count"),
        })
    return saida


CULTS_CONSULTA = """
query Busca($q: String!, $n: Int!) {
  creationsSearchBatch(query: $q, limit: $n) {
    results { name(locale: EN) url(locale: EN) illustrationImageUrl likesCount downloadsCount creator { nick } }
  }
}"""


def buscar_cults(termo, chaves):
    auth = base64.b64encode(f"{chaves['cults_usuario']}:{chaves['cults_chave']}".encode()).decode()
    j = _json_web("https://cults3d.com/graphql", {"Authorization": "Basic " + auth},
                  {"query": CULTS_CONSULTA, "variables": {"q": termo, "n": POR_SITE}})
    if isinstance(j, dict) and j.get("errors"):
        raise ErroDados("o Cults3D recusou a busca: " + str(j["errors"][0].get("message", ""))[:160])
    saida = []
    for h in _pegar(j, "data.creationsSearchBatch.results") or []:
        saida.append({
            "titulo": h.get("name"), "link": h.get("url") or "", "imagem": h.get("illustrationImageUrl"),
            "autor": _pegar(h, "creator.nick"), "curtidas": h.get("likesCount"), "downloads": h.get("downloadsCount"),
        })
    return saida


BUSCAS_API = {"thingiverse": buscar_thingiverse, "myminifactory": buscar_myminifactory, "cults": buscar_cults}


# ---------------------------------------------------------------- leitura da página (janela escondida)
# Roda dentro da página de busca. Procura os modelos em dois lugares:
# 1. nos dados que a página carregou (JSON embutido, estado do app e respostas de busca capturadas);
# 2. se não achar, nos cartões da tela (links para modelos com imagem).
# Devolve um texto JSON: {verificacao, titulo, itens: [...]}.
JS_GANCHO = r"""
(function () {
  if (window.__org3dGancho) return; window.__org3dGancho = true;
  window.__org3dRespostas = [];
  const guardar = (t) => { try { if (t && t.length < 4e6 && /^[\s]*[\[{]/.test(t)) window.__org3dRespostas.push(JSON.parse(t)); } catch (e) {} };
  const f = window.fetch;
  if (f) window.fetch = function () { return f.apply(this, arguments).then((r) => { try { r.clone().text().then(guardar).catch(() => {}); } catch (e) {} return r; }); };
  const abrir = XMLHttpRequest.prototype.open, enviar = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () { this.addEventListener('load', () => { try { if (!this.responseType || this.responseType === 'text') guardar(this.responseText); } catch (e) {} }); return enviar.apply(this, arguments); };
  XMLHttpRequest.prototype.open = abrir;
})();
"""

JS_EXTRAIR = r"""
(function (cfg) {
  const corpo = (document.body && document.body.innerText || '').slice(0, 3000);
  const verificacao = /just a moment|um momento|verifica(ndo|ção)|attention required|are you (a )?human|captcha|cf-chl|security check/i
    .test(document.title + ' ' + corpo.slice(0, 600)) && !document.querySelector('a[href*="/model"]');
  const reModelo = new RegExp(cfg.modelo, 'i');
  const abs = (u) => {
    if (!u || typeof u !== 'string') return '';
    if (/^https?:\/\//i.test(u)) return u;
    if (u.startsWith('//')) return 'https:' + u;
    if (cfg.midia && !u.startsWith('/')) return cfg.midia + u;
    try { return new URL(u, location.href).href; } catch (e) { return ''; }
  };
  const num = (v) => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') { const m = v.replace(/\s/g, '').match(/^([\d.,]+)([kKmM])?$/); if (m) return v.replace(/\s/g, ''); }
    return null;
  };
  const imgDe = (v) => {
    if (!v) return '';
    if (typeof v === 'string') return /\.(jpe?g|png|webp|gif|avif)|image|img|cdn|media|thumb/i.test(v) ? abs(v) : '';
    if (Array.isArray(v)) return imgDe(v[0]);
    if (typeof v === 'object') return imgDe(v.url || v.filePath || v.src || v.originalUrl || v.original || v.thumbnail || v.large || v.medium);
    return '';
  };
  const CHAVES_IMG = ['cover', 'coverUrl', 'coverImage', 'image', 'images', 'thumbnail', 'thumbnailUrl', 'previewImage',
    'preview_image', 'preview', 'illustrationImageUrl', 'mainImage', 'picture', 'pictures', 'media', 'coverPortrait', 'coverLandscape'];
  const contagens = (o) => {
    const r = {};
    const olhar = (obj) => {
      for (const k of Object.keys(obj)) {
        const v = num(obj[k]); if (v === null) continue;
        const kk = k.toLowerCase();
        if (/liked$|^is|percent|rate$/.test(kk)) continue;
        if (/like|thumbsup|heart/.test(kk) && r.curtidas == null) r.curtidas = v;
        else if (/download/.test(kk) && r.downloads == null) r.downloads = v;
        else if (/(print|make)s?(count|_count)?$|printcount|makecount|makes_count/.test(kk) && r.impressoes == null) r.impressoes = v;
        else if (/collect|favorit|bookmark/.test(kk) && r.colecoes == null) r.colecoes = v;
      }
    };
    olhar(o);
    for (const k of ['stats', 'counts', 'statistics', 'counters', 'metrics', 'designExtension']) if (o[k] && typeof o[k] === 'object') olhar(o[k]);
    return r;
  };
  const itens = [], vistos = new Set();
  const adicionar = (it) => {
    const chave = it.link || it.titulo;
    if (!chave || vistos.has(chave)) return;
    vistos.add(chave); itens.push(it);
  };
  const autorDe = (o) => {
    const a = o.designCreator || o.creator || o.user || o.author || o.designer || o.owner;
    if (!a) return '';
    if (typeof a === 'string') return a;
    return a.name || a.publicUsername || a.handle || a.username || a.nick || a.nickname || '';
  };
  let passos = 0;
  const andar = (o, prof) => {
    if (!o || typeof o !== 'object' || prof > 14 || ++passos > 400000) return;
    if (Array.isArray(o)) { for (const x of o) andar(x, prof + 1); return; }
    const titulo = typeof o.title === 'string' ? o.title : typeof o.name === 'string' ? o.name : '';
    if (titulo && titulo.length > 1 && titulo.length < 220) {
      let img = '';
      for (const k of CHAVES_IMG) { if (o[k]) { img = imgDe(o[k]); if (img) break; } }
      const c = contagens(o);
      if (img && Object.keys(c).length) {
        let link = typeof o.url === 'string' && reModelo.test(abs(o.url)) ? abs(o.url) : '';
        const id = o.id || o.designId || o.modelId || o.thingId;
        if (!link && id != null && /^\d+$/.test(String(id))) link = cfg.link.replace('{id}', id);
        if (link) adicionar({ titulo, link, imagem: img, autor: autorDe(o), ...c });
      }
    }
    for (const k of Object.keys(o)) { const v = o[k]; if (v && typeof v === 'object') andar(v, prof + 1); }
  };
  const fontes = [];
  for (const s of document.querySelectorAll('script[type="application/json"], script#__NEXT_DATA__, script[type="application/ld+json"]')) {
    try { fontes.push(JSON.parse(s.textContent)); } catch (e) {}
  }
  for (const k of ['__NEXT_DATA__', '__APOLLO_STATE__', '__NUXT__', '__INITIAL_STATE__', '__PRELOADED_STATE__', '__remixContext', '__sveltekit_data']) {
    try { if (window[k] && typeof window[k] === 'object') fontes.push(window[k]); } catch (e) {}
  }
  for (const r of (window.__org3dRespostas || [])) fontes.push(r);
  for (const f of fontes) andar(f, 0);

  // cartões da tela (quando os dados não têm as contagens)
  const porLink = new Map();
  for (const a of document.querySelectorAll('a[href]')) {
    const href = abs(a.getAttribute('href'));
    const m = href.match(reModelo);
    if (!m) continue;
    const link = cfg.link.replace('{id}', m[1]);
    let card = a, img = null;
    for (let i = 0; i < 6 && card; i++) {
      img = card.querySelector && card.querySelector('img');
      if (img) break;
      card = card.parentElement;
    }
    if (!img) continue;
    let titulo = (a.getAttribute('title') || a.innerText || '').trim().split('\n')[0];
    if (!titulo || titulo.length < 2) titulo = (img.getAttribute('alt') || '').trim();
    const ant = porLink.get(link);
    if (ant) { if (titulo.length > ant.titulo.length) ant.titulo = titulo; continue; }
    porLink.set(link, { titulo, link, imagem: abs(img.currentSrc || img.src || img.getAttribute('data-src')), autor: '' });
  }
  for (const it of porLink.values()) if (it.titulo && it.imagem && !it.imagem.startsWith('data:')) adicionar(it);
  return JSON.stringify({ verificacao, titulo: document.title, itens: itens.slice(0, 60) });
})
"""


def js_extrair(site):
    s = SITES_BUSCA[site]
    cfg = {"modelo": s["modelo"], "link": s["link"], "midia": s.get("midia", "")}
    return f"{JS_EXTRAIR}({json.dumps(cfg)})"


class LeitorOculto:
    """Abre uma página numa janela escondida do programa e lê os resultados (precisa do pywebview rodando)."""

    def __init__(self):
        self.ativo = False  # vira True quando a janela do programa (pywebview) está rodando

    def ler(self, url, script, prazo=ESPERA_JANELA):
        if not self.ativo:
            raise ErroDados("a busca nesse site só funciona com a janela do programa aberta (não no modo navegador)")
        import webview
        janela = webview.create_window("Selecta 3D — pesquisando", url, hidden=True, width=1366, height=900)
        carregou = threading.Event()
        janela.events.loaded += lambda *_: carregou.set()
        fim = time.time() + prazo
        ultimo, iguais, resposta = -1, 0, {"itens": [], "verificacao": False}
        try:
            if not carregou.wait(prazo):
                raise ErroDados("a página de busca demorou demais para abrir")
            self._injetar(janela)  # captura as respostas de busca que a página ainda vai pedir
            while time.time() < fim:
                time.sleep(1.5)
                try:
                    bruto = janela.evaluate_js(script)
                    resposta = json.loads(bruto) if isinstance(bruto, str) else (bruto or resposta)
                except Exception:  # noqa: BLE001  (página trocando no meio da leitura)
                    continue
                n = len(resposta.get("itens") or [])
                if resposta.get("verificacao") and time.time() > fim - prazo + 8:
                    break  # deu tempo para a verificação automática passar sozinha; não passou
                if n and n == ultimo:
                    iguais += 1
                    if iguais >= 2 or n >= POR_SITE:
                        break
                else:
                    iguais = 0
                ultimo = n
        finally:
            try:
                janela.destroy()
            except Exception:  # noqa: BLE001
                pass
        return resposta

    @staticmethod
    def _injetar(janela):
        try:
            janela.evaluate_js(JS_GANCHO)
        except Exception:  # noqa: BLE001
            pass

    def mostrar(self, url):
        """Janela visível na busca do site, para o usuário fazer a verificação de "não sou robô"."""
        if not self.ativo:
            raise ErroDados("só funciona na janela do programa no PC")
        import webview
        webview.create_window("Faça a verificação do site e feche esta janela", url, width=1280, height=860)
        return {"ok": True}


# ---------------------------------------------------------------- serviço usado pelo servidor
class Pesquisa:
    def __init__(self, config=None, leitor=None):
        self.config = config
        self.leitor = leitor or LeitorOculto()
        self._buscas = {}
        self._cache = {}
        self._trava = threading.Lock()

    # chaves das buscas oficiais (config.json, fora da pasta compartilhada)
    def _chaves(self):
        dados = (self.config["pesquisa"] if self.config is not None else None) or {}
        return {k: str(dados.get(k) or "").strip() for k in CHAVES}

    def gravar_chaves(self, novas):
        if self.config is None:
            raise ErroDados("sem configuração")
        atuais = self._chaves()
        for k in CHAVES:
            if k in (novas or {}) and novas[k] is not None:
                v = str(novas[k]).strip()
                if v != "••••":  # campo não mexido na tela
                    atuais[k] = v[:300]
        self.config["pesquisa"] = atuais
        with self._trava:
            self._cache.clear()
        return self.sites()

    def sites(self):
        chaves = self._chaves()
        lista = []
        for sid, s in SITES_BUSCA.items():
            falta = [k for k in s.get("chaves", []) if not chaves.get(k)]
            if s["modo"] == "api":
                pronto, motivo = not falta, ("falta a chave" if falta else "")
            else:
                pronto = self.leitor.ativo
                motivo = "" if pronto else "só com a janela do programa aberta no PC"
            lista.append({"id": sid, "nome": s["nome"], "modo": s["modo"], "dominios": s["dominios"],
                          "pronto": pronto, "motivo": motivo, "como": s.get("como", ""),
                          "chaves": {k: bool(chaves.get(k)) for k in s.get("chaves", [])},
                          "pagina": s["pagina"]})
        return {"sites": lista}

    def pagina(self, site, termo):
        s = SITES_BUSCA.get(site)
        if not s:
            raise ErroDados("site desconhecido")
        return s["pagina"].replace("{q}", urllib.parse.quote(limpar_termo(termo), safe=""))

    def buscar(self, site, termo):
        """Começa uma busca e devolve a chave para acompanhar (ou o resultado, se já estiver guardado)."""
        termo = limpar_termo(termo)
        if site not in SITES_BUSCA:
            raise ErroDados("site desconhecido")
        if len(termo) < 2:
            raise ErroDados("escreva o tema da pesquisa")
        with self._trava:
            guardado = self._cache.get((site, termo.lower()))
            if guardado and time.time() - guardado[0] < VALIDADE_CACHE:
                return {"chave": "", **guardado[1]}
            chave = secrets.token_urlsafe(8)
            self._buscas[chave] = {"estado": "buscando", "site": site, "quando": time.time()}
            for k in [k for k, v in self._buscas.items() if time.time() - v["quando"] > 3600]:
                self._buscas.pop(k, None)
        threading.Thread(target=self._rodar, args=(chave, site, termo), daemon=True).start()
        return {"chave": chave, "estado": "buscando", "site": site}

    def estado(self, chave):
        with self._trava:
            return dict(self._buscas.get(chave) or {"estado": "erro", "erro": "busca não encontrada"})

    def mostrar_verificacao(self, site, termo):
        return self.leitor.mostrar(self.pagina(site, termo))

    def _rodar(self, chave, site, termo):
        s = SITES_BUSCA[site]
        try:
            if s["modo"] == "api":
                chaves = self._chaves()
                falta = [k for k in s["chaves"] if not chaves.get(k)]
                if falta:
                    resultado = {"estado": "sem_chave", "site": site, "itens": []}
                else:
                    brutos = BUSCAS_API[site](termo, chaves)
                    resultado = {"estado": "pronto", "site": site, "itens": self._montar(site, brutos)}
            else:
                r = self.leitor.ler(self.pagina(site, termo), js_extrair(site))
                itens = self._montar(site, r.get("itens") or [])
                if r.get("verificacao") and not itens:
                    resultado = {"estado": "verificacao", "site": site, "itens": []}
                else:
                    resultado = {"estado": "pronto", "site": site, "itens": itens}
            if resultado["estado"] == "pronto":
                with self._trava:
                    self._cache[(site, termo.lower())] = (time.time(), resultado)
        except ErroDados as e:
            resultado = {"estado": "erro", "site": site, "erro": str(e), "itens": []}
        except Exception as e:  # noqa: BLE001
            log.exception("erro na pesquisa em %s", site)
            resultado = {"estado": "erro", "site": site, "erro": f"erro inesperado: {e}", "itens": []}
        with self._trava:
            self._buscas[chave] = {**resultado, "quando": time.time()}

    @staticmethod
    def _montar(site, brutos):
        itens = []
        for i, b in enumerate(brutos):
            it = normalizar(site, b, i)
            if it["titulo"] and it["link"].startswith("http"):
                itens.append(it)
        return itens[:POR_SITE]


def limpar_termo(termo):
    return re.sub(r"\s+", " ", str(termo or "")).strip()[:120]
