# Extensão "Selecta 3D" para o Brave

Salva a página aberta no navegador direto no Selecta 3D do PC: como **referência** (`referencias.md`), **projeto novo** (`projetos.md`, com o link guardado como referência dele) ou **compra** (`compras.md`, com loja, link e valor).

## Instalar (uma vez)

1. No Brave, abra `brave://extensions`.
2. Ligue o **Modo de desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** e escolha a pasta `extensao` (ao lado do `Selecta3D.exe`; quem roda pelo código: `PROGRAMAS\SELECTA-3D\extensao`).
4. Clique no ícone de quebra-cabeça da barra do Brave e no alfinete do **Selecta 3D**, para o ícone ficar sempre à vista.
5. No programa do PC: botão **Celular** (menu) → **Ligar celular e extensão** → em "Extensão do navegador", **Copiar**.
6. Clique no ícone da extensão, cole o endereço e clique em **Conectar**.

O programa precisa estar aberto no PC, com "celular e extensão" ligado. Se o código de acesso mudar, clique na engrenagem da extensão e cole o endereço de novo.

## Usar

- **Ícone da extensão** ou **Alt+Shift+S**: lê a página aberta (nome, autor, licença, imagens e preço) e mostra o formulário.
  - Em lojas (Mercado Livre, Amazon, Shopee, AliExpress, KaBuM!…) ou páginas com preço, já abre em **Compra**.
  - Nas outras, abre em **Referência**: escolha projetos, tags e a imagem (das da página ou um print da tela). Nas tags, as já existentes aparecem para clicar, com as **relacionadas** (em verde) primeiro: as que aparecem no nome ou na descrição da página, as dos projetos marcados e as que andam junto com as já escolhidas. Digitar um pedaço filtra.
  - **Projeto novo** cria o projeto (status "ideia") e guarda o link como referência `quero fazer` dele.
  - Avisa se o link já estiver salvo. **Ctrl+Enter** salva.
- **Botão direito** num link → **Salvar link no Selecta 3D**, sem abrir a página. Quem lê o link é o programa, e alguns sites não deixam ler. Botão direito na página → **Salvar esta página no Selecta 3D**.
- **Modelo baixado**: quando o Brave termina de baixar um **3MF, STL, STEP ou OBJ**, abre sozinha uma janela: escolha o **projeto** (o programa sugere o da referência ou o escolhido no botão Baixar do Selecta 3D), confira o nome e a **licença**. A extensão lê a licença na página do modelo; se não achar, avise que é para procurar "Licença"/"License" na página: quando ela aparece na tela, o campo é preenchido sozinho. Também dá para escolher na lista ou deixar "Ainda não sei" (vai para a revisão). **Guardar no projeto** move o arquivo de Downloads para a pasta do projeto. Outros tipos de download são ignorados; **Deixar em Downloads** fecha sem mexer.
- Depois de salvar, **Ver no Selecta 3D** abre a aba certa do programa no navegador.

Como a extensão lê a página na sua própria aba, funciona também em Printables e MakerWorld, que bloqueiam a leitura automática do programa. Se o site recusar baixar a imagem escolhida, a extensão tenta pela página e, se não der, guarda o print da tela.

## Permissões

| Permissão | Para quê |
|---|---|
| `activeTab`, `scripting` | ler a aba aberta só quando você clica na extensão (ou usa o atalho ou o menu) |
| `storage` | guardar o endereço do programa |
| `contextMenus` | itens do botão direito |
| `downloads` | perceber quando termina o download de um modelo 3D (3MF, STL, STEP, OBJ) e saber onde ele foi salvo; os outros downloads são ignorados |
| `http://127.0.0.1/*` | falar com o programa no próprio PC |
| opcional: outro endereço | só se você colar um endereço que não seja do PC; o Brave pergunta antes |

Nada sai do seu PC: a extensão só conversa com o programa (em `127.0.0.1`), e o programa só baixa a imagem escolhida.

## Versões

| Versão | Data | O que mudou |
|---|---|---|
| 1.3.0 | 2026-11-22 | Modelos baixados vão para a pasta do projeto escolhido, com a licença da página (ou procurada pelo usuário); permissão `downloads`; leitura de licença melhor (Creative Commons por extenso, dados do MakerWorld). |
| 1.2.0 | 2026-11-21 | Ícone e cores reggae. |
| 1.1.0 | 2026-11-20 | Tags sugeridas com as relacionadas primeiro; digitar filtra. |
| 1.0.0 | 2026-11-20 | Primeira versão: referência, projeto novo e compra; imagens da página ou print; menu do botão direito; atalho Alt+Shift+S. |
