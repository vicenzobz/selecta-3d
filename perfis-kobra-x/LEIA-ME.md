# Perfis da Kobra X (OrcaSlicer 2.5.2)

Origem: perfis oficiais `resources/profiles/Anycubic/` do OrcaSlicer, tag `v2.5.2` (commit `f92a7c065c5718b8ef1baac1cd704df2911238f4`). AGPL-3.0.

Os perfis do Orca herdam de perfis-base (`inherits`). Pela linha de comando, isso não é resolvido; por isso cada arquivo aqui é o perfil **completo** (cadeia de herança resolvida por `scripts/achatar_perfil.py`). O nome original está em `indice.json` e no campo `name` de cada arquivo.

## Única alteração

- `maquina/kobra_x_04.json`: `retraction_distances_when_cut` de `0` para `18`. O perfil oficial traz `0`, mas o próprio Orca 2.5.2 recusa esse valor na linha de comando (“not in range [10, 18]”) e não fatia. Não muda nada na impressão porque `enable_long_retraction_when_cut` está desligado.

## Diferenças para o projeto salvo pelo Anycubic Slicer Next (Benchy, 0.20mm Standard + Anycubic PLA)

Quase tudo é igual. Diferenças encontradas: ventoinha (mín. 80 % no Orca × 60 % no Anycubic), retração 0,8 mm × 1,3 mm, bico na 1ª camada 215 °C × 220 °C, padrão de sólido interno e direção da parede. Lembrar da decisão de fixar a temperatura em todas as camadas (`kobra-x/firmware.md` no projeto): ainda não aplicada aqui.

## Perfil próprio: PLA Print Pulse (2026-11-22)

`filamento/print_pulse_pla.json` ("PLA Print Pulse @Anycubic Kobra X 0.4 nozzle"): cópia do Anycubic PLA com **220 °C em todas as camadas** (todas as variantes de temperatura do bico), faixa do rótulo 200–220 °C, fabricante "Print Pulse". Aplica a decisão de 20/11/2026 (`impressora.md`). É o filamento padrão da aba Reggae Slicer do Selecta 3D. Testado na nuvem: Benchy 42m 23s, 10,96 g; o G-code sai com `extruderTemp=220`.

## Cópia dentro do Selecta 3D

Esta pasta é uma cópia de `PROGRAMAS/REGGAE-SLICER/perfis` (2026-11-25), para o Selecta 3D fatiar numa pasta que não tenha os perfis (cópia compartilhada, `.exe`). Quando a original mudar, copie de novo.
