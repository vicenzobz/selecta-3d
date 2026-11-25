# Empacota o Selecta 3D num programa para Windows que não precisa de Python (PyInstaller, pasta única).
# Rodar pelo empacotar.ps1 (no PC) ou pelo GitHub Actions (.github/workflows/empacotar.yml).
import os

PASTA = os.path.dirname(SPECPATH)  # PROGRAMAS/SELECTA-3D

dados = [
    (os.path.join(PASTA, "ui"), "ui"),
    (os.path.join(PASTA, "icone"), "icone"),
    (os.path.join(PASTA, "perfis-kobra-x"), "perfis-kobra-x"),
    (os.path.join(PASTA, "deteccao", "LEIA-ME.md"), "deteccao"),
    (os.path.join(PASTA, "deteccao", "deteccao.py"), "deteccao"),
    (os.path.join(PASTA, "deteccao", "instalar_deteccao.ps1"), "deteccao"),
]

a = Analysis(
    [os.path.join(PASTA, "selecta3d.pyw")],
    pathex=[PASTA],
    datas=dados,
    hiddenimports=["app.bandeja", "pystray._win32", "webview.platforms.winforms", "webview.platforms.edgechromium",
                   "clr"],
    excludes=["tkinter", "pytest", "numpy", "psutil", "setuptools"],
)
# ui/app_antigo* e arquivos de cópia não vão no pacote
a.datas = [d for d in a.datas if "app_antigo" not in d[0]]
pyz = PYZ(a.pure)
exe = EXE(
    pyz, a.scripts, [],
    exclude_binaries=True,
    name="Selecta3D",
    icon=os.path.join(PASTA, "icone", "selecta3d.ico"),
    console=False,
    version=None,
)
coll = COLLECT(exe, a.binaries, a.datas, name="Selecta3D")
