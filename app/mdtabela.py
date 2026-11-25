"""Leitura e escrita de tabelas Markdown dentro de arquivos .md.

Regra principal: tudo o que não é a tabela editada continua byte a byte igual.
Linhas da tabela que não mudaram são reescritas com o texto original.
"""
import os
import re
import time

_SEPARADOR = re.compile(r"^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$")
_TITULO = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")


def ler_arquivo(caminho):
    """Lê o arquivo em UTF-8 sem converter as quebras de linha."""
    with open(caminho, "r", encoding="utf-8", newline="") as f:
        texto = f.read()
    return texto


class ErroEncolheu(Exception):
    """O texto novo ficou com menos da metade do tamanho do antigo: provável truncamento."""


MANTER_BACKUPS = 10
MINIMO_PARA_CONFERIR = 400  # arquivos menores que isso não passam pela conferência de tamanho


def _guardar_backup(caminho, pasta_backup):
    """Copia a versão atual para pasta_backup/<nome>/<AAAA-MM-DD_HHMMSS>.md e mantém só as 10 últimas."""
    if not pasta_backup or not os.path.exists(caminho):
        return None
    nome = os.path.splitext(os.path.basename(caminho))[0]
    destino_pasta = os.path.join(pasta_backup, nome)
    os.makedirs(destino_pasta, exist_ok=True)
    carimbo = time.strftime("%Y-%m-%d_%H%M%S")
    ext = os.path.splitext(caminho)[1] or ".md"
    destino = os.path.join(destino_pasta, carimbo + ext)
    n = 1
    while os.path.exists(destino):  # duas gravações no mesmo segundo
        destino = os.path.join(destino_pasta, f"{carimbo}-{n}{ext}")
        n += 1
    with open(caminho, "rb") as f:
        dados = f.read()
    if not dados:
        return None  # não guarda versão vazia
    with open(destino, "wb") as f:
        f.write(dados)
    antigos = sorted(a for a in os.listdir(destino_pasta) if a.endswith(ext))
    for a in antigos[:-MANTER_BACKUPS]:
        try:
            os.remove(os.path.join(destino_pasta, a))
        except OSError:
            pass
    return destino


def escrever_arquivo(caminho, texto, pasta_backup=None, permitir_encolher=False):
    """Grava em UTF-8 (sem BOM) num temporário e troca de uma vez.

    Com pasta_backup, guarda antes a versão anterior (10 últimas). Recusa (ErroEncolheu) gravar um
    texto com menos da metade do tamanho do antigo, a não ser com permitir_encolher=True.
    """
    pasta = os.path.dirname(caminho)
    novo = texto.encode("utf-8")
    if os.path.exists(caminho) and not permitir_encolher:
        antigo = os.path.getsize(caminho)
        if antigo >= MINIMO_PARA_CONFERIR and len(novo) < antigo / 2:
            raise ErroEncolheu(
                f"{os.path.basename(caminho)}: o texto novo tem {len(novo)} bytes e o atual {antigo}. "
                "Gravação recusada para não truncar o arquivo; nada foi alterado.")
    if pasta_backup:
        _guardar_backup(caminho, pasta_backup)
    tmp = os.path.join(pasta, "." + os.path.basename(caminho) + ".tmp-organizador")
    with open(tmp, "w", encoding="utf-8", newline="") as f:
        f.write(texto)
        f.flush()
        os.fsync(f.fileno())
    for tentativa in range(10):
        try:
            os.replace(tmp, caminho)
            return
        except PermissionError:
            # outro programa (editor, sincronização) segurando o arquivo
            time.sleep(0.15 * (tentativa + 1))
    try:
        with open(caminho, "w", encoding="utf-8", newline="") as f:
            f.write(texto)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def dividir_linha(linha):
    """'| a | b \\| c |' -> ['a', 'b | c']"""
    s = linha.strip()
    if s.startswith("|"):
        s = s[1:]
    if s.endswith("|") and not s.endswith("\\|"):
        s = s[:-1]
    celulas, atual, i = [], [], 0
    while i < len(s):
        c = s[i]
        if c == "\\" and i + 1 < len(s) and s[i + 1] == "|":
            atual.append("|")
            i += 2
            continue
        if c == "|":
            celulas.append("".join(atual).strip())
            atual = []
        else:
            atual.append(c)
        i += 1
    celulas.append("".join(atual).strip())
    return celulas


def montar_linha(celulas):
    partes = []
    for c in celulas:
        c = "" if c is None else str(c)
        c = c.replace("\r\n", " ").replace("\n", " ").replace("\r", " ").replace("|", "\\|").strip()
        partes.append(c)
    return "| " + " | ".join(partes) + " |"


class TabelaNaoEncontrada(Exception):
    pass


class Documento:
    """Um arquivo .md com uma ou mais tabelas editáveis, cada uma depois de um título."""

    def __init__(self, texto):
        self.quebra = "\r\n" if "\r\n" in texto else "\n"
        self.linhas = texto.split(self.quebra)

    def texto(self):
        return self.quebra.join(self.linhas)

    def _localizar(self, titulo):
        alvo = titulo.strip().lower()
        for i, linha in enumerate(self.linhas):
            m = _TITULO.match(linha)
            if m and m.group(2).strip().lower() == alvo:
                nivel = len(m.group(1))
                j = i + 1
                while j < len(self.linhas):
                    l = self.linhas[j]
                    t = _TITULO.match(l)
                    if t and len(t.group(1)) <= nivel:
                        break
                    if l.lstrip().startswith("|"):
                        if j + 1 < len(self.linhas) and _SEPARADOR.match(self.linhas[j + 1]):
                            fim = j + 2
                            while fim < len(self.linhas) and self.linhas[fim].lstrip().startswith("|"):
                                fim += 1
                            return j, fim
                        break
                    j += 1
                raise TabelaNaoEncontrada(f"sem tabela depois de '## {titulo}'")
        raise TabelaNaoEncontrada(f"título '## {titulo}' não encontrado")

    def tabela(self, titulo):
        ini, fim = self._localizar(titulo)
        return Tabela(self, titulo, ini, fim)


class Tabela:
    def __init__(self, doc, titulo, ini, fim):
        self.doc = doc
        self.titulo = titulo
        self.ini = ini
        self.fim = fim
        bruto = doc.linhas[ini:fim]
        self.cabecalho = dividir_linha(bruto[0])
        self._linha_cab = bruto[0]
        self._linha_sep = bruto[1]
        self.linhas = []      # listas de células
        self._originais = []  # (células, texto original) para reaproveitar
        n = len(self.cabecalho)
        for l in bruto[2:]:
            c = dividir_linha(l)
            if len(c) < n:
                c = c + [""] * (n - len(c))
            elif len(c) > n:
                c = c[: n - 1] + [" | ".join(c[n - 1:])]
            self.linhas.append(c)
            self._originais.append((list(c), l))

    # --- acesso como dicionários ---
    def registros(self):
        return [dict(zip(self.cabecalho, c)) for c in self.linhas]

    def indice_coluna(self, nome):
        try:
            return self.cabecalho.index(nome)
        except ValueError:
            raise KeyError(f"coluna '{nome}' não existe em '{self.titulo}'")

    def achar(self, coluna, valor):
        k = self.indice_coluna(coluna)
        for i, c in enumerate(self.linhas):
            if c[k] == valor:
                return i
        return -1

    def registro_para_celulas(self, registro):
        return [str(registro.get(col, "") or "") for col in self.cabecalho]

    # --- estrutura ---
    def inserir_coluna(self, nome, depois_de=None):
        """Acrescenta uma coluna vazia (depois de outra ou no fim). Reescreve a tabela inteira."""
        if nome in self.cabecalho:
            return False
        k = self.cabecalho.index(depois_de) + 1 if depois_de in self.cabecalho else len(self.cabecalho)
        self.cabecalho.insert(k, nome)
        for c in self.linhas:
            c.insert(k, "")
        self._linha_cab = montar_linha(self.cabecalho)
        self._linha_sep = "|" + "---|" * len(self.cabecalho)
        self._originais = []
        return True

    # --- gravação ---
    def aplicar(self):
        """Devolve a tabela ao documento, mantendo linhas não alteradas."""
        novas = [self._linha_cab, self._linha_sep]
        usadas = set()
        for c in self.linhas:
            texto = None
            for k, (orig, bruto) in enumerate(self._originais):
                if k not in usadas and orig == c:
                    texto = bruto
                    usadas.add(k)
                    break
            novas.append(texto if texto is not None else montar_linha(c))
        self.doc.linhas[self.ini:self.fim] = novas
        delta = len(novas) - (self.fim - self.ini)
        self.fim += delta
        return delta
