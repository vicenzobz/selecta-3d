"""Avisos fora da tela (A11): bot do Telegram do usuário, opcional e desligado por padrão.

O aviso no app do celular (notificação do navegador) é feito na própria interface (ui/app.js).
Aqui fica só o Telegram, mandado pelo PC: token e chat ficam em %LOCALAPPDATA%\\Organizador3D\\config.json
(nunca na pasta compartilhada). Sem token, nada é enviado.
"""
import json
import logging
import threading
import urllib.parse
import urllib.request

from .dados import ErroDados

log = logging.getLogger("organizador")
EVENTOS = ("terminou", "falhou", "cancelada", "falha_camera", "primeira_camada")
API = "https://api.telegram.org/bot{token}/sendMessage"


class Avisos:
    def __init__(self, config=None, enviar=None):
        self.config = config
        self._enviar = enviar or self._enviar_http  # os testes trocam por uma função falsa

    def _cfg(self, k):
        return self.config[k] if self.config is not None else None

    def estado(self):
        return {"telegram": bool(self._cfg("telegram_token") and self._cfg("telegram_chat")),
                "eventos": list(self._cfg("avisos_eventos") or EVENTOS)}

    def configurar(self, token=None, chat=None, eventos=None, apagar=False):
        if self.config is None:
            raise ErroDados("sem configuração")
        if apagar:
            self.config["telegram_token"] = None
            self.config["telegram_chat"] = None
            return self.estado()
        if token is not None:
            token = str(token).strip()
            if token and ":" not in token:
                raise ErroDados("o token do bot tem o formato 123456:ABC…")
            self.config["telegram_token"] = token or None
        if chat is not None:
            chat = str(chat).strip()
            if chat and not chat.lstrip("-").isdigit():
                raise ErroDados("o chat é um número (ex.: 123456789)")
            self.config["telegram_chat"] = chat or None
        if eventos is not None:
            self.config["avisos_eventos"] = [e for e in eventos if e in EVENTOS]
        return self.estado()

    def _enviar_http(self, token, chat, texto):
        dados = urllib.parse.urlencode({"chat_id": chat, "text": texto}).encode()
        with urllib.request.urlopen(urllib.request.Request(API.format(token=token), data=dados), timeout=15) as r:
            return json.loads(r.read().decode("utf-8", "replace")).get("ok", False)

    def avisar(self, evento, texto, esperar=False):
        """Manda o aviso se o Telegram estiver configurado e o evento ligado. Nunca levanta erro."""
        token, chat = self._cfg("telegram_token"), self._cfg("telegram_chat")
        if not (token and chat) or evento not in (self._cfg("avisos_eventos") or EVENTOS):
            return False

        def mandar():
            try:
                return self._enviar(token, chat, "Selecta 3D — " + texto)
            except Exception:  # noqa: BLE001
                log.exception("não consegui mandar o aviso pelo Telegram")
                return False
        if esperar:
            return mandar()
        threading.Thread(target=mandar, daemon=True).start()
        return True

    def testar(self):
        if not self.estado()["telegram"]:
            raise ErroDados("preencha o token do bot e o número do chat antes")
        ok = self.avisar("terminou", "teste de aviso. Se chegou, está tudo certo.", esperar=True)
        if not ok:
            raise ErroDados("o Telegram não aceitou a mensagem: confira o token e o chat (mande /start para o bot antes)")
        return {"ok": True}
