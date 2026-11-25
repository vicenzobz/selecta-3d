<#
  Instala o serviço de detecção de falhas (modelo aberto do Obico, AGPL-3.0) neste PC, para o Selecta 3D.

  O QUE FAZ (nada roda sozinho: você executa este script quando quiser):
    1. Confere a placa NVIDIA (nvidia-smi), o WSL 2 e o Docker Desktop. Se faltar algo, só explica o que instalar e PARA.
    2. Baixa o código do Obico numa versão fixa (commit df8190ef, 2026-11-06) para %LOCALAPPDATA%\Organizador3D\obico.
    3. Monta a imagem do serviço "ml_api" (baixa a imagem base do Obico, alguns GB, e o modelo, ~200 MB).
    4. Sobe o contêiner "organizador-deteccao" SÓ em 127.0.0.1:3333 (não fica visível na rede nem na internet),
       com a placa de vídeo (--gpus all) e reinício automático junto com o Docker.
    5. Usa a senha do serviço que o Selecta 3D guarda em %LOCALAPPDATA%\Organizador3D\config.json (nunca na pasta D:\IMPRESSÃO 3D).
    6. Confere se o serviço responde e se carregou o modelo na placa de vídeo.

  COMO RODAR: botão direito neste arquivo -> "Executar com o PowerShell".
    Opções:  -SemGpu      usa só o processador (mais lento; para testar se a placa der problema)
             -Remover     para e apaga o contêiner (a imagem fica; para apagar: docker image rm organizador/obico-ml-api)

  Log: PROGRAMAS\SELECTA-3D\deteccao\instalar_deteccao.log
#>
param([switch]$SemGpu, [switch]$Remover)

# 'Continue': no Windows PowerShell 5.1, com 'Stop' qualquer linha que o docker escreve no stderr (o progresso do
# docker build, por exemplo) derruba o script sem aviso. Os erros são conferidos por $LASTEXITCODE e try/catch.
$ErrorActionPreference = 'Continue'
$Commit = 'df8190ef7500459599ebf398c3d1f653754792fd'
$Imagem = 'organizador/obico-ml-api:df8190ef'
$Nome = 'organizador-deteccao'
$Porta = 3333
$Dados = Join-Path $env:LOCALAPPDATA 'Organizador3D'
$Pasta = Join-Path $Dados 'obico'
$Config = Join-Path $Dados 'config.json'
$Log = Join-Path $PSScriptRoot 'instalar_deteccao.log'

function Diga($t) { $l = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $t"; Write-Host $t; Add-Content -Path $Log -Value $l -Encoding UTF8 }
function Pare($t) { Diga "PAROU: $t"; Write-Host ''; Read-Host 'Enter para fechar'; exit 1 }
function Tem($cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

Diga '=== Detecção de falhas do Selecta 3D ==='

if ($Remover) {
  if (Tem 'docker') { docker rm -f $Nome 2>&1 | Out-Null; Diga "Contêiner $Nome removido (se existia)." }
  Read-Host 'Enter para fechar'; exit 0
}

# 1) conferências — este script NÃO instala driver, WSL nem Docker
if (-not $SemGpu) {
  if (-not (Tem 'nvidia-smi')) { Pare 'não achei o driver da NVIDIA (nvidia-smi). Instale o driver mais novo da RTX 3060 pelo site da NVIDIA ou pelo GeForce Experience e rode de novo. (Ou rode com -SemGpu para testar só no processador.)' }
  $gpu = (& nvidia-smi --query-gpu=name,driver_version --format=csv,noheader) 2>$null
  Diga "Placa de vídeo: $gpu"
}
$wsl = (& wsl.exe --status) 2>$null
if ($LASTEXITCODE -ne 0) { Pare 'o WSL 2 não está instalado. Abra o PowerShell como administrador, rode:  wsl --install  , reinicie o PC e rode este script de novo.' }
Diga 'WSL: ok'
if (-not (Tem 'docker')) { Pare 'o Docker Desktop não está instalado. Baixe em https://www.docker.com/products/docker-desktop/ , instale com o "WSL 2 backend", abra o Docker Desktop uma vez e rode este script de novo.' }
docker info 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Pare 'o Docker Desktop está instalado mas não está aberto. Abra o Docker Desktop, espere ficar "Engine running" e rode de novo.' }
Diga 'Docker: ok'
if (-not $SemGpu) {
  docker run --rm --gpus all nvidia/cuda:11.4.3-base-ubuntu20.04 nvidia-smi 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { Pare 'o Docker não está enxergando a placa de vídeo. Atualize o driver da NVIDIA e o Docker Desktop (o suporte a GPU no WSL 2 vem com eles) e rode de novo. Para testar sem a placa: -SemGpu' }
  Diga 'Docker enxerga a placa de vídeo: ok'
}

# 2) código do Obico numa versão fixa
New-Item -ItemType Directory -Force -Path $Pasta | Out-Null
$zip = Join-Path $Pasta "obico-$Commit.zip"
$src = Join-Path $Pasta "obico-server-$Commit"
if (-not (Test-Path $src)) {
  Diga "Baixando o código do Obico ($($Commit.Substring(0,8)))..."
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  try {
    Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/TheSpaghettiDetective/obico-server/archive/$Commit.zip" -OutFile $zip -ErrorAction Stop
    Expand-Archive -Path $zip -DestinationPath $Pasta -Force -ErrorAction Stop
    Remove-Item $zip -ErrorAction SilentlyContinue
  } catch { Pare "não consegui baixar o código do Obico: $($_.Exception.Message)" }
}
$ml = Join-Path $src 'ml_api'
if (-not (Test-Path (Join-Path $ml 'server.py'))) { Pare "não achei ml_api\server.py em $src" }

# 3) imagem
Diga 'Montando a imagem do serviço (a primeira vez demora: baixa a base do Obico e o modelo)...'
docker build -t $Imagem $ml 2>&1 | ForEach-Object { "$_" } | Tee-Object -FilePath $Log -Append | Out-Host
if ($LASTEXITCODE -ne 0) { Pare 'a montagem da imagem falhou (veja o log). Tente de novo mais tarde: pode ser a internet.' }

# 5) senha do serviço: o Selecta 3D cria e guarda no config.json dele; aqui só lemos (o script não grava nada lá)
if (-not (Test-Path $Config)) { Pare 'não achei o config.json do Selecta 3D. Abra o Selecta 3D (versão fila-v25 ou mais nova) uma vez e rode de novo.' }
$cfg = [IO.File]::ReadAllText($Config) | ConvertFrom-Json
$token = $cfg.deteccao_token
if (-not $token) { Pare 'o config.json ainda não tem a senha da detecção. Feche e abra o Selecta 3D (versão fila-v25 ou mais nova) e rode de novo.' }
Diga 'Senha do serviço lida do config.json do Selecta 3D.'

# 4) contêiner só em 127.0.0.1
docker rm -f $Nome 2>&1 | Out-Null
$argumentos = @('run', '-d', '--name', $Nome, '--restart', 'unless-stopped', '-p', "127.0.0.1:${Porta}:3333", '-e', "ML_API_TOKEN=$token")
if (-not $SemGpu) { $argumentos += @('--gpus', 'all') }
$argumentos += @($Imagem, 'gunicorn', '--bind', '0.0.0.0:3333', '--workers', '1', '--timeout', '120', 'wsgi')
docker @argumentos | Out-Null
if ($LASTEXITCODE -ne 0) { Pare 'não consegui subir o contêiner (veja o log).' }
Diga "Contêiner $Nome no ar em 127.0.0.1:$Porta. Esperando o modelo carregar..."

# 6) conferir
$ok = $false
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 3
  try { if ((Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Porta/hc/" -TimeoutSec 3).Content.Trim() -eq 'ok') { $ok = $true; break } } catch { }
}
$logs = docker logs $Nome 2>&1 | Out-String
Add-Content -Path $Log -Value $logs -Encoding UTF8
if (-not $ok) { Pare 'o serviço não respondeu em 3 minutos. Veja "docker logs organizador-deteccao" ou o log.' }
# O darknet escreve "0 : compute_capability = 860, cudnn_half = 1, GPU: NVIDIA ..." quando usa a placa.
# (A frase antiga "use_gpu = True ... Succeeded" não aparece na versão df8190ef; fica como alternativa.)
if ($logs -match 'compute_capability = \d+[^\n]*GPU: \S' -or $logs -match 'use_gpu = True[^\n]*\r?\n[^\n]*Succeeded') { Diga 'Modelo carregado NA PLACA DE VÍDEO. Pronto.' }
elseif ($SemGpu) { Diga 'Modelo carregado no processador (modo -SemGpu). Pronto.' }
else { Diga 'ATENÇÃO: o serviço respondeu, mas o modelo parece ter carregado no processador (mais lento). Funciona; veja o log se quiser usar a placa.' }
Diga 'Agora feche e abra o Selecta 3D: o cartão Kobra X deve mostrar "Detecção de falhas: ligada".'
Read-Host 'Enter para fechar'
