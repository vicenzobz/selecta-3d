"""KX-Bridge: imprimir na Kobra X pela rede de casa (ver PROGRAMAS/REGGAE-SLICER/KX-BRIDGE.md).

O KX-Bridge é um programa à parte (instalado em %LOCALAPPDATA%\\KX-Bridge) que conversa com a impressora
em modo LAN e se apresenta como Moonraker em http://127.0.0.1:7125. Aqui o Selecta 3D:

- liga e desliga a ponte (e, se o usuário quiser, junto com o programa);
- lê o estado (imprimindo/pausada/concluída, porcentagem, camada, temperaturas), a câmera e os slots do ACE;
- manda imprimir um arquivo fatiado: tira o G-code de dentro do .gcode.3mf e envia com print=true;
- pausa, continua e cancela;
- percebe o fim da impressão e guarda um aviso para a tela abrir o registro já preenchido
  (o estoque só baixa quando o usuário confirma o registro).

Endereços conferidos na documentação do KX-Bridge (API.md e código, nov/2026). Uma versão nova da ponte que
mude a interface pede ajuste só neste arquivo (os testes usam uma ponte falsa).
"""
import io
import json
import logging
import os
import re
import shutil
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile

from .dados import PASTA_ORGANIZADOR, ErroDados

log = logging.getLogger("organizador")

URL_PADRAO = "http://127.0.0.1:7125"
# A06: roteiro do primeiro dia com a Kobra X (o texto de cada passo fica na tela e em PROGRAMAS/REGGAE-SLICER/KX-BRIDGE.md)
# "f0" (princ-v02) é a primeira peça, mandada pelo Anycubic Slicer Next antes de ligar o modo LAN; sai do roteiro
# junto com o cartão quando o primeiro dia for concluído.
PASSOS_PRIMEIRO_DIA = ("f0", "instalar", "online", "status", "slots", "foto", "benchy", "pausar", "fim")
OBJETOS = "print_stats,virtual_sdcard,display_status,extruder,heater_bed"
ATIVOS = ("printing", "paused")
FIM = {"complete": "concluída", "error": "falhou", "standby": "cancelada", "cancelled": "cancelada"}
LIMITE_GCODE = 500 * 1024 * 1024
# F4: foto do fim e timelapse; F7: foto da 1ª camada (placas e peças grandes)
PASTA_FOTOS = "IMPRESSOES/fotos"
PASTA_TIMELAPSE = "IMPRESSOES/timelapse"
QUADRO_MIN_PADRAO = 2  # minutos entre uma foto e outra do timelapse
CAMADA1_MIN = 120  # peça "grande": estimativa acima de 2 h
# princ-v02: o fim só vale depois de a ponte ter mostrado "imprimindo" pelo menos uma vez. Entre o envio e o começo
# (a impressora recebe o arquivo, aquece, nivela) a ponte pode responder "standby", e a 2.x pisca entre os dois.
ESPERA_INICIO = 15 * 60  # segundos de tolerância depois do envio para a impressora começar
LEITURAS_FIM = 3  # leituras seguidas em "standby" para aceitar que parou (complete/error valem na primeira)
FIM_CERTO = ("complete", "error")
# diagnóstico (princ-v02): só leitura; o que parecer credencial ou identificação do aparelho não vai para o arquivo
ARQUIVO_DIAGNOSTICO = f"{PASTA_ORGANIZADOR}/diagnostico-ponte.json"
CONSULTAS_DIAGNOSTICO = ("/server/info", "/printer/info", "/printer/objects/list",
                         "/printer/objects/query?objects=" + OBJETOS, "/kx/filament/slots", "/server/files/list")
CHAVE_SENSIVEL = re.compile(r"pass|senha|token|secret|key|user|serial|(^|_)sn$|device|mac|cert|auth|(^|_)ip$|host|addr|cn$",
                            re.IGNORECASE)


def minutos_do_texto(t):
    """'5h12', '5 h 12 min', '43 min', '1:30' → minutos."""
    t = str(t or "").lower().replace(" ", "")
    m = re.fullmatch(r"(\d+):(\d{2})", t)
    if m:
        return int(m.group(1)) * 60 + int(m.group(2))
    h = re.search(r"(\d+(?:[.,]\d+)?)h", t)
    mi = re.search(r"(\d+)(?:min|m(?!s))", t) or re.search(r"h(\d+)$", t)
    total = (float(h.group(1).replace(",", ".")) * 60 if h else 0) + (int(mi.group(1)) if mi else 0)
    return int(total)


def exe_padrao():
    base = os.environ.get("LOCALAPPDATA") or os.path.join(os.path.expanduser("~"), "AppData", "Local")
    return os.path.join(base, "KX-Bridge", "kx-bridge.exe")


def gcode_do_arquivo(caminho):
    """Devolve (nome.gcode, bytes) de um .gcode, ou do G-code de dentro de um .gcode.3mf (Metadata/plate_N.gcode)."""
    nome = os.path.basename(caminho)
    low = nome.lower()
    if low.endswith((".gcode", ".bgcode")):
        with open(caminho, "rb") as f:
            return nome, f.read(LIMITE_GCODE + 1)
    if low.endswith(".3mf"):
        try:
            with zipfile.ZipFile(caminho) as z:
                internos = sorted(n for n in z.namelist() if n.lower().endswith(".gcode"))
                if not internos:
                    raise ErroDados("esse 3MF não está fatiado (não tem G-code dentro): fatie antes")
                dados = z.read(internos[0])
        except zipfile.BadZipFile:
            raise ErroDados("arquivo 3MF inválido")
        base = nome[: -len(".gcode.3mf")] if low.endswith(".gcode.3mf") else nome[:-4]
        return base + ".gcode", dados
    raise ErroDados("para imprimir, use um arquivo fatiado (.gcode ou .gcode.3mf)")


def filamentos_do_arquivo(caminho):
    """Filamentos que o fatiado usa, na ordem do fatiador (Metadata/slice_info.config do .gcode.3mf):
    [{"id": 1, "tipo": "PLA", "cor": "#FFFFFF", "gramas": 10.94}]. Lista vazia se o arquivo não disser."""
    if not str(caminho).lower().endswith(".3mf"):
        return []
    try:
        with zipfile.ZipFile(caminho) as z:
            nome = next((n for n in z.namelist() if n.lower().endswith("slice_info.config")), None)
            if not nome:
                return []
            texto = z.read(nome).decode("utf-8", "replace")
    except (zipfile.BadZipFile, OSError, KeyError):
        return []
    saida = []
    for m in re.finditer(r"<filament\b([^>]*)>", texto):
        at = dict(re.findall(r'([\w-]+)="([^"]*)"', m.group(1)))
        try:
            n = int(at.get("id") or 0)
        except ValueError:
            continue
        if n < 1:
            continue
        try:
            g = round(float(at.get("used_g") or 0), 2)
        except ValueError:
            g = 0
        cor = (at.get("color") or "").strip()[:7]
        saida.append({"id": n, "tipo": at.get("type") or "", "cor": cor if cor.startswith("#") else "", "gramas": g})
    return sorted(saida, key=lambda f: f["id"])


def _sem_segredos(v):
    if isinstance(v, dict):
        return {k: ("(oculto)" if CHAVE_SENSIVEL.search(str(k)) else _sem_segredos(x)) for k, x in v.items()}
    if isinstance(v, list):
        return [_sem_segredos(x) for x in v[:200]]
    if isinstance(v, str):
        return re.sub(r"\b\d{1,3}(?:\.\d{1,3}){3}\b", "(ip)", v)[:2000]
    return v


class KXBridge:
    def __init__(self, repo, config=None, url=None, exe=None, intervalo=5.0):
        self.repo = repo
        self.config = config
        self.url = (url or (config["ponte_url"] if config is not None else None) or URL_PADRAO).rstrip("/")
        self.exe = exe or exe_padrao()
        self.intervalo = intervalo
        self._processo = None
        self._trava = threading.Lock()
        self._ultimo = {}
        self.avisos = None  # app.avisos.Avisos (A11), ligado pelo selecta3d.pyw
        self.deteccao = None  # app.deteccao.Deteccao (A12), ligado pelo selecta3d.pyw
        self._estado_ant = None
        self._fins = 0  # leituras seguidas em estado de fim
        self._cancelar_pedido = False  # o usuário cancelou por aqui: o "standby" seguinte é fim de verdade
        self._parar = threading.Event()
        self._thread = None

    # ------------------------------------------------------------ conversa com a ponte
    def _req(self, caminho, metodo="GET", dados=None, cab=None, prazo=6, binario=False):
        req = urllib.request.Request(self.url + caminho, data=dados, method=metodo, headers=cab or {})
        try:
            with urllib.request.urlopen(req, timeout=prazo) as r:
                corpo = r.read(LIMITE_GCODE)
        except urllib.error.HTTPError as e:
            texto = ""
            try:
                texto = json.loads(e.read().decode("utf-8", "replace")).get("error", "")
            except Exception:  # noqa: BLE001
                pass
            if isinstance(texto, dict):
                texto = texto.get("message", "")
            raise ErroDados(f"a ponte respondeu com erro {e.code}" + (f": {texto}" if texto else ""))
        except (urllib.error.URLError, OSError) as e:
            raise ErroDados(f"a ponte KX-Bridge não respondeu ({getattr(e, 'reason', '') or e})")
        if binario:
            return corpo
        try:
            j = json.loads(corpo.decode("utf-8") or "{}")
        except ValueError:
            raise ErroDados("resposta estranha da ponte")
        return j.get("result", j) if isinstance(j, dict) else j

    def online(self):
        try:
            self._req("/server/info", prazo=2)
            return True
        except ErroDados:
            return False

    # ------------------------------------------------------------ ligar e desligar o programa da ponte
    def instalada(self):
        return os.path.isfile(self.exe)

    def ligar(self, esperar=12):
        if self.online():
            return self.estado()
        if not self.instalada():
            raise ErroDados("KX-Bridge não instalado (rode PROGRAMAS\\REGGAE-SLICER\\scripts\\instalar-kx-bridge.bat)")
        flags = 0x08000000 if os.name == "nt" else 0  # CREATE_NO_WINDOW: sem janela preta
        with self._trava:
            self._processo = subprocess.Popen([self.exe], cwd=os.path.dirname(self.exe), creationflags=flags,
                                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        fim = time.time() + esperar
        while time.time() < fim:
            if self.online():
                break
            time.sleep(0.5)
        log.info("KX-Bridge ligado pelo Selecta 3D")
        return self.estado()

    def desligar(self):
        """Fecha só a ponte que o Selecta 3D abriu (uma aberta à mão continua)."""
        with self._trava:
            p, self._processo = self._processo, None
        if p is not None and p.poll() is None:
            p.terminate()
            try:
                p.wait(5)
            except subprocess.TimeoutExpired:
                p.kill()
            log.info("KX-Bridge desligado pelo Selecta 3D")
        return self.estado()

    def definir_auto(self, ligado):
        if self.config is None:
            raise ErroDados("sem configuração")
        self.config["ponte_auto"] = bool(ligado)
        return self.estado()

    # ------------------------------------------------------------ estado
    def _status(self):
        r = self._req("/printer/objects/query?objects=" + OBJETOS)
        st = (r.get("status") if isinstance(r, dict) else None) or {}
        ps, vs = st.get("print_stats") or {}, st.get("virtual_sdcard") or {}
        ds, ex, mesa = st.get("display_status") or {}, st.get("extruder") or {}, st.get("heater_bed") or {}
        info = ps.get("info") or {}
        prog = vs.get("progress")
        if prog is None:
            prog = ds.get("progress")
        return {
            "estado": ps.get("state") or "standby",
            "arquivo": ps.get("filename") or "",
            "progresso": round(float(prog or 0), 4),
            "camada": info.get("current_layer"),
            "camadas": info.get("total_layer"),
            "bico": ex.get("temperature"), "bico_alvo": ex.get("target"),
            "mesa": mesa.get("temperature"), "mesa_alvo": mesa.get("target"),
        }

    def _slots(self):
        try:
            r = self._req("/kx/filament/slots")
        except ErroDados:
            return []
        lista = r if isinstance(r, list) else (r.get("slots") if isinstance(r, dict) else None) or []
        saida = []
        for s in lista:
            if not isinstance(s, dict):
                continue
            cor = str(s.get("color_hex") or "").strip()
            if cor and not cor.startswith("#"):
                cor = "#" + cor
            saida.append({"slot": s.get("slot_index"), "material": s.get("material") or "", "cor": cor[:7],
                          "carregado": s.get("status") == "loaded", "nome": s.get("filament_name") or ""})
        return saida

    def _versao(self):
        try:
            r = self._req("/printer/info", prazo=2)
            return str(r.get("software_version") or "") if isinstance(r, dict) else ""
        except ErroDados:
            return ""

    def estado(self):
        cfg = self.config
        base = {
            "instalada": self.instalada(), "url": self.url, "online": False,
            "auto": bool(cfg["ponte_auto"]) if cfg is not None else False,
            "ligada_por_nos": self._processo is not None and self._processo.poll() is None,
            "atual": (cfg["impressao_atual"] if cfg is not None else None) or None,
            "evento": (cfg["impressao_evento"] if cfg is not None else None) or None,
            "primeiro_dia": self.primeiro_dia(),
            "rolos_slots": self.rolos_slots(),
            "deteccao": self.deteccao.estado() if self.deteccao is not None else None,
            "camada1": (cfg["impressao_camada1"] if cfg is not None else None) or None,
            "timelapse": self.timelapse_cfg(),
        }
        try:
            st = self._status()
        except ErroDados as e:
            base["erro"] = str(e)
            return base
        base.update({"online": True, "impressora": st, "slots": self._slots(), "versao": self._versao()})
        if base["atual"] and not base["atual"].get("visto") and st["estado"] not in ATIVOS:
            base["aguardando_inicio"] = True
            base["aguardando_min"] = round((time.time() - (base["atual"].get("enviado") or time.time())) / 60)
        if base["atual"] and base["atual"].get("inicio") and base["atual"].get("visto"):
            decorrido = time.time() - base["atual"]["inicio"]
            base["decorrido_min"] = round(decorrido / 60)
            if st["estado"] in ATIVOS and st["progresso"] > 0.02:
                base["restante_min"] = round(decorrido * (1 - st["progresso"]) / st["progresso"] / 60)
        with self._trava:
            self._ultimo = base
        return base

    # ------------------------------------------------------------ imprimir e controlar
    def imprimir(self, rel, peca=None):
        caminho = self.repo.caminho_seguro(rel)
        if not os.path.isfile(caminho):
            raise ErroDados("arquivo não encontrado")
        st = self._status()
        if st["estado"] in ATIVOS:
            raise ErroDados("a impressora já está imprimindo")
        pendente = (self.config["impressao_atual"] if self.config is not None else None) or None
        if pendente and not pendente.get("visto") and time.time() - (pendente.get("enviado") or 0) < ESPERA_INICIO:
            raise ErroDados("já mandei um arquivo e a impressora ainda não começou; espere ou cancele na impressora")
        nome, dados = gcode_do_arquivo(caminho)
        if len(dados) > LIMITE_GCODE:
            raise ErroDados("G-code grande demais")
        borda = "----org3d" + uuid.uuid4().hex
        partes = [
            f'--{borda}\r\nContent-Disposition: form-data; name="print"\r\n\r\ntrue\r\n'.encode(),
            (f'--{borda}\r\nContent-Disposition: form-data; name="file"; filename="{nome}"\r\n'
             "Content-Type: application/octet-stream\r\n\r\n").encode("utf-8"),
            dados, f"\r\n--{borda}--\r\n".encode(),
        ]
        r = self._req("/server/files/upload", "POST", b"".join(partes),
                      {"Content-Type": f"multipart/form-data; boundary={borda}"}, prazo=180)
        if isinstance(r, dict) and r.get("filament_mismatch"):
            det = r.get("mismatch_details")
            raise ErroDados("a ponte não começou: os filamentos dos slots não batem com o arquivo"
                            + (f" ({json.dumps(det, ensure_ascii=False)[:200]})" if det else ""))
        agora = time.time()
        atual = {"peca": peca or "", "arquivo": rel, "gcode": nome, "inicio": agora, "enviado": agora, "visto": False,
                 "chave": self._chave(peca)}
        if self.config is not None:
            self.config["impressao_atual"] = atual
            self.config["impressao_evento"] = None
            self.config["impressao_camada1"] = None
        self._fins = 0
        self._cancelar_pedido = False
        if peca:
            try:
                self.repo.fila_atualizar(peca, {"Status": "imprimindo"}, None, autor="programa", origem="KX-Bridge")
            except Exception:  # noqa: BLE001  (a impressão já foi; o status a tela ajusta)
                log.exception("não consegui marcar %s como imprimindo", peca)
        return {"ok": True, "gcode": nome, "peca": peca or ""}

    def _comando(self, acao):
        self._req(f"/printer/print/{acao}", "POST", b"")
        return self.estado()

    def pausar(self):
        return self._comando("pause")

    def continuar(self):
        return self._comando("resume")

    def cancelar(self):
        self._cancelar_pedido = True
        return self._comando("cancel")

    def foto(self):
        return self._req("/api/camera/snapshot", binario=True, prazo=4)

    def filamentos(self, rel):
        """Filamentos do fatiado, para a tela mostrar "filamento N → slot N" antes de enviar."""
        caminho = self.repo.caminho_seguro(rel)
        if not os.path.isfile(caminho):
            raise ErroDados("arquivo não encontrado")
        return {"filamentos": filamentos_do_arquivo(caminho)}

    def diagnostico(self):
        """Guarda as respostas de leitura da ponte num arquivo, para conferir a interface da versão instalada.
        Não manda comando nenhum para a impressora."""
        saida = {"quando": time.strftime("%Y-%m-%d %H:%M"), "url": "(endereço local da ponte)", "consultas": {}}
        for c in CONSULTAS_DIAGNOSTICO:
            try:
                saida["consultas"][c] = _sem_segredos(self._req(c, prazo=4))
            except ErroDados as e:
                saida["consultas"][c] = {"erro": str(e)}
        respondeu = sum(1 for v in saida["consultas"].values() if not (isinstance(v, dict) and set(v) == {"erro"}))
        destino = self.repo.caminho(ARQUIVO_DIAGNOSTICO)
        os.makedirs(os.path.dirname(destino), exist_ok=True)
        with open(destino, "w", encoding="utf-8", newline="\n") as f:
            json.dump(saida, f, ensure_ascii=False, indent=2)
        return {"ok": True, "arquivo": ARQUIVO_DIAGNOSTICO, "respondeu": respondeu, "total": len(CONSULTAS_DIAGNOSTICO)}

    # ------------------------------------------------------------ roteiro do primeiro dia (A06)
    def primeiro_dia(self):
        """{"passos": {id: "ok"|"falhou"}, "concluido": bool, "quando": {id: "AAAA-MM-DD HH:MM"}} guardado em config.json."""
        d = (self.config["primeiro_dia"] if self.config is not None else None) or {}
        return {"passos": dict(d.get("passos") or {}), "concluido": bool(d.get("concluido")),
                "quando": dict(d.get("quando") or {})}

    def marcar_primeiro_dia(self, passo, valor):
        if self.config is None:
            raise ErroDados("sem configuração")
        d = self.primeiro_dia()
        if passo == "concluido":
            d["concluido"] = bool(valor)
        else:
            if passo not in PASSOS_PRIMEIRO_DIA:
                raise ErroDados(f"passo desconhecido: {passo}")
            if valor in ("ok", "falhou"):
                d["passos"][passo] = valor
                d["quando"][passo] = time.strftime("%Y-%m-%d %H:%M")
            elif not valor:
                d["passos"].pop(passo, None)
                d["quando"].pop(passo, None)
            else:
                raise ErroDados("valor deve ser ok, falhou ou vazio")
        self.config["primeiro_dia"] = d
        return self.estado()

    # ------------------------------------------------------------ rolo do estoque em cada slot (A08)
    def rolos_slots(self):
        """{"1": "R07", …}: rolo do estoque que o usuário disse estar em cada slot do ACE (config.json)."""
        d = (self.config["rolos_slots"] if self.config is not None else None) or {}
        return {str(k): v for k, v in d.items() if v}

    def ligar_rolo(self, slot, rolo):
        if self.config is None:
            raise ErroDados("sem configuração")
        try:
            n = int(slot)
        except (TypeError, ValueError):
            raise ErroDados("slot inválido") from None
        if not 1 <= n <= 8:
            raise ErroDados("slot inválido")
        rolo = str(rolo or "").strip().upper()
        if rolo and not (rolo.startswith("R") and rolo[1:].isdigit()):
            raise ErroDados("rolo inválido (use o ID do estoque, ex.: R07)")
        d = self.rolos_slots()
        if rolo:
            for k in [k for k, v in d.items() if v == rolo]:
                d.pop(k)  # um rolo só fica num slot
            d[str(n)] = rolo
        else:
            d.pop(str(n), None)
        self.config["rolos_slots"] = d
        return self.estado()

    def visto(self):
        if self.config is not None:
            self.config["impressao_evento"] = None
        return {"ok": True}

    def camada1_visto(self):
        if self.config is not None:
            self.config["impressao_camada1"] = None
        return {"ok": True}

    # ------------------------------------------------------------ F4 e F7: fotos e timelapse
    @staticmethod
    def _chave(peca):
        return time.strftime("%Y-%m-%d_%H%M") + "_" + (re.sub(r"[^A-Za-z0-9]+", "", peca or "") or "sem-peca")

    def timelapse_cfg(self):
        d = (self.config["timelapse"] if self.config is not None else None) or {}
        return {"ligado": d.get("ligado", True), "minutos": max(1, int(d.get("minutos") or QUADRO_MIN_PADRAO))}

    def configurar_timelapse(self, ligado=None, minutos=None):
        if self.config is None:
            raise ErroDados("sem configuração")
        d = self.timelapse_cfg()
        if ligado is not None:
            d["ligado"] = bool(ligado)
        if minutos is not None:
            try:
                d["minutos"] = max(1, min(30, int(minutos)))
            except (TypeError, ValueError):
                raise ErroDados("minutos inválidos") from None
        self.config["timelapse"] = d
        return self.estado()

    def _guardar_foto(self, rel_pasta, nome):
        """Tira uma foto da câmera e guarda em rel_pasta/nome; devolve o caminho relativo (ou "")."""
        try:
            dados = self.foto()
        except ErroDados:
            return ""
        if not dados or len(dados) < 200:
            return ""
        pasta = self.repo.caminho(rel_pasta)
        os.makedirs(pasta, exist_ok=True)
        with open(os.path.join(pasta, nome), "wb") as f:
            f.write(dados)
        return f"{rel_pasta}/{nome}"

    def _peca_pede_camada1(self, peca):
        """F7: só placas e peças grandes (estimativa > 2 h)."""
        if not peca:
            return False
        try:
            fila = {r.get("ID"): r for r in self.repo._doc("fila-impressao.md").tabela("Fila").registros()}
            r = fila.get(peca) or {}
            if "PLACAS" in str(r.get("Arquivo (caminho relativo)") or "").upper():
                return True
            for e in self.repo._doc("impressoes.md").tabela("Estimativas").registros():
                if e.get("Peça") == peca:
                    return minutos_do_texto(e.get("Tempo")) > CAMADA1_MIN
        except Exception:  # noqa: BLE001
            log.exception("não consegui ver se %s pede a foto da 1ª camada", peca)
        return False

    def _durante(self, st, atual):
        """A cada rodada com a impressora imprimindo: foto da 1ª camada (F7) e quadros do timelapse (F4)."""
        cfg = self.config
        if cfg is None:
            return
        mudou = False
        if not atual.get("chave"):
            atual["chave"] = self._chave(atual.get("peca"))
            mudou = True
        camada = st.get("camada") or 0
        if not atual.get("camada1_feita") and camada >= 2:
            atual["camada1_feita"] = True
            mudou = True
            if self._peca_pede_camada1(atual.get("peca")):
                foto = self._guardar_foto(PASTA_FOTOS, atual["chave"] + "_camada1.jpg")
                ev = {"peca": atual.get("peca", ""), "foto": foto, "quando": time.strftime("%Y-%m-%d %H:%M")}
                cfg["impressao_camada1"] = ev
                if self.avisos is not None:
                    self.avisos.avisar("primeira_camada", f"{ev['peca']}: 1ª camada pronta. Confira a foto no Selecta 3D "
                                                          "e pause se não estiver grudando bem.")
        tl = self.timelapse_cfg()
        if tl["ligado"] and time.time() - (atual.get("ultimo_quadro") or 0) >= tl["minutos"] * 60:
            n = int(atual.get("quadros") or 0) + 1
            if self._guardar_foto(f"{PASTA_TIMELAPSE}/{atual['chave']}", f"{n:04d}.jpg"):
                atual["quadros"] = n
            atual["ultimo_quadro"] = time.time()
            mudou = True
        if mudou:
            cfg["impressao_atual"] = atual

    def _montar_video(self, chave):
        """Junta os quadros num MP4 se o ffmpeg existir no PC (senão a tela passa as fotos em sequência)."""
        ffmpeg = shutil.which("ffmpeg") or next((p for p in (self.repo.caminho("PROGRAMAS/SELECTA-3D/ferramentas/ffmpeg.exe"),)
                                                  if os.path.isfile(p)), None)
        pasta = self.repo.caminho(f"{PASTA_TIMELAPSE}/{chave}")
        if not ffmpeg or not os.path.isdir(pasta) or len([n for n in os.listdir(pasta) if n.endswith(".jpg")]) < 5:
            return
        try:
            subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-framerate", "12", "-i", os.path.join(pasta, "%04d.jpg"),
                            "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", os.path.join(pasta, "timelapse.mp4")],
                           timeout=600, capture_output=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        except (OSError, subprocess.SubprocessError):
            log.exception("não consegui montar o timelapse")

    def midia(self):
        """Fotos e timelapses guardados, por chave (AAAA-MM-DD_HHMM_Fnn), para a tela de Impressões."""
        saida = {}
        pf = self.repo.caminho(PASTA_FOTOS)
        if os.path.isdir(pf):
            for n in sorted(os.listdir(pf)):
                m = re.fullmatch(r"(.+)_(fim|camada1)\.jpg", n)
                if m:
                    saida.setdefault(m.group(1), {})[m.group(2)] = f"{PASTA_FOTOS}/{n}"
        pt = self.repo.caminho(PASTA_TIMELAPSE)
        if os.path.isdir(pt):
            for d in sorted(os.listdir(pt)):
                p = os.path.join(pt, d)
                if not os.path.isdir(p):
                    continue
                quadros = sorted(n for n in os.listdir(p) if re.fullmatch(r"\d{4}\.jpg", n))
                item = saida.setdefault(d, {})
                item["quadros"] = [f"{PASTA_TIMELAPSE}/{d}/{n}" for n in quadros]
                if os.path.isfile(os.path.join(p, "timelapse.mp4")):
                    item["video"] = f"{PASTA_TIMELAPSE}/{d}/timelapse.mp4"
        for k, v in saida.items():
            m = re.match(r"(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})_(.*)", k)
            if m:
                v.update(data=m.group(1), hora=f"{m.group(2)}:{m.group(3)}", peca="" if m.group(4) == "sem-peca" else m.group(4))
        return saida

    # ------------------------------------------------------------ acompanhar e perceber o fim
    def verificar(self):
        """Uma rodada do acompanhamento (o laço chama a cada poucos segundos)."""
        try:
            st = self._status()
        except ErroDados:
            return None
        agora = st["estado"]
        self._estado_ant = agora
        cfg = self.config
        atual = (cfg["impressao_atual"] if cfg is not None else None) or None
        if agora in ATIVOS and not atual and cfg is not None:
            # começou por outro caminho (Reggae Slicer, painel da impressora): acompanha mesmo assim
            atual = {"peca": "", "arquivo": "", "gcode": st["arquivo"], "inicio": time.time(), "visto": True,
                     "chave": self._chave("")}
            cfg["impressao_atual"] = atual
        if agora in ATIVOS and atual:
            self._fins = 0
            if not atual.get("visto"):
                # primeira vez que a ponte mostra a impressão andando: o tempo real conta daqui
                atual["visto"] = True
                atual["inicio"] = time.time()
                if cfg is not None:
                    cfg["impressao_atual"] = atual
        if agora == "printing" and atual:
            try:
                self._durante(st, atual)
            except Exception:  # noqa: BLE001
                log.exception("erro nas fotos da impressão")
        if not atual or agora not in FIM:
            return None
        if not atual.get("visto"):
            # enviado, mas a ponte ainda não mostrou "imprimindo": não é fim (o "complete" pode ser da impressão anterior)
            if self._cancelar_pedido or time.time() - (atual.get("enviado") or atual.get("inicio") or 0) > ESPERA_INICIO:
                return self._nao_comecou(atual)
            return None
        self._fins += 1
        if agora not in FIM_CERTO and not self._cancelar_pedido and self._fins < LEITURAS_FIM:
            return None  # um "standby" isolado no meio da impressão não encerra nada
        self._fins = 0
        self._cancelar_pedido = False
        evento = {"resultado": FIM[agora], "peca": atual.get("peca", ""), "arquivo": atual.get("arquivo", ""),
                  "gcode": atual.get("gcode", ""), "minutos": round((time.time() - atual.get("inicio", time.time())) / 60),
                  "quando": time.strftime("%Y-%m-%d %H:%M")}
        chave = atual.get("chave") or self._chave(atual.get("peca"))
        evento["chave"] = chave
        evento["foto"] = self._guardar_foto(PASTA_FOTOS, chave + "_fim.jpg")  # F4
        if atual.get("quadros"):
            threading.Thread(target=self._montar_video, args=(chave,), daemon=True).start()
        if cfg is not None:
            cfg["impressao_evento"] = evento
            cfg["impressao_atual"] = None
        log.info("impressão terminou: %s", evento)
        if self.avisos is not None:  # A11: Telegram, se configurado
            tipo = {"concluída": "terminou", "falhou": "falhou", "cancelada": "cancelada"}.get(evento["resultado"], "terminou")
            nome = evento["peca"] or evento["gcode"] or "impressão"
            self.avisos.avisar(tipo, f"{nome}: {evento['resultado']} ({evento['minutos']} min).")
        return evento

    def _nao_comecou(self, atual):
        """O arquivo foi enviado e a impressora não começou: a peça volta para "fatiado" e a tela explica o que fazer."""
        cfg = self.config
        cancelada = self._cancelar_pedido
        self._cancelar_pedido = False
        self._fins = 0
        peca = atual.get("peca", "")
        evento = {"resultado": "não começou", "peca": peca, "arquivo": atual.get("arquivo", ""), "gcode": atual.get("gcode", ""),
                  "minutos": 0, "quando": time.strftime("%Y-%m-%d %H:%M"), "cancelada": cancelada}
        if peca:
            try:
                self.repo.fila_atualizar(peca, {"Status": "fatiado"}, None, autor="programa", origem="KX-Bridge")
            except Exception:  # noqa: BLE001
                log.exception("não consegui voltar %s para fatiado", peca)
        if cfg is not None:
            cfg["impressao_evento"] = evento
            cfg["impressao_atual"] = None
        log.warning("a impressora não começou: %s", evento)
        if self.avisos is not None and not cancelada:
            self.avisos.avisar("falhou", f"{peca or evento['gcode'] or 'impressão'}: enviei o arquivo e a Kobra X não começou. "
                                         "Confira a tela da impressora.")
        return evento

    def iniciar(self):
        """Laço em segundo plano; liga a ponte junto se o usuário pediu."""
        if self.config is not None and self.config["ponte_auto"] and self.instalada():
            threading.Thread(target=self._ligar_silencioso, daemon=True).start()
        self._thread = threading.Thread(target=self._laco, daemon=True)
        self._thread.start()

    def _ligar_silencioso(self):
        try:
            self.ligar()
        except Exception:  # noqa: BLE001
            log.exception("não consegui ligar o KX-Bridge")

    def _laco(self):
        while not self._parar.wait(self.intervalo):
            try:
                self.verificar()
            except Exception:  # noqa: BLE001
                log.exception("erro acompanhando a impressora")

    def encerrar(self):
        self._parar.set()
        self.desligar()
