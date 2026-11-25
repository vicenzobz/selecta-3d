"""Ponte com o Reggae Slicer: o que o fatiador mostra do Selecta 3D.

Grava dois tipos de arquivo, sempre que os .md da raiz mudam:

1. %LOCALAPPDATA%\\Organizador3D\\reggae-slicer.json: as próximas peças da fila (com o arquivo e as
   cores), os projetos ativos e os rolos do estoque. A página inicial do Reggae Slicer lê este
   arquivo, então funciona com o Selecta 3D fechado e sem rede.
2. Um filamento pronto para cada cor do estoque, em PROGRAMAS\\REGGAE-SLICER\\dados-orca\\user\\default\\filament
   ("PLA Print Pulse preto", com a cor, a marca e a temperatura do rótulo), herdando o PLA da Kobra X.
   Só mexe nos arquivos que ele mesmo gravou: se você editar um desses filamentos no Reggae Slicer,
   ele passa a ser seu e não é mais trocado. Filamento de cor que saiu do estoque é apagado só se
   ainda for igual ao que a ponte gravou.

Também roda sozinha, para conferir: python -m app.ponte_reggae --raiz "D:\\IMPRESSÃO 3D"
"""
import argparse
import hashlib
import json
import logging
import os
import re
import threading
import time

from . import mdtabela as md
from .dados import ARQ_ESTOQUE, ARQ_FILA, ARQ_PROJETOS, ErroDados, caminhos_entre_crases

log = logging.getLogger(__name__)

ARQ_RESUMO = "reggae-slicer.json"
ARQ_ESTADO = "reggae-filamentos.json"  # hash do que a ponte gravou em cada filamento
VERSAO_RESUMO = 1
STATUS_FORA_DA_FILA = {"concluído", "concluido", "cancelado"}
STATUS_ROLO_FORA = {"acabou"}
FILAMENTO_BASE = "Anycubic PLA @Anycubic Kobra X 0.4 nozzle"
VERSAO_PRESET = "2.5.2.0"
EXTENSOES_MODELO = (".3mf", ".stl", ".step", ".stp", ".obj")


def _norm(t):
    return re.sub(r"\s+", " ", str(t or "").strip().lower())


def _registros(repo, arquivo, secao):
    try:
        return repo._doc(arquivo).tabela(secao).registros()
    except (ErroDados, md.TabelaNaoEncontrada, OSError):
        return []


def _hex(v):
    v = str(v or "").strip()
    return v.upper() if re.fullmatch(r"#[0-9a-fA-F]{6}", v) else ""


def _inteiro(v):
    m = re.search(r"-?\d+", str(v or "").replace(".", ""))
    return int(m.group(0)) if m else None


def _ids_extras(texto):
    """'F03, F28–F31' -> {'F03', 'F28', 'F29', 'F30', 'F31'}"""
    ids = set()
    for a, b in re.findall(r"F(\d+)\s*(?:[–-]\s*F?(\d+))?", str(texto or "")):
        ini = int(a)
        fim = int(b) if b else ini
        for n in range(ini, fim + 1):
            ids.add(f"F{n:02d}")
    return ids


class PonteReggae:
    def __init__(self, repo, pasta_app, pasta_reggae, intervalo=10):
        self.repo = repo
        self.pasta_app = pasta_app
        self.pasta_filamentos = os.path.join(pasta_reggae, "dados-orca", "user", "default", "filament")
        self.intervalo = intervalo
        self._versao = None
        self._parar = threading.Event()

    # ------------------------------------------------------------ resumo
    def _cores(self, rolos):
        """Índice nome da cor -> hex, dos rolos do estoque (o nome mais longo vence: 'azul escuro' antes de 'azul')."""
        indice = {}
        for r in rolos:
            n = _norm(r.get("Cor"))
            if n and n not in indice:
                indice[n] = {"nome": r.get("Cor", "").strip(), "hex": _hex(r.get("Hex"))}
        return sorted(indice.items(), key=lambda kv: -len(kv[0]))

    @staticmethod
    def _cores_do_texto(texto, indice):
        t = _norm(str(texto or "").split("(")[0])
        achadas = []
        for chave, cor in indice:
            for m in re.finditer(r"(?<![a-zà-ú])" + re.escape(chave) + r"(?![a-zà-ú])", t):
                achadas.append((m.start(), cor))
                t = t[:m.start()] + " " * len(chave) + t[m.end():]
        vistos, res = set(), []
        for _, cor in sorted(achadas, key=lambda x: x[0]):
            if cor["nome"] not in vistos:
                vistos.add(cor["nome"])
                res.append(cor)
        return res

    def _arquivo(self, texto):
        for c in caminhos_entre_crases(texto):
            try:
                p = self.repo.caminho_seguro(c)
            except ErroDados:
                continue
            if os.path.isfile(p) and p.lower().endswith(EXTENSOES_MODELO):
                return p
        return ""

    def resumo(self):
        rolos = _registros(self.repo, ARQ_ESTOQUE, "Filamentos")
        indice = self._cores(rolos)
        projetos = _registros(self.repo, ARQ_PROJETOS, "Projetos")
        pastas = []
        for p in projetos:
            pasta = (caminhos_entre_crases(p.get("Pasta", "")) or [""])[0].replace("\\", "/").strip("/")
            pastas.append((p, pasta.lower(), _ids_extras(p.get("Fila (IDs extras)", ""))))

        def projeto_da(peca):
            caminho = " ".join(caminhos_entre_crases(peca.get("Arquivo (caminho relativo)", ""))).replace("\\", "/").lower()
            for p, pasta, extras in pastas:
                if peca.get("ID") in extras or (pasta and caminho.startswith(pasta + "/")):
                    return p
            return None

        fila, pendentes = [], {}
        for peca in _registros(self.repo, ARQ_FILA, "Fila"):
            if _norm(peca.get("Status")) in STATUS_FORA_DA_FILA:
                continue
            proj = projeto_da(peca)
            if proj is not None:
                pendentes[proj.get("ID")] = pendentes.get(proj.get("ID"), 0) + 1
            fila.append({
                "id": peca.get("ID", ""),
                "peca": peca.get("Peça", ""),
                "projeto": proj.get("Projeto", "") if proj else "",
                "status": peca.get("Status", ""),
                "prioridade": peca.get("Prioridade", ""),
                "arquivo": self._arquivo(peca.get("Arquivo (caminho relativo)", "")),
                "cores": self._cores_do_texto(peca.get("Filamento/cor", ""), indice),
            })

        ativos = [{"id": p.get("ID", ""), "nome": p.get("Projeto", ""), "prazo": p.get("Prazo", ""),
                   "pendentes": pendentes.get(p.get("ID"), 0)}
                  for p in projetos if _norm(p.get("Status")) == "ativo"]

        estoque = [{"id": r.get("ID", ""), "material": r.get("Material", ""), "marca": r.get("Marca", ""),
                    "cor": r.get("Cor", ""), "hex": _hex(r.get("Hex")), "peso": _inteiro(r.get("Peso (g)")),
                    "restante": _inteiro(r.get("Restante (g)")), "status": r.get("Status", "")}
                   for r in rolos if _norm(r.get("Status")) not in STATUS_ROLO_FORA]

        return {"versao": VERSAO_RESUMO, "gerado": time.strftime("%d/%m %H:%M"), "raiz": self.repo.raiz,
                "fila": fila, "projetos": ativos, "estoque": estoque}

    # ------------------------------------------------------------ filamentos
    def filamentos_desejados(self):
        """Um filamento por combinação material + marca + cor dos rolos que ainda existem (só PLA)."""
        vistos, res = set(), {}
        for r in _registros(self.repo, ARQ_ESTOQUE, "Filamentos"):
            if _norm(r.get("Status")) in STATUS_ROLO_FORA:
                continue
            material = _norm(r.get("Material"))
            if not material.startswith("pla"):
                continue  # a base é o PLA da Kobra X; outros materiais pedem outra base
            marca = (r.get("Marca") or "").strip()
            cor = (r.get("Cor") or "").strip()
            hexa = _hex(r.get("Hex"))
            if not cor or not hexa:
                continue
            nome = re.sub(r"[\\/:*?\"<>|]", "-", f"PLA {marca} {cor}".replace("  ", " ").strip())
            if nome.lower() in vistos:
                continue
            vistos.add(nome.lower())
            temp_max, temp_min = 220, 200
            m = re.search(r"(\d{3})\s*[–-]\s*(\d{3})\s*°?C", r.get("Observações", "") or "")
            if m:
                temp_min, temp_max = int(m.group(1)), int(m.group(2))
            preset = {
                "filament_settings_id": [nome],
                "from": "User",
                "inherits": FILAMENTO_BASE,
                "is_custom_defined": "0",
                "name": nome,
                "version": VERSAO_PRESET,
                "filament_colour": [hexa],
                # O Reggae Slicer guarda a cor do filamento em default_filament_colour; filament_colour é
                # do projeto e o programa descarta ao ler o perfil (ler essa chave fechava o programa).
                "default_filament_colour": [hexa],
                "filament_vendor": [marca or "Genérico"],
                "nozzle_temperature": [str(temp_max)],
                "nozzle_temperature_initial_layer": [str(temp_max)],
                "nozzle_temperature_range_low": [str(temp_min)],
                "nozzle_temperature_range_high": [str(temp_max)],
            }
            preco = str(r.get("Preço (R$)", "") or "").strip().replace(".", "").replace(",", ".")
            peso = _inteiro(r.get("Peso (g)"))
            try:
                if preco and peso:
                    preset["filament_cost"] = [f"{float(preco) * 1000 / peso:.2f}"]  # R$ por kg
            except ValueError:
                pass
            res[nome] = json.dumps(preset, ensure_ascii=False, indent=4) + "\n"
        return res

    def _ler_estado(self):
        try:
            with open(os.path.join(self.pasta_app, ARQ_ESTADO), encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return {}

    def gravar_filamentos(self):
        if not os.path.isdir(os.path.dirname(os.path.dirname(self.pasta_filamentos))):
            return {"gravados": [], "mantidos": [], "apagados": []}  # o Reggae Slicer ainda não foi aberto
        os.makedirs(self.pasta_filamentos, exist_ok=True)
        estado = self._ler_estado()
        desejados = self.filamentos_desejados()
        feito = {"gravados": [], "mantidos": [], "apagados": []}
        novo_estado = {}
        for nome, conteudo in desejados.items():
            caminho = os.path.join(self.pasta_filamentos, nome + ".json")
            atual = _hash_arquivo(caminho)
            if atual is not None and atual != estado.get(nome) and atual != hashlib.sha256(conteudo.encode("utf-8")).hexdigest():
                feito["mantidos"].append(nome)  # editado no Reggae Slicer (ou criado à mão): é do usuário
                continue
            h = hashlib.sha256(conteudo.encode("utf-8")).hexdigest()
            if atual != h:
                _gravar_atomico(caminho, conteudo)
                feito["gravados"].append(nome)
            novo_estado[nome] = h
        for nome, h in estado.items():
            if nome in desejados:
                continue
            caminho = os.path.join(self.pasta_filamentos, nome + ".json")
            if _hash_arquivo(caminho) == h:
                os.remove(caminho)
                feito["apagados"].append(nome)
        _gravar_atomico(os.path.join(self.pasta_app, ARQ_ESTADO), json.dumps(novo_estado, ensure_ascii=False, indent=1))
        return feito

    # ------------------------------------------------------------ ciclo
    def atualizar(self):
        os.makedirs(self.pasta_app, exist_ok=True)
        dados = self.resumo()
        _gravar_atomico(os.path.join(self.pasta_app, ARQ_RESUMO), json.dumps(dados, ensure_ascii=False, indent=1))
        return dados, self.gravar_filamentos()

    def _laco(self):
        while not self._parar.is_set():
            try:
                v = self.repo.versao()
                if v != self._versao:
                    self.atualizar()
                    self._versao = v
            except Exception:  # noqa: BLE001  (a ponte nunca derruba o Selecta 3D)
                log.exception("ponte com o Reggae Slicer")
            self._parar.wait(self.intervalo)

    def iniciar(self):
        threading.Thread(target=self._laco, name="ponte-reggae", daemon=True).start()
        return self

    def parar(self):
        self._parar.set()


def _hash_arquivo(caminho):
    try:
        with open(caminho, "rb") as f:
            return hashlib.sha256(f.read()).hexdigest()
    except OSError:
        return None


def _gravar_atomico(caminho, texto):
    tmp = caminho + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(texto)
    os.replace(tmp, caminho)


def main():
    from .dados import PASTA_REGGAE, Repositorio
    p = argparse.ArgumentParser(description="Gera o resumo e os filamentos do Reggae Slicer uma vez")
    p.add_argument("--raiz", required=True)
    p.add_argument("--pasta-app", default=os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "Organizador3D"))
    a = p.parse_args()
    repo = Repositorio(a.raiz)
    ponte = PonteReggae(repo, a.pasta_app, repo.caminho(PASTA_REGGAE))
    dados, fil = ponte.atualizar()
    print(f"Resumo: {os.path.join(a.pasta_app, ARQ_RESUMO)}")
    print(f"  {len(dados['fila'])} peças na fila, {len(dados['projetos'])} projetos ativos, {len(dados['estoque'])} rolos")
    com_arquivo = sum(1 for x in dados["fila"] if x["arquivo"])
    print(f"  {com_arquivo} peças com arquivo para abrir no Reggae Slicer")
    print(f"Filamentos em {ponte.pasta_filamentos}:")
    for chave, nomes in fil.items():
        print(f"  {chave}: {', '.join(nomes) if nomes else '-'}")


if __name__ == "__main__":
    main()
