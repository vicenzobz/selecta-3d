"""Selecta 3D — abre a janela do programa.

Dois cliques neste arquivo (ou no atalho "Selecta 3D") abrem o programa (Python 3 com pywebview).
Fechar a janela deixa o programa rodando perto do relógio (para o app do celular e a extensão);
para fechar de vez: botão direito no ícone perto do relógio → Sair do Selecta 3D.

Opções para quem rodar pelo terminal:
  --segundo-plano    abre só o ícone perto do relógio, sem a janela (é assim que liga junto com o Windows)
  --navegador        abre no navegador em vez da janela própria (sem ícone perto do relógio)
  --porta 8765       porta fixa (padrão: uma livre qualquer)
  --raiz CAMINHO     pasta de dados. Padrão: duas pastas acima (D:/IMPRESSÃO 3D, porque o programa fica em
                     PROGRAMAS/SELECTA-3D) se lá houver fila-impressao.md; senão a guardada no config.json ("raiz");
                     senão Documentos/Selecta 3D, criada na primeira vez com os arquivos vazios
  --sem-abrir        só sobe o servidor (com --navegador) e mostra o endereço
"""
import argparse
import json
import logging
import os
import shutil
import subprocess
import sys
import threading
import urllib.request
import webbrowser

sys.dont_write_bytecode = True
# Empacotado (Selecta3D.exe, feito pelo PyInstaller): ui/, icone/ e app/ ficam na pasta temporária do pacote
EMPACOTADO = bool(getattr(sys, "frozen", False))
AQUI = getattr(sys, "_MEIPASS", "") if EMPACOTADO else os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)

from app.config import Configuracao  # noqa: E402
from app.fatiador import Fatiador  # noqa: E402
from app.ponte_reggae import PonteReggae  # noqa: E402
from app.dados import PASTA_REGGAE, Repositorio  # noqa: E402
from app.inicializacao import Inicializacao  # noqa: E402
from app.pesquisa import Pesquisa  # noqa: E402
from app.baixados import Baixados  # noqa: E402
from app.kxbridge import KXBridge  # noqa: E402
from app.avisos import Avisos  # noqa: E402
from app.deteccao import Deteccao  # noqa: E402
from app.seletor import SeletorImagem  # noqa: E402
from app.servidor import Celular, criar_servidor  # noqa: E402

TITULO = "Selecta 3D"
ICONE = os.path.join(AQUI, "icone", "selecta3d.ico")
ICONE_BANDEJA = os.path.join(AQUI, "icone", "png", "selecta3d_64.png")
ID_APLICATIVO = "Selecta3D.Programa"  # o mesmo do atalho (criar_atalhos.ps1): agrupa e fixa na barra de tarefas
ARQ_INSTANCIA = "instancia.json"  # porta da cópia aberta, para outra cópia pedir a janela
_TRAVA_INSTANCIA = None


def ja_esta_aberto():
    """Só uma cópia por vez (trava do Windows com nome)."""
    global _TRAVA_INSTANCIA
    if os.name != "nt":
        return False
    import ctypes
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    k32.CreateMutexW.restype = ctypes.c_void_p
    _TRAVA_INSTANCIA = k32.CreateMutexW(None, False, "Local/Organizador3D")
    return ctypes.get_last_error() == 183  # ERROR_ALREADY_EXISTS


def chamar_copia_aberta(pasta_app, token):
    """Pede à cópia que já está rodando (talvez só perto do relógio) para mostrar a janela."""
    try:
        with open(os.path.join(pasta_app, ARQ_INSTANCIA), encoding="utf-8") as f:
            porta = int(json.load(f)["porta"])
        req = urllib.request.Request(f"http://127.0.0.1:{porta}/api/janela", data=b"{}",
                                     headers={"X-Token": token, "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status == 200
    except Exception:  # noqa: BLE001
        pass
    if os.name == "nt":  # cópia antiga, sem esse pedido: ao menos traz a janela para a frente
        import ctypes
        u32 = ctypes.windll.user32
        janela = u32.FindWindowW(None, TITULO)
        if janela:
            u32.ShowWindow(janela, 9)  # SW_RESTORE
            u32.SetForegroundWindow(janela)
            return True
    return False


def identificar_aplicativo():
    """Faz o Windows tratar a janela como um programa próprio (ícone e grupo na barra de tarefas)."""
    if os.name == "nt":
        try:
            import ctypes
            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(ID_APLICATIVO)
        except (AttributeError, OSError):
            pass


def configurar_registro():
    pasta = os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "Organizador3D")
    os.makedirs(pasta, exist_ok=True)
    logging.basicConfig(
        filename=os.path.join(pasta, "registro.log"),
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        encoding="utf-8",
    )
    return pasta


def pasta_documentos():
    """Pasta Documentos de verdade (pode estar no OneDrive)."""
    if os.name == "nt":
        try:
            import ctypes
            buf = ctypes.create_unicode_buffer(260)
            if ctypes.windll.shell32.SHGetFolderPathW(None, 5, None, 0, buf) == 0 and buf.value:  # CSIDL_PERSONAL
                return buf.value
        except (AttributeError, OSError):
            pass
    return os.path.join(os.path.expanduser("~"), "Documents")


def escolher_raiz(pedida, config):
    """Pasta de dados: a pedida (--raiz ou ORGANIZADOR_RAIZ); a pasta de impressão 3D em volta do programa,
    se tiver a fila; a guardada no config.json; ou Documentos/Selecta 3D (cópia compartilhada, primeira vez)."""
    if pedida:
        return pedida
    if not EMPACOTADO:
        em_volta = os.path.dirname(os.path.dirname(AQUI))
        if os.path.isfile(os.path.join(em_volta, "fila-impressao.md")):
            return em_volta
    guardada = config["raiz"]
    if isinstance(guardada, str) and os.path.isdir(guardada):
        return guardada
    raiz = os.path.join(pasta_documentos(), "Selecta 3D")
    os.makedirs(raiz, exist_ok=True)
    config["raiz"] = raiz
    return raiz


def abrir_janela_alternativa(url):
    """Sem pywebview: tenta o Edge em modo aplicativo (janela sem abas), senão o navegador padrão."""
    for edge in (
        shutil.which("msedge"),
        os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
    ):
        if edge and os.path.exists(edge):
            subprocess.Popen([edge, f"--app={url}"])
            return
    webbrowser.open(url)


def criar_bandeja(abrir, sair, celular, inicio):
    try:
        from app.bandeja import Bandeja
        b = Bandeja(ICONE_BANDEJA, abrir, sair, celular, inicio)
        b.iniciar()
        return b
    except Exception:  # noqa: BLE001  (sem pystray: segue sem o ícone perto do relógio)
        logging.exception("não consegui pôr o ícone perto do relógio")
        return None


def main():
    p = argparse.ArgumentParser(description=TITULO)
    p.add_argument("--segundo-plano", action="store_true")
    p.add_argument("--navegador", action="store_true")
    p.add_argument("--porta", type=int, default=0)
    p.add_argument("--raiz", default=os.environ.get("ORGANIZADOR_RAIZ") or None)
    p.add_argument("--sem-abrir", action="store_true")
    args = p.parse_args()

    pasta_dados_app = configurar_registro()
    config = Configuracao(pasta_dados_app)
    if not args.navegador and ja_esta_aberto():
        if not args.segundo_plano:  # ligando com o Windows e já aberto: não faz nada
            chamar_copia_aberta(pasta_dados_app, config["token"])
        logging.info("já havia uma cópia aberta")
        return
    identificar_aplicativo()
    repo = Repositorio(escolher_raiz(args.raiz, config), pasta_miniaturas=os.path.join(pasta_dados_app, "miniaturas"))
    try:
        feito = repo.garantir_estrutura()
        if feito:
            logging.info("estrutura atualizada: %s", "; ".join(feito))
    except Exception:  # noqa: BLE001
        logging.exception("não consegui atualizar a estrutura dos .md")
    pasta_ui = os.path.join(AQUI, "ui")
    pesquisa = Pesquisa(config)
    fatiador = Fatiador(repo, repo.caminho(PASTA_REGGAE), config=config)
    # resumo e filamentos do estoque para o Reggae Slicer (app/ponte_reggae.py)
    PonteReggae(repo, pasta_dados_app, repo.caminho(PASTA_REGGAE)).iniciar()
    baixados = Baixados(repo, config)
    kx = KXBridge(repo, config)  # impressora pela rede (PROGRAMAS/REGGAE-SLICER/KX-BRIDGE.md)
    kx.avisos = Avisos(config)  # aviso pelo Telegram, se o usuário configurar (A11)
    # detecção de falhas pela câmera (A12): só funciona depois de rodar SELECTA-3D/deteccao/instalar_deteccao.ps1
    kx.deteccao = Deteccao(repo, kx, config, kx.avisos)
    kx.iniciar()
    kx.deteccao.iniciar()
    celular = Celular(repo, pasta_ui, config, pesquisa=pesquisa, baixados=baixados, kx=kx)
    seletor = SeletorImagem()
    inicio = Inicializacao(sys.executable if EMPACOTADO else os.path.abspath(__file__),
                           sys.executable if EMPACOTADO else ICONE)
    if os.name == "nt" and inicio.migrar():  # atalho antigo (Organizador 3D) apontava para a pasta velha
        logging.info("atalho de ligar junto com o Windows refeito com o nome novo")
    acoes = {"mostrar": lambda: None}  # preenchida quando a janela existir
    servidor = criar_servidor(repo, pasta_ui, porta=args.porta, token=config["token"], celular=celular,
                              seletor=seletor, inicializacao=inicio, ao_mostrar=lambda: acoes["mostrar"](),
                              pesquisa=pesquisa, fatiador=fatiador, baixados=baixados, kx=kx)
    porta = servidor.server_address[1]
    url = f"http://127.0.0.1:{porta}/?t={servidor.token}"
    logging.info("iniciado em %s, raiz %s%s", f"127.0.0.1:{porta}", repo.raiz,
                 " (segundo plano)" if args.segundo_plano else "")
    if config["celular"]:
        try:
            celular.ligar()
        except Exception:  # noqa: BLE001
            logging.exception("não consegui ligar o acesso pelo celular")

    if args.navegador:
        print(url, flush=True)
        if not args.sem_abrir:
            webbrowser.open(url)
        try:
            servidor.serve_forever()
        except KeyboardInterrupt:
            pass
        return

    threading.Thread(target=servidor.serve_forever, daemon=True).start()
    arq_instancia = os.path.join(pasta_dados_app, ARQ_INSTANCIA)
    with open(arq_instancia, "w", encoding="utf-8") as f:
        json.dump({"porta": porta, "pid": os.getpid()}, f)

    def encerrar():
        try:
            kx.deteccao.encerrar()
            kx.encerrar()  # fecha a ponte só se foi o Selecta 3D que a abriu
        except Exception:  # noqa: BLE001
            logging.exception("erro ao fechar o KX-Bridge")
        try:
            os.remove(arq_instancia)
        except OSError:
            pass
        if celular.srv is not None:
            celular.srv.shutdown()
        servidor.shutdown()

    try:
        import webview
    except ImportError:
        logging.warning("pywebview não instalado; usando janela do Edge")
        fim = threading.Event()
        acoes["mostrar"] = lambda: abrir_janela_alternativa(url)
        bandeja = criar_bandeja(acoes["mostrar"], fim.set, celular, inicio)
        if not args.segundo_plano:
            abrir_janela_alternativa(url)
        fim.wait()  # fica servindo até "Sair" no ícone perto do relógio
        if bandeja:
            bandeja.parar()
        encerrar()
        return

    janela = webview.create_window(TITULO, url, width=1400, height=900, min_size=(1000, 660),
                                   background_color="#15110C", text_select=True, hidden=args.segundo_plano)
    estado = {"sair": False, "avisou": False}

    def mostrar():
        janela.show()
        try:
            janela.restore()
        except Exception:  # noqa: BLE001
            pass

    def sair():
        estado["sair"] = True
        janela.destroy()

    acoes["mostrar"] = mostrar
    bandeja = criar_bandeja(mostrar, sair, celular, inicio)

    def ao_fechar():
        if estado["sair"] or bandeja is None:
            return True  # sem o ícone perto do relógio, fechar a janela fecha o programa
        threading.Thread(target=janela.hide, daemon=True).start()
        if not estado["avisou"]:
            estado["avisou"] = True
            bandeja.avisar("Continuo rodando aqui, perto do relógio, para o app do celular e a extensão. "
                           "Para fechar de vez: botão direito no ícone → Sair do Selecta 3D.")
        return False

    janela.events.closing += ao_fechar
    seletor.ativo = True
    pesquisa.leitor.ativo = True
    webview.start(private_mode=False, storage_path=os.path.join(pasta_dados_app, "webview"),
                  icon=ICONE if os.path.isfile(ICONE) else None)
    if bandeja:
        bandeja.parar()
    encerrar()
    logging.info("encerrado")


if __name__ == "__main__":
    main()
