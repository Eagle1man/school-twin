// Сверка JS и NetLogo по фикстуре. Запускается отдельно (не в общем прогоне),
// потому что требует NetLogo и файла results.csv.
//
//   node tests/parity.mjs
//
// Коды выхода: 0 — совпало, 1 — расхождение, 2 — сверять не с чем.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const expectedPath = join(root, 'netlogo', 'fixture', 'expected.json');
const resultsPath = join(root, 'netlogo', 'results.csv');

if (!existsSync(expectedPath)) {
  console.error('Нет эталона netlogo/fixture/expected.json — сначала node netlogo/export-fixture.mjs');
  process.exit(2);
}
if (!existsSync(resultsPath)) {
  console.error('Нет netlogo/results.csv — модель NetLogo не запускалась. Сверка не выполнена.');
  process.exit(2);
}

const expected = JSON.parse(readFileSync(expectedPath, 'utf8'));
const lines = readFileSync(resultsPath, 'utf8').trim().split(/\r?\n/);
const header = lines[0].split(',');
const rows = lines.slice(1).map((line) => Object.fromEntries(line.split(',').map((v, i) => [header[i], v.trim()])));

let failed = 0;
for (const [policy, exp] of Object.entries(expected.policies)) {
  const row = rows.find((r) => r.policy === policy);
  if (!row) {
    console.log(`НЕ ПРОЙДЕНО ${policy}: строки нет в results.csv`);
    failed += 1;
    continue;
  }
  const pairs = [
    ['missed', exp.week.missed],
    ['extra-hours', exp.week.extra],
    ['cost', exp.week.cost],
  ];
  for (const [key, want] of pairs) {
    const got = Number(row[key]);
    const ok = Math.abs(got - want) < 0.5;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${policy}.${key}: NetLogo ${got}, JS ${want}`);
    if (!ok) failed += 1;
  }
}

if (failed) {
  console.log(`\nРасхождений: ${failed}. Числа двух реализаций не совпали.`);
  process.exit(1);
}
console.log('\nСверка пройдена: числа JS и NetLogo совпали на фикстуре.');
