"""Fatiador dentro do Selecta 3D: as funções básicas de fatiar, com o Reggae Slicer (ou o OrcaSlicer
oficial, enquanto o Reggae Slicer não estiver instalado) chamado por linha de comando.

- Tudo do fatiador fica em `PROGRAMAS/REGGAE-SLICER/` (fora da lista de Arquivos):
  `reggae-slicer/` (o fork, quando instalado), `orca-oficial/`, `perfis/` (Kobra X, completos),
  `dados-orca/` (configuração própria) e `saidas/<data>_<modelo>/`.
- "Abrir no Reggae Slicer" abre o arquivo na janela do programa, para alterações que a aba não faz.
- Nunca grava nos .md: a estimativa é salva pela interface, pela rota normal `/api/estimativa/salvar`.
- Não conversa com a impressora.
"""
import datetime
import json
import logging
import os
import re
import shlex
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
import zipfile
from xml.sax.saxutils import quoteattr

from .dados import ARQ_ESTOQUE, ARQ_FILA, COLUNA_FATIADO, ErroDados, formatar_minutos, formatar_numero, hoje

log = logging.getLogger("organizador")

VERSAO_ORCA = "OrcaSlicer 2.5.2"
EXT_FATIAVEIS = {".stl", ".3mf", ".obj", ".step", ".stp", ".amf"}
LIMITE_SEGUNDOS = 20 * 60
# andamento: com --debug 4 o fatiador escreve no log "default_status_callback: percent=N, warning_step=-1, message=..."
RE_ANDAMENTO = re.compile(r"percent=(\d+), warning_step=-1, message=(.*?), message_type=")
ETAPAS = {"Slicing mesh": "Fatiando a malha", "Generating walls": "Gerando as paredes",
          "Generating infill regions": "Gerando o preenchimento", "Generating infill toolpath": "Gerando o preenchimento",
          "Checking support necessity": "Conferindo os suportes", "Generating support": "Gerando os suportes",
          "Detect overhangs for auto-lift": "Conferindo as saliências", "Generating skirt & brim": "Gerando a saia e a borda",
          "Optimizing toolpath": "Otimizando o caminho", "Generating G-code": "Gerando o G-code"}
# o perfil oficial da Kobra X traz 0, mas a linha de comando do Orca 2.5.2 só aceita 10 a 18
# (não muda nada na impressão: a retração longa no corte está desligada)
CORTE_PADRAO = "18"
# status em que a peça pode passar para "fatiado" sozinha
STATUS_ANTES_DE_FATIAR = {"aguardando modelo", "pronto para fatiar", "fatiado"}
MAX_CORES = 4  # a Kobra X tem 4 slots
# filamento do estoque: "estoque/<nome do perfil>", um dos filamentos que a ponte grava em dados-orca
PREFIXO_ESTOQUE = "estoque/"
# chaves do perfil do estoque que não passam para o perfil completo montado para o fatiamento
CHAVES_META = {"from", "inherits", "is_custom_defined", "version", "name", "filament_settings_id", "filament_colour",
               "setting_id", "filament_id", "base_id", "instantiation", "updated_time", "user_id"}


def _norm(t):
    return str(t or "").lower().strip()


PROGRAMAS_ABRIR = ("anycubic", "reggae")  # botões "Abrir no …" do Painel e da Fila


class Fatiador:
    def __init__(self, repo, pasta, comando=None, config=None):
        self.repo = repo
        self.config = config  # guarda o fatiador padrão dos botões Abrir (fatiador_abrir)
        self.pasta = os.path.realpath(pasta)
        self.perfis = os.path.join(self.pasta, "perfis")
        self.saidas = os.path.join(self.pasta, "saidas")
        self.dados_orca = os.path.join(self.pasta, "dados-orca")
        # para testes fora do Windows: ORGANIZADOR_ORCA="xvfb-run -a /caminho/orca"
        self._comando = comando or (shlex.split(os.environ["ORGANIZADOR_ORCA"]) if os.environ.get("ORGANIZADOR_ORCA") else None)
        self.trava = threading.Lock()
        self.trabalhos = {}
        self.ocupado = False

    # ------------------------------------------------------------ executável e perfis
    def executavel(self):
        if self._comando:
            return self._comando
        # o Reggae Slicer (fork) tem prioridade; o Orca oficial fica como reserva
        for sub in ("reggae-slicer", "orca-oficial"):
            p = os.path.join(self.pasta, sub, "orca-slicer.exe")
            if os.path.isfile(p):
                return [p]
        # zip extraído com o nome original (ex.: OrcaSlicer_Windows_V2.5.2_x64_portable)
        try:
            for nome in sorted(os.listdir(self.pasta)):
                p = os.path.join(self.pasta, nome, "orca-slicer.exe")
                if nome.lower().startswith("orcaslicer") and os.path.isfile(p):
                    return [p]
        except OSError:
            pass
        return None

    def _indice(self):
        try:
            with open(os.path.join(self.perfis, "indice.json"), encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return []

    def listar_perfis(self):
        idx = self._indice()
        proc = [{"arquivo": i["arquivo"], "nome": i["perfil_orca"].split(" @")[0]} for i in idx if i["tipo"] == "processo"]
        fil = [{"arquivo": i["arquivo"], "nome": i["perfil_orca"].split(" @")[0]} for i in idx if i["tipo"] == "filamento"]
        return proc, fil

    def _pasta_estoque(self):
        return os.path.join(self.dados_orca, "user", "default", "filament")

    def listar_estoque(self):
        """Filamentos do estoque (um por cor, gravados pela ponte do Reggae Slicer): nome, cor e arquivo."""
        res = []
        try:
            nomes = sorted(n for n in os.listdir(self._pasta_estoque()) if n.lower().endswith(".json"))
        except OSError:
            return res
        for n in nomes:
            try:
                with open(os.path.join(self._pasta_estoque(), n), encoding="utf-8") as f:
                    d = json.load(f)
            except (OSError, ValueError):
                continue
            nome = n[:-5]
            cor = d.get("default_filament_colour") or d.get("filament_colour") or [""]
            cor = cor[0] if isinstance(cor, list) and cor else (cor if isinstance(cor, str) else "")
            res.append({"arquivo": PREFIXO_ESTOQUE + nome, "nome": nome, "hex": cor})
        return res

    def _filamento_do_estoque(self, nome, pasta_tmp, i):
        """Perfil completo de um filamento do estoque: o perfil da Kobra X de que ele herda, com as mudanças dele
        (cor, temperatura, marca, preço). A linha de comando recebe tudo pronto, sem depender de herança."""
        with open(os.path.join(self._pasta_estoque(), nome + ".json"), encoding="utf-8") as f:
            d = json.load(f)
        base_rel = next((x["arquivo"] for x in self._indice() if x["tipo"] == "filamento" and x["perfil_orca"] == d.get("inherits")),
                        "filamento/anycubic_pla.json")
        with open(os.path.join(self.perfis, *base_rel.split("/")), encoding="utf-8") as f:
            perfil = json.load(f)
        perfil.update({k: v for k, v in d.items() if k not in CHAVES_META})
        perfil["name"] = nome
        perfil["filament_settings_id"] = [nome]
        cor = d.get("default_filament_colour") or d.get("filament_colour")
        if cor:
            perfil["default_filament_colour"] = cor
        caminho = os.path.join(pasta_tmp, f"filamento_{i + 1}.json")
        with open(caminho, "w", encoding="utf-8") as f:
            json.dump(perfil, f, ensure_ascii=False, indent=4)
        return caminho

    @staticmethod
    def _materiais_3mf(caminho):
        """3MF sem configuração de fatiador (gerado por script): cores das <base> e a cor de cada peça.
        Devolve (cores, item, peças) ou None; peças é [(id do objeto, nome, índice da cor)]."""
        try:
            with zipfile.ZipFile(caminho) as z:
                xml = z.read("3D/3dmodel.model").decode("utf-8", "replace")
        except (KeyError, OSError, zipfile.BadZipFile):
            return None
        bases = re.search(r"<basematerials\b[^>]*>(.*?)</basematerials>", xml, re.S)
        if not bases:
            return None
        cores = [{"nome": n, "hex": h} for n, h in re.findall(r'<base\b[^>]*name="([^"]*)"[^>]*displaycolor="(#[0-9A-Fa-f]{6})', bases.group(1))]
        pecas = [(int(i), n, int(k)) for i, n, k in
                 re.findall(r'<object\b[^>]*\bid="(\d+)"[^>]*\bname="([^"]*)"[^>]*\bpindex="(\d+)"', xml)]
        item = re.search(r'<item\b[^>]*\bobjectid="(\d+)"', xml)
        if not cores or not pecas or not item:
            return None
        return cores[:MAX_CORES], int(item.group(1)), pecas

    def cores_do_modelo(self, caminho):
        """Cores que o modelo pede, na ordem dos filamentos: [{nome, hex}]. STL e 3MF de uma cor: []."""
        if not caminho.lower().endswith(".3mf") or not os.path.isfile(caminho):
            return []
        cfg = self._configuracao_do_projeto(caminho)
        if cfg and isinstance(cfg.get("filament_colour"), list):
            return [{"nome": "", "hex": h} for h in cfg["filament_colour"][:MAX_CORES]]
        m = self._materiais_3mf(caminho)
        return m[0] if m else []

    def _com_extrusoras(self, origem, destino):
        """Cópia de um 3MF de script com cada peça no filamento da sua cor (Metadata/model_settings.config).
        O Reggae Slicer ignora as cores <basematerials>; sem isto, a peça toda sairia no filamento 1."""
        cores, item, pecas = self._materiais_3mf(origem)
        partes = "".join(
            f'    <part id="{i}" subtype="normal_part">\n      <metadata key="name" value={quoteattr(n)}/>\n'
            f'      <metadata key="extruder" value="{min(k, len(cores) - 1) + 1}"/>\n    </part>\n' for i, n, k in pecas)
        config = (f'<?xml version="1.0" encoding="UTF-8"?>\n<config>\n  <object id="{item}">\n'
                  f'    <metadata key="extruder" value="1"/>\n{partes}  </object>\n</config>\n')
        with zipfile.ZipFile(origem) as zin, zipfile.ZipFile(destino, "w", zipfile.ZIP_DEFLATED) as zout:
            for it in zin.infolist():
                if it.filename != "Metadata/model_settings.config":
                    zout.writestr(it, zin.read(it.filename))
            zout.writestr("Metadata/model_settings.config", config)

    def _perfil(self, rel, tipo):
        validos = {i["arquivo"] for i in self._indice() if i["tipo"] == tipo}
        if rel not in validos:
            raise ErroDados(f"perfil de {tipo} desconhecido")
        return os.path.join(self.perfis, *rel.split("/"))

    def programa(self):
        exe = self.executavel()
        if not exe or self._comando:
            return "OrcaSlicer (teste)" if self._comando else ""
        return "Reggae Slicer" if os.sep + "reggae-slicer" + os.sep in exe[0] else VERSAO_ORCA

    def estado(self):
        exe = self.executavel()
        proc, fil = self.listar_perfis()
        with self.trava:
            trab = sorted(self.trabalhos.values(), key=lambda t: t["inicio"], reverse=True)[:12]
            trab = [dict(t) for t in trab]
        return {
            "disponivel": bool(exe),
            "versao": self.programa() or VERSAO_ORCA,
            "reggae": self.programa() == "Reggae Slicer",
            "executavel": os.path.relpath(exe[0], self.repo.raiz).replace("\\", "/") if exe and not self._comando else "",
            "processos": proc,
            "filamentos": fil,
            "estoque": self.listar_estoque(),
            "padrao": {"processo": "processo/020_standard.json", "filamento": "filamento/print_pulse_pla.json"},
            "trabalhos": trab,
            "ocupado": self.ocupado,
            "anycubic": bool(self.anycubic_exe()),
            "abrir_padrao": self.padrao_abrir(),
            "recentes": self.recentes(),  # B2: últimos fatiados, também depois de reabrir o programa
        }

    def trabalho(self, jid):
        with self.trava:
            if jid not in self.trabalhos:
                raise ErroDados("fatiamento não encontrado")
            return dict(self.trabalhos[jid])

    def info_arquivo(self, rel):
        """Diz se um 3MF traz configurações salvas para a Kobra X (só esses podem usar "as do 3MF")."""
        p = self.repo.caminho_seguro(rel)
        cfg = self._configuracao_do_projeto(p) if p.lower().endswith(".3mf") and os.path.isfile(p) else None
        impressora = ""
        if cfg:
            impressora = str(cfg.get("printer_settings_id") or cfg.get("printer_model") or "")
        return {"tem_configuracao": bool(cfg), "impressora": impressora, "kobra_x": "kobra x" in impressora.lower(),
                "cores": self.cores_do_modelo(p)}

    # ------------------------------------------------------------ fatiar
    def fatiar(self, dados):
        exe = self.executavel()
        if not exe:
            raise ErroDados("fatiador não encontrado em PROGRAMAS/REGGAE-SLICER/reggae-slicer nem em PROGRAMAS/REGGAE-SLICER/orca-oficial")
        rel = str(dados.get("caminho") or "")
        modelo = self.repo.caminho_seguro(rel)
        ext = os.path.splitext(modelo)[1].lower()
        if not os.path.isfile(modelo) or ext not in EXT_FATIAVEIS:
            raise ErroDados("escolha um arquivo STL, 3MF, OBJ ou STEP da pasta")
        modo = dados.get("modo") or "perfil"
        if modo not in ("perfil", "projeto"):
            raise ErroDados("modo desconhecido")
        if modo == "projeto" and not self.info_arquivo(rel)["kobra_x"]:
            # um 3MF salvo para outra impressora sairia com a mesa e o G-code de início dela
            raise ErroDados("este arquivo não traz configurações salvas para a Kobra X; use os perfis da Kobra X")
        processo = filamento = None
        escolhas = []
        if modo == "perfil":
            processo = self._perfil(dados.get("processo") or "", "processo")
            # um filamento por cor do modelo (perfil da Kobra X ou filamento do estoque); sem a lista, o mesmo em todas
            escolhas = [str(x or "") for x in (dados.get("filamentos") or [])][:MAX_CORES]
            if escolhas:
                estoque = {e["arquivo"] for e in self.listar_estoque()}
                for e in escolhas:
                    if e.startswith(PREFIXO_ESTOQUE):
                        if e not in estoque:
                            raise ErroDados(f"filamento do estoque não encontrado: {e[len(PREFIXO_ESTOQUE):]}")
                    else:
                        self._perfil(e, "filamento")
                dados = dict(dados, filamento=dados.get("filamento") or (escolhas[0] if not escolhas[0].startswith(PREFIXO_ESTOQUE) else ""))
            else:
                filamento = self._perfil(dados.get("filamento") or "", "filamento")
        peca = str(dados.get("peca") or "")
        if peca and not re.fullmatch(r"F\d{2,}", peca):
            raise ErroDados("peça inválida")
        with self.trava:
            if self.ocupado:
                raise ErroDados("já tem um fatiamento em andamento; espere terminar")
            self.ocupado = True
            jid = uuid.uuid4().hex[:10]
            job = {"id": jid, "caminho": rel.replace("\\", "/"), "modo": modo, "peca": peca,
                   "processo": dados.get("processo") if modo == "perfil" else "",
                   "filamento": dados.get("filamento") if modo == "perfil" else "",
                   "escolhas": escolhas,
                   "salvar": bool(dados.get("salvar")) and bool(peca),
                   "status": "fatiando", "mensagem": "Fatiando…", "inicio": time.time()}
            self.trabalhos[jid] = job
        threading.Thread(target=self._rodar, args=(jid, exe, modelo, modo, processo, filamento, escolhas), daemon=True).start()
        return dict(job)

    @staticmethod
    def _configuracao_do_projeto(caminho):
        try:
            with zipfile.ZipFile(caminho) as z:
                return json.loads(z.read("Metadata/project_settings.config").decode("utf-8"))
        except (KeyError, OSError, ValueError, zipfile.BadZipFile):
            return None

    @staticmethod
    def _corrigir_corte(valor):
        if isinstance(valor, list):
            return [CORTE_PADRAO if str(v) in ("0", "") else v for v in valor]
        return CORTE_PADRAO if str(valor) in ("0", "") else valor

    def _copiar_projeto(self, origem, destino):
        """Cópia do 3MF com a correção do `retraction_distances_when_cut` (o original não é tocado)."""
        with zipfile.ZipFile(origem) as zin, zipfile.ZipFile(destino, "w", zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                conteudo = zin.read(item.filename)
                if item.filename == "Metadata/project_settings.config":
                    cfg = json.loads(conteudo.decode("utf-8"))
                    if "retraction_distances_when_cut" in cfg:
                        cfg["retraction_distances_when_cut"] = self._corrigir_corte(cfg["retraction_distances_when_cut"])
                    conteudo = json.dumps(cfg, indent=4, ensure_ascii=False).encode("utf-8")
                zout.writestr(item, conteudo)

    def _quantos_filamentos(self, modelo):
        cfg = self._configuracao_do_projeto(modelo) if modelo.lower().endswith(".3mf") else None
        if cfg and isinstance(cfg.get("filament_colour"), list):
            return max(1, min(MAX_CORES, len(cfg["filament_colour"])))
        return max(1, len(self.cores_do_modelo(modelo)))

    def _rodar(self, jid, exe, modelo, modo, processo, filamento, escolhas=()):
        job = self.trabalhos[jid]
        tmp = tempfile.mkdtemp(prefix="org3d-fatiar-")
        try:
            base = re.sub(r"[^A-Za-z0-9_-]+", "_", os.path.splitext(os.path.basename(modelo))[0]).strip("_")[:50] or "modelo"
            pasta_saida = os.path.join(self.saidas, datetime.datetime.now().strftime("%Y-%m-%d_%H%M%S") + "_" + base)
            os.makedirs(pasta_saida, exist_ok=True)
            os.makedirs(self.dados_orca, exist_ok=True)
            nome_saida = base + ".gcode.3mf"
            entrada = modelo
            cmd = list(exe) + ["--datadir", self.dados_orca]
            if modo == "projeto":
                entrada = os.path.join(tmp, base + ".3mf")
                self._copiar_projeto(modelo, entrada)
            else:
                if self._materiais_3mf(modelo) and not self._configuracao_do_projeto(modelo):
                    entrada = os.path.join(tmp, base + ".3mf")
                    self._com_extrusoras(modelo, entrada)
                if escolhas:
                    arquivos = [self._filamento_do_estoque(e[len(PREFIXO_ESTOQUE):], tmp, i) if e.startswith(PREFIXO_ESTOQUE)
                                else self._perfil(e, "filamento") for i, e in enumerate(escolhas)]
                else:
                    arquivos = [filamento] * self._quantos_filamentos(modelo)
                # menos escolhas que cores (a tela ainda não tinha lido as cores): repete a última
                arquivos += arquivos[-1:] * (self._quantos_filamentos(modelo) - len(arquivos))
                filamento = arquivos[0]
                cmd += ["--load-settings", f"{os.path.join(self.perfis, 'maquina', 'kobra_x_04.json')};{processo}",
                        "--load-filaments", ";".join(arquivos), "--orient", "0"]
                # STL ou 3MF de outra impressora: arruma na mesa da Kobra X; 3MF da Kobra X: mantém a posição
                if not (modelo.lower().endswith(".3mf") and self.info_arquivo(os.path.relpath(modelo, self.repo.raiz))["kobra_x"]):
                    cmd += ["--arrange", "1"]
            log_orca = os.path.join(tmp, "andamento.log")
            cmd += ["--slice", "0", "--export-3mf", nome_saida, "--outputdir", pasta_saida, "--export-statistics",
                    "--debug", "4", "--logfile", log_orca, entrada]
            inicio = time.time()
            job.update(progresso=2, etapa="Abrindo o modelo")
            p = self._executar(cmd, job, log_orca)
            with open(os.path.join(pasta_saida, "log-orca.txt"), "w", encoding="utf-8") as f:
                f.write(" ".join(cmd) + "\n\n" + (p.stdout or "") + "\n" + (p.stderr or ""))
            arquivo = os.path.join(pasta_saida, nome_saida)
            if p.returncode != 0 or not os.path.isfile(arquivo):
                msg = self._erro_do_orca(p, pasta_saida)
                job.update(status="erro", mensagem=msg, pasta=self._rel(pasta_saida))
                log.warning("fatiamento %s falhou: %s", jid, msg)
                return
            res = self._resultado(pasta_saida, modelo if modo == "perfil" else entrada, modo, filamento, escolhas)
            job.update(arquivo=self._rel(arquivo), pasta=self._rel(pasta_saida), duracao=round(time.time() - inicio, 1), **res)
            if job.get("salvar"):
                self._salvar_na_fila(job, processo, filamento)
            # "concluido" só depois de salvar: quem acompanha o trabalho já vê o resultado de salvar junto
            job.update(status="concluido", mensagem="Fatiado.", progresso=100, etapa="")
        except subprocess.TimeoutExpired:
            job.update(status="erro", mensagem="O fatiamento passou de 20 minutos e foi interrompido.")
        except OSError as e:
            job.update(status="erro", mensagem=f"Não consegui rodar o OrcaSlicer: {e}")
        except Exception as e:  # noqa: BLE001
            log.exception("erro no fatiador")
            job.update(status="erro", mensagem=f"Erro inesperado: {e}")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
            with self.trava:
                self.ocupado = False

    @staticmethod
    def andamento(texto):
        """(percentual, etapa) da última linha de andamento do log do fatiador, ou None."""
        ultimo = None
        for m in RE_ANDAMENTO.finditer(texto):
            ultimo = m
        if not ultimo:
            return None
        msg = ultimo.group(2).strip()
        base, _, resto = msg.partition(": layer ")
        etapa = ETAPAS.get(base, base)
        return int(ultimo.group(1)), etapa + (f" (camada {resto})" if resto else "")

    def _executar(self, cmd, job, log_orca):
        """Roda o fatiador e, enquanto ele trabalha, passa o andamento do log para o trabalho (a barra da tela)."""
        p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8",
                             errors="replace", creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        fim = time.time() + LIMITE_SEGUNDOS
        while True:
            try:
                out, err = p.communicate(timeout=0.5)
                break
            except subprocess.TimeoutExpired:
                if time.time() > fim:
                    p.kill()
                    p.communicate()
                    raise
            try:
                with open(log_orca, encoding="utf-8", errors="replace") as f:
                    a = self.andamento(f.read())
            except OSError:
                a = None
            if a:
                # 5–95% da barra para o fatiamento; o resto é abrir o modelo e salvar o arquivo
                job.update(progresso=max(job.get("progresso", 0), min(95, 5 + a[0] * 0.9)), etapa=a[1])
        return subprocess.CompletedProcess(cmd, p.returncode, out, err)

    # ------------------------------------------------------------ estimativa e status da peça
    def _indice_cores(self):
        """Cores dos rolos do estoque (nome e hex), como em ui/app.js indiceCores()."""
        try:
            regs = self.repo._doc(ARQ_ESTOQUE).tabela("Filamentos").registros()
        except Exception:  # noqa: BLE001
            return []
        mapa = {}
        for r in regs:
            n = _norm(r.get("Cor"))
            if n and n not in mapa:
                mapa[n] = {"nome": r.get("Cor", ""), "hex": r.get("Hex", "") or ""}
        entradas = [dict(v, chave=k) for k, v in mapa.items()]
        primeiras = {}
        for e in entradas:
            p = e["chave"].split(" ")[0]
            primeiras[p] = primeiras.get(p, 0) + 1
        for e in list(entradas):
            p = e["chave"].split(" ")[0]
            if p != e["chave"] and primeiras[p] == 1 and p not in mapa:
                entradas.append(dict(e, chave=p))
        return sorted(entradas, key=lambda e: -len(e["chave"]))

    @staticmethod
    def _cores_do_texto(texto, indice):
        """Cores de rolos citadas num texto, na ordem em que aparecem (como coresDoTexto() da interface)."""
        t = _norm(str(texto or "").split("(")[0])
        achadas = []
        letra = re.compile(r"[a-zà-ú]")
        for e in indice:
            k = e["chave"]
            i = t.find(k)
            while i >= 0:
                antes = i == 0 or not letra.match(t[i - 1])
                fim = i + len(k)
                depois = fim >= len(t) or not letra.match(t[fim])
                if antes and depois:
                    achadas.append((i, e["nome"]))
                    t = t[:i] + " " * len(k) + t[fim:]
                i = t.find(k, i + 1)
        vistos, res = set(), []
        for _, nome in sorted(achadas):
            if nome not in vistos:
                vistos.add(nome)
                res.append(nome)
        return res

    @staticmethod
    def _cor_parecida(hexa, indice):
        def rgb(h):
            m = re.fullmatch(r"#?([0-9a-fA-F]{6})", str(h or "").strip())
            return [int(m.group(1)[i:i + 2], 16) for i in (0, 2, 4)] if m else None
        a = rgb(hexa)
        if not a:
            return ""
        melhor, dist = "", None
        for e in indice:
            b = rgb(e["hex"])
            if b:
                d = sum((x - y) ** 2 for x, y in zip(a, b))
                if dist is None or d < dist:
                    melhor, dist = e["nome"], d
        return melhor

    def _salvar_na_fila(self, job, processo, filamento):
        """Grava a estimativa da peça e a marca como fatiada, pelas regras do Selecta 3D (dados.py)."""
        peca = job["peca"]
        try:
            fila = {r.get("ID"): r for r in self.repo._doc(ARQ_FILA).tabela("Fila").registros()}
            r = fila.get(peca)
            if not r:
                raise ErroDados(f"{peca} não está na fila")
            indice = self._indice_cores()
            fil = job.get("filamentos") or []
            da_fila = self._cores_do_texto(r.get("Filamento/cor"), indice)
            if len(fil) == 1:
                nomes = [(da_fila[0] if da_fila else "") or self._cor_parecida(fil[0]["hex"], indice) or "total"]
            else:
                nomes = [((da_fila[i] if len(da_fila) == len(fil) else "") or self._cor_parecida(f["hex"], indice)
                          or f"filamento {f['id']}") for i, f in enumerate(fil)]
            gramas = "; ".join(f"{n} {formatar_numero(round(f['gramas'], 1))}" for n, f in zip(nomes, fil))
            if job["modo"] == "projeto":
                perfil = "configurações salvas no 3MF"
            else:
                nomes_p = {i["arquivo"]: i["perfil_orca"].split(" @")[0] for i in self._indice()}
                nomes_p.update({e["arquivo"]: e["nome"] for e in self.listar_estoque()})
                fils = " + ".join(nomes_p.get(e, "") for e in job.get("escolhas") or [job["filamento"]])
                perfil = f"{nomes_p.get(job['processo'], '')}, {fils}"
            programa = self.programa() or VERSAO_ORCA
            purga = job.get("purga_g")
            self.repo.estimativa_salvar(peca, gramas, job.get("tempo", ""), f"{programa} (Selecta 3D)",
                                        f"Arquivo `{job['arquivo']}`; {perfil}; {job.get('camadas', 0)} camadas"
                                        + (f"; purga {formatar_numero(purga)} g" if purga else "") + ".")
            feito = "estimativa salva"
            status = r.get("Status", "")
            tem_coluna = COLUNA_FATIADO in r  # A02: caminho do fatiado na coluna própria (as crases ficam de reserva)
            if status in STATUS_ANTES_DE_FATIAR:
                obs = (r.get("Observações") or "").strip()
                frase = (f"Fatiado em {hoje()} ({programa}, {perfil}, {job.get('tempo', '')}, "
                         f"{formatar_numero(round(job.get('gramas_total', 0), 1))} g): `{job['arquivo']}`.")
                campos = {"Status": "fatiado", "Observações": f"{obs} {frase}".strip()}
                antes = {"Status": status, "Observações": r.get("Observações", "")}
                if tem_coluna:
                    campos[COLUNA_FATIADO] = f"`{job['arquivo']}`"
                    antes[COLUNA_FATIADO] = r.get(COLUNA_FATIADO, "")
                self.repo.fila_atualizar(peca, campos, antes)
                feito = f"estimativa salva e {peca} marcada como fatiada"
            job["salvo"] = feito
        except Exception as e:  # noqa: BLE001
            log.exception("não consegui salvar a estimativa do fatiamento")
            job["aviso_salvar"] = f"Fatiado, mas não consegui salvar na fila: {e}"

    # ------------------------------------------------------------ B2: últimos fatiados (sobrevive a reabrir)
    def recentes(self, n=12):
        saida = []
        try:
            pastas = sorted((d for d in os.listdir(self.saidas) if os.path.isdir(os.path.join(self.saidas, d))), reverse=True)
        except OSError:
            return saida
        pecas = {}
        try:
            for r in self.repo._doc(ARQ_FILA).tabela("Fila").registros():
                for m in re.findall(r"`([^`]+\.gcode(?:\.3mf)?)`", (r.get(COLUNA_FATIADO) or "") + " " + (r.get("Observações") or "")):
                    pecas[m.replace("\\", "/")] = r.get("ID", "")
        except Exception:  # noqa: BLE001
            pass
        for d in pastas:
            pasta = os.path.join(self.saidas, d)
            try:
                arq = next((x for x in os.listdir(pasta) if x.lower().endswith(".gcode.3mf")), None)
            except OSError:
                continue
            if not arq:
                continue
            rel = self._rel(os.path.join(pasta, arq))
            m = re.match(r"(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})", d)
            saida.append({"arquivo": rel, "pasta": self._rel(pasta), "peca": pecas.get(rel, ""),
                          "quando": f"{m.group(1)} {m.group(2)}:{m.group(3)}" if m else ""})
            if len(saida) >= n:
                break
        return saida

    def _rel(self, p):
        return os.path.relpath(p, self.repo.raiz).replace("\\", "/")

    @staticmethod
    def _erro_do_orca(p, pasta):
        try:
            with open(os.path.join(pasta, "result.json"), encoding="utf-8") as f:
                r = json.load(f)
            if r.get("error_string") and r.get("error_string") != "Success.":
                return f"O OrcaSlicer recusou: {r['error_string']}"
        except (OSError, ValueError):
            pass
        texto = ((p.stdout or "") + "\n" + (p.stderr or "")).strip().splitlines()
        uteis = [l for l in texto if re.search(r"error|erro|not in range|invalid|failed", l, re.I)]
        return ("O OrcaSlicer não gerou o arquivo (código %s). " % p.returncode) + " ".join((uteis or texto)[-3:])[:600]

    def _resultado(self, pasta, modelo, modo, filamento, escolhas=()):
        segundos, camadas, por_fil = 0.0, 0, {}
        for nome in sorted(os.listdir(pasta)):
            if re.fullmatch(r"plate_\d+\.statistics\.json", nome):
                with open(os.path.join(pasta, nome), encoding="utf-8") as f:
                    s = json.load(f).get("summary", {})
                segundos += float(s.get("time") or 0)
                camadas = max(camadas, int(s.get("layer_count") or 0))
                for fl in s.get("filaments") or []:
                    i = int(fl.get("id") or 0)
                    por_fil[i] = por_fil.get(i, 0.0) + float(fl.get("weight") or 0)
        cores = []
        cfg = self._configuracao_do_projeto(modelo) if str(modelo).lower().endswith(".3mf") else None
        do_estoque = {e["arquivo"]: e["hex"] for e in self.listar_estoque()}
        if escolhas and all(e in do_estoque for e in escolhas):
            cores = [do_estoque[e] for e in escolhas]  # a cor do rolo escolhido para cada filamento
        elif cfg and isinstance(cfg.get("filament_colour"), list):
            cores = cfg["filament_colour"]
        elif self.cores_do_modelo(str(modelo)):
            cores = [c["hex"] for c in self.cores_do_modelo(str(modelo))]
        elif filamento:
            try:
                with open(filamento, encoding="utf-8") as f:
                    c = json.load(f).get("default_filament_colour")
                cores = c if isinstance(c, list) else [c]
            except (OSError, ValueError):
                cores = []
        filamentos = [{"id": i, "gramas": round(g, 2), "hex": (cores[i - 1] if 0 < i <= len(cores) else "")}
                      for i, g in sorted(por_fil.items()) if g > 0]
        mins = int(round(segundos / 60))
        return {"segundos": round(segundos), "tempo": formatar_minutos(mins) if segundos else "",
                "camadas": camadas, "filamentos": filamentos,
                "gramas_total": round(sum(f["gramas"] for f in filamentos), 2),
                "purga_g": self._purga(pasta)}

    # F8: gramas gastos nas trocas de cor (purga e torre), lidos dos comentários do G-code fatiado
    RE_PURGA = [re.compile(r";\s*total filament used for wipe tower \[g\]\s*=\s*([\d.]+)", re.I),
                re.compile(r";\s*(?:total )?(?:flush|purge)[a-z ]*\[g\]\s*=\s*([\d.]+)", re.I),
                re.compile(r";\s*total filament (?:used )?(?:for )?(?:prime tower|wipe tower|flush)[^=\n]*=\s*([\d.]+)\s*g", re.I)]

    def _purga(self, pasta):
        try:
            nomes = [n for n in os.listdir(pasta) if n.lower().endswith(".gcode.3mf")]
            for n in nomes:
                with zipfile.ZipFile(os.path.join(pasta, n)) as z:
                    for interno in z.namelist():
                        if not interno.lower().endswith(".gcode"):
                            continue
                        with z.open(interno) as f:
                            # os totais ficam no começo (cabeçalho) ou no fim do G-code
                            dados = f.read()
                        texto = dados[:200000].decode("utf-8", "replace") + "\n" + dados[-200000:].decode("utf-8", "replace")
                        for rx in self.RE_PURGA:
                            m = rx.search(texto)
                            if m:
                                return round(float(m.group(1)), 1)
        except (OSError, ValueError, zipfile.BadZipFile):
            pass
        return None

    # ------------------------------------------------------------ abrir no Reggae Slicer (com janela)
    # ------------------------------------------------------------ abrir no Anycubic ou no Reggae Slicer
    @staticmethod
    def anycubic_exe():
        """Anycubic Slicer Next instalado (Arquivos de Programas ou só para o usuário)."""
        bases = [os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)"),
                 os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs") if os.environ.get("LOCALAPPDATA") else ""]
        for base in filter(None, bases):
            try:
                nomes = sorted(os.listdir(base))
            except OSError:
                continue
            for nome in nomes:
                n = nome.lower().replace(" ", "")
                if "anycubic" not in n or "slicer" not in n:
                    continue
                pasta = os.path.join(base, nome)
                try:
                    exes = [e for e in os.listdir(pasta) if e.lower().endswith(".exe") and "unins" not in e.lower()]
                except OSError:
                    continue
                exes.sort(key=lambda e: (0 if "slicer" in e.lower() else 1, len(e)))
                if exes:
                    return os.path.join(pasta, exes[0])
        return None

    def padrao_abrir(self):
        v = (self.config["fatiador_abrir"] if self.config is not None else None) or ""
        if v in PROGRAMAS_ABRIR:
            return v
        return "anycubic" if self.anycubic_exe() else "reggae"

    def definir_padrao(self, programa):
        if programa not in PROGRAMAS_ABRIR:
            raise ErroDados("fatiador desconhecido")
        if self.config is None:
            raise ErroDados("sem configuração")
        self.config["fatiador_abrir"] = programa
        return {"padrao": programa}

    def abrir_em(self, programa, rel):
        """Abre o arquivo no fatiador escolhido (ou no padrão)."""
        programa = programa or self.padrao_abrir()
        if programa == "reggae":
            return self.abrir_no_orca(rel)
        if programa != "anycubic":
            raise ErroDados("fatiador desconhecido")
        p = self.repo.caminho_seguro(rel) if rel else ""
        if p and not os.path.isfile(p):
            raise ErroDados("arquivo não encontrado")
        exe = self.anycubic_exe()
        if not exe:
            raise ErroDados("não achei o Anycubic Slicer Next instalado (Arquivos de Programas)")
        subprocess.Popen([exe] + ([p] if p else []), cwd=os.path.dirname(exe))
        return {"ok": True, "programa": "Anycubic Slicer Next"}

    def abrir_no_orca(self, rel):
        exe = self.executavel()
        if not exe or self._comando:
            raise ErroDados("fatiador não encontrado em PROGRAMAS/REGGAE-SLICER")
        p = self.repo.caminho_seguro(rel) if rel else ""
        if p and not os.path.isfile(p):
            raise ErroDados("arquivo não encontrado")
        os.makedirs(self.dados_orca, exist_ok=True)
        subprocess.Popen(list(exe) + ["--datadir", self.dados_orca] + ([p] if p else []), cwd=os.path.dirname(exe[0]))
        return {"ok": True, "programa": self.programa()}
