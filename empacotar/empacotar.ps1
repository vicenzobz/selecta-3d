# Faz o Selecta3D.zip no PC (o mesmo que o GitHub Actions faz a cada versão nova).
# Uso: powershell -ExecutionPolicy Bypass -File PROGRAMAS\SELECTA-3D\empacotar\empacotar.ps1
# Precisa de: python -m pip install --user pyinstaller pywebview pystray pillow
$ErrorActionPreference = "Stop"
$pasta = Split-Path -Parent $PSScriptRoot            # PROGRAMAS\SELECTA-3D
$saida = Join-Path $PSScriptRoot "saida"
$trabalho = Join-Path $env:TEMP "selecta3d-empacotar"  # fora da pasta: caminho sem acento para o PyInstaller

Remove-Item -Recurse -Force $trabalho -ErrorAction SilentlyContinue
python -m PyInstaller --noconfirm --clean --distpath "$trabalho\dist" --workpath "$trabalho\build" (Join-Path $PSScriptRoot "selecta3d.spec")
if ($LASTEXITCODE -ne 0) { throw "o PyInstaller falhou" }

$dist = Join-Path $trabalho "dist\Selecta3D"
Copy-Item -Recurse (Join-Path $pasta "extensao") (Join-Path $dist "extensao")
Copy-Item (Join-Path $pasta "README.md") (Join-Path $dist "LEIA-ME.md")
New-Item -ItemType Directory -Force $saida | Out-Null
$zip = Join-Path $saida "Selecta3D.zip"
Remove-Item -Force $zip -ErrorAction SilentlyContinue
Compress-Archive -Path $dist -DestinationPath $zip
Write-Host "Pronto: $zip"
