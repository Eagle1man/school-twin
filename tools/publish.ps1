param(
  [string]$Message = "Обновление демо",
  [switch]$WithE2E
)

# Публикация демо одной командой.
#   powershell -File tools\publish.ps1 -Message "что изменилось"
#   powershell -File tools\publish.ps1 -Message "..." -WithE2E   # если поднят локальный сервер
#
# Почему скрипт, а не строка с &&: в Windows PowerShell 5.1 оператор && не работает,
# а молчаливая остановка на середине цепочки — худший вариант для публикации.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Step([string]$Name, [scriptblock]$Action) {
  Write-Host "== $Name" -ForegroundColor Cyan
  & $Action
  if ($LASTEXITCODE -ne 0) {
    throw "Шаг «$Name» завершился с кодом $LASTEXITCODE. Публикация остановлена."
  }
}

Step 'Тесты движка' { node --test "tests/*.test.mjs" }
Step 'Сборка сайта' { node tools/build-dist.mjs }
Step 'Проверка данных перед публикацией' { node tools/check-public-data.mjs }

if ($WithE2E) {
  Step 'Проверка интерфейса в браузере' { node tools/e2e.mjs }
} else {
  Write-Host '== Проверка интерфейса пропущена (нужен поднятый сервер). Запуск: node tools/serve.mjs . 8081' -ForegroundColor DarkYellow
}

$changes = git status --porcelain
if (-not $changes) {
  Write-Host 'Изменений нет — отправлять нечего.' -ForegroundColor Green
  exit 0
}

git add -A
if ($LASTEXITCODE -ne 0) { throw 'git add не удался' }

git -c core.quotepath=false commit -m $Message
if ($LASTEXITCODE -ne 0) { throw 'git commit не удался' }

git push
if ($LASTEXITCODE -ne 0) { throw 'git push не удался' }

Write-Host ''
Write-Host 'Отправлено. GitHub Pages пересоберёт сайт за ~30 секунд:' -ForegroundColor Green
Write-Host 'https://eagle1man.github.io/school-twin/'
Write-Host 'Статус сборки: gh run list --limit 1'
