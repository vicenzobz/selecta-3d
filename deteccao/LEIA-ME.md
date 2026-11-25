# Detecção de falhas pela câmera (A12)

Feita na rodada fila-v25 (2026-11-22). O Selecta 3D olha a câmera da Kobra X durante a impressão e, se vir uma falha (espaguete, peça solta), **pausa a impressão e avisa**. Continuar ou cancelar fica com você, no cartão Kobra X do Painel. Pausar sozinho foi autorizado pelo usuário em 22/11 (`decisoes.md`); é a única ação automática na impressora.

## De onde vem

- Modelo e serviço do **Obico** (antigo The Spaghetti Detective), `TheSpaghettiDetective/obico-server`, pasta `ml_api`, versão fixa: commit `df8190ef7500459599ebf398c3d1f653754792fd` (2026-11-06). Licença **AGPL-3.0**. Usamos o serviço como está, rodando num contêiner neste PC; nada do código deles foi copiado para esta pasta.
- O cálculo que decide "é falha" é o mesmo do Obico (`backend/lib/prediction.py` e os parâmetros `FD_1ST_GEN_PARAMS` de `backend/config/settings.py`), reescrito em `PROGRAMAS/SELECTA-3D/app/deteccao.py`: uma foto a cada 10 s, média exponencial e médias móveis; os primeiros 30 quadros (5 min) de cada impressão não contam; o nível de pausar é o de alerta dividido por 1,75 (como o Obico faz para "pausar" × "avisar").

## Instalar (você roda; nada instala sozinho)

Precisa de: driver NVIDIA atualizado (RTX 3060), WSL 2 e Docker Desktop (com o "WSL 2 backend"). O script **não** instala nenhum desses: se faltar, ele diz o que instalar e para.

1. Abra o Selecta 3D uma vez (versão fila-v25 ou mais nova): ele cria a senha do serviço no `config.json` dele.
2. Abra o Docker Desktop e espere "Engine running".
3. Botão direito em `instalar_deteccao.ps1` → **Executar com o PowerShell**. A primeira vez demora (baixa a imagem base do Obico, alguns GB, e o modelo, ~200 MB).
4. No fim deve aparecer "Modelo carregado NA PLACA DE VÍDEO. Pronto." Feche e abra o Selecta 3D: o cartão Kobra X mostra "Detecção de falhas: ligada".

O contêiner (`organizador-deteccao`) só escuta em `127.0.0.1:3333`: não aparece na rede de casa nem na internet. Ele busca a foto num endereço local de uso único que o Selecta 3D abre em `127.0.0.1:7131` (pelo nome `host.docker.internal`, do Docker Desktop).

Opções: `-SemGpu` (só processador, para testar), `-Remover` (para e apaga o contêiner). Log: `instalar_deteccao.log`.

## Conferir à mão

- `python PROGRAMAS/SELECTA-3D\deteccao\deteccao.py` → o serviço responde?
- `python PROGRAMAS/SELECTA-3D\deteccao\deteccao.py foto.jpg` → o que o modelo vê numa foto.

## Na tela

- Cartão Kobra X → **Detecção de falhas**: ligar/desligar e sensibilidade (baixa, média, alta; como no Obico). Só na janela do PC.
- Na falha: quadro vermelho com a foto, **Continuar a impressão**, **Cancelar…** (pede confirmação) e **Falso alarme** (anota em `IMPRESSOES/falhas/falsos-alarmes.md`, para calibrar).
- As fotos das falhas ficam em `IMPRESSOES/falhas/`.
- Aviso no celular (navegador) e no Telegram, se configurado (botão Avisos).

## Se não estiver instalada

Nada muda: o resto do Selecta 3D funciona igual; o cartão só diz "serviço não instalado".

## Limites conhecidos (a conferir com a impressora)

- Testado só com a ponte falsa e um serviço de detecção falso; o modelo de verdade e a câmera da Kobra X ainda não foram vistos juntos.
- A câmera da Kobra X pode ter pouca luz ou ângulo ruim: se houver muitos falsos alarmes, baixar a sensibilidade ou desligar.
- Se `host.docker.internal` não alcançar o `127.0.0.1` do PC, o serviço responde erro e a detecção fica parada (aparece no log do Selecta 3D). Ajuste: em `config.json`, `deteccao_host` e `deteccao_porta`.
