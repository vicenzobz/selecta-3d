"""Ícone do Selecta 3D perto do relógio (área de notificação do Windows).

Com ele o programa continua rodando sem a janela, para o app do celular e a extensão do navegador
seguirem funcionando. Menu: abrir, celular e extensão, ligar junto com o Windows, sair.
"""
import logging
import threading

log = logging.getLogger("organizador")


class Bandeja:
    def __init__(self, icone_png, abrir, sair, celular, inicializacao):
        import pystray
        from PIL import Image

        self._abrir = abrir
        self._sair = sair
        self._celular = celular
        self._inicio = inicializacao

        def alternar_celular(_icone, _item):
            try:
                if self._celular.srv is None:
                    self._celular.ligar()
                else:
                    self._celular.desligar()
            except Exception as e:  # noqa: BLE001
                self.avisar(f"Não consegui mudar o acesso do celular: {e}")
            self.atualizar()

        def alternar_inicio(_icone, _item):
            try:
                if self._inicio.ligado():
                    self._inicio.desligar()
                else:
                    self._inicio.ligar()
            except Exception as e:  # noqa: BLE001
                log.exception("inicialização com o Windows")
                self.avisar(f"Não consegui mudar a inicialização com o Windows: {e}")
            self.atualizar()

        menu = pystray.Menu(
            pystray.MenuItem("Abrir o Selecta 3D", lambda _i, _m: self._abrir(), default=True),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Celular e extensão ligados", alternar_celular,
                             checked=lambda _m: self._celular.srv is not None),
            pystray.MenuItem("Ligar junto com o Windows", alternar_inicio,
                             checked=lambda _m: self._inicio.ligado()),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Sair do Selecta 3D", lambda _i, _m: self._sair()),
        )
        self.icone = pystray.Icon("Organizador3D", Image.open(icone_png), "Selecta 3D", menu)
        self.atualizar()

    def atualizar(self):
        estado = "celular e extensão ligados" if self._celular.srv is not None else "celular e extensão desligados"
        self.icone.title = f"Selecta 3D · {estado}"
        try:
            self.icone.update_menu()
        except Exception:  # noqa: BLE001
            pass

    def iniciar(self):
        threading.Thread(target=self.icone.run, name="bandeja", daemon=True).start()

    def avisar(self, texto):
        try:
            self.icone.notify(texto, "Selecta 3D")
        except Exception:  # noqa: BLE001
            log.info("aviso da bandeja: %s", texto)

    def parar(self):
        try:
            self.icone.stop()
        except Exception:  # noqa: BLE001
            pass
