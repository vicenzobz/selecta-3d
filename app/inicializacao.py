"""Ligar o Selecta 3D junto com o Windows: um atalho na pasta "Inicializar" do usuário.

O atalho abre o programa em segundo plano (só o ícone perto do relógio), para o app do celular
e a extensão do navegador funcionarem sem precisar abrir a janela. Apagar o atalho desliga.
"""
import os
import subprocess
import sys

NOME_ATALHO = "Selecta 3D (segundo plano).lnk"
NOME_ANTIGO = "Organizador 3D (segundo plano).lnk"  # até princ-v01; apontava para PROGRAMAS\\ORGANIZADOR


class Inicializacao:
    def __init__(self, script, icone, pasta=None):
        self.script = os.path.abspath(script)
        self.icone = os.path.abspath(icone)
        self.pasta = pasta or os.path.join(os.environ.get("APPDATA", ""), "Microsoft", "Windows", "Start Menu",
                                           "Programs", "Startup")

    @property
    def atalho(self):
        return os.path.join(self.pasta, NOME_ATALHO)

    def ligado(self):
        return os.path.isfile(self.atalho)

    def migrar(self):
        """Troca o atalho do nome antigo (que aponta para a pasta velha) pelo novo. Devolve True se trocou."""
        antigo = os.path.join(self.pasta, NOME_ANTIGO)
        if not os.path.isfile(antigo):
            return False
        try:
            self.ligar()
            os.remove(antigo)
        except (OSError, subprocess.SubprocessError):
            return False
        return True

    def ligar(self):
        if getattr(sys, "frozen", False):  # Selecta3D.exe: o próprio .exe é o alvo, sem script
            alvo, args = sys.executable, "--segundo-plano"
        else:
            alvo = os.path.join(os.path.dirname(sys.executable), "pythonw.exe")
            if not os.path.isfile(alvo):
                alvo = sys.executable
            args = f'"{self.script}" --segundo-plano'
        os.makedirs(self.pasta, exist_ok=True)
        # os valores vão por variáveis de ambiente: nada de aspas ou acentos dentro do comando
        comando = ("$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:ORG_ATALHO);"
                   "$s.TargetPath = $env:ORG_ALVO; $s.Arguments = $env:ORG_ARGS; $s.WorkingDirectory = $env:ORG_PASTA;"
                   "$s.IconLocation = $env:ORG_ICONE; $s.Description = 'Selecta 3D em segundo plano'; $s.Save()")
        env = {**os.environ, "ORG_ATALHO": self.atalho, "ORG_ALVO": alvo,
               "ORG_ARGS": args, "ORG_PASTA": os.path.dirname(self.script),
               "ORG_ICONE": self.icone}
        subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", comando], env=env, check=True,
                       capture_output=True, timeout=30, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        return self.ligado()

    def desligar(self):
        if os.path.isfile(self.atalho):
            os.remove(self.atalho)
        return self.ligado()
