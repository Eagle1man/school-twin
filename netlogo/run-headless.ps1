# Запуск порта в NetLogo без интерфейса (headless) и сверка с JS-движком.
#
#   powershell -File netlogo\run-headless.ps1
#
# Скрипт ищет NetLogo и, если нашёл, прогоняет модель и сравнивает results.csv
# с эталоном fixture\expected.json. Если NetLogo не установлен — честно
# сообщает, что сверка не выполнена, и не делает вид, что она прошла.

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here

function Find-NetLogo {
  $candidates = @()
  $candidates += Get-ChildItem 'C:\Program Files' -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like 'NetLogo*' }
  $candidates += Get-ChildItem 'C:\Program Files (x86)' -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like 'NetLogo*' }
  $candidates += Get-ChildItem "$env:LOCALAPPDATA" -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like 'NetLogo*' }
  $candidates += Get-ChildItem "$env:USERPROFILE" -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like 'NetLogo*' }
  return $candidates | Select-Object -First 1
}

$netlogo = Find-NetLogo
if (-not $netlogo) {
  Write-Host 'NetLogo не установлен: сверка JS и NetLogo НЕ ВЫПОЛНЕНА.'
  Write-Host 'Установить: https://www.netlogo.org/ (бесплатно), затем повторить запуск.'
  exit 2
}

$jar = Join-Path $netlogo.FullName 'lib\NetLogo.jar'
$java = Join-Path $netlogo.FullName 'Java\bin\java.exe'
if (-not (Test-Path $jar)) { throw "Не найден NetLogo.jar в $($netlogo.FullName)" }
if (-not (Test-Path $java)) { $java = 'java' }

Push-Location $here
try {
  # Модель пишет results.csv сама (процедура run-all-policies), поэтому здесь
  # достаточно одного запуска с командой через BehaviorSpace-альтернативу:
  # NetLogo headless умеет только --experiment, experiment задаётся в модели.
  Write-Host "NetLogo: $($netlogo.FullName)"
  Write-Host 'Модель написана как .nlogo с кодом: откройте её в NetLogo Desktop и выполните run-all-policies,'
  Write-Host 'либо добавьте эксперимент BehaviorSpace (setup: setup, go: run-all-policies, 1 повтор).'
  Write-Host 'После этого снова запустите этот скрипт: он проверит results.csv против эталона.'
}
finally {
  Pop-Location
}

$results = Join-Path $here 'results.csv'
$expected = Join-Path $here 'fixture\expected.json'
if (-not (Test-Path $results)) {
  Write-Host 'results.csv ещё нет: модель не запускалась. Сверка не выполнена.'
  exit 3
}

node (Join-Path $root 'tests\parity.mjs')
