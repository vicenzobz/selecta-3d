"""Seletor de imagem: abre o link da referência numa janela do programa e deixa o usuário clicar na foto.

É o usuário quem abre e navega na página (como num navegador comum); o programa só recebe a imagem
em que ele clicou. Só existe na janela própria (pywebview), não no modo --navegador.
"""
import base64
import json
import logging
import re
import secrets
import threading
import time

from .dados import ErroDados, TIPOS_IMAGEM, baixar_imagem_web

log = logging.getLogger("organizador")

# conferência de licenças em lote (janelas escondidas)
PRAZO_LOTE = 25            # segundos por página, no máximo
SIMULTANEAS_LOTE = 2       # páginas abertas ao mesmo tempo
ESPERA_LEITURA_LOTE = 2.0  # segundos entre leituras da mesma página

# barra e modo de escolha injetados na página aberta
JS_SELETOR = r"""
(function () {
  if (window.__org3d) return;
  window.__org3d = true;
  const VERDE = '#4fdca0', FUNDO = '#0e3a2e';
  const barra = document.createElement('div');
  barra.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:2147483647;display:flex;gap:10px;align-items:center;'
    + 'padding:10px 16px;background:' + FUNDO + ';color:#e2f3eb;font:600 14px/1.3 Segoe UI,system-ui,sans-serif;box-shadow:0 4px 16px #0008';
  const botao = (txt, fundo, cor) => {
    const b = document.createElement('button');
    b.textContent = txt;
    b.style.cssText = 'height:34px;padding:0 16px;border:0;border-radius:999px;cursor:pointer;font:600 13px Segoe UI,sans-serif;'
      + 'background:' + fundo + ';color:' + cor;
    return b;
  };
  const texto = document.createElement('span');
  texto.style.flex = '1';
  const bModo = botao('', 'transparent', '#e2f3eb');
  bModo.style.border = '1px solid #e2f3eb55';
  const bCapa = botao('Usar a imagem de capa', VERDE, '#03271c');
  const bSair = botao('Cancelar', 'transparent', '#e2f3eb');
  bSair.style.border = '1px solid #e2f3eb55';
  barra.append(texto, bModo, bCapa, bSair);
  const moldura = document.createElement('div');
  moldura.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;border:3px solid ' + VERDE
    + ';border-radius:6px;box-shadow:0 0 0 9999px #0003;display:none';
  const montar = () => { if (document.body) { document.body.append(moldura, barra); } else { setTimeout(montar, 200); } };
  montar();

  let ativo = true, ocupado = false;
  const atualizar = () => {
    texto.textContent = ocupado ? 'Baixando a imagem…'
      : ativo ? 'Selecta 3D · clique na imagem que quer usar na referência'
      : 'Navegando normalmente (aceite cookies, troque de foto…). Depois volte ao modo escolher.';
    bModo.textContent = ativo ? 'Navegar na página' : 'Voltar a escolher';
    if (!ativo) moldura.style.display = 'none';
  };
  atualizar();

  const fonteDe = (el) => {
    if (!el || barra.contains(el)) return null;
    if (el.tagName === 'IMG') {
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 40) return null;
      return { src: el.currentSrc || el.src, rect: r };
    }
    if (el.tagName === 'SOURCE' && el.parentElement) return fonteDe(el.parentElement.querySelector('img'));
    const bg = getComputedStyle(el).backgroundImage;
    const m = bg && bg.match(/url\(["']?([^"')]+)["']?\)/);
    if (m && !m[1].startsWith('data:image/svg')) {
      const r = el.getBoundingClientRect();
      if (r.width >= 60 && r.height >= 60) return { src: new URL(m[1], location.href).href, rect: r };
    }
    return null;
  };
  const achar = (x, y) => {
    for (const el of document.elementsFromPoint(x, y)) {
      const f = fonteDe(el);
      if (f && f.src && !f.src.startsWith('data:image/svg')) return f;
    }
    return null;
  };

  document.addEventListener('mousemove', (e) => {
    if (!ativo || ocupado) return;
    const f = achar(e.clientX, e.clientY);
    if (!f) { moldura.style.display = 'none'; return; }
    Object.assign(moldura.style, { display: 'block', left: f.rect.left - 3 + 'px', top: f.rect.top - 3 + 'px',
      width: f.rect.width + 'px', height: f.rect.height + 'px' });
  }, true);

  const api = () => new Promise((ok) => {
    if (window.pywebview && window.pywebview.api) return ok(window.pywebview.api);
    window.addEventListener('pywebviewready', () => ok(window.pywebview.api), { once: true });
  });

  async function escolher(src) {
    ocupado = true; atualizar(); moldura.style.display = 'none';
    const a = await api();
    let r = await a.escolher(src, location.href);
    if (!r || !r.ok) {
      // o servidor de imagens recusou o download direto: pega pela própria página
      try {
        const resp = await fetch(src, { credentials: 'include' });
        const blob = await resp.blob();
        const dados = await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(blob); });
        r = await a.escolher_dados(dados);
      } catch (e) { r = { ok: false, erro: String(e) }; }
    }
    if (!r || !r.ok) {
      ocupado = false; atualizar();
      texto.textContent = 'O site não deixou pegar essa imagem. Tente outra ou "Usar a imagem de capa"; se não der, tire um print (Win+Shift+S) e cole no programa com Ctrl+V.';
    }
  }

  document.addEventListener('click', (e) => {
    if (!ativo || ocupado || barra.contains(e.target)) return;
    const f = achar(e.clientX, e.clientY);
    if (!f) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    escolher(f.src);
  }, true);

  bModo.onclick = (e) => { e.stopPropagation(); ativo = !ativo; atualizar(); };
  bSair.onclick = async (e) => { e.stopPropagation(); (await api()).cancelar(); };
  bCapa.onclick = (e) => {
    e.stopPropagation();
    const m = document.querySelector('meta[property="og:image"],meta[name="og:image"],meta[name="twitter:image"]');
    if (m && m.content) escolher(new URL(m.content, location.href).href);
    else texto.textContent = 'Esta página não tem imagem de capa: clique numa imagem.';
  };
})();
"""

# o que a página mostra sobre a licença (usado na janela "Conferir licença" e na conferência em lote, escondida)
JS_COLHER = r"""
function colher(barra) {
  const PALAVRA = /licen[cçs]/i;
  const daBarra = (el) => !!(barra && el && barra.contains(el));
  const p = { links: [], jsonld: [], meta: [], perto: [], texto: '' };
  for (const a of document.querySelectorAll('a[rel~="license"], link[rel~="license"], a[href*="creativecommons.org"]')) {
    if (daBarra(a)) continue;
    p.links.push((a.href || '') + ' ' + (a.textContent || '').trim());
  }
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const achar = (o) => {
        if (!o || typeof o !== 'object') return;
        for (const [k, v] of Object.entries(o)) {
          if (/^license$/i.test(k)) p.jsonld.push(typeof v === 'string' ? v : JSON.stringify(v));
          else if (typeof v === 'object') achar(v);
        }
      };
      achar(JSON.parse(s.textContent));
    } catch (e) { /* JSON-LD inválido */ }
  }
  for (const m of document.querySelectorAll('meta[name*="license" i], meta[property*="license" i], meta[name="dc.rights" i], meta[name="dcterms.license" i]')) {
    if (m.content) p.meta.push(m.content);
  }
  // textos curtos perto da palavra Licença/License (o rótulo e o que vem logo depois)
  const andar = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  let n, vistos = 0;
  while ((n = andar.nextNode()) && vistos < 40) {
    const t = (n.textContent || '').trim();
    if (!t || t.length > 300 || !PALAVRA.test(t) || daBarra(n.parentElement)) continue;
    let el = n.parentElement;
    for (let i = 0; i < 3 && el && el.parentElement && (el.innerText || '').length < 200; i++) el = el.parentElement;
    const bloco = el ? (el.innerText || el.textContent || '') : t;
    const links = el ? [...el.querySelectorAll('a[href]')].map((a) => a.href).join(' ') : '';
    p.perto.push((bloco.slice(0, 600) + ' ' + links).trim());
    vistos++;
  }
  p.texto = (document.body ? document.body.innerText : '').slice(0, 200000);
  p.titulo = document.title || '';
  return p;
}
"""

# conferência em lote: a mesma colheita, numa janela escondida, devolvida como texto JSON
JS_COLHER_OCULTO = "(function () {\n" + JS_COLHER + "\nreturn JSON.stringify(colher(null));\n})()"

# janela "Conferir licença": lê a página sozinha (de novo a cada mudança, porque muitos sites carregam aos poucos)
JS_LICENCA = r"""
(function () {
  if (window.__org3dlic) return;
  window.__org3dlic = true;
  const VERDE = '#4fdca0', FUNDO = '#0e3a2e';
  const barra = document.createElement('div');
  barra.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:2147483647;display:flex;gap:10px;align-items:center;flex-wrap:wrap;'
    + 'padding:10px 16px;background:' + FUNDO + ';color:#e2f3eb;font:600 14px/1.3 Segoe UI,system-ui,sans-serif;box-shadow:0 4px 16px #0008';
  const botao = (txt, fundo, cor) => {
    const b = document.createElement('button');
    b.textContent = txt;
    b.style.cssText = 'height:34px;padding:0 16px;border:0;border-radius:999px;cursor:pointer;font:600 13px Segoe UI,sans-serif;'
      + 'background:' + fundo + ';color:' + cor;
    return b;
  };
  const texto = document.createElement('span');
  texto.style.flex = '1';
  const bUsar = botao('Usar esta licença', VERDE, '#03271c');
  const bSelecao = botao('Usar o texto selecionado', 'transparent', '#e2f3eb');
  bSelecao.style.border = '1px solid #e2f3eb55';
  const bDeNovo = botao('Ler de novo', 'transparent', '#e2f3eb');
  bDeNovo.style.border = '1px solid #e2f3eb55';
  const bSair = botao('Cancelar', 'transparent', '#e2f3eb');
  bSair.style.border = '1px solid #e2f3eb55';
  bUsar.style.display = 'none';
  barra.append(texto, bUsar, bSelecao, bDeNovo, bSair);
  const montar = () => { if (document.body) { document.body.append(barra); } else { setTimeout(montar, 200); } };
  montar();

  const api = () => new Promise((ok) => {
    if (window.pywebview && window.pywebview.api) return ok(window.pywebview.api);
    window.addEventListener('pywebviewready', () => ok(window.pywebview.api), { once: true });
  });

  /*COLHER*/

  let achada = '', lendo = false, ultimo = '';
  async function ler(manual) {
    if (lendo) return;
    lendo = true;
    try {
      const r = await (await api()).ler(colher(barra), location.href);
      if (r && r.licenca) {
        achada = r.licenca;
        texto.textContent = 'Selecta 3D · achei: ' + r.licenca + ' (' + r.fonte + '). Confira na página e clique em "Usar esta licença".';
        bUsar.style.display = '';
        bUsar.textContent = 'Usar ' + r.licenca;
      } else if (!achada) {
        texto.textContent = manual
          ? 'Ainda não achei. Role até a parte da licença, abra a aba "Detalhes"/"License" ou selecione o texto da licença e clique em "Usar o texto selecionado".'
          : 'Selecta 3D · lendo a licença da página… (se pedir, aceite os cookies; continuo procurando sozinho)';
      }
    } catch (e) { texto.textContent = 'Não consegui ler a página: ' + e; }
    lendo = false;
  }
  texto.textContent = 'Selecta 3D · lendo a licença da página…';
  setTimeout(() => ler(false), 1200);
  // a página muda (carrega o resto, troca de aba): lê de novo, no máximo a cada 2 s, por 2 minutos
  const inicio = Date.now();
  const obs = new MutationObserver(() => {
    if (Date.now() - inicio > 120000) { obs.disconnect(); return; }
    const t = document.body ? document.body.innerText.length : 0;
    if (String(t) === ultimo) return;
    ultimo = String(t);
    clearTimeout(window.__org3dlicT);
    window.__org3dlicT = setTimeout(() => ler(false), 2000);
  });
  const vigiar = () => { if (document.body) obs.observe(document.body, { childList: true, subtree: true }); else setTimeout(vigiar, 300); };
  vigiar();

  bUsar.onclick = async (e) => { e.stopPropagation(); if (achada) (await api()).usar(achada, location.href); };
  bSelecao.onclick = async (e) => {
    e.stopPropagation();
    const sel = String(window.getSelection() || '').trim();
    if (!sel) { texto.textContent = 'Selecione com o mouse o texto da licença na página e clique de novo.'; return; }
    const r = await (await api()).usar_texto(sel, location.href);
    if (!r || !r.ok) texto.textContent = (r && r.erro) || 'Não deu para usar esse texto.';
  };
  bDeNovo.onclick = (e) => { e.stopPropagation(); ler(true); };
  bSair.onclick = async (e) => { e.stopPropagation(); (await api()).cancelar(); };
})();
""".replace("  /*COLHER*/", "\n".join("  " + l if l else l for l in JS_COLHER.strip("\n").split("\n")))


class _ApiLicenca:
    """Funções que a página aberta na janela "Conferir licença" pode chamar."""

    def __init__(self, seletor, chave):
        self._seletor = seletor
        self._chave = chave
        self._janela = None

    def ler(self, pedacos, pagina=None):
        from .baixados import licenca_da_pagina
        try:
            r = licenca_da_pagina(pedacos)
        except Exception as e:  # noqa: BLE001
            log.exception("não consegui ler a licença da página")
            return {"licenca": "", "erro": str(e)}
        if r.get("licenca"):
            self._seletor._resultado(self._chave, {"estado": "achada", "licenca": r["licenca"], "fonte": r["fonte"],
                                                   "certeza": r["certeza"], "pagina": pagina or ""}, manter=True)
        return r

    def usar(self, licenca, pagina=None):
        licenca = " ".join(str(licenca or "").split())[:80]
        if not licenca:
            return {"ok": False, "erro": "licença vazia"}
        self._seletor._resultado(self._chave, {"estado": "pronto", "licenca": licenca, "pagina": pagina or ""})
        if self._janela:
            threading.Timer(0.3, self._janela.destroy).start()
        return {"ok": True}

    def usar_texto(self, texto, pagina=None):
        from .baixados import identificar_licenca
        t = " ".join(str(texto or "").split())
        lic = identificar_licenca(t) or (t if 2 <= len(t) <= 80 else "")
        if not lic:
            return {"ok": False, "erro": "Selecione só o nome da licença (até 80 letras), por exemplo CC BY-NC 4.0."}
        return self.usar(lic, pagina)

    def cancelar(self):
        self._seletor._resultado(self._chave, {"estado": "cancelado"})
        if self._janela:
            threading.Timer(0.1, self._janela.destroy).start()
        return {"ok": True}


class _ApiJanela:
    """Funções que a página aberta pode chamar (window.pywebview.api)."""

    def __init__(self, seletor, chave):
        self._seletor = seletor
        self._chave = chave
        self._janela = None

    def escolher(self, src, pagina=None):
        try:
            dados, ext = baixar_imagem_web(src, referer=pagina)
        except ErroDados as e:
            return {"ok": False, "erro": str(e)}
        self._seletor._concluir(self._chave, dados, ext, self._janela)
        return {"ok": True}

    def escolher_dados(self, data_url):
        try:
            cabeca, b64 = str(data_url).split(",", 1)
            tipo = cabeca.split(":")[1].split(";")[0].lower()
            if tipo not in TIPOS_IMAGEM:
                return {"ok": False, "erro": "formato não aceito"}
            dados = base64.b64decode(b64)
            if len(dados) > 8_000_000:
                return {"ok": False, "erro": "imagem grande demais"}
        except (ValueError, IndexError):
            return {"ok": False, "erro": "imagem inválida"}
        self._seletor._concluir(self._chave, dados, TIPOS_IMAGEM[tipo], self._janela)
        return {"ok": True}

    def cancelar(self):
        self._seletor._resultado(self._chave, {"estado": "cancelado"})
        if self._janela:
            threading.Timer(0.1, self._janela.destroy).start()
        return {"ok": True}


class SeletorImagem:
    def __init__(self):
        self._resultados = {}
        self._trava = threading.Lock()
        self._lotes = {}
        self.ativo = False  # vira True quando a janela própria (pywebview) está rodando

    def _resultado(self, chave, valor, manter=False):
        with self._trava:
            atual = self._resultados.get(chave, {})
            if atual.get("estado") in ("pronto", "cancelado"):
                return
            self._resultados[chave] = {**valor, "quando": time.time()}

    def _concluir(self, chave, dados, ext, janela):
        tipo = next(t for t, e in TIPOS_IMAGEM.items() if e == ext)
        self._resultado(chave, {"estado": "pronto", "nome": "pagina" + ext,
                                "dados": f"data:{tipo};base64," + base64.b64encode(dados).decode()})
        if janela:
            threading.Timer(0.3, janela.destroy).start()

    def abrir(self, url):
        if not self.ativo:
            raise ErroDados("escolher na página só funciona na janela do programa (não no navegador); "
                            "use Ctrl+V ou arraste a imagem")
        import webview  # só existe na janela própria
        if not str(url or "").lower().startswith(("http://", "https://")):
            raise ErroDados("cole o link da referência (http:// ou https://) antes")
        chave = secrets.token_urlsafe(8)
        api = _ApiJanela(self, chave)
        self._resultado(chave, {"estado": "aguardando"})
        janela = webview.create_window("Escolher imagem — clique na foto que quer usar", url, js_api=api,
                                       width=1280, height=860, text_select=True)
        api._janela = janela

        def ao_carregar(*_):
            try:
                janela.evaluate_js(JS_SELETOR)
            except Exception:  # noqa: BLE001
                log.exception("não consegui preparar a página do seletor")

        def ao_fechar(*_):
            self._resultado(chave, {"estado": "cancelado"})

        janela.events.loaded += ao_carregar
        janela.events.closed += ao_fechar
        # limpa resultados antigos
        with self._trava:
            for k in [k for k, v in self._resultados.items() if time.time() - v.get("quando", 0) > 3600]:
                self._resultados.pop(k, None)
        return {"chave": chave}

    def abrir_licenca(self, url):
        """Abre a página numa janela do programa e lê a licença sozinho (JS_LICENCA). Estado em estado(chave):
        aguardando -> achada (licença lida, ainda sem confirmar) -> pronto (o usuário clicou "Usar") ou cancelado."""
        if not self.ativo:
            raise ErroDados("conferir na página só funciona na janela do programa (não no navegador)")
        import webview  # só existe na janela própria
        if not str(url or "").lower().startswith(("http://", "https://")):
            raise ErroDados("esta linha não tem link da página do modelo")
        chave = secrets.token_urlsafe(8)
        api = _ApiLicenca(self, chave)
        self._resultado(chave, {"estado": "aguardando"})
        janela = webview.create_window("Conferir licença — o programa lê a página sozinho", url, js_api=api,
                                       width=1280, height=860, text_select=True)
        api._janela = janela

        def ao_carregar(*_):
            try:
                janela.evaluate_js(JS_LICENCA)
            except Exception:  # noqa: BLE001
                log.exception("não consegui preparar a página da licença")

        def ao_fechar(*_):
            self._resultado(chave, {"estado": "cancelado"})

        janela.events.loaded += ao_carregar
        janela.events.closed += ao_fechar
        return {"chave": chave}

    def estado(self, chave):
        with self._trava:
            return dict(self._resultados.get(chave) or {"estado": "desconhecido"})

    # ---------------------------------------------------------- conferência de licenças em lote (trab-v01)
    # Para cada item: abre a página numa janela ESCONDIDA, lê a licença com a mesma colheita da janela
    # "Conferir licença" (JS_COLHER) e fecha. Não grava nada: a tela mostra o que achou e o usuário salva.
    def conferir_lote(self, itens, prazo=PRAZO_LOTE, simultaneas=SIMULTANEAS_LOTE, criar_janela=None):
        if not self.ativo and criar_janela is None:
            raise ErroDados("a conferência em lote só funciona na janela do programa no PC (não no navegador)")
        vistos, fila = set(), []
        for it in (itens or [])[:300]:
            iid, url = str((it or {}).get("id") or "").strip(), str((it or {}).get("url") or "").strip()
            if iid and iid not in vistos and url.lower().startswith(("http://", "https://")):
                vistos.add(iid)
                fila.append((iid, url))
        if not fila:
            raise ErroDados("nenhuma linha com link da página para conferir")
        with self._trava:
            if any(l["estado"] == "rodando" for l in self._lotes.values()):
                raise ErroDados("já há uma conferência em lote rodando; espere terminar ou clique em Parar")
            chave = secrets.token_urlsafe(8)
            lote = {"estado": "rodando", "total": len(fila), "feitos": 0, "atuais": [], "resultados": {},
                    "parar": False, "quando": time.time()}
            self._lotes[chave] = lote
        pendentes = list(fila)

        def trabalhador():
            while True:
                with self._trava:
                    if lote["parar"] or not pendentes:
                        return
                    iid, url = pendentes.pop(0)
                    lote["atuais"].append(iid)
                try:
                    r = self._ler_oculto(url, prazo, criar_janela, lambda: lote["parar"])
                except Exception as e:  # noqa: BLE001
                    log.exception("conferência em lote: falhou %s", url)
                    r = {"estado": "erro", "licenca": "", "erro": str(e)[:200]}
                with self._trava:
                    lote["resultados"][iid] = r
                    lote["feitos"] += 1
                    if iid in lote["atuais"]:
                        lote["atuais"].remove(iid)

        def rodar():
            ts = [threading.Thread(target=trabalhador, daemon=True) for _ in range(max(1, min(simultaneas, len(fila))))]
            for t in ts:
                t.start()
            for t in ts:
                t.join()
            with self._trava:
                lote["estado"] = "parado" if lote["parar"] else "fim"
                lote["quando"] = time.time()

        threading.Thread(target=rodar, daemon=True, name="licencas-lote").start()
        return {"chave": chave, "total": len(fila)}

    def estado_lote(self, chave):
        with self._trava:
            lote = self._lotes.get(chave)
            if not lote:
                return {"estado": "desconhecido"}
            return {k: (dict(v) if isinstance(v, dict) else list(v) if isinstance(v, list) else v)
                    for k, v in lote.items() if k != "parar"}

    def parar_lote(self, chave):
        with self._trava:
            lote = self._lotes.get(chave)
            if lote and lote["estado"] == "rodando":
                lote["parar"] = True
        return {"ok": True}

    @staticmethod
    def _ler_oculto(url, prazo, criar_janela=None, parar=lambda: False):
        """Abre a página escondida, lê a licença de novo a cada ~2 s (muitos sites carregam aos poucos) e fecha.
        Para cedo com certeza alta, ou quando a mesma licença aparece duas leituras seguidas."""
        from .baixados import licenca_da_pagina
        if criar_janela is None:
            import webview  # só existe na janela própria
            criar_janela = lambda u: webview.create_window("Selecta 3D — conferindo licença", u,  # noqa: E731
                                                           hidden=True, width=1366, height=900)
        janela = criar_janela(url)
        carregou = threading.Event()
        try:
            janela.events.loaded += lambda *_: carregou.set()
        except Exception:  # noqa: BLE001
            carregou.set()
        fim = time.time() + prazo
        melhor, repetiu, verificacao = None, 0, False
        ordem = {"alta": 3, "media": 2, "baixa": 1}
        try:
            carregou.wait(min(prazo, 20))
            while time.time() < fim and not parar():
                time.sleep(ESPERA_LEITURA_LOTE)
                try:
                    bruto = janela.evaluate_js(JS_COLHER_OCULTO)
                    pedacos = json.loads(bruto) if isinstance(bruto, str) else (bruto or {})
                except Exception:  # noqa: BLE001  (página trocando no meio da leitura)
                    continue
                titulo = str(pedacos.get("titulo") or "") + " " + str(pedacos.get("texto") or "")[:600]
                verificacao = bool(re.search(r"(?i)just a moment|verify you are human|are you a robot|"
                                             r"checking your browser|não sou (um )?rob", titulo))
                r = licenca_da_pagina(pedacos)
                if not r.get("licenca"):
                    continue
                if melhor and r["licenca"] == melhor["licenca"]:
                    repetiu += 1
                elif not melhor or ordem.get(r["certeza"], 0) >= ordem.get(melhor["certeza"], 0):
                    melhor, repetiu = r, 0
                if melhor["certeza"] == "alta" or repetiu >= 1:
                    break
        finally:
            try:
                janela.destroy()
            except Exception:  # noqa: BLE001
                pass
        if melhor:
            return {"estado": "achada", "licenca": melhor["licenca"], "fonte": melhor["fonte"],
                    "certeza": melhor["certeza"]}
        if parar():
            return {"estado": "parado", "licenca": ""}
        if verificacao:
            return {"estado": "nada", "licenca": "",
                    "erro": "o site pediu a verificação de \"não sou robô\": use Conferir na página"}
        return {"estado": "nada", "licenca": "", "erro": "não achei na página"}

