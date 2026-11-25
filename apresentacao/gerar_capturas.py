"""Gera as capturas de tela do README com dados de demonstração (nada da pasta real).

Cria uma pasta de dados fictícia num diretório temporário, abre o Selecta 3D no modo navegador com uma
configuração isolada e tira as capturas com o Playwright (Chromium).
Uso (a partir de PROGRAMAS/SELECTA-3D): python apresentacao/gerar_capturas.py
Precisa de: pip install playwright trimesh && python -m playwright install chromium
"""
import datetime
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time

AQUI = os.path.dirname(os.path.abspath(__file__))
PROGRAMA = os.path.dirname(AQUI)
sys.path.insert(0, PROGRAMA)

from app.dados import Repositorio  # noqa: E402

HOJE = datetime.date.today()


def dia(n):
    return (HOJE + datetime.timedelta(days=n)).isoformat()


def modelos(raiz):
    """Arquivos 3D simples para a tela Arquivos e a prévia."""
    import trimesh
    pastas = {"organizadores": "PROJETOS/ORGANIZADORES", "vasos": "PROJETOS/VASOS", "kobra": "PROJETOS/IMPRESSORA"}
    for p in pastas.values():
        os.makedirs(os.path.join(raiz, p), exist_ok=True)
    caixa = trimesh.creation.box((80, 50, 30))
    vazio = trimesh.creation.box((76, 46, 30)).apply_translation((0, 0, 2))
    try:
        org = caixa.difference(vazio)
    except Exception:  # noqa: BLE001  (sem motor de booleanas: caixa cheia)
        org = caixa
    org.export(os.path.join(raiz, pastas["organizadores"], "bandeja_80x50_v01.stl"))
    vaso = trimesh.creation.cylinder(radius=35, height=120, sections=10)
    vaso.export(os.path.join(raiz, pastas["vasos"], "vaso_facetado_v02.stl"))
    gancho = trimesh.creation.annulus(r_min=12, r_max=18, height=8)
    gancho.export(os.path.join(raiz, pastas["kobra"], "suporte_carretel_v01.stl"))
    trimesh.creation.capsule(height=40, radius=8).export(os.path.join(raiz, pastas["organizadores"], "divisoria_v01.stl"))


def dados_demo(raiz):
    r = Repositorio(raiz)
    r.garantir_estrutura()
    modelos(raiz)
    rolos = [("PLA", "Genérico", "branco", "#F2F0E6", 1000, 820, 22.0), ("PLA", "Genérico", "preto", "#1D1D1F", 1000, 640, 22.0),
             ("PLA", "Genérico", "azul", "#1F5FBF", 1000, 910, 24.0), ("PLA", "Genérico", "vermelho", "#C8281E", 1000, 350, 24.0),
             ("PLA", "Genérico", "amarelo", "#F2C12E", 1000, 1000, 24.0), ("PLA", "Genérico", "verde", "#3E8E3A", 1000, 180, 24.0),
             ("PETG", "Genérico", "laranja", "#EE7A22", 1000, 1000, 30.0), ("PLA", "Genérico", "cinza", "#8A8D91", 1000, 760, 22.0)]
    for mat, marca, cor, hexa, peso, resta, preco in rolos:
        r.tabela_adicionar("estoque.md", "Filamentos", {
            "Material": mat, "Marca": marca, "Cor": cor, "Hex": hexa, "Peso (g)": str(peso), "Restante (g)": str(resta),
            "Tara (g)": "180", "Preço (R$)": f"{preco * 4:.2f}".replace(".", ","), "Local": "caixa com sílica",
            "Status": "aberto" if resta < peso else "lacrado"})
    for item, cat, q, un, minimo in [("Cola em bastão", "mesa", "2", "un", "1"), ("Álcool isopropílico", "limpeza", "1", "L", "1"),
                                     ("Bico 0,4 mm", "peça da impressora", "3", "un", "2"), ("Sílica gel", "armazenamento", "400", "g", "200")]:
        r.tabela_adicionar("estoque.md", "Insumos e peças", {"Item": item, "Categoria": cat, "Quantidade": q, "Unidade": un,
                                                            "Mínimo": minimo, "Local": "gaveta"})
    for nome, pasta, st, prazo, desc in [
            ("Organizadores de bancada", "`PROJETOS/ORGANIZADORES`", "ativo", dia(12), "Bandejas e divisórias para a bancada."),
            ("Vasos facetados", "`PROJETOS/VASOS`", "ativo", dia(20), "Vasos em modo vaso, para presente."),
            ("Impressora e acessórios", "`PROJETOS/IMPRESSORA`", "ativo", "", "Calibração e peças para a impressora."),
            ("Luminária de mesa", "", "ideia", "", "Cúpula difusora e base com peso.")]:
        r.tabela_adicionar("projetos.md", "Projetos", {"Projeto": nome, "Pasta": pasta, "Status": st, "Prazo": prazo,
                                                       "Descrição": desc})
    pecas = [("Suporte de carretel", "`PROJETOS/IMPRESSORA/suporte_carretel_v01.stl`", "cinza", "1", "pronto para fatiar", "Em casa."),
             ("Bandeja 80 × 50 (4)", "`PROJETOS/ORGANIZADORES/bandeja_80x50_v01.stl`", "preto, amarelo", "2", "pronto para fatiar",
              "Trabalho. Rolos: carregar amarelo."),
             ("Divisórias (8)", "`PROJETOS/ORGANIZADORES/divisoria_v01.stl`", "preto", "2", "pronto para fatiar", "Madrugada."),
             ("Vaso facetado azul", "`PROJETOS/VASOS/vaso_facetado_v02.stl`", "azul", "2", "pronto para fatiar", "Modo vaso, 0,28 mm."),
             ("Vaso facetado vermelho e branco", "`PROJETOS/VASOS/vaso_facetado_v02.stl`", "vermelho, branco", "3", "pronto para fatiar", ""),
             ("Cúpula da luminária", "—", "branco", "4", "aguardando modelo", "Desenhar no CAD."),
             ("Base da luminária", "—", "preto", "4", "aguardando modelo", "")]
    for peca, arq, cor, pri, st, obs in pecas:
        r.fila_adicionar({"Peça": peca, "Arquivo (caminho relativo)": arq, "Filamento/cor": cor, "Prioridade": pri,
                          "Status": st, "Observações": obs})
    for pid, gramas, tempo in [("F01", "cinza 38", "1h45"), ("F02", "preto 96; amarelo 22", "4h10"), ("F03", "preto 54", "2h20"),
                               ("F04", "azul 61", "2h05"), ("F05", "vermelho 40; branco 25", "2h50")]:
        r.estimativa_salvar(pid, gramas, tempo, "fatiador", "")
    r.fila_atualizar("F01", {"Status": "fatiado"}, {"Status": "pronto para fatiar"})
    r.fila_atualizar("F02", {"Status": "fatiado"}, {"Status": "pronto para fatiar"})
    r.fila_registrar("F01", "concluído", "1h52", [{"id": "R08", "gramas": "39"}], "Saiu limpo.", {"Status": "fatiado"})
    for item, loja, valor, st, chegada in [("Rolo PLA preto 1 kg", "Loja de filamentos", "89,90", "a caminho", dia(3)),
                                           ("Ímãs de neodímio 6 × 2 mm (50)", "Loja de eletrônica", "24,50", "pedido", dia(8)),
                                           ("Chapa PEI texturizada", "Marketplace", "119,00", "recebido", "")]:
        r.tabela_adicionar("compras.md", "Compras", {"Data": dia(-4), "Item": item, "Loja": loja, "Valor (R$)": valor,
                                                     "Status": st, "Chegada prevista": chegada})
    for tit, link, tipo, tags in [("Organizador modular de gavetas", "https://www.printables.com/", "quero fazer", "organização"),
                                  ("Vaso em espiral", "https://makerworld.com/", "referência", "vaso, presente"),
                                  ("Suporte de ferramentas na lateral", "https://www.thingiverse.com/", "quero fazer", "impressora")]:
        r.tabela_adicionar("referencias.md", "Referências", {"Título": tit, "Link": link, "Tipo": tipo, "Status": "salvo",
                                                             "Tags": tags, "Licença": "?"})
    with open(os.path.join(raiz, "diario.md"), "a", encoding="utf-8") as f:
        f.write(f"\n## {dia(-1)} — Calibração\n\nPrimeira camada ajustada; temperatura do PLA genérico em 210 °C.\n")


def gerar_banner(p):
    """banner.html (fontes e cores do programa) -> banner.png, 1280 x 440, em dobro para ficar nítido."""
    from pathlib import Path
    nav = p.chromium.launch()
    pag = nav.new_page(viewport={"width": 1280, "height": 440}, device_scale_factor=2)
    pag.goto(Path(os.path.join(AQUI, "banner.html")).as_uri())
    pag.wait_for_timeout(800)
    pag.screenshot(path=os.path.join(AQUI, "banner.png"))
    nav.close()
    print("banner")


def porta_livre():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main():
    from playwright.sync_api import sync_playwright
    base = tempfile.mkdtemp(prefix="selecta-demo-")
    raiz, app = os.path.join(base, "Selecta 3D"), os.path.join(base, "appdata")
    os.makedirs(raiz)
    os.makedirs(app)
    dados_demo(raiz)
    porta = porta_livre()
    env = {**os.environ, "LOCALAPPDATA": app, "APPDATA": app, "PYTHONUTF8": "1"}
    proc = subprocess.Popen([sys.executable, os.path.join(PROGRAMA, "selecta3d.pyw"), "--navegador", "--sem-abrir",
                             "--raiz", raiz, "--porta", str(porta)], env=env, stdout=subprocess.PIPE, text=True)
    try:
        url = proc.stdout.readline().strip()
        time.sleep(1.5)
        with sync_playwright() as p:
            gerar_banner(p)
            nav = p.chromium.launch()
            pag = nav.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
            # sem o roteiro do primeiro dia aberto e sem a revisão das referências sem imagem
            pag.add_init_script("localStorage.setItem('org3d.aberto_1dia','false');"
                                "localStorage.setItem('org3d.semImagemAoAbrir','false');")
            pag.goto(url)
            pag.wait_for_timeout(2500)
            for tela in ("painel", "fila", "estoque", "projetos", "arquivos"):
                pag.evaluate(f"irPara('{tela}')")
                pag.wait_for_timeout(2500 if tela == "arquivos" else 1200)
                # o caminho da pasta temporária (com o nome do usuário do Windows) vira o caminho padrão
                pag.evaluate("""([r, novo]) => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
                    while (w.nextNode()) if (w.currentNode.nodeValue.includes(r))
                      w.currentNode.nodeValue = w.currentNode.nodeValue.split(r).join(novo); }""", [raiz, r"Documentos\Selecta 3D"])
                pag.screenshot(path=os.path.join(AQUI, f"tela_{tela}.png"))
                print("captura", tela)
            nav.close()
    finally:
        proc.terminate()
        shutil.rmtree(base, ignore_errors=True)


if __name__ == "__main__":
    main()
