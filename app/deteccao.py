"""Detecção de falhas pela câmera (A12), com o modelo aberto do Obico rodando neste PC.

Como funciona:
- O serviço de detecção do Obico (`ml_api`, licença AGPL-3.0) roda num contêiner Docker só em 127.0.0.1:3333,
  instalado pelo usuário com `PROGRAMAS/SELECTA-3D/deteccao/instalar_deteccao.ps1`. Sem ele, nada aqui roda.
- Durante a impressão (estado "printing" no KX-Bridge), a cada 10 s o Selecta 3D pega a foto da câmera
  (`/api/camera/snapshot` da ponte), deixa-a num endereço local de uso único e pede ao serviço que a analise
  (`GET /p/?img=…`). O serviço devolve caixas [rótulo, confiança, [x, y, l, a]].
- A soma das confianças de cada foto entra no mesmo cálculo do Obico (média exponencial + médias móveis curta e
  longa, `backend/lib/prediction.py`, parâmetros FD_1ST_GEN_PARAMS de `backend/config/settings.py`, commit
  df8190ef de 2026-11-06). Assim, uma foto ruim sozinha não pausa nada: é preciso uma sequência.
- Nível 1 (alerta): avisa. Nível 2 (o Obico usa o mesmo teste dividido por 1,75): **pausa** pelo KX-Bridge
  (autorizado pelo usuário em 22/11), guarda a foto em `IMPRESSOES/falhas/` e avisa. Continuar ou cancelar fica
  com o usuário, na tela.
"""
import datetime
import json
import logging
import os
import secrets
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .dados import ErroDados

log = logging.getLogger("organizador")

SERVICO_PADRAO = "http://127.0.0.1:3333"
# endereço pelo qual o contêiner alcança este PC (Docker Desktop); a foto é servida só em 127.0.0.1
HOST_DO_CONTEINER = "host.docker.internal"
PORTA_QUADRO = 7131
INTERVALO = 10  # s; os parâmetros do Obico foram ajustados para 10 s entre fotos
PASTA_FALHAS = "IMPRESSOES/falhas"

# FD_1ST_GEN_PARAMS do Obico (backend/config/settings.py)
PARAMS = {
    "EWM_SPAN": 12,
    "ROLLING_WIN_SHORT": 310,
    "ROLLING_WIN_LONG": 7200,
    "THRESHOLD_LOW": 0.38,
    "THRESHOLD_HIGH": 0.78,
    "INIT_SAFE_FRAME_NUM": 30,
    "ROLLING_MEAN_SHORT_MULTIPLE": 3.8,
    "ESCALATING_FACTOR": 1.75,
}
SENSIBILIDADES = {"baixa": 0.8, "média": 1.0, "alta": 1.2}  # como no Obico (detective_sensitivity)


class Previsao:
    """Mesmo cálculo do Obico (prediction.py): um objeto por impressão."""

    def __init__(self, params=PARAMS):
        self.p = params
        self.atual = 0.0
        self.quadros = 0
        self.ewm = 0.0
        self.curta = 0.0
        self.longa = 0.0

    @staticmethod
    def _rolante(p, media, n, janela):
        return media + (p - media) / float(janela if janela <= n else n + 1)

    def somar(self, deteccoes):
        p = sum(float(d[1]) for d in deteccoes or [])
        alfa = 2 / (self.p["EWM_SPAN"] + 1)
        self.atual = p
        self.ewm = p * alfa + self.ewm * (1 - alfa)
        self.curta = self._rolante(p, self.curta, self.quadros, self.p["ROLLING_WIN_SHORT"])
        self.longa = self._rolante(p, self.longa, self.quadros, self.p["ROLLING_WIN_LONG"])
        self.quadros += 1
        return p

    def falhando(self, sensibilidade=1.0, fator=1.0):
        if self.quadros < self.p["INIT_SAFE_FRAME_NUM"]:
            return False
        ajustado = (self.ewm - self.longa) * sensibilidade / fator
        if ajustado < self.p["THRESHOLD_LOW"]:
            return False
        if ajustado > self.p["THRESHOLD_HIGH"]:
            return True
        return ajustado > (self.curta - self.longa) * self.p["ROLLING_MEAN_SHORT_MULTIPLE"]

    def nivel(self, sensibilidade=1.0):
        """0 = normal, 1 = alerta (avisa), 2 = falha (pausa)."""
        if self.falhando(sensibilidade, self.p["ESCALATING_FACTOR"]):
            return 2
        return 1 if self.falhando(sensibilidade) else 0


class _Quadro(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):  # noqa: N802
        dono = self.server.dono
        if self.path != "/" + dono._segredo + ".jpg" or not dono._foto:
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", "image/jpeg")
        self.send_header("Content-Length", str(len(dono._foto)))
        self.end_headers()
        self.wfile.write(dono._foto)


class Deteccao:
    def __init__(self, repo, kx, config=None, avisos=None, servico=None, porta_quadro=None, host_conteiner=None,
                 intervalo=INTERVALO, analisar=None, params=PARAMS):
        self.repo, self.kx, self.config, self.avisos = repo, kx, config, avisos
        self.servico = (servico or self._cfg("deteccao_servico") or SERVICO_PADRAO).rstrip("/")
        self.porta_quadro = porta_quadro if porta_quadro is not None else (self._cfg("deteccao_porta") or PORTA_QUADRO)
        self.host_conteiner = host_conteiner or self._cfg("deteccao_host") or HOST_DO_CONTEINER
        self.intervalo = intervalo
        self.params = params
        self._analisar = analisar  # os testes trocam por uma função falsa (foto -> detecções)
        self._segredo = secrets.token_urlsafe(16)
        self._foto = b""
        self._srv = None
        self._parar = threading.Event()
        self._prev = None
        self._estado_ant = None
        self._alertou = False
        self.ultimo = {}
        self.servico_ok = None
        if self.config is not None and not self._cfg("deteccao_token"):
            # senha do serviço local; o instalar_deteccao.ps1 lê daqui (fica só no config.json, fora da pasta)
            self._gravar_cfg("deteccao_token", secrets.token_urlsafe(24))

    def _cfg(self, k):
        return self.config[k] if self.config is not None else None

    def _gravar_cfg(self, k, v):
        if self.config is not None:
            self.config[k] = v

    # ------------------------------------------------------------ configuração
    def ligada(self):
        v = self._cfg("deteccao_ligada")
        return True if v is None else bool(v)  # ligada por padrão; só funciona com o serviço instalado

    def sensibilidade(self):
        s = self._cfg("deteccao_sensibilidade") or "média"
        return s if s in SENSIBILIDADES else "média"

    def configurar(self, ligada=None, sensibilidade=None):
        if ligada is not None:
            self._gravar_cfg("deteccao_ligada", bool(ligada))
        if sensibilidade is not None:
            if sensibilidade not in SENSIBILIDADES:
                raise ErroDados("sensibilidade: baixa, média ou alta")
            self._gravar_cfg("deteccao_sensibilidade", sensibilidade)
        return self.estado()

    def estado(self):
        return {"servico": self.servico_ok, "ligada": self.ligada(), "sensibilidade": self.sensibilidade(),
                "quadros": self._prev.quadros if self._prev else 0, "ultimo": self.ultimo,
                "evento": self._cfg("deteccao_evento") or None}

    # ------------------------------------------------------------ serviço
    def verificar_servico(self):
        try:
            with urllib.request.urlopen(self.servico + "/hc/", timeout=3) as r:
                self.servico_ok = r.read(20).strip() == b"ok"
        except Exception:  # noqa: BLE001
            self.servico_ok = False
        return self.servico_ok

    def _servir_quadro(self):
        if self._srv is None:
            self._srv = ThreadingHTTPServer(("127.0.0.1", self.porta_quadro), _Quadro)
            self._srv.dono = self
            threading.Thread(target=self._srv.serve_forever, daemon=True).start()

    def _analisar_http(self, foto):
        self._foto = foto
        self._servir_quadro()
        url_img = f"http://{self.host_conteiner}:{self._srv.server_address[1]}/{self._segredo}.jpg"
        cab = {}
        token = self._cfg("deteccao_token")
        if token:
            cab["Authorization"] = "Bearer " + token
        req = urllib.request.Request(self.servico + "/p/?" + urllib.parse.urlencode({"img": url_img}), headers=cab)
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode("utf-8")).get("detections") or []

    # ------------------------------------------------------------ uma rodada
    def rodada(self):
        """Chamada a cada INTERVALO s. Devolve o nível (0, 1, 2) ou None se não analisou."""
        if not self.ligada():
            return None
        try:
            st = self.kx._status()
        except Exception:  # noqa: BLE001
            self._estado_ant = None
            return None
        agora = st.get("estado")
        if agora != "printing":
            if agora not in ("paused",):
                self._prev = None  # impressão acabou: a próxima começa do zero
                self._alertou = False
            self._estado_ant = agora
            return None
        if self._prev is None:
            self._prev = Previsao(self.params)
        self._estado_ant = agora
        if self._analisar is None and not self.servico_ok and not self.verificar_servico():
            return None
        foto = self.kx.foto()
        if not foto:
            return None
        try:
            det = (self._analisar or self._analisar_http)(foto)
        except Exception as e:  # noqa: BLE001
            log.warning("detecção: o serviço não respondeu (%s)", e)
            self.servico_ok = False
            return None
        p = self._prev.somar(det)
        nivel = self._prev.nivel(SENSIBILIDADES[self.sensibilidade()])
        self.ultimo = {"p": round(p, 3), "ewm": round(self._prev.ewm, 3), "nivel": nivel,
                       "quando": time.strftime("%Y-%m-%d %H:%M:%S")}
        if nivel == 2:
            self._falha(foto, det)
        elif nivel == 1 and not self._alertou:
            self._alertou = True
            if self.avisos is not None:
                self.avisos.avisar("falha_camera", "a câmera viu algo estranho na impressão (ainda não pausei).")
        return nivel

    def _peca(self):
        atual = self._cfg("impressao_atual") or {}
        return atual.get("peca") or ""

    def _guardar_foto(self, foto, sufixo):
        pasta = self.repo.caminho(PASTA_FALHAS)
        os.makedirs(pasta, exist_ok=True)
        nome = f"{datetime.datetime.now():%Y-%m-%d_%H%M%S}_{self._peca() or 'impressao'}_{sufixo}.jpg"
        with open(os.path.join(pasta, nome), "wb") as f:
            f.write(foto)
        return f"{PASTA_FALHAS}/{nome}"

    def _falha(self, foto, det):
        try:
            self.kx.pausar()  # única ação automática autorizada na impressora
            pausou = True
        except Exception as e:  # noqa: BLE001
            log.error("detecção: não consegui pausar: %s", e)
            pausou = False
        rel = ""
        try:
            rel = self._guardar_foto(foto, "falha")
        except OSError:
            log.exception("detecção: não consegui guardar a foto")
        evento = {"quando": time.strftime("%Y-%m-%d %H:%M"), "peca": self._peca(), "foto": rel, "pausou": pausou,
                  "p": self.ultimo.get("p"), "ewm": self.ultimo.get("ewm"), "caixas": len(det or [])}
        self._gravar_cfg("deteccao_evento", evento)
        if self.avisos is not None:
            self.avisos.avisar("falha_camera", f"{evento['peca'] or 'impressão'}: possível falha vista pela câmera. "
                               + ("Pausei a impressão; continue ou cancele no Selecta 3D." if pausou else
                                  "NÃO consegui pausar: confira a impressora agora."))
        self._prev = Previsao(self.params)  # recomeça a contagem (ao continuar, não pausa de novo na hora)
        self._alertou = False

    def visto(self):
        self._gravar_cfg("deteccao_evento", None)
        return self.estado()

    def falso_alarme(self, nota=""):
        """Registra o caso em IMPRESSOES/falhas/falsos-alarmes.md (data, peça, foto) para calibrar depois."""
        ev = self._cfg("deteccao_evento") or {}
        pasta = self.repo.caminho(PASTA_FALHAS)
        os.makedirs(pasta, exist_ok=True)
        arq = os.path.join(pasta, "falsos-alarmes.md")
        novo = not os.path.exists(arq)
        with open(arq, "a", encoding="utf-8", newline="\n") as f:
            if novo:
                f.write("# Falsos alarmes da detecção de falhas\n\nUma linha por caso marcado como falso alarme no "
                        "Selecta 3D. Serve para ajustar a sensibilidade.\n\n| Data | Peça | Foto | Nota |\n|---|---|---|---|\n")
            f.write(f"| {time.strftime('%Y-%m-%d %H:%M')} | {ev.get('peca', '')} | `{ev.get('foto', '')}` | "
                    f"{str(nota or '').replace('|', '/').strip()} |\n")
        return self.visto()

    # ------------------------------------------------------------ laço
    def iniciar(self):
        self.verificar_servico()
        threading.Thread(target=self._laco, daemon=True).start()

    def _laco(self):
        while not self._parar.wait(self.intervalo):
            try:
                self.rodada()
            except Exception:  # noqa: BLE001
                log.exception("erro na detecção de falhas")

    def encerrar(self):
        self._parar.set()
        if self._srv is not None:
            self._srv.shutdown()
