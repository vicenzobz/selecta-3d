"""Conferir a detecção de falhas à mão (A12). O trabalho de verdade roda dentro do Selecta 3D (app/deteccao.py).

    python PROGRAMAS\\SELECTA-3D\\deteccao\\deteccao.py            -> o serviço responde? (http://127.0.0.1:3333/hc/)
    python PROGRAMAS\\SELECTA-3D\\deteccao\\deteccao.py foto.jpg   -> manda uma foto e mostra o que o modelo viu

Usa a senha guardada em %LOCALAPPDATA%\\Organizador3D\\config.json (a mesma do Selecta 3D).
"""
import json
import os
import sys
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(AQUI))

from app.deteccao import SERVICO_PADRAO, Deteccao  # noqa: E402


class _Cfg(dict):
    def __getitem__(self, k):
        return self.get(k)


def _config():
    arq = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "Organizador3D", "config.json")
    try:
        with open(arq, encoding="utf-8") as f:
            return _Cfg(json.load(f))
    except (OSError, ValueError):
        return _Cfg()


def main():
    cfg = _config()
    servico = cfg.get("deteccao_servico") or SERVICO_PADRAO
    try:
        with urllib.request.urlopen(servico + "/hc/", timeout=5) as r:
            print("serviço:", r.read().decode().strip(), f"({servico})")
    except Exception as e:  # noqa: BLE001
        print(f"o serviço não respondeu em {servico}: {e}")
        print("Rode PROGRAMAS\\SELECTA-3D\\deteccao\\instalar_deteccao.ps1 e abra o Docker Desktop.")
        return 1
    if len(sys.argv) < 2:
        return 0
    with open(sys.argv[1], "rb") as f:
        foto = f.read()
    d = Deteccao(None, None, None, servico=servico, porta_quadro=0)
    d.config = cfg  # só para ler a senha; nada é gravado
    det = d._analisar_http(foto)
    d.encerrar()
    print(f"{len(det)} caixa(s); soma das confianças = {sum(x[1] for x in det):.3f}")
    for rot, conf, caixa in det:
        print(f"  {rot}: {conf:.3f} em {caixa}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
