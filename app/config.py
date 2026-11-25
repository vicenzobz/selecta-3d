"""Configuração local do programa (fora da pasta compartilhada): token de acesso e acesso pelo celular."""
import json
import os
import secrets


class Configuracao:
    def __init__(self, pasta):
        self.caminho = os.path.join(pasta, "config.json")
        self.dados = {}
        try:
            with open(self.caminho, encoding="utf-8") as f:
                self.dados = json.load(f)
        except (OSError, ValueError):
            self.dados = {}
        mudou = False
        if not isinstance(self.dados.get("token"), str) or len(self.dados["token"]) < 20:
            self.dados["token"] = secrets.token_urlsafe(18)
            mudou = True
        self.dados.setdefault("porta_celular", 8765)
        self.dados.setdefault("celular", False)
        if mudou:
            self.salvar()

    def __getitem__(self, k):
        return self.dados.get(k)

    def __setitem__(self, k, v):
        self.dados[k] = v
        self.salvar()

    def salvar(self):
        os.makedirs(os.path.dirname(self.caminho), exist_ok=True)
        tmp = self.caminho + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.dados, f, ensure_ascii=False, indent=2)
        os.replace(tmp, self.caminho)
