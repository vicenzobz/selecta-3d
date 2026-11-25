"""Servidor HTTP que entrega a interface e a API em JSON.

O servidor principal só aceita o próprio PC (127.0.0.1). O acesso pelo celular é um
segundo servidor na rede de casa, ligado e desligado pelo usuário na tela "Celular".
"""
import collections
import json
import logging
import os
import secrets
import shutil
import socket
import subprocess
import threading
import time
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .dados import LOJAS, SITES, ErroConflito, ErroDados

log = logging.getLogger("organizador")

TIPOS = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".json": "application/json; charset=utf-8",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".webmanifest": "application/manifest+json; charset=utf-8",
}

TAILSCALE_EXE = os.path.join(os.environ.get("ProgramFiles", "C:/Program Files"), "Tailscale", "tailscale.exe")

PAGINAS_NAVEGADOR = {"etiquetas.html"}


def ips_locais():
    ips = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))  # não envia nada; só escolhe a interface da rede
        ips.append(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127.") and ip not in ips:
                ips.append(ip)
    except OSError:
        pass
    return ips


def _tailscale(*args, timeout=4):
    exe = TAILSCALE_EXE if os.path.isfile(TAILSCALE_EXE) else shutil.which("tailscale")
    if not exe:
        return None
    r = subprocess.run([exe, *args], capture_output=True, text=True, encoding="utf-8", errors="replace",
                       timeout=timeout, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    return r.stdout if r.returncode == 0 else None


def info_tailscale(porta):
    """Estado do Tailscale neste PC: nome no tailnet, HTTPS e se o `tailscale serve` aponta para a porta do celular."""
    try:
        st = _tailscale("status", "--json")
        if st is None:
            return {"instalado": False}
        st = json.loads(st)
        nome = ((st.get("Self") or {}).get("DNSName") or "").rstrip(".")
        sv = json.loads(_tailscale("serve", "status", "--json") or "{}") or {}
    except (OSError, ValueError, subprocess.SubprocessError) as e:
        return {"instalado": True, "erro": str(e)}
    destinos = []
    for site in (sv.get("Web") or {}).values():
        for h in (site.get("Handlers") or {}).values():
            destinos.append(str(h.get("Proxy") or ""))
    serve = any(d.rstrip("/").endswith(f":{porta}") for d in destinos)
    return {
        "instalado": True,
        "conectado": st.get("BackendState") == "Running",
        "nome": nome,
        "https": bool(st.get("CertDomains")),
        "serve": serve,
        "base": f"https://{nome}" if nome and serve else "",
    }


class Celular:
    """Liga/desliga o servidor da rede de casa (porta fixa, mesmo token).

    O mesmo servidor atende o app do celular fora de casa (pelo `tailscale serve`, em HTTPS)
    e a extensão do navegador (em http://127.0.0.1:porta).
    """

    def __init__(self, repo, pasta_ui, config, pesquisa=None, baixados=None, kx=None):
        self.repo = repo
        self.pesquisa = pesquisa
        self.baixados = baixados
        self.kx = kx
        self.pasta_ui = pasta_ui
        self.config = config
        self.srv = None
        self.erro = ""
        self.trava = threading.Lock()
        self._ts = (0.0, None)

    def tailscale(self):
        quando, valor = self._ts
        if valor is None or time.time() - quando > 20:
            valor = info_tailscale(self.config["porta_celular"])
            self._ts = (time.time(), valor)
        return valor

    def info(self):
        porta = self.config["porta_celular"]
        ips = ips_locais()
        base = [f"http://{ip}:{porta}" for ip in ips]
        ts = self.tailscale()
        token = self.config["token"]
        return {
            "ativo": self.srv is not None,
            "porta": porta,
            "bases": base,
            "enderecos": [f"{b}/?t={token}" for b in base],
            "token": token,
            "erro": self.erro,
            "tailscale": {**ts, "endereco": f"{ts['base']}/?t={token}" if ts.get("base") else ""},
            "extensao": f"http://127.0.0.1:{porta}/?t={token}",
        }

    def ligar(self):
        with self.trava:
            if self.srv is None:
                try:
                    self.srv = criar_servidor(self.repo, self.pasta_ui, host="0.0.0.0",
                                              porta=self.config["porta_celular"], token=self.config["token"],
                                              remoto=True, pesquisa=self.pesquisa,
                                              baixados=self.baixados, kx=self.kx)
                except OSError as e:
                    self.erro = f"não consegui abrir a porta {self.config['porta_celular']}: {e}"
                    raise ErroDados(self.erro)
                threading.Thread(target=self.srv.serve_forever, daemon=True).start()
                self.erro = ""
                log.info("acesso pelo celular ligado na porta %s", self.config["porta_celular"])
            if not self.config["celular"]:
                self.config["celular"] = True
        return self.info()

    def desligar(self):
        with self.trava:
            if self.srv is not None:
                self.srv.shutdown()
                self.srv.server_close()
                self.srv = None
                log.info("acesso pelo celular desligado")
            if self.config["celular"]:
                self.config["celular"] = False
        return self.info()


def criar_servidor(repo, pasta_ui, host="127.0.0.1", porta=0, token=None, celular=None, remoto=False, seletor=None,
                   inicializacao=None, ao_mostrar=None, pesquisa=None, fatiador=None, baixados=None, kx=None):
    token = token or secrets.token_urlsafe(18)
    pasta_ui = os.path.realpath(pasta_ui)

    rotas_post = {
        "/api/fila/atualizar": lambda d: repo.fila_atualizar(d["id"], d.get("campos"), d.get("antes")),
        "/api/fila/mover": lambda d: repo.fila_mover(d["id"], d.get("direcao")),
        "/api/fila/adicionar": lambda d: repo.fila_adicionar(d.get("campos")),
        "/api/fila/registrar": lambda d: repo.fila_registrar(
            d["id"], d.get("status"), d.get("tempo"), d.get("consumo"), d.get("nota"), d.get("antes"),
            d.get("motivo_falha", ""), d.get("solucao", ""), bool(d.get("anotar_problema")), d.get("fatiado", "")),
        "/api/estimativa/salvar": lambda d: repo.estimativa_salvar(
            d["peca"], d.get("gramas"), d.get("tempo"), d.get("fonte"), d.get("obs")),
        "/api/tabela/atualizar": lambda d: repo.tabela_atualizar(
            d["arquivo"], d["secao"], {"id": d.get("id"), "indice": d.get("indice")}, d.get("campos"), d.get("antes")),
        "/api/tabela/adicionar": lambda d: repo.tabela_adicionar(d["arquivo"], d["secao"], d.get("campos")),
        "/api/estoque/movimentar": lambda d: repo.estoque_movimentar(
            d["secao"], d["id"], d.get("delta"), d.get("valor"), d.get("motivo")),
        "/api/estoque/pesar": lambda d: repo.estoque_pesar(d["id"], d.get("balanca"), d.get("tara"), d.get("motivo")),
        "/api/referencia/ler": lambda d: repo.ler_link(d.get("url")),
        "/api/miniatura/guardar": lambda d: repo.miniatura_guardar(d["caminho"], d.get("dados")),
        "/api/referencia/imagem": lambda d: repo.referencia_imagem(d["id"], d.get("url"), d.get("dados"), d.get("nome"),
                                                                    d.get("pagina")),
        "/api/referencia/fila": lambda d: repo.referencia_para_fila(d["id"], d.get("campos")),
        "/api/link": lambda d: repo.abrir_link(d.get("url")),
    }
    # ações que mexem no PC (abrir programas, ligar a rede) só valem na janela do próprio PC
    rotas_locais = {"/api/abrir", "/api/pagina", "/api/celular", "/api/link", "/api/seletor/abrir", "/api/seletor/licenca",
                    "/api/licencas/lote", "/api/licencas/lote/estado", "/api/licencas/lote/parar",
                    "/api/janela",
                    "/api/inicializacao", "/api/pesquisa/chaves", "/api/pesquisa/verificar",
                    "/api/fatiador/fatiar", "/api/fatiador/orca", "/api/fatiador/abrir", "/api/fatiador/padrao"}
    avisos = getattr(kx, "avisos", None) if kx is not None else None
    if avisos is not None:  # A11: Telegram (token só no config.json); configurar e testar só na janela do PC
        rotas_locais.update({"/api/avisos/configurar", "/api/avisos/testar"})
        rotas_post.update({
            "/api/avisos/estado": lambda d: avisos.estado(),
            "/api/avisos/configurar": lambda d: avisos.configurar(d.get("token"), d.get("chat"), d.get("eventos"),
                                                                  bool(d.get("apagar"))),
            "/api/avisos/testar": lambda d: avisos.testar(),
        })
    det = getattr(kx, "deteccao", None) if kx is not None else None
    if det is not None:  # A12: ligar/desligar e sensibilidade só na janela do PC
        rotas_locais.add("/api/deteccao/configurar")
        rotas_post.update({
            "/api/deteccao/configurar": lambda d: det.configurar(d.get("ligada"), d.get("sensibilidade")),
            "/api/deteccao/visto": lambda d: det.visto(),
            "/api/deteccao/falso-alarme": lambda d: det.falso_alarme(d.get("nota", "")),
        })
    if pesquisa is not None:
        rotas_post.update({
            "/api/pesquisa/buscar": lambda d: pesquisa.buscar(d.get("site"), d.get("termo")),
            "/api/pesquisa/chaves": lambda d: pesquisa.gravar_chaves(d.get("chaves")),
            "/api/pesquisa/verificar": lambda d: pesquisa.mostrar_verificacao(d.get("site"), d.get("termo")),
        })
    # mexem em arquivos do PC: só valem para quem chama do próprio PC (a extensão fala com o 127.0.0.1)
    rotas_so_neste_pc = {"/api/baixados/receber"}
    if baixados is not None:
        rotas_locais.add("/api/baixados/baixar")
        rotas_post.update({
            "/api/baixados/contexto": lambda d: baixados.contexto(d.get("pagina")),
            "/api/baixados/receber": lambda d: baixados.receber(d),
            "/api/baixados/licenca": lambda d: baixados.salvar_licenca(d.get("licenca"), d.get("referencia"),
                                                                     d.get("caminho")),
            "/api/baixados/baixar": lambda d: baixados.baixar(d),
        })
    if kx is not None:
        # imprimir, ligar e desligar a ponte só na janela do PC; acompanhar, pausar e cancelar também no celular
        rotas_locais.update({"/api/impressora/imprimir", "/api/impressora/ligar", "/api/impressora/desligar",
                             "/api/impressora/auto", "/api/impressora/diagnostico"})
        rotas_post.update({
            "/api/impressora/imprimir": lambda d: kx.imprimir(d.get("caminho") or "", d.get("peca") or ""),
            "/api/impressora/filamentos": lambda d: kx.filamentos(d.get("caminho") or ""),
            "/api/impressora/diagnostico": lambda d: kx.diagnostico(),
            "/api/impressora/ligar": lambda d: kx.ligar(),
            "/api/impressora/desligar": lambda d: kx.desligar(),
            "/api/impressora/auto": lambda d: kx.definir_auto(d.get("ligado")),
            "/api/impressora/pausar": lambda d: kx.pausar(),
            "/api/impressora/continuar": lambda d: kx.continuar(),
            "/api/impressora/cancelar": lambda d: kx.cancelar(),
            "/api/impressora/visto": lambda d: kx.visto(),
            "/api/impressora/primeiro-dia": lambda d: kx.marcar_primeiro_dia(d.get("passo") or "", d.get("valor")),
            "/api/impressora/rolo-slot": lambda d: kx.ligar_rolo(d.get("slot"), d.get("rolo")),
            "/api/impressora/camada1-visto": lambda d: kx.camada1_visto(),
            "/api/impressora/timelapse": lambda d: kx.configurar_timelapse(d.get("ligado"), d.get("minutos")),
        })
        rotas_locais.add("/api/impressora/timelapse")
    if fatiador is not None:
        rotas_post.update({
            "/api/fatiador/fatiar": lambda d: fatiador.fatiar(d),
            "/api/fatiador/orca": lambda d: fatiador.abrir_no_orca(d.get("caminho") or ""),
            "/api/fatiador/abrir": lambda d: fatiador.abrir_em(d.get("programa") or "", d.get("caminho") or ""),
            "/api/fatiador/padrao": lambda d: fatiador.definir_padrao(d.get("programa") or ""),
        })
    # mudanças já gravadas, pelo código "_op" que o app do celular manda: se a conexão cair depois de gravar
    # e o celular mandar de novo, devolve a mesma resposta em vez de gravar duas vezes
    ops_feitas = collections.OrderedDict()
    trava_ops = threading.Lock()

    class Manipulador(BaseHTTPRequestHandler):
        server_version = "Organizador3D"

        def log_message(self, fmt, *args):
            log.debug("%s %s", self.address_string(), fmt % args)

        # ---------------------------------------------------------- respostas
        def _json(self, codigo, obj):
            corpo = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            self.send_response(codigo)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(corpo)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(corpo)

        def _bytes(self, tipo, corpo):
            self.send_response(200)
            self.send_header("Content-Type", tipo)
            self.send_header("Content-Length", str(len(corpo)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(corpo)

        def _token_ok(self, consulta):
            dado = self.headers.get("X-Token") or (consulta.get("t") or [""])[0]
            return secrets.compare_digest(dado, token)

        def _executar(self, funcao, op=""):
            try:
                resultado = funcao()
                if op:
                    with trava_ops:
                        ops_feitas[op] = resultado
                        while len(ops_feitas) > 1000:
                            ops_feitas.popitem(last=False)
                self._json(200, resultado)
            except ErroConflito as e:
                self._json(409, {"erro": str(e)})
            except (ErroDados, KeyError, ValueError) as e:
                self._json(400, {"erro": str(e)})
            except Exception as e:  # noqa: BLE001
                log.exception("erro na API")
                self._json(500, {"erro": f"erro inesperado: {e}"})

        # ---------------------------------------------------------- GET
        def do_GET(self):
            url = urllib.parse.urlsplit(self.path)
            consulta = urllib.parse.parse_qs(url.query)
            caminho = urllib.parse.unquote(url.path)
            if caminho == "/manifest.webmanifest":
                return self._manifesto(consulta)
            if caminho.startswith("/api/"):
                if not self._token_ok(consulta):
                    return self._json(403, {"erro": "token inválido"})
                if caminho == "/api/tudo":
                    return self._executar(lambda: {**repo.tudo(), "remoto": remoto,
                                                    "sites": SITES, "lojas": sorted(LOJAS)})
                if caminho == "/api/versao":
                    return self._executar(repo.versao)
                if caminho == "/api/arquivos":
                    return self._executar(repo.arquivos)
                if caminho == "/api/modelo":
                    return self._modelo((consulta.get("caminho") or [""])[0])
                if caminho == "/api/miniatura":
                    return self._miniatura((consulta.get("caminho") or [""])[0])
                if caminho == "/api/imagem":
                    return self._imagem((consulta.get("caminho") or [""])[0])
                if caminho == "/api/seletor":
                    if remoto or seletor is None:
                        return self._json(403, {"erro": "só na janela do PC"})
                    return self._executar(lambda: seletor.estado((consulta.get("chave") or [""])[0]))
                if caminho == "/api/impressora":
                    if kx is None:
                        return self._json(404, {"erro": "impressora indisponível"})
                    return self._executar(lambda: {**kx.estado(), "remoto": remoto})
                if caminho == "/api/impressora/foto":
                    if kx is None:
                        return self._json(404, {"erro": "impressora indisponível"})
                    try:
                        return self._bytes("image/jpeg", kx.foto())
                    except Exception as e:  # noqa: BLE001
                        return self._json(502, {"erro": str(e)})
                if caminho == "/api/impressoes/midia":  # F4: fotos e timelapses das impressões
                    if kx is None:
                        return self._json(200, {})
                    return self._executar(kx.midia)
                if caminho == "/api/licencas/revisao":
                    if baixados is None:
                        return self._json(404, {"erro": "indisponível"})
                    return self._executar(baixados.revisao)
                if caminho == "/api/pesquisa/sites":
                    if pesquisa is None:
                        return self._json(404, {"erro": "pesquisa indisponível"})
                    return self._executar(lambda: {**pesquisa.sites(), "remoto": remoto})
                if caminho == "/api/pesquisa/estado":
                    if pesquisa is None:
                        return self._json(404, {"erro": "pesquisa indisponível"})
                    return self._executar(lambda: pesquisa.estado((consulta.get("chave") or [""])[0]))
                if caminho == "/api/fatiador":
                    if fatiador is None:
                        return self._json(404, {"erro": "fatiador indisponível"})
                    return self._executar(lambda: {**fatiador.estado(), "remoto": remoto})
                if caminho == "/api/fatiador/info":
                    if fatiador is None:
                        return self._json(404, {"erro": "fatiador indisponível"})
                    return self._executar(lambda: fatiador.info_arquivo((consulta.get("caminho") or [""])[0]))
                if caminho == "/api/fatiador/trabalho":
                    if fatiador is None:
                        return self._json(404, {"erro": "fatiador indisponível"})
                    return self._executar(lambda: fatiador.trabalho((consulta.get("id") or [""])[0]))
                if caminho == "/api/celular":
                    if remoto or celular is None:
                        return self._json(403, {"erro": "só na janela do PC"})
                    return self._executar(celular.info)
                if caminho == "/api/inicializacao":
                    if remoto or inicializacao is None:
                        return self._json(403, {"erro": "só na janela do PC"})
                    return self._executar(lambda: {"ligado": inicializacao.ligado()})
                return self._json(404, {"erro": "rota desconhecida"})
            self._estatico(caminho)

        def _modelo(self, rel):
            try:
                p = repo.caminho_seguro(rel)
            except ErroDados as e:
                return self._json(400, {"erro": str(e)})
            if not os.path.isfile(p):
                return self._json(404, {"erro": "arquivo não encontrado"})
            tamanho = os.path.getsize(p)
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(tamanho))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            with open(p, "rb") as f:
                shutil.copyfileobj(f, self.wfile, 1024 * 256)

        def _miniatura(self, rel):
            try:
                png = repo.miniatura(rel)
            except ErroDados as e:
                return self._json(400, {"erro": str(e)})
            if not png:
                return self._json(404, {"erro": "sem miniatura embutida"})
            self._bytes("image/png", png)

        def _imagem(self, rel):
            tipos = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
                     ".gif": "image/gif", ".avif": "image/avif", ".mp4": "video/mp4"}  # .mp4: timelapse (F4)
            try:
                p = repo.caminho_seguro(rel)
            except ErroDados as e:
                return self._json(400, {"erro": str(e)})
            tipo = tipos.get(os.path.splitext(p)[1].lower())
            if not tipo or not os.path.isfile(p):
                return self._json(404, {"erro": "imagem não encontrada"})
            with open(p, "rb") as f:
                self._bytes(tipo, f.read())

        def _manifesto(self, consulta):
            inicio = "/"
            if self._token_ok(consulta):
                inicio = "/?" + urllib.parse.urlencode({"t": token})
            icones = [
                {"src": "/icone-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
                {"src": "/icone-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
                {"src": "/icone-mascara-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
            ]
            atalhos = [{"name": nome, "url": f"{inicio}#{aba}", "icons": [icones[0]]}
                       for nome, aba in (("Fila", "fila"), ("Estoque", "estoque"), ("Referências", "referencias"),
                                         ("Compras", "compras"))]
            corpo = json.dumps({
                "id": "/", "name": "Selecta 3D", "short_name": "Selecta 3D",
                "description": "Fila, estoque, compras, projetos e referências da impressão 3D",
                "lang": "pt-BR", "start_url": inicio, "scope": "/", "display": "standalone",
                "orientation": "portrait", "background_color": "#15110c", "theme_color": "#15110c",
                "icons": icones, "shortcuts": atalhos,
                # aparece no menu "Compartilhar" do Android: links e imagens de outros apps
                "share_target": {"action": "/compartilhar", "method": "POST", "enctype": "multipart/form-data",
                                 "params": {"title": "titulo", "text": "texto", "url": "link",
                                            "files": [{"name": "imagem", "accept": ["image/*"]}]}},
            }, ensure_ascii=False).encode("utf-8")
            self._bytes(TIPOS[".webmanifest"], corpo)

        def _estatico(self, caminho):
            if caminho in ("", "/"):
                caminho = "/index.html"
            p = os.path.realpath(os.path.join(pasta_ui, caminho.lstrip("/")))
            if os.path.commonpath([p, pasta_ui]) != pasta_ui or not os.path.isfile(p):
                self.send_error(404)
                return
            tipo = TIPOS.get(os.path.splitext(p)[1].lower(), "application/octet-stream")
            with open(p, "rb") as f:
                self._bytes(tipo, f.read())

        # ---------------------------------------------------------- POST
        def do_POST(self):
            url = urllib.parse.urlsplit(self.path)
            consulta = urllib.parse.parse_qs(url.query)
            if url.path == "/compartilhar":
                # o "Compartilhar" do Android chega aqui só se o app ainda não estiver pronto no celular;
                # normalmente o service worker recebe antes. Volta para o início sem perder a tela.
                self.send_response(303)
                self.send_header("Location", "/?compartilhado=0")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            if not self._token_ok(consulta):
                return self._json(403, {"erro": "token inválido"})
            if url.path in rotas_locais and remoto:
                return self._json(403, {"erro": "essa ação só funciona na janela do PC"})
            if url.path in rotas_so_neste_pc and self.client_address[0] not in ("127.0.0.1", "::1"):
                return self._json(403, {"erro": "essa ação só funciona no próprio PC"})
            try:
                n = int(self.headers.get("Content-Length") or 0)
                dados = json.loads(self.rfile.read(n).decode("utf-8") or "{}")
            except (ValueError, UnicodeDecodeError):
                return self._json(400, {"erro": "JSON inválido"})
            op = str(dados.get("_op") or "")[:80] if isinstance(dados, dict) else ""
            if op:
                with trava_ops:
                    ja = ops_feitas.get(op)
                if ja is not None:
                    return self._json(200, ja)
            if url.path == "/api/abrir":
                return self._executar(lambda: repo.abrir(dados["caminho"], dados.get("modo")))
            if url.path == "/api/pagina":
                return self._executar(lambda: self._abrir_pagina(dados))
            if url.path == "/api/seletor/abrir":
                if seletor is None:
                    return self._json(400, {"erro": "indisponível"})
                return self._executar(lambda: seletor.abrir(dados.get("url")))
            if url.path == "/api/seletor/licenca":  # abre a página numa janela e lê a licença sozinho
                if seletor is None:
                    return self._json(400, {"erro": "indisponível"})
                return self._executar(lambda: seletor.abrir_licenca(dados.get("url")))
            if url.path.startswith("/api/licencas/lote"):  # conferir em lote, em janelas escondidas (trab-v01)
                if seletor is None:
                    return self._json(400, {"erro": "indisponível"})
                if url.path == "/api/licencas/lote":
                    return self._executar(lambda: seletor.conferir_lote(dados.get("itens")))
                if url.path == "/api/licencas/lote/estado":
                    return self._executar(lambda: seletor.estado_lote(dados.get("chave")))
                if url.path == "/api/licencas/lote/parar":
                    return self._executar(lambda: seletor.parar_lote(dados.get("chave")))
            if url.path == "/api/janela":  # outra cópia aberta pede para mostrar a janela desta
                if ao_mostrar is None:
                    return self._json(404, {"erro": "indisponível"})
                return self._executar(lambda: (ao_mostrar(), {"ok": True})[1])
            if url.path == "/api/inicializacao":
                if inicializacao is None:
                    return self._json(404, {"erro": "indisponível"})
                return self._executar(lambda: {"ligado": inicializacao.ligar() if dados.get("ativo")
                                               else inicializacao.desligar()})
            if url.path == "/api/celular":
                if celular is None:
                    return self._json(404, {"erro": "indisponível"})
                return self._executar(lambda: celular.ligar() if dados.get("ativo") else celular.desligar())
            rota = rotas_post.get(url.path)
            if not rota:
                return self._json(404, {"erro": "rota desconhecida"})
            self._executar(lambda: rota(dados), op)

        def _abrir_pagina(self, dados):
            pagina = dados.get("pagina", "")
            if pagina not in PAGINAS_NAVEGADOR:
                raise ErroDados("página desconhecida")
            consulta = urllib.parse.urlencode({**(dados.get("consulta") or {}), "t": token})
            porta_atual = self.server.server_address[1]
            webbrowser.open(f"http://127.0.0.1:{porta_atual}/{pagina}?{consulta}")
            return {"ok": True}

    servidor = ThreadingHTTPServer((host, porta), Manipulador)
    servidor.daemon_threads = True
    servidor.token = token
    return servidor
