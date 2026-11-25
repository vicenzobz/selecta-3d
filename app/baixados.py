"""Arquivos de modelos baixados (extensão do navegador e botão Baixar) e licenças.

- A extensão avisa quando o navegador termina de baixar um 3MF, STL, STEP ou OBJ. O usuário escolhe o
  projeto e o programa MOVE o arquivo da pasta Downloads para `<pasta do projeto>/baixados/`
  (sem projeto: `BAIXADOS/`, direto), liga à referência da página (cria se não existir) e anota origem,
  autor e licença em `modelos.md`.
- Botão Baixar (Referências e Pesquisa): o Thingiverse deixa o programa baixar pela busca oficial
  (com a chave da Pesquisa); nos outros sites o programa abre a página no navegador e guarda o projeto
  escolhido, para a extensão já sugerir quando o download terminar.
- Licenças: detecta a licença no texto da página (Creative Commons por extenso ou abreviada, CC0, GPL,
  Standard Digital File License…) e lista o que ainda está sem licença.
"""
import json
import os
import re
import shutil
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import webbrowser

from .dados import (ARQ_MODELOS, ARQ_PROJETOS, ARQ_REFERENCIAS, CABECALHOS_WEB, TRAVA, ErroDados, hoje, limpar,
                    limpar_link, site_do_link)

EXTS_MODELO = (".3mf", ".stl", ".step", ".stp", ".obj")
PASTA_SEM_PROJETO = "BAIXADOS"
LIMITE_BYTES = 400 * 1024 * 1024
LICENCA_A_CONFERIR = "?"

# licenças mais comuns nos sites de modelos, para escolher na mão
LICENCAS_COMUNS = [
    "CC BY 4.0", "CC BY-SA 4.0", "CC BY-NC 4.0", "CC BY-NC-SA 4.0", "CC BY-ND 4.0", "CC BY-NC-ND 4.0", "CC0",
    "Standard Digital File License", "GNU GPL", "uso pessoal (licença do site)",
]


# ---------------------------------------------------------------- licença no texto
def identificar_licenca(texto):
    """Acha a licença num texto de página. Ex.: 'Creative Commons — Attribution — Noncommercial — Share Alike'
    -> 'CC BY-NC-SA'; 'cc-by-sa-4.0' / creativecommons.org/licenses/by-sa/4.0 -> 'CC BY-SA 4.0'."""
    t = str(texto or "")
    m = re.search(r"(?i)creativecommons\.org/licenses/((?:by)(?:-(?:nc|sa|nd)){0,2})/(\d\.\d)", t)
    if m:
        return "CC " + m.group(1).upper() + " " + m.group(2)
    if re.search(r"(?i)creativecommons\.org/publicdomain/zero|\bCC0\b|\bCC[ -]?ZERO\b", t):
        return "CC0"
    m = re.search(r"(?i)\bCC[ _-]?BY((?:[ _-]?(?:NC|SA|ND)){0,2})(?:[ _-]?(\d\.\d))?\b", t)
    if m:
        partes = ["BY"] + [p.upper() for p in re.findall(r"(?i)NC|SA|ND", m.group(1))]
        return "CC " + "-".join(partes) + (f" {m.group(2)}" if m.group(2) else "")
    m = re.search(r"(?i)creative\s*commons", t)
    if m:
        trecho = t[m.end():m.end() + 160]
        if re.search(r"(?i)public\s*domain|dom[ií]nio\s*p[uú]blico|zero", trecho[:40]):
            return "CC0"
        if re.search(r"(?i)attribution|atribui[cç][aã]o|\bBY\b", trecho):
            partes = ["BY"]
            if re.search(r"(?i)non[\s-]*commercial|n[aã]o[\s-]*comercial|\bNC\b", trecho):
                partes.append("NC")
            if re.search(r"(?i)share[\s-]*alike|compartilha[\s-]*igual|\bSA\b", trecho):
                partes.append("SA")
            if re.search(r"(?i)no[\s-]*deriv|sem[\s-]*deriva|\bND\b", trecho):
                partes.append("ND")
            v = re.search(r"\b(\d\.\d)\b", trecho)
            return "CC " + "-".join(partes) + (f" {v.group(1)}" if v else "")
    if re.search(r"(?i)public\s*domain|dom[ií]nio\s*p[uú]blico", t):
        return "domínio público"
    m = re.search(r"(?i)standard\s+digital\s+file\s+license|\bGNU\s*(?:L?GPL)(?:\s*v?\d(?:\.\d)?)?|\bMIT License\b", t)
    if m:
        return re.sub(r"\s+", " ", m.group(0)).strip()
    return ""


def licenca_da_pagina(pedacos):
    """Lê a licença do que a janela do programa colheu da página aberta (ver app/seletor.py, JS_LICENCA).

    pedacos = {"links": [hrefs de rel=license e de creativecommons.org], "jsonld": [campos license],
               "meta": [conteúdos de meta license/dc.rights], "perto": [textos perto de "License"/"Licença"],
               "texto": texto visível da página}
    Vai do mais confiável para o menos: link de licença > JSON-LD > meta > perto da palavra licença > página toda.
    Devolve {"licenca": "...", "fonte": "...", "certeza": "alta"|"media"|"baixa"} ou licenca vazia."""
    p = pedacos if isinstance(pedacos, dict) else {}
    lista = lambda k: [str(x)[:2000] for x in (p.get(k) or []) if x][:40]  # noqa: E731
    ordem = (("links", "link de licença na página", "alta"), ("jsonld", "dados estruturados da página", "alta"),
             ("meta", "metadados da página", "alta"), ("perto", "texto ao lado de \"Licença\"", "media"))
    for chave, fonte, certeza in ordem:
        for pedaco in lista(chave):
            # perto da palavra: olha primeiro o que vem logo depois de "Licença"/"License" (o bloco pode ter
            # outras licenças antes, de remixes ou de outros modelos da página)
            m = re.search(r"(?i)licen[cçs]", pedaco) if chave == "perto" else None
            lic = identificar_licenca(pedaco[m.start():m.start() + 300]) if m else ""
            lic = lic or identificar_licenca(pedaco)
            if lic:
                return {"licenca": lic, "fonte": fonte, "certeza": certeza, "trecho": pedaco[:160]}
    texto = str(p.get("texto") or "")[:200000]
    lic = identificar_licenca(texto)
    if lic:
        return {"licenca": lic, "fonte": "texto da página (confira: pode ser de outro modelo da página)",
                "certeza": "baixa", "trecho": ""}
    return {"licenca": "", "fonte": "", "certeza": "", "trecho": ""}


def nome_de_arquivo(nome):
    """Sem acento e sem espaço (convenção da pasta): 'Kobra X poop deflector.3mf' -> 'kobra_x_poop_deflector.3mf'."""
    base, ext = os.path.splitext(os.path.basename(str(nome or "")))
    base = unicodedata.normalize("NFKD", base).encode("ascii", "ignore").decode()
    base = re.sub(r"[^A-Za-z0-9._-]+", "_", base).strip("._-").lower()[:80] or "modelo"
    return base + ext.lower()


def chave_link(u):
    """Mesma página com ou sem idioma, ?from=…, #perfil ou nome no fim: site + número do modelo."""
    u = str(u or "").strip().lower()
    host = re.sub(r"^https?://(www\.)?", "", u).split("/")[0]
    n = id_modelo(u)
    if n and host:
        return f"{host}#{n}"
    u = re.sub(r"[?#].*$", "", re.sub(r"^https?://(www\.)?", "", u)).rstrip("/")
    return u


def id_modelo(url):
    """Número do modelo no link (Thingiverse thing:123, MakerWorld /models/123, Printables /model/123-nome)."""
    m = re.search(r"thing:(\d+)|/(?:models?|m)/(\d+)|/object/[^/?#]*?-(\d+)|/(\d+)\.html", str(url or ""))
    return next((g for g in (m.groups() if m else []) if g), "")


def pasta_downloads():
    """Pasta Downloads do Windows (onde o navegador salva)."""
    if os.name == "nt":
        try:
            import ctypes
            guid = (ctypes.c_byte * 16).from_buffer_copy(
                bytes.fromhex("90e24d373f126545916439c4925e467b"))  # FOLDERID_Downloads
            ptr = ctypes.c_wchar_p()
            if ctypes.windll.shell32.SHGetKnownFolderPath(ctypes.byref(guid), 0, None, ctypes.byref(ptr)) == 0:
                caminho = ptr.value
                ctypes.windll.ole32.CoTaskMemFree(ptr)
                if caminho:
                    return caminho
        except Exception:  # noqa: BLE001
            pass
    return os.path.join(os.path.expanduser("~"), "Downloads")


class Baixados:
    def __init__(self, repo, config=None, pasta_downloads_fn=pasta_downloads):
        self.repo = repo
        self.config = config
        self._pasta_downloads = pasta_downloads_fn
        self._esperados = {}  # chave do link -> (quando, projeto)
        self._trava = threading.Lock()

    # ------------------------------------------------------------ apoio
    def _tabela(self, arquivo, secao):
        doc = self.repo._doc(arquivo)
        return doc, doc.tabela(secao)

    def _projetos(self):
        _, tab = self._tabela(ARQ_PROJETOS, "Projetos")
        return [dict(zip(tab.cabecalho, l)) for l in tab.linhas]

    def _pasta_do_projeto(self, projeto):
        if not projeto:
            return PASTA_SEM_PROJETO
        p = next((p for p in self._projetos() if p.get("ID") == projeto), None)
        if not p:
            raise ErroDados(f"projeto {projeto} não existe")
        pasta = re.sub(r"^`|`$", "", (p.get("Pasta") or "").strip())
        if not pasta:
            raise ErroDados(f"o projeto {projeto} não tem pasta em projetos.md")
        return pasta.replace("\\", "/").strip("/")

    def _referencia_do_link(self, link):
        if not link:
            return None
        _, tab = self._tabela(ARQ_REFERENCIAS, "Referências")
        k = chave_link(link)
        for l in tab.linhas:
            r = dict(zip(tab.cabecalho, l))
            if r.get("Link") and chave_link(r["Link"]) == k:
                return r
        return None

    # ------------------------------------------------------------ contexto para a extensão
    def esperar(self, pagina, projeto):
        with self._trava:
            self._esperados[chave_link(pagina)] = (time.time(), projeto or "")

    def contexto(self, pagina):
        ref = self._referencia_do_link(pagina)
        projeto = None
        with self._trava:
            e = self._esperados.get(chave_link(pagina))
            if e and time.time() - e[0] < 3600:
                projeto = e[1]
        if projeto is None and ref:
            projeto = (ref.get("Projeto") or "").split(" ")[0]
        return {"referencia": ref, "projeto": projeto or "", "licencas": LICENCAS_COMUNS,
                "pasta_sem_projeto": PASTA_SEM_PROJETO}

    # ------------------------------------------------------------ receber um download do navegador
    def receber(self, d):
        origem = os.path.realpath(str(d.get("origem") or ""))
        if not origem or not os.path.isfile(origem):
            raise ErroDados("o arquivo baixado não está mais na pasta Downloads")
        if os.path.splitext(origem)[1].lower() not in EXTS_MODELO:
            raise ErroDados("só arquivos 3MF, STL, STEP e OBJ")
        downloads = os.path.realpath(self._pasta_downloads())
        if os.path.commonpath([os.path.normcase(origem), os.path.normcase(downloads)]) != os.path.normcase(downloads):
            raise ErroDados("só arquivos da pasta Downloads")
        projeto = str(d.get("projeto") or "").strip()
        destino_rel = self._destino(projeto, os.path.basename(origem))
        destino = self.repo.caminho_seguro(destino_rel)
        os.makedirs(os.path.dirname(destino), exist_ok=True)
        shutil.move(origem, destino)
        return self.registrar(destino_rel, d, projeto, "extensão do navegador")

    def _destino(self, projeto, nome):
        pasta = f"{self._pasta_do_projeto(projeto)}/baixados" if projeto else PASTA_SEM_PROJETO
        nome = nome_de_arquivo(nome)
        base, ext = os.path.splitext(nome)
        rel, n = f"{pasta}/{nome}", 2
        while os.path.exists(self.repo.caminho_seguro(rel)):
            rel, n = f"{pasta}/{base}_{n}{ext}", n + 1
        return rel

    def registrar(self, rel, d, projeto, como):
        """Liga o arquivo à referência da página (cria se não existir) e anota em modelos.md."""
        pagina = limpar_link(str(d.get("pagina") or ""))
        licenca = limpar(d.get("licenca")) or ""
        autor = limpar(d.get("autor"))
        titulo = limpar(d.get("titulo")) or os.path.splitext(os.path.basename(rel))[0]
        site = limpar(d.get("site")) or (site_do_link(pagina) if pagina else "")
        ref_id = ""
        with TRAVA:
            if pagina:
                doc, tab = self._tabela(ARQ_REFERENCIAS, "Referências")
                k = chave_link(pagina)
                i = next((j for j, l in enumerate(tab.linhas)
                          if dict(zip(tab.cabecalho, l)).get("Link") and chave_link(dict(zip(tab.cabecalho, l))["Link"]) == k), -1)
                item = f"`{rel}`"
                if i >= 0:
                    r = dict(zip(tab.cabecalho, tab.linhas[i]))
                    ref_id = r["ID"]
                    arquivos = r.get("Arquivos") or ""
                    if item not in arquivos:
                        arquivos = (arquivos + ", " + item).strip(", ")
                    projs = (r.get("Projeto") or "").split()
                    if projeto and projeto not in projs:
                        projs.append(projeto)
                    novos = {"Arquivos": arquivos, "Projeto": " ".join(projs)}
                    if licenca and licenca != LICENCA_A_CONFERIR and not r.get("Licença"):
                        novos["Licença"] = licenca
                    if autor and not r.get("Autor"):
                        novos["Autor"] = autor
                    for col, v in novos.items():
                        tab.linhas[i][tab.indice_coluna(col)] = limpar(v)
                    tab.aplicar()
                    self.repo._gravar(ARQ_REFERENCIAS, doc)
                else:
                    ref_id = self.repo.tabela_adicionar(ARQ_REFERENCIAS, "Referências", {
                        "Título": titulo, "Link": pagina, "Site": site, "Tipo": "quero fazer", "Status": "salvo",
                        "Projeto": projeto, "Autor": autor,
                        "Licença": licenca if licenca != LICENCA_A_CONFERIR else "",
                        "Arquivos": item, "Observações": f"Criada ao baixar o arquivo ({hoje()}).",
                    })["id"]
            doc, tab = self._tabela(ARQ_MODELOS, "Origem dos modelos")
            origem = f"{site} — {titulo}" if site else titulo
            if ref_id:
                origem += f" ({ref_id})"
            obs = (f"Baixado em {hoje()} ({como})" + (f" de {pagina}" if pagina else "")
                   + ". Original baixado: não editar, copiar antes.")
            tab.linhas.append(tab.registro_para_celulas({
                "Caminho": f"`{rel}`", "Origem": origem, "Autor": autor or "?",
                "Licença": licenca or LICENCA_A_CONFERIR, "Observações": obs}))
            tab.aplicar()
            self.repo._gravar(ARQ_MODELOS, doc)
        return {"caminho": rel, "referencia": ref_id, "licenca": licenca or LICENCA_A_CONFERIR}

    # ------------------------------------------------------------ licença
    def salvar_licenca(self, licenca, referencia=None, caminho=None):
        """Grava a licença na referência e em todas as linhas de modelos.md dos arquivos dela (ou num caminho)."""
        licenca = limpar(licenca)
        if not licenca:
            raise ErroDados("escolha a licença")
        mudou = []
        with TRAVA:
            caminhos = set()
            if caminho:
                caminhos.add(re.sub(r"^`|`$", "", caminho))
            if referencia:
                doc, tab = self._tabela(ARQ_REFERENCIAS, "Referências")
                i = tab.achar("ID", referencia)
                if i < 0:
                    raise ErroDados(f"{referencia} não existe mais")
                r = dict(zip(tab.cabecalho, tab.linhas[i]))
                caminhos.update(re.findall(r"`([^`]+)`", r.get("Arquivos") or ""))
                if licenca != LICENCA_A_CONFERIR:
                    tab.linhas[i][tab.indice_coluna("Licença")] = licenca
                    tab.aplicar()
                    self.repo._gravar(ARQ_REFERENCIAS, doc)
                    mudou.append(referencia)
            if caminhos:
                doc, tab = self._tabela(ARQ_MODELOS, "Origem dos modelos")
                k = tab.indice_coluna("Licença")
                alterou = False
                for l in tab.linhas:
                    c = re.sub(r"^`|`$", "", dict(zip(tab.cabecalho, l)).get("Caminho") or "")
                    if any(c == x or x.startswith(c.rstrip("/") + "/") or c.startswith(x.rstrip("/") + "/") for x in caminhos):
                        l[k] = licenca
                        alterou = True
                        mudou.append(c)
                if alterou:
                    tab.aplicar()
                    self.repo._gravar(ARQ_MODELOS, doc)
        return {"mudou": mudou}

    def revisao(self):
        """O que está sem licença: arquivos em modelos.md e referências 'quero fazer' ou com arquivos."""
        _, tm = self._tabela(ARQ_MODELOS, "Origem dos modelos")
        _, tr = self._tabela(ARQ_REFERENCIAS, "Referências")
        refs = [dict(zip(tr.cabecalho, l)) for l in tr.linhas]
        sem = lambda v: not (v or "").strip() or (v or "").strip() == LICENCA_A_CONFERIR  # noqa: E731
        modelos = []
        for l in tm.linhas:
            m = dict(zip(tm.cabecalho, l))
            if sem(m.get("Licença")):
                c = re.sub(r"^`|`$", "", m.get("Caminho") or "")
                ref = next((r for r in refs if c and c in (r.get("Arquivos") or "")), None)
                modelos.append({"caminho": c, "origem": m.get("Origem", ""), "autor": m.get("Autor", ""),
                                "referencia": ref["ID"] if ref else "", "link": ref.get("Link", "") if ref else
                                (re.search(r"https?://\S+", m.get("Observações") or "") or [""])[0]})
        referencias = [{"id": r["ID"], "titulo": r.get("Título", ""), "link": r.get("Link", ""), "site": r.get("Site", ""),
                        "tipo": r.get("Tipo", ""), "arquivos": bool(r.get("Arquivos"))}
                       for r in refs if sem(r.get("Licença")) and r.get("Status") != "descartado"
                       and (r.get("Tipo") == "quero fazer" or r.get("Arquivos"))]
        return {"modelos": modelos, "referencias": referencias, "licencas": LICENCAS_COMUNS}

    # ------------------------------------------------------------ botão Baixar
    def baixar(self, d):
        """Thingiverse com chave: baixa direto. Outros: abre a página e espera o download pela extensão."""
        link = limpar_link(str(d.get("link") or ""))
        ref = d.get("referencia")
        if ref and not link:
            _, tab = self._tabela(ARQ_REFERENCIAS, "Referências")
            i = tab.achar("ID", ref)
            if i < 0:
                raise ErroDados(f"{ref} não existe mais")
            r = dict(zip(tab.cabecalho, tab.linhas[i]))
            link = r.get("Link", "")
            d = {**d, "titulo": d.get("titulo") or r.get("Título"), "autor": d.get("autor") or r.get("Autor"),
                 "site": d.get("site") or r.get("Site")}
        if not re.match(r"^https?://", link or "", re.I):
            raise ErroDados("a referência não tem link")
        projeto = str(d.get("projeto") or "").strip()
        self._pasta_do_projeto(projeto)  # confere antes
        chaves = (self.config["pesquisa"] if self.config is not None else None) or {}
        token = str(chaves.get("thingiverse_token") or "").strip()
        if "thingiverse.com" in link and token and id_modelo(link):
            return self._baixar_thingiverse(link, id_modelo(link), token, projeto, d)
        self.esperar(link, projeto)
        webbrowser.open(link)
        return {"abriu": True, "link": link}

    def _baixar_thingiverse(self, link, thing, token, projeto, d):
        cab = {**CABECALHOS_WEB, "Authorization": "Bearer " + token, "Accept": "application/json"}

        def pegar(url, binario=False):
            req = urllib.request.Request(url, headers=cab)
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    dados = r.read(LIMITE_BYTES + 1)
            except urllib.error.HTTPError as e:
                raise ErroDados(f"o Thingiverse respondeu com erro {e.code}")
            except (urllib.error.URLError, OSError) as e:
                raise ErroDados(f"não consegui falar com o Thingiverse ({getattr(e, 'reason', '') or e})")
            if len(dados) > LIMITE_BYTES:
                raise ErroDados("arquivo grande demais")
            return dados if binario else json.loads(dados.decode("utf-8"))

        info = pegar(f"https://api.thingiverse.com/things/{thing}")
        arquivos = pegar(f"https://api.thingiverse.com/things/{thing}/files")
        licenca = identificar_licenca(info.get("license") if isinstance(info, dict) else "") or \
            (limpar(info.get("license")) if isinstance(info, dict) else "")
        dados_reg = {"pagina": link, "licenca": licenca, "titulo": d.get("titulo") or info.get("name"),
                     "autor": d.get("autor") or (info.get("creator") or {}).get("name"), "site": "Thingiverse"}
        feitos = []
        for a in arquivos if isinstance(arquivos, list) else []:
            nome = a.get("name") or ""
            if os.path.splitext(nome)[1].lower() not in EXTS_MODELO or not a.get("download_url"):
                continue
            conteudo = pegar(a["download_url"], binario=True)
            rel = self._destino(projeto, nome)
            caminho = self.repo.caminho_seguro(rel)
            os.makedirs(os.path.dirname(caminho), exist_ok=True)
            with open(caminho, "wb") as f:
                f.write(conteudo)
            feitos.append(self.registrar(rel, dados_reg, projeto, "botão Baixar, Thingiverse"))
        if not feitos:
            raise ErroDados("o Thingiverse não mostrou arquivos 3MF, STL, STEP ou OBJ nesse modelo")
        return {"baixou": [f["caminho"] for f in feitos], "referencia": feitos[0]["referencia"],
                "licenca": licenca or LICENCA_A_CONFERIR}
