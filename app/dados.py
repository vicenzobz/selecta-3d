"""Regras de negócio do organizador: fila, estoque, compras, projetos e arquivos.

Todos os dados vivem nos .md da raiz. Cada operação lê o arquivo de novo,
muda só o necessário e grava; nada fica guardado em memória entre chamadas.
"""
import base64
import datetime
import hashlib
import json
import os
import re
import subprocess
import threading
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
import zipfile
from html.parser import HTMLParser

from . import mdtabela as md

ARQ_FILA = "fila-impressao.md"
ARQ_ESTOQUE = "estoque.md"
ARQ_COMPRAS = "compras.md"
ARQ_PROJETOS = "projetos.md"
ARQ_IMPRESSOES = "impressoes.md"
ARQ_MODELOS = "modelos.md"
ARQ_IMPRESSORA = "impressora.md"
ARQ_REFERENCIAS = "referencias.md"
ARQ_DIARIO = "diario.md"
ARQUIVOS_DADOS = [ARQ_FILA, ARQ_ESTOQUE, ARQ_COMPRAS, ARQ_PROJETOS, ARQ_IMPRESSOES, ARQ_MODELOS, ARQ_REFERENCIAS, ARQ_DIARIO]
# Pastas fixas, relativas à raiz D:\IMPRESSÃO 3D (reorganização de 2026-11-23: programas em PROGRAMAS/, projetos em PROJETOS/)
PASTA_PROGRAMAS = "PROGRAMAS"
PASTA_ORGANIZADOR = f"{PASTA_PROGRAMAS}/SELECTA-3D"  # a pasta do programa (até princ-v01: PROGRAMAS/ORGANIZADOR)
PASTA_REGGAE = f"{PASTA_PROGRAMAS}/REGGAE-SLICER"
PASTA_REFERENCIAS = f"{PASTA_ORGANIZADOR}/referencias"
PASTA_IMAGENS_REF = f"{PASTA_REFERENCIAS}/imagens"
# Arquivos de dados que não ficam na raiz. O nome curto (ex.: "referencias.md") continua sendo a chave usada
# pela tela, pela extensão e pela API; só o lugar no disco muda (Repositorio.caminho).
LOCAL_ARQUIVOS = {ARQ_REFERENCIAS: f"{PASTA_REFERENCIAS}/referencias.md"}

# tabelas editáveis pelo caminho genérico: (arquivo, seção) -> prefixo do ID (None = sem ID)
TABELAS_GENERICAS = {
    (ARQ_ESTOQUE, "Filamentos"): "R",
    (ARQ_ESTOQUE, "Insumos e peças"): "I",
    (ARQ_COMPRAS, "Compras"): "C",
    (ARQ_COMPRAS, "Prazos"): None,
    (ARQ_PROJETOS, "Projetos"): "P",
    (ARQ_PROJETOS, "Materiais"): None,
    (ARQ_IMPRESSOES, "Estimativas"): None,
    (ARQ_IMPRESSOES, "Impressões"): None,
    (ARQ_MODELOS, "Origem dos modelos"): None,
    (ARQ_REFERENCIAS, "Referências"): "RF",
}

CAB_REFERENCIAS = ["ID", "Título", "Link", "Site", "Tipo", "Status", "Projeto", "Tags", "Autor", "Licença",
                   "Imagem", "Arquivos", "Fila", "Observações"]

SITES = [
    ("printables.com", "Printables"), ("makerworld.com", "MakerWorld"), ("thingiverse.com", "Thingiverse"),
    ("thangs.com", "Thangs"), ("cults3d.com", "Cults"), ("myminifactory.com", "MyMiniFactory"),
    ("makeronline.com", "Makeronline"), ("anycubic.com", "Anycubic"), ("bambulab.com", "Bambu Lab"),
    ("thingiverse", "Thingiverse"), ("3dgo.app", "3DGO"), ("sketchfab.com", "Sketchfab"),
    ("cgtrader.com", "CGTrader"), ("instructables.com", "Instructables"), ("youtube.com", "YouTube"),
    ("youtu.be", "YouTube"), ("instagram.com", "Instagram"), ("pinterest.", "Pinterest"),
    ("tiktok.com", "TikTok"), ("reddit.com", "Reddit"), ("github.com", "GitHub"), ("etsy.com", "Etsy"),
    ("grabcad.com", "GrabCAD"), ("onshape.com", "Onshape"), ("tinkercad.com", "Tinkercad"),
    ("stlfinder.com", "STLFinder"), ("all3dp.com", "All3DP"), ("makezine.com", "Make:"), ("prusa3d.com", "Prusa"),
    ("3dprint.com", "3DPrint.com"), ("3dnatives.com", "3Dnatives"), ("3dsourced.com", "3DSourced"),
    # lojas (a extensão do navegador sugere "Compra" nesses sites)
    ("mercadolivre.com", "Mercado Livre"), ("mercadolibre.", "Mercado Livre"), ("amazon.", "Amazon"),
    ("shopee.", "Shopee"), ("aliexpress.", "AliExpress"), ("kabum.com", "KaBuM!"), ("magazineluiza.com", "Magalu"),
    ("magalu.com", "Magalu"), ("americanas.com", "Americanas"), ("temu.com", "Temu"), ("shein.com", "Shein"),
    ("casasbahia.com", "Casas Bahia"), ("leroymerlin.com", "Leroy Merlin"),
]
LOJAS = {"Mercado Livre", "Amazon", "Shopee", "AliExpress", "KaBuM!", "Magalu", "Americanas", "Temu", "Shein",
         "Casas Bahia", "Leroy Merlin"}

CAB_ESTIMATIVAS = ["Peça", "Gramas por cor", "Tempo", "Fonte", "Observações"]
CAB_IMPRESSOES = ["Data", "Peça", "Resultado", "Tempo estimado", "Tempo real", "Gramas", "Custo (R$)",
                  "Rolos", "Motivo da falha", "Observações"]
CAB_MATERIAIS = ["Projeto", "Item", "Quantidade", "Unidade", "Estoque", "Compra", "Observações"]
CAB_MODELOS = ["Caminho", "Origem", "Autor", "Licença", "Observações"]


def _tabela_vazia(cab):
    return md.montar_linha(cab) + "\n|" + "---|" * len(cab) + "\n"


MODELO_IMPRESSOES = f"""# Impressões — estimativas e histórico

Caminhos relativos à raiz `D:\\IMPRESSÃO 3D`. Criado pelo programa `SELECTA-3D/` (que lê e grava estas tabelas).

## Regras

- O Selecta 3D lê e grava estas tabelas (você também pode editar à mão). **Antes de editar, leia o arquivo de novo.** Mantenha o formato.
- **Estimativas:** uma linha por peça da fila (ID F…) com o que o fatiador prevê. Gramas por cor no formato `azul 60; branco quente 47` (use `total 107` quando não der para separar por cor). Tempo como `5h12` ou `45 min`.
- **Impressões:** uma linha por impressão registrada (concluída ou falhou). Só acrescentar; não apagar linhas.
- Custo = gramas × preço do rolo ÷ peso do rolo (de `estoque.md`). Só material, sem energia.

## Estimativas

{_tabela_vazia(CAB_ESTIMATIVAS)}
## Impressões

{_tabela_vazia(CAB_IMPRESSOES)}"""

MODELO_MODELOS = f"""# Origem dos modelos

Caminhos relativos à raiz `D:\\IMPRESSÃO 3D`. Criado pelo programa `SELECTA-3D/` (que lê e grava esta tabela).

## Regras

- **Caminho** é um arquivo ou uma pasta, entre crases. Vale para tudo o que está dentro; o caminho mais específico vence.
- **Licença** como o autor publicou (ex.: CC BY-SA 4.0). Modelo próprio: `própria`. `?` = a conferir.
- Arquivos originais baixados não são editados: copie antes de alterar.

## Origem dos modelos

{_tabela_vazia(CAB_MODELOS)}"""

MODELO_REFERENCIAS = f"""# Referências — projetos de outros sites

Caminhos relativos à raiz `D:\\IMPRESSÃO 3D`. Criado pelo programa `SELECTA-3D/` (que lê e grava esta tabela).
Projetos encontrados em sites (Printables, MakerWorld, Thingiverse, YouTube…) para fazer no futuro ou para usar como referência em outros projetos.

## Regras

- O Selecta 3D lê e grava esta tabela (você também pode editar à mão). **Antes de editar, leia o arquivo de novo.** Mantenha o formato.
- IDs sequenciais com o prefixo RF e dois dígitos, nunca reaproveitados. Referência que perdeu o interesse fica com status `descartado`.
- **Tipo:** `quero fazer` (pode virar peça da fila) ou `referência` (ideia, técnica ou inspiração para outro projeto).
- **Projeto:** IDs de `projetos.md` (P01…), separados por espaço; vazio = sem projeto ainda.
- **Imagem:** miniatura guardada em `{PASTA_IMAGENS_REF}/` (o programa baixa do link). **Arquivos:** pasta ou arquivo baixado, entre crases. **Fila:** ID da peça criada na fila.
- **Licença** como o site mostra; o que o programa detecta sozinho deve ser conferido.

**Status:** salvo · baixado · na fila · feito · descartado

## Referências

{_tabela_vazia(CAB_REFERENCIAS)}"""

# Arquivos de uma pasta nova (primeira vez em outro computador). Na pasta que já tem os arquivos, nada disto é usado.
CAB_FILA = ["ID", "Peça", "Arquivo (caminho relativo)", "Fatiado", "Filamento/cor", "Prioridade", "Status",
            "Observações"]
CAB_HISTORICO = ["Data", "ID", "Mudança", "Quem mudou"]
CAB_FILAMENTOS = ["ID", "Material", "Marca", "Cor", "Hex", "Peso (g)", "Restante (g)", "Tara (g)", "Preço (R$)",
                  "Local", "Status", "Observações"]
CAB_INSUMOS = ["ID", "Item", "Categoria", "Quantidade", "Unidade", "Mínimo", "Local", "Observações"]
CAB_MOVIMENTACOES = ["Data", "Item", "Quantidade", "Motivo", "Quem"]
CAB_COMPRAS = ["ID", "Data", "Item", "Loja", "Link", "Valor (R$)", "Pagamento", "Status", "Chegada prevista",
               "Projeto", "Observações"]
CAB_PRAZOS = ["Data", "Compra", "O que vence"]
CAB_PROJETOS = ["ID", "Projeto", "Pasta", "Status", "Prazo", "Descrição", "Fila (IDs extras)", "Observações"]

MODELO_FILA = f"""# Fila de impressão

Caminhos relativos a esta pasta. Criado pelo Selecta 3D (que lê e grava estas tabelas).

## Regras

- IDs sequenciais, nunca reaproveitados. Nenhuma linha é apagada: peça cancelada fica com o último status e "CANCELADA" em Observações.
- **Coluna Fatiado:** caminho do arquivo fatiado (`.gcode.3mf`) entre crases; `—` se ainda não houver.
- Toda mudança de status, prioridade ou ordem vai para o **Histórico**.

**Status:** aguardando modelo · pronto para fatiar · fatiado · imprimindo · concluído · falhou

**Prioridade:** 1 = essencial · 2 = com prazo · 3 = se der tempo · 4 = depois · 5 = sem pressa

## Fila

{_tabela_vazia(CAB_FILA)}
## Histórico

{_tabela_vazia(CAB_HISTORICO)}"""

MODELO_ESTOQUE = f"""# Estoque — filamentos, insumos e peças

Criado pelo Selecta 3D (que lê e grava estas tabelas).

## Regras

- IDs sequenciais (R para rolos de filamento, I para insumos e peças), nunca reaproveitados.
- **Hex:** cor do rolo (ex.: `#1E5AA8`). **Tara:** peso do carretel vazio, para pesar na balança.
- Toda entrada ou saída vai para **Movimentações**.

## Filamentos

{_tabela_vazia(CAB_FILAMENTOS)}
## Insumos e peças

{_tabela_vazia(CAB_INSUMOS)}
## Movimentações

{_tabela_vazia(CAB_MOVIMENTACOES)}"""

MODELO_COMPRAS = f"""# Compras

Criado pelo Selecta 3D (que lê e grava estas tabelas).

## Regras

- IDs sequenciais, nunca reaproveitados.
- **Prazos:** datas que vencem (devolução, garantia, chegada).

## Compras

{_tabela_vazia(CAB_COMPRAS)}
## Prazos

{_tabela_vazia(CAB_PRAZOS)}"""

MODELO_PROJETOS = f"""# Projetos

Caminhos relativos a esta pasta. Criado pelo Selecta 3D (que lê e grava estas tabelas).

## Regras

- IDs sequenciais, nunca reaproveitados. **Pasta:** onde ficam os arquivos do projeto, entre crases.

## Projetos

{_tabela_vazia(CAB_PROJETOS)}"""

MODELO_IMPRESSORA = """# Impressora

Anotações da impressora: ajustes testados, materiais e problemas. O Selecta 3D acrescenta linhas em
**Problemas conhecidos e soluções** quando você registra uma falha e pede para anotar.

## Problemas conhecidos e soluções

| Problema | Solução |
|---|---|
"""

MODELO_DIARIO = """# Diário

Anotações livres, uma entrada por dia, no formato `## AAAA-MM-DD — título`. O Painel do Selecta 3D mostra as últimas.
"""

SECAO_MATERIAIS = f"""
## Materiais

O que cada projeto precisa além do filamento. **Estoque** = ID do insumo em `estoque.md` (vazio se ainda não existe); **Compra** = ID em `compras.md`.

{_tabela_vazia(CAB_MATERIAIS)}"""

COL_QTD = {"Filamentos": "Restante (g)", "Insumos e peças": "Quantidade"}

EXT_3D = {".stl", ".3mf", ".step", ".stp", ".obj", ".scad", ".f3d", ".gcode", ".bgcode", ".ply", ".amf"}
EXT_COM_PREVIA = {".stl", ".3mf"}  # os que o programa sabe desenhar
VERSAO_MINIATURA = "v2"  # a mesma de ui/visualizador.js: miniaturas de versões antigas são refeitas
PASTAS_IGNORADAS = {".claude", ".codex", PASTA_PROGRAMAS, "SELECTA-3D", "ORGANIZADOR", "REGGAE-SLICER", "__pycache__", ".git", "node_modules"}

QUEM = "usuário"
# A03: quem fez a mudança, na coluna Quem do Histórico. "programa" = automático (KX-Bridge, detecção de falhas).
AUTORES = ("usuário", "programa", "fila", "trabalho", "principal")
# A02: coluna com o caminho do arquivo fatiado (.gcode.3mf); as crases das Observações ficam só de reserva
COLUNA_FATIADO = "Fatiado"


def autor_valido(autor):
    a = (autor or QUEM).strip().lower()
    if a == "usuario":
        a = "usuário"
    if a not in AUTORES:
        raise ErroDados(f"autor desconhecido: {autor!r} (use {', '.join(AUTORES)})")
    return a
TRAVA = threading.RLock()


class ErroDados(Exception):
    """Pedido inválido (vira HTTP 400)."""


class ErroConflito(Exception):
    """O arquivo mudou desde que a tela foi carregada (vira HTTP 409)."""


def hoje():
    return datetime.date.today().isoformat()


def numero(texto):
    """'2.706,99' -> 2706.99 · '1000' -> 1000 · '?' / '' -> None"""
    if texto is None:
        return None
    s = str(texto).strip().replace("R$", "").replace(" ", "")
    if not s or not re.search(r"\d", s):
        return None
    s = s.replace("−", "-")
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def formatar_numero(v):
    if v is None:
        return "?"
    if abs(v - round(v)) < 1e-9:
        return str(int(round(v)))
    return f"{v:.2f}".rstrip("0").rstrip(".").replace(".", ",")


def limpar(valor):
    if valor is None:
        return ""
    return " ".join(str(valor).split())


# parâmetros que não fazem parte do endereço: rastreio de campanha e o código de verificação do Cloudflare
_PARAMS_LIXO = re.compile(r"^(utm_|__cf_chl)|^(fbclid|gclid|igshid|mc_cid|mc_eid)$", re.I)


def limpar_link(url):
    """Tira do link os parâmetros de rastreio e de verificação (ex.: ?__cf_chl_tk=…). Se não houver, devolve igual."""
    url = limpar(url)
    if not re.match(r"^https?://", url, re.I):
        return url
    partes = urllib.parse.urlsplit(url)
    pares = urllib.parse.parse_qsl(partes.query, keep_blank_values=True)
    bons = [(k, v) for k, v in pares if not _PARAMS_LIXO.search(k)]
    if len(bons) == len(pares):
        return url
    return urllib.parse.urlunsplit(partes._replace(query=urllib.parse.urlencode(bons)))


def caminhos_entre_crases(texto):
    return [c.strip() for c in re.findall(r"`([^`]+)`", texto or "") if c.strip()]


CABECALHOS_WEB = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/130.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
}


def site_do_link(url):
    host = (urllib.parse.urlsplit(str(url or "")).hostname or "").lower()
    for chave, nome in SITES:
        if chave in host:
            return nome
    return host[4:] if host.startswith("www.") else host


TIPOS_IMAGEM = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif", "image/avif": ".avif"}


def baixar_imagem_web(url, referer=None):
    """Baixa uma imagem (até 8 MB). Devolve (bytes, extensão)."""
    if not re.match(r"^https?://", str(url or ""), re.I):
        raise ErroDados("link de imagem inválido")
    cab = {**CABECALHOS_WEB, "Accept": "image/avif,image/webp,image/*,*/*;q=0.8"}
    if referer and re.match(r"^https?://", str(referer), re.I):
        cab["Referer"] = referer
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=cab), timeout=15) as r:
            tipo = r.headers.get("Content-Type", "").split(";")[0].strip().lower()
            dados = r.read(8_000_001)
    except (urllib.error.URLError, OSError, ValueError) as e:
        raise ErroDados(f"não consegui baixar a imagem ({getattr(e, 'code', '') or e})")
    if not tipo.startswith("image/") or tipo not in TIPOS_IMAGEM:
        raise ErroDados("o link não é de uma imagem aceita (JPG, PNG, WebP, GIF)")
    if len(dados) > 8_000_000:
        raise ErroDados("imagem grande demais (máximo 8 MB)")
    return dados, TIPOS_IMAGEM[tipo]


def titulo_do_link(url):
    """Nome a partir do endereço: '.../model/464655-modular-fiddle-v4' -> 'Modular fiddle v4'."""
    caminho = urllib.parse.unquote(urllib.parse.urlsplit(str(url or "")).path).rstrip("/")
    ultimo = caminho.split("/")[-1] if caminho else ""
    ultimo = re.sub(r"^(thing:)?\d+[-_]?", "", ultimo)
    ultimo = re.sub(r"\.(html?|php)$", "", ultimo)
    texto = re.sub(r"[-_]+", " ", ultimo).strip()
    return (texto[:1].upper() + texto[1:]) if texto and not texto.isdigit() else ""


def normalizar_licenca(texto):
    """Acha a primeira licença Creative Commons (ou CC0/GPL) no texto: 'cc-by-nc-sa-4.0' -> 'CC BY-NC-SA 4.0'."""
    m = re.search(r"(?i)\bCC[ _-]?BY((?:[ _-]?(?:NC|SA|ND)){0,2})(?:[ _-]?(\d\.\d))?\b", texto or "")
    if m:
        partes = ["BY"] + [p.upper() for p in re.findall(r"(?i)NC|SA|ND", m.group(1))]
        return "CC " + "-".join(partes) + (f" {m.group(2)}" if m.group(2) else "")
    m = re.search(r"(?i)\bCC0\b|\bGNU GPL(?:v?\d)?\b|Standard Digital File License", texto or "")
    return m.group(0) if m else ""


# imagens que quase nunca são a foto do projeto
_IMAGEM_LIXO = re.compile(r"(logo|avatar|icon|sprite|badge|emoji|placeholder|pixel|spinner|loading|blank|flag|"
                          r"profile|favicon|banner-ad|tracking)", re.I)


def _maior_do_srcset(srcset):
    """'a.jpg 320w, b.jpg 1080w' -> 'b.jpg'."""
    melhor, maior = "", -1.0
    for parte in str(srcset or "").split(","):
        pedacos = parte.strip().split()
        if not pedacos:
            continue
        tam = 1.0
        if len(pedacos) > 1:
            try:
                tam = float(pedacos[1].rstrip("wx"))
            except ValueError:
                pass
        if tam > maior:
            melhor, maior = pedacos[0], tam
    return melhor


class _LeitorMeta(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.meta, self.titulo, self.image_src = {}, "", ""
        self.imagens = []  # fotos da página, na ordem em que aparecem
        self.imagens_ld = []  # imagens dos dados estruturados (JSON-LD)
        self._no_titulo = False
        self._ld = None

    def _imagem(self, a):
        try:
            larg = int(re.sub(r"\D", "", a.get("width", "")) or 0)
            alt = int(re.sub(r"\D", "", a.get("height", "")) or 0)
        except ValueError:
            larg = alt = 0
        if (larg and larg < 120) or (alt and alt < 100):
            return
        src = (_maior_do_srcset(a.get("data-srcset") or a.get("srcset")) or a.get("data-src") or a.get("data-original")
               or a.get("data-lazy-src") or a.get("src") or "")
        if src and not src.startswith("data:") and not _IMAGEM_LIXO.search(src) \
                and not re.search(r"\.(svg|ico)(\?|$)", src, re.I):
            self.imagens.append(src)

    def handle_starttag(self, tag, attrs):
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "img":
            self._imagem(a)
        elif tag == "source" and a.get("srcset") and "image" in a.get("type", "image"):
            self._imagem({"srcset": a["srcset"]})
        elif tag == "script" and "ld+json" in a.get("type", ""):
            self._ld = []
        if tag == "meta":
            chave = (a.get("property") or a.get("name") or "").lower()
            if chave and a.get("content") and chave not in self.meta:
                self.meta[chave] = a["content"]
        elif tag == "title":
            self._no_titulo = True
        elif tag == "link" and "image_src" in a.get("rel", "") and a.get("href"):
            self.image_src = a["href"]

    def handle_endtag(self, tag):
        if tag == "title":
            self._no_titulo = False
        elif tag == "script" and self._ld is not None:
            try:
                dados = json.loads("".join(self._ld))
            except ValueError:
                dados = None
            self._ld = None
            pilha = [dados]
            while pilha and len(self.imagens_ld) < 12:
                x = pilha.pop(0)
                if isinstance(x, list):
                    pilha.extend(x)
                elif isinstance(x, dict):
                    im = x.get("image") or x.get("thumbnailUrl")
                    for item in (im if isinstance(im, list) else [im]):
                        u = item.get("url") if isinstance(item, dict) else item
                        if isinstance(u, str) and u.startswith(("http", "/")):
                            self.imagens_ld.append(u)
                    pilha.extend(v for k, v in x.items() if k == "@graph" or isinstance(v, (dict, list)))

    def handle_data(self, data):
        if self._ld is not None:
            self._ld.append(data)
        if self._no_titulo and not self.titulo:
            self.titulo = data.strip()


def minutos(texto):
    """'5h12' -> 312 · '~5,2 h' -> 312 · '45 min' -> 45 · '1:30' -> 90 · '' -> None"""
    s = str(texto or "").lower().replace("~", "").replace(",", ".").strip()
    if not s:
        return None
    m = re.search(r"(\d+)\s*:\s*(\d{1,2})", s)
    if m:
        return int(m.group(1)) * 60 + int(m.group(2))
    m = re.search(r"(\d+(?:\.\d+)?)\s*h\s*(\d{1,2})?", s)
    if m:
        h = float(m.group(1))
        return int(round(h * 60)) + (int(m.group(2)) if m.group(2) else 0)
    m = re.search(r"(\d+)\s*min", s)
    if m:
        return int(m.group(1))
    return None


def formatar_minutos(mins):
    if mins is None:
        return ""
    return f"{mins // 60}h{mins % 60:02d}" if mins >= 60 else f"{mins} min"


def gramas_por_cor(texto):
    """'azul 60; branco quente 47' -> [('azul', 60.0), ('branco quente', 47.0)]"""
    res = []
    for parte in re.split(r"[;\n]", str(texto or "")):
        m = re.match(r"^\s*(.*?)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*g?\s*$", parte)
        if m and m.group(1).strip():
            res.append((m.group(1).strip(), numero(m.group(2))))
    return res


class Repositorio:
    def __init__(self, raiz, pasta_miniaturas=None):
        self.raiz = os.path.realpath(raiz)
        # miniaturas feitas pelo programa ficam fora da pasta compartilhada (%LOCALAPPDATA%\Organizador3D\miniaturas)
        self.pasta_miniaturas = pasta_miniaturas
        self._embutidas = {}  # (caminho, data, tamanho) -> o .3mf tem miniatura do fatiador?

    # ------------------------------------------------------------ arquivos
    def caminho(self, rel):
        return os.path.join(self.raiz, LOCAL_ARQUIVOS.get(rel, rel))

    def caminho_seguro(self, rel):
        if not rel or not isinstance(rel, str):
            raise ErroDados("caminho vazio")
        rel = rel.replace("\\", "/").lstrip("/")
        p = os.path.realpath(os.path.join(self.raiz, rel))
        try:
            dentro = os.path.commonpath([p, self.raiz]) == self.raiz
        except ValueError:
            dentro = False
        if not dentro:
            raise ErroDados("caminho fora da pasta de impressão 3D")
        return p

    def _doc(self, arquivo):
        p = self.caminho(arquivo)
        if not os.path.exists(p):
            raise ErroDados(f"arquivo {arquivo} não encontrado na pasta")
        return md.Documento(md.ler_arquivo(p))

    @property
    def pasta_backup(self):
        # cópias das 10 últimas versões de cada .md (A01); fora da lista de Arquivos (a pasta do programa é ignorada)
        return os.path.join(self.raiz, *PASTA_ORGANIZADOR.split("/"), "backup")

    def _gravar(self, arquivo, doc):
        try:
            md.escrever_arquivo(self.caminho(arquivo), doc.texto(), pasta_backup=self.pasta_backup)
        except md.ErroEncolheu as e:
            raise ErroDados(str(e))

    def garantir_estrutura(self):
        """Cria arquivos, seções e colunas que versões novas do programa precisam. Não mexe no que já existe."""
        feito = []
        with TRAVA:
            for arq, modelo in ((ARQ_FILA, MODELO_FILA), (ARQ_ESTOQUE, MODELO_ESTOQUE),
                                (ARQ_COMPRAS, MODELO_COMPRAS), (ARQ_PROJETOS, MODELO_PROJETOS),
                                (ARQ_IMPRESSORA, MODELO_IMPRESSORA), (ARQ_DIARIO, MODELO_DIARIO),
                                (ARQ_IMPRESSOES, MODELO_IMPRESSOES), (ARQ_MODELOS, MODELO_MODELOS),
                                (ARQ_REFERENCIAS, MODELO_REFERENCIAS)):
                if not os.path.exists(self.caminho(arq)):
                    os.makedirs(os.path.dirname(self.caminho(arq)), exist_ok=True)
                    md.escrever_arquivo(self.caminho(arq), modelo)
                    feito.append(f"criado {arq}")
            p = self.caminho(ARQ_PROJETOS)
            if os.path.exists(p):
                doc = self._doc(ARQ_PROJETOS)
                try:
                    doc.tabela("Materiais")
                except md.TabelaNaoEncontrada:
                    texto = doc.texto()
                    nl = "\r\n" if "\r\n" in texto else "\n"  # arquivo salvo com CRLF (Bloco de Notas): não misturar
                    md.escrever_arquivo(p, texto.rstrip("\r\n") + nl + SECAO_MATERIAIS.replace("\n", nl),
                                        pasta_backup=self.pasta_backup)
                    feito.append("seção Materiais em projetos.md")
            if os.path.exists(self.caminho(ARQ_ESTOQUE)):
                doc = self._doc(ARQ_ESTOQUE)
                try:
                    tab = doc.tabela("Filamentos")
                    mudou = tab.inserir_coluna("Tara (g)", "Restante (g)")
                    mudou = tab.inserir_coluna("Preço (R$)", "Tara (g)") or mudou
                    if mudou:
                        tab.aplicar()
                        self._gravar(ARQ_ESTOQUE, doc)
                        feito.append("colunas Tara e Preço em estoque.md")
                except md.TabelaNaoEncontrada:
                    pass
            if os.path.exists(self.caminho(ARQ_COMPRAS)):
                doc = self._doc(ARQ_COMPRAS)
                try:
                    tab = doc.tabela("Compras")
                    if tab.inserir_coluna("Link", "Loja"):  # página do produto (a extensão do navegador preenche)
                        tab.aplicar()
                        self._gravar(ARQ_COMPRAS, doc)
                        feito.append("coluna Link em compras.md")
                except md.TabelaNaoEncontrada:
                    pass
        return feito

    def versao(self):
        v = {}
        for a in ARQUIVOS_DADOS:
            try:
                v[a] = os.stat(self.caminho(a)).st_mtime_ns
            except OSError:
                v[a] = 0
        return v

    # ------------------------------------------------------------ leitura
    def _ler(self, arquivo, secao, avisos):
        try:
            tab = self._doc(arquivo).tabela(secao)
            return {"colunas": tab.cabecalho, "linhas": tab.registros()}
        except (ErroDados, md.TabelaNaoEncontrada) as e:
            avisos.append(f"{arquivo} / {secao}: {e}")
            return {"colunas": [], "linhas": []}

    def tudo(self):
        avisos = []
        fila = self._ler(ARQ_FILA, "Fila", avisos)
        for r in fila["linhas"]:
            r["_arquivos"] = self._info_caminhos(r.get("Arquivo (caminho relativo)", ""))
        historico = self._ler(ARQ_FILA, "Histórico", avisos)
        return {
            "raiz": self.raiz,
            "hoje": hoje(),
            "versao": self.versao(),
            "fila": fila,
            "historico": historico,
            "filamentos": self._ler(ARQ_ESTOQUE, "Filamentos", avisos),
            "insumos": self._ler(ARQ_ESTOQUE, "Insumos e peças", avisos),
            "movimentacoes": self._ler(ARQ_ESTOQUE, "Movimentações", avisos),
            "compras": self._ler(ARQ_COMPRAS, "Compras", avisos),
            "prazos": self._ler(ARQ_COMPRAS, "Prazos", avisos),
            "projetos": self._ler(ARQ_PROJETOS, "Projetos", avisos),
            "materiais": self._ler(ARQ_PROJETOS, "Materiais", avisos),
            "estimativas": self._ler(ARQ_IMPRESSOES, "Estimativas", avisos),
            "impressoes": self._ler(ARQ_IMPRESSOES, "Impressões", avisos),
            "modelos": self._ler(ARQ_MODELOS, "Origem dos modelos", avisos),
            "referencias": self._ler(ARQ_REFERENCIAS, "Referências", avisos),
            "diario": self.diario(4),
            "avisos": avisos,
        }

    def _info_caminhos(self, texto):
        info = []
        for c in caminhos_entre_crases(texto):
            try:
                p = self.caminho_seguro(c)
                existe = os.path.exists(p)
                pasta = os.path.isdir(p)
            except ErroDados:
                existe, pasta = False, False
            info.append({"caminho": c.replace("\\", "/"), "existe": existe, "pasta": pasta})
        return info

    def diario(self, n=4):
        try:
            texto = md.ler_arquivo(self.caminho(ARQ_DIARIO))
        except OSError:
            return []
        entradas, atual = [], None
        for linha in texto.splitlines():
            if re.match(r"^#{2,3} \d{4}-\d{2}-\d{2}", linha):
                atual = {"titulo": linha.lstrip("#").strip(), "linhas": []}
                entradas.append(atual)
            elif atual is not None and linha.strip() and not linha.startswith("---"):
                atual["linhas"].append(linha.strip())
        return entradas[-n:][::-1]

    def arquivos(self):
        lista = []
        for base, pastas, nomes in os.walk(self.raiz):
            pastas[:] = sorted(p for p in pastas if p not in PASTAS_IGNORADAS and not p.startswith("."))
            for nome in nomes:
                ext = os.path.splitext(nome)[1].lower()
                if ext not in EXT_3D:
                    continue
                cheio = os.path.join(base, nome)
                try:
                    st = os.stat(cheio)
                except OSError:
                    continue
                rel = os.path.relpath(cheio, self.raiz).replace("\\", "/")
                m = re.search(r"(?i)(?:^|[_\-. ])(v\d{1,3})(?=[_\-. ]|$)", os.path.splitext(nome)[0])
                lista.append({
                    "caminho": rel,
                    "nome": nome,
                    "pasta": os.path.dirname(rel),
                    "ext": ext[1:],
                    "tamanho": st.st_size,
                    "modificado": datetime.datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d %H:%M"),
                    "versao": m.group(1).lower() if m else "",
                    "mini": ext in EXT_COM_PREVIA and self.tem_miniatura(rel, st),
                })
        lista.sort(key=lambda a: a["caminho"].lower())
        return lista

    # ------------------------------------------------------------ utilidades de gravação
    @staticmethod
    def _proximo_id(prefixo, doc):
        maior = 0
        for m in re.finditer(r"\b" + prefixo + r"(\d{2,})\b", doc.texto()):
            maior = max(maior, int(m.group(1)))
        return f"{prefixo}{maior + 1:02d}"

    @staticmethod
    def _indice(tab, chave, antes):
        if chave.get("id"):
            col_id = tab.cabecalho[0]
            i = tab.achar(col_id, chave["id"])
            if i < 0:
                raise ErroConflito(f"{chave['id']} não existe mais no arquivo")
            return i
        i = chave.get("indice")
        if not isinstance(i, int) or i < 0 or i >= len(tab.linhas):
            raise ErroConflito("a linha não existe mais no arquivo")
        if not antes or set(antes) != set(tab.cabecalho):
            raise ErroDados("linha sem ID: mande a linha inteira em 'antes'")
        return i

    @staticmethod
    def _conferir_antes(tab, i, antes, rotulo):
        if not antes:
            return
        atual = dict(zip(tab.cabecalho, tab.linhas[i]))
        for col, val in antes.items():
            if col.startswith("_"):
                continue
            if limpar(atual.get(col, "")) != limpar(val):
                raise ErroConflito(
                    f"{rotulo}: '{col}' mudou no arquivo (outra conta ou outro programa editou). "
                    "A tela foi recarregada; confira e tente de novo."
                )

    @staticmethod
    def _aplicar_campos(tab, i, campos, protegidas=()):
        mudou = []
        for col, val in (campos or {}).items():
            if col.startswith("_"):
                continue
            if col in protegidas:
                raise ErroDados(f"a coluna '{col}' não pode ser mudada")
            k = tab.indice_coluna(col)
            novo = limpar(val)
            if tab.linhas[i][k] != novo:
                mudou.append((col, tab.linhas[i][k], novo))
                tab.linhas[i][k] = novo
        return mudou

    def _registrar_historico(self, doc, id_peca, mudanca, autor=QUEM):
        hist = doc.tabela("Histórico")
        hist.linhas.append([hoje(), id_peca, limpar(mudanca), autor_valido(autor)])
        hist.aplicar()

    # ------------------------------------------------------------ tabelas genéricas
    def tabela_atualizar(self, arquivo, secao, chave, campos, antes):
        if (arquivo, secao) not in TABELAS_GENERICAS:
            raise ErroDados("tabela não editável por aqui")
        prefixo = TABELAS_GENERICAS[(arquivo, secao)]
        with TRAVA:
            doc = self._doc(arquivo)
            tab = doc.tabela(secao)
            i = self._indice(tab, chave, antes)
            self._conferir_antes(tab, i, antes, chave.get("id") or secao)
            if campos and "Link" in campos:
                campos = {**campos, "Link": limpar_link(campos["Link"])}
            protegidas = (tab.cabecalho[0],) if prefixo else ()
            mudou = self._aplicar_campos(tab, i, campos, protegidas)
            if mudou:
                tab.aplicar()
                self._gravar(arquivo, doc)
            return {"mudou": [m[0] for m in mudou]}

    def tabela_adicionar(self, arquivo, secao, campos):
        if (arquivo, secao) not in TABELAS_GENERICAS:
            raise ErroDados("tabela não editável por aqui")
        prefixo = TABELAS_GENERICAS[(arquivo, secao)]
        with TRAVA:
            doc = self._doc(arquivo)
            tab = doc.tabela(secao)
            reg = {k: limpar(v) for k, v in (campos or {}).items() if not k.startswith("_")}
            if "Link" in reg:
                reg["Link"] = limpar_link(reg["Link"])
            for k in reg:
                tab.indice_coluna(k)
            if prefixo:
                reg[tab.cabecalho[0]] = self._proximo_id(prefixo, doc)
            tab.linhas.append(tab.registro_para_celulas(reg))
            tab.aplicar()
            self._gravar(arquivo, doc)
            return {"id": reg.get(tab.cabecalho[0]) if prefixo else None}

    # ------------------------------------------------------------ fila
    def fila_atualizar(self, id_peca, campos, antes, autor=QUEM, origem=""):
        """autor: usuário | programa | fila | trabalho (A03). origem: texto curto (ex.: "KX-Bridge")."""
        autor = autor_valido(autor)
        with TRAVA:
            doc = self._doc(ARQ_FILA)
            tab = doc.tabela("Fila")
            i = self._indice(tab, {"id": id_peca}, antes)
            self._conferir_antes(tab, i, antes, id_peca)
            mudou = self._aplicar_campos(tab, i, campos, protegidas=("ID",))
            if not mudou:
                return {"mudou": []}
            tab.aplicar()
            partes = []
            outras = []
            for col, velho, novo in mudou:
                if col in ("Status", "Prioridade"):
                    partes.append(f"{col}: {velho or '—'} → {novo or '—'}")
                else:
                    outras.append(col)
            if outras:
                partes.append("Editado: " + ", ".join(outras))
            sufixo = f" (automático: {origem})." if (autor == "programa" and origem) else (
                " (automático)." if autor == "programa" else " (pelo programa).")
            self._registrar_historico(doc, id_peca, "; ".join(partes) + sufixo, autor)
            self._gravar(ARQ_FILA, doc)
            return {"mudou": [m[0] for m in mudou]}

    def fila_mover(self, id_peca, direcao):
        with TRAVA:
            doc = self._doc(ARQ_FILA)
            tab = doc.tabela("Fila")
            i = tab.achar("ID", id_peca)
            if i < 0:
                raise ErroConflito(f"{id_peca} não existe mais no arquivo")
            j = i - 1 if direcao == "cima" else i + 1
            if j < 0 or j >= len(tab.linhas):
                return {"mudou": []}
            vizinho = tab.linhas[j][0]
            tab.linhas[i], tab.linhas[j] = tab.linhas[j], tab.linhas[i]
            tab.aplicar()
            if direcao == "cima":
                texto = f"Ordem: {id_peca} passou para antes de {vizinho} (pelo programa)."
            else:
                texto = f"Ordem: {id_peca} passou para depois de {vizinho} (pelo programa)."
            self._registrar_historico(doc, id_peca, texto)
            self._gravar(ARQ_FILA, doc)
            return {"mudou": ["ordem"]}

    def fila_adicionar(self, campos):
        with TRAVA:
            doc = self._doc(ARQ_FILA)
            tab = doc.tabela("Fila")
            reg = {k: limpar(v) for k, v in (campos or {}).items() if not k.startswith("_")}
            for k in reg:
                tab.indice_coluna(k)
            if not reg.get("Peça"):
                raise ErroDados("dê um nome à peça")
            reg["ID"] = self._proximo_id("F", doc)
            reg.setdefault("Status", "aguardando modelo")
            if not reg.get("Arquivo (caminho relativo)"):
                reg["Arquivo (caminho relativo)"] = "—"
            tab.linhas.append(tab.registro_para_celulas(reg))
            tab.aplicar()
            self._registrar_historico(doc, reg["ID"], f"Peça adicionada no fim da fila (pelo programa): {reg['Peça']}.")
            self._gravar(ARQ_FILA, doc)
            return {"id": reg["ID"]}

    def fila_registrar(self, id_peca, status, tempo, consumo, nota, antes,
                       motivo_falha="", solucao="", anotar_problema=False, fatiado=""):
        if status not in ("concluído", "falhou"):
            raise ErroDados("status final deve ser 'concluído' ou 'falhou'")
        consumo = [c for c in (consumo or []) if numero(c.get("gramas")) and numero(c.get("gramas")) > 0]
        with TRAVA:
            self.garantir_estrutura()
            # 1) confere tudo antes de gravar qualquer coisa
            doc_f = self._doc(ARQ_FILA)
            tab_f = doc_f.tabela("Fila")
            i = self._indice(tab_f, {"id": id_peca}, antes)
            self._conferir_antes(tab_f, i, antes, id_peca)
            doc_e = None
            if consumo:
                doc_e = self._doc(ARQ_ESTOQUE)
                tab_r = doc_e.tabela("Filamentos")
                for c in consumo:
                    k = tab_r.achar("ID", c.get("id", ""))
                    if k < 0:
                        raise ErroDados(f"rolo {c.get('id')} não existe em estoque.md")
                    if numero(tab_r.linhas[k][tab_r.indice_coluna("Restante (g)")]) is None:
                        raise ErroDados(f"rolo {c.get('id')} está sem o peso restante (?); pese e ajuste antes")
            doc_i = self._doc(ARQ_IMPRESSOES)
            est = {r["Peça"]: r for r in doc_i.tabela("Estimativas").registros()}.get(id_peca, {})

            # 2) estoque
            total, custo, custo_ok = 0.0, 0.0, True
            detalhes, rolos = [], []
            if consumo:
                tab_r = doc_e.tabela("Filamentos")
                movs = []
                for c in consumo:
                    g = numero(c["gramas"])
                    total += g
                    reg = dict(zip(tab_r.cabecalho, tab_r.linhas[tab_r.achar("ID", c["id"])]))
                    linha = tab_r.linhas[tab_r.achar("ID", c["id"])]
                    col_r = tab_r.indice_coluna("Restante (g)")
                    col_s = tab_r.indice_coluna("Status")
                    restante = max(0.0, numero(linha[col_r]) - g)
                    linha[col_r] = formatar_numero(restante)
                    if restante <= 0:
                        linha[col_s] = "acabou"
                    elif linha[col_s] == "lacrado":
                        linha[col_s] = "aberto"
                    preco, peso = numero(reg.get("Preço (R$)")), numero(reg.get("Peso (g)"))
                    if preco is not None and peso:
                        custo += g * preco / peso
                    else:
                        custo_ok = False
                    cor = reg.get("Cor", "")
                    detalhes.append(f"{cor} {formatar_numero(g)} g")
                    rolos.append(f"{c['id']} {formatar_numero(g)} g")
                    movs.append([hoje(), f"{c['id']} ({cor})", f"−{formatar_numero(g)} g",
                                 f"{id_peca} {status}", QUEM])
                tab_r.aplicar()
                tab_m = doc_e.tabela("Movimentações")
                tab_m.linhas.extend(movs)
                tab_m.aplicar()
                self._gravar(ARQ_ESTOQUE, doc_e)

            # 3) histórico de impressões
            mins = minutos(tempo)
            tab_h = doc_i.tabela("Impressões")
            tab_h.linhas.append(tab_h.registro_para_celulas({
                "Data": hoje(),
                "Peça": id_peca,
                "Resultado": status,
                "Tempo estimado": limpar(est.get("Tempo", "")),
                "Tempo real": formatar_minutos(mins) if mins is not None else limpar(tempo),
                "Gramas": formatar_numero(total) if total else "",
                "Custo (R$)": (f"{custo:.2f}".replace(".", ",") if custo_ok else "?") if total else "",
                "Rolos": "; ".join(rolos),
                "Motivo da falha": limpar(motivo_falha) if status == "falhou" else "",
                "Observações": limpar(nota),
            }))
            tab_h.aplicar()
            self._gravar(ARQ_IMPRESSOES, doc_i)

            # 4) problema conhecido em impressora.md (só se pedido)
            if status == "falhou" and anotar_problema and limpar(motivo_falha):
                try:
                    doc_p = self._doc(ARQ_IMPRESSORA)
                    tab_p = doc_p.tabela("Problemas conhecidos e soluções")
                    tab_p.linhas.append(tab_p.registro_para_celulas({
                        tab_p.cabecalho[0]: f"{limpar(motivo_falha)} ({hoje()}, {id_peca})",
                        tab_p.cabecalho[1]: limpar(solucao) or "a investigar",
                    }))
                    tab_p.aplicar()
                    self._gravar(ARQ_IMPRESSORA, doc_p)
                except (ErroDados, md.TabelaNaoEncontrada):
                    pass

            # 5) fila
            tab_f = doc_f.tabela("Fila")
            col_s = tab_f.indice_coluna("Status")
            col_o = tab_f.indice_coluna("Observações")
            velho = tab_f.linhas[i][col_s]
            tab_f.linhas[i][col_s] = status
            resumo = [status]
            if limpar(tempo):
                resumo.append(formatar_minutos(mins) if mins is not None else limpar(tempo))
            if total:
                resumo.append(f"{formatar_numero(total)} g ({', '.join(detalhes)})")
            if status == "falhou" and limpar(motivo_falha):
                resumo.append(f"motivo: {limpar(motivo_falha)}")
            frase = f"Impressão registrada em {hoje()}: {', '.join(resumo)}."
            if limpar(nota):
                frase += f" {limpar(nota).rstrip('.')}."
            obs = tab_f.linhas[i][col_o].strip()
            tab_f.linhas[i][col_o] = (obs + " " + frase).strip() if obs else frase
            mudou_cols = ["Status", "Observações"]
            fat = limpar(fatiado).strip("`").strip()
            if fat and COLUNA_FATIADO in tab_f.cabecalho:
                col_fat = tab_f.indice_coluna(COLUNA_FATIADO)
                if tab_f.linhas[i][col_fat].strip("`").strip() != fat:
                    tab_f.linhas[i][col_fat] = f"`{fat}`"
                    mudou_cols.append(COLUNA_FATIADO)
            tab_f.aplicar()
            self._registrar_historico(doc_f, id_peca, f"Status: {velho} → {status} (pelo programa). {frase}")
            self._gravar(ARQ_FILA, doc_f)
            return {"mudou": mudou_cols, "gramas": total, "custo": custo if custo_ok else None}

    # ------------------------------------------------------------ estimativas
    def estimativa_salvar(self, id_peca, gramas, tempo, fonte, obs):
        if not re.fullmatch(r"F\d{2,}", str(id_peca or "")):
            raise ErroDados("peça inválida")
        with TRAVA:
            self.garantir_estrutura()
            doc = self._doc(ARQ_IMPRESSOES)
            tab = doc.tabela("Estimativas")
            reg = {"Peça": id_peca, "Gramas por cor": limpar(gramas), "Tempo": limpar(tempo),
                   "Fonte": limpar(fonte), "Observações": limpar(obs)}
            i = tab.achar("Peça", id_peca)
            if not reg["Gramas por cor"] and not reg["Tempo"]:
                if i >= 0:
                    tab.linhas.pop(i)  # estimativa apagada pelo usuário
            elif i >= 0:
                tab.linhas[i] = tab.registro_para_celulas(reg)
            else:
                tab.linhas.append(tab.registro_para_celulas(reg))
            tab.aplicar()
            self._gravar(ARQ_IMPRESSOES, doc)
            return {"ok": True}

    # ------------------------------------------------------------ pesagem
    def estoque_pesar(self, id_rolo, balanca, tara, motivo):
        b = numero(balanca)
        t = numero(tara)
        if b is None:
            raise ErroDados("informe o peso na balança")
        with TRAVA:
            doc = self._doc(ARQ_ESTOQUE)
            tab = doc.tabela("Filamentos")
            i = tab.achar("ID", id_rolo)
            if i < 0:
                raise ErroConflito(f"{id_rolo} não existe mais no arquivo")
            linha = tab.linhas[i]
            col_t = tab.indice_coluna("Tara (g)")
            if t is None:
                t = numero(linha[col_t])
            if t is None:
                raise ErroDados("informe o peso do carretel vazio (tara)")
            linha[col_t] = formatar_numero(t)
            tab.aplicar()
            self._gravar(ARQ_ESTOQUE, doc)
        return self.estoque_movimentar("Filamentos", id_rolo, None, max(0.0, b - t),
                                       limpar(motivo) or f"pesado: balança {formatar_numero(b)} g − carretel {formatar_numero(t)} g")

    # ------------------------------------------------------------ miniaturas
    def _arquivo_miniatura(self, rel, st=None):
        """Onde fica a miniatura feita pelo programa para esta versão do arquivo (muda se o arquivo mudar)."""
        if not self.pasta_miniaturas:
            return None
        p = self.caminho_seguro(rel)
        st = st or os.stat(p)
        chave = hashlib.sha1(f"{VERSAO_MINIATURA}|{rel}|{st.st_mtime_ns}|{st.st_size}".encode("utf-8")).hexdigest()[:24]
        return os.path.join(self.pasta_miniaturas, chave + ".png")

    def tem_miniatura(self, rel, st=None):
        try:
            p = self.caminho_seguro(rel)
            st = st or os.stat(p)
            if p.lower().endswith(".3mf"):
                k = (rel, st.st_mtime_ns, st.st_size)
                if k not in self._embutidas:
                    self._embutidas[k] = self._miniatura_embutida(p) is not None
                if self._embutidas[k]:
                    return True
            arq = self._arquivo_miniatura(rel, st)
            return bool(arq and os.path.isfile(arq))
        except (ErroDados, OSError):
            return False

    def miniatura(self, rel):
        """Miniatura do arquivo: a que o fatiador guardou no .3mf ou a que o programa fez; senão None."""
        p = self.caminho_seguro(rel)
        if not os.path.isfile(p):
            return None
        if p.lower().endswith(".3mf"):
            embutida = self._miniatura_embutida(p)
            if embutida:
                return embutida
        try:
            arq = self._arquivo_miniatura(rel)
        except OSError:
            return None
        if arq and os.path.isfile(arq):
            with open(arq, "rb") as f:
                return f.read()
        return None

    def miniatura_guardar(self, rel, dados_b64):
        """Guarda a miniatura desenhada pela janela do programa (PNG ou JPEG em base64)."""
        arq = self._arquivo_miniatura(rel)
        if not arq:
            raise ErroDados("o programa está sem pasta de miniaturas")
        try:
            dados = base64.b64decode(str(dados_b64 or "").split(",")[-1], validate=False)
        except ValueError:
            raise ErroDados("miniatura inválida")
        if not (dados.startswith(b"\x89PNG") or dados.startswith(b"\xff\xd8")) or len(dados) > 3_000_000:
            raise ErroDados("miniatura inválida")
        os.makedirs(self.pasta_miniaturas, exist_ok=True)
        tmp = arq + ".tmp"
        with open(tmp, "wb") as f:
            f.write(dados)
        os.replace(tmp, arq)
        return {"ok": True}

    def _miniatura_embutida(self, p):
        """PNG que o fatiador guarda dentro do .3mf (Metadata/), ou None."""
        try:
            with zipfile.ZipFile(p) as z:
                nomes = [n for n in z.namelist() if n.lower().startswith("metadata/") and n.lower().endswith(".png")]
                if not nomes:
                    return None
                preferidos = sorted(nomes, key=lambda n: (
                    0 if "thumbnail" in n.lower() else 1 if "plate_1" in n.lower() or "top_1" in n.lower() else 2,
                    "small" in n.lower(), n))
                return z.read(preferidos[0])
        except (zipfile.BadZipFile, OSError, KeyError):
            return None

    # ------------------------------------------------------------ estoque
    def estoque_movimentar(self, secao, id_item, delta, valor, motivo):
        if secao not in COL_QTD:
            raise ErroDados("seção de estoque inválida")
        col = COL_QTD[secao]
        d = numero(delta) if delta not in (None, "") else None
        v = numero(valor) if valor not in (None, "") else None
        if d is None and v is None:
            raise ErroDados("informe quanto entrou/saiu ou o valor novo")
        with TRAVA:
            doc = self._doc(ARQ_ESTOQUE)
            tab = doc.tabela(secao)
            i = tab.achar("ID", id_item)
            if i < 0:
                raise ErroConflito(f"{id_item} não existe mais no arquivo")
            linha = tab.linhas[i]
            k = tab.indice_coluna(col)
            atual = numero(linha[k])
            if v is None:
                if atual is None:
                    raise ErroDados("a quantidade atual está como '?'; informe o valor novo")
                novo = max(0.0, atual + d)
            else:
                novo = max(0.0, v)
            linha[k] = formatar_numero(novo)
            unidade = "g" if secao == "Filamentos" else linha[tab.indice_coluna("Unidade")]
            if secao == "Filamentos":
                col_s = tab.indice_coluna("Status")
                if novo <= 0:
                    linha[col_s] = "acabou"
                elif linha[col_s] in ("lacrado", "acabou") and (atual is None or novo < atual or linha[col_s] == "acabou"):
                    linha[col_s] = "aberto"
                nome = linha[tab.indice_coluna("Cor")]
            else:
                nome = linha[tab.indice_coluna("Item")]
            tab.aplicar()
            if v is None:
                qtd = ("+" if d > 0 else "−") + f"{formatar_numero(abs(d))} {unidade}".strip()
            else:
                qtd = f"= {formatar_numero(novo)} {unidade}".strip() + (f" (era {formatar_numero(atual)})" if atual is not None else "")
            tab_m = doc.tabela("Movimentações")
            tab_m.linhas.append([hoje(), f"{id_item} ({nome})", qtd, limpar(motivo) or "ajuste", QUEM])
            tab_m.aplicar()
            self._gravar(ARQ_ESTOQUE, doc)
            return {"novo": novo}

    # ------------------------------------------------------------ referências
    def ler_link(self, url):
        """Busca título, imagem, autor e licença de um link (melhor esforço; muitos sites bloqueiam robôs)."""
        url = limpar(url)
        if not re.match(r"^https?://[^\s/]+", url, re.I):
            raise ErroDados("o link precisa começar com http:// ou https://")
        info = {"link": url, "site": site_do_link(url), "titulo": "", "imagem": "", "imagens": [], "autor": "",
                "licenca": "", "descricao": "", "erro": ""}
        try:
            req = urllib.request.Request(url, headers=CABECALHOS_WEB)
            with urllib.request.urlopen(req, timeout=12) as r:
                tipo = r.headers.get("Content-Type", "")
                bruto = r.read(3_000_000)
                info["link"] = limpar_link(r.geturl())
            if "html" not in tipo.lower():
                info["erro"] = "o link não é uma página"
                return info
            m = re.search(r"charset=([\w-]+)", tipo)
            html = bruto.decode(m.group(1) if m else "utf-8", errors="replace")
        except (urllib.error.URLError, OSError, ValueError) as e:
            codigo = getattr(e, "code", "") or getattr(e, "reason", "") or e
            info["titulo"] = titulo_do_link(url)
            info["erro"] = (f"o site não deixa ler a página automaticamente ({codigo}). Confira o nome. Para a imagem: "
                            "no PC, \"Escolher na página\" ou cole um print (Ctrl+V); no celular, tire um print da página "
                            "e escolha da galeria.")
            return info
        p = _LeitorMeta()
        try:
            p.feed(html)
        except Exception:  # noqa: BLE001
            pass
        meta = p.meta
        titulo = meta.get("og:title") or meta.get("twitter:title") or p.titulo
        info["titulo"] = limpar(re.sub(r"\s*[|·–-]\s*(Printables\.com|MakerWorld|Thingiverse|Thangs|Cults|YouTube)\s*$", "", titulo or ""))
        img = meta.get("og:image") or meta.get("og:image:url") or meta.get("twitter:image") or p.image_src
        info["imagem"] = urllib.parse.urljoin(info["link"], img) if img else ""
        vistas, chaves = [], set()  # capa primeiro, depois as dos dados estruturados e as fotos da página
        for u in [img, meta.get("twitter:image"), *p.imagens_ld, *p.imagens]:
            if u:
                u = urllib.parse.urljoin(info["link"], u.strip())
                partes = urllib.parse.urlsplit(u)
                # a mesma foto em outro tamanho (foto.jpg?width=620) conta uma vez só
                chave = (partes.netloc + partes.path if re.search(r"\.(jpe?g|png|webp|gif|avif)$", partes.path, re.I)
                         else u)
                if u.startswith("http") and chave not in chaves:
                    chaves.add(chave)
                    vistas.append(u)
        info["imagens"] = vistas[:16]
        info["descricao"] = limpar(meta.get("og:description") or meta.get("description") or "")[:400]
        info["autor"] = limpar(meta.get("author") or meta.get("article:author") or "")
        if info["site"].lower().split(".")[0] in info["autor"].lower().replace(" ", ""):
            info["autor"] = ""  # alguns sites põem o próprio nome como autor
        m_por = re.match(r"^(.{3,}) by ([^|]{2,40})$", info["titulo"])
        if m_por and info["site"] in ("Thingiverse", "Cults", "MyMiniFactory"):
            info["titulo"], autor_titulo = m_por.group(1).strip(), m_por.group(2).strip()
            info["autor"] = info["autor"] or autor_titulo
        if meta.get("og:site_name") and not any(nome == info["site"] for _, nome in SITES):
            info["site"] = limpar(meta["og:site_name"])
        info["licenca"] = normalizar_licenca(html)
        if not info["titulo"]:
            info["titulo"] = titulo_do_link(url)
            info["erro"] = "a página não mostrou o título; confira o nome e cole um print para a imagem"
        return info

    def referencia_imagem(self, id_ref, url=None, dados_b64=None, nome=None, pagina=None):
        """Guarda a miniatura da referência em PROGRAMAS/SELECTA-3D/referencias/imagens/<ID>.<ext> e anota na coluna Imagem."""
        if not re.fullmatch(r"RF\d{2,}", str(id_ref or "")):
            raise ErroDados("referência inválida")
        if dados_b64:
            try:
                dados = base64.b64decode(str(dados_b64).split(",")[-1], validate=False)
            except ValueError:
                raise ErroDados("imagem inválida")
            ext = os.path.splitext(nome or "")[1].lower() or ".png"
        elif url:
            dados, ext = baixar_imagem_web(url, referer=pagina)
        else:
            raise ErroDados("sem imagem")
        if len(dados) > 8_000_000:
            raise ErroDados("imagem grande demais (máximo 8 MB)")
        if ext not in (".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"):
            raise ErroDados("formato de imagem não aceito")
        pasta = self.caminho(PASTA_IMAGENS_REF)
        os.makedirs(pasta, exist_ok=True)
        for velho in os.listdir(pasta):  # troca a miniatura antiga desta referência
            if os.path.splitext(velho)[0] == id_ref:
                os.remove(os.path.join(pasta, velho))
        rel = f"{PASTA_IMAGENS_REF}/{id_ref}{ext}"
        with open(self.caminho(rel), "wb") as f:
            f.write(dados)
        with TRAVA:
            doc = self._doc(ARQ_REFERENCIAS)
            tab = doc.tabela("Referências")
            i = tab.achar("ID", id_ref)
            if i < 0:
                raise ErroConflito(f"{id_ref} não existe mais no arquivo")
            tab.linhas[i][tab.indice_coluna("Imagem")] = f"`{rel}`"
            tab.aplicar()
            self._gravar(ARQ_REFERENCIAS, doc)
        return {"imagem": rel}

    def referencia_para_fila(self, id_ref, campos):
        """Cria a peça no fim da fila a partir da referência e liga as duas."""
        with TRAVA:
            doc = self._doc(ARQ_REFERENCIAS)
            tab = doc.tabela("Referências")
            i = tab.achar("ID", id_ref)
            if i < 0:
                raise ErroConflito(f"{id_ref} não existe mais no arquivo")
            ref = dict(zip(tab.cabecalho, tab.linhas[i]))
            if ref.get("Fila"):
                raise ErroDados(f"{id_ref} já está na fila como {ref['Fila']}")
            obs = f"Da referência {id_ref}: {ref.get('Link', '')}."
            novo = {
                "Peça": limpar((campos or {}).get("Peça")) or ref.get("Título") or id_ref,
                "Arquivo (caminho relativo)": ref.get("Arquivos") or "—",
                "Filamento/cor": limpar((campos or {}).get("Filamento/cor")) or "a definir",
                "Prioridade": limpar((campos or {}).get("Prioridade")) or "4",
                "Status": "aguardando modelo" if not ref.get("Arquivos") else "pronto para fatiar",
                "Observações": (limpar((campos or {}).get("Observações")) + " " + obs).strip(),
            }
            r = self.fila_adicionar(novo)
            doc = self._doc(ARQ_REFERENCIAS)
            tab = doc.tabela("Referências")
            i = tab.achar("ID", id_ref)
            tab.linhas[i][tab.indice_coluna("Fila")] = r["id"]
            tab.linhas[i][tab.indice_coluna("Status")] = "na fila"
            tab.aplicar()
            self._gravar(ARQ_REFERENCIAS, doc)
            return r

    @staticmethod
    def abrir_link(url):
        if not re.match(r"^https?://", str(url or ""), re.I):
            raise ErroDados("link inválido")
        webbrowser.open(url)
        return {"ok": True}

    # ------------------------------------------------------------ abrir no Windows
    def abrir(self, rel, modo):
        p = self.caminho_seguro(rel)
        if not os.path.exists(p):
            raise ErroDados(f"não encontrado: {rel}")
        if modo == "pasta":
            if os.path.isdir(p):
                os.startfile(p)
            else:
                subprocess.Popen(f'explorer /select,"{p}"')
        else:
            os.startfile(p)
        return {"ok": True}
