// Проверка перед публикацией: в демо-данных не должно быть персональных данных.
// Публикация — действие человека; этот скрипт лишь не даёт выложить лишнее.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const dist = join(root, 'dist');
const start = process.argv[2] ? join(root, process.argv[2]) : dist;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const problems = [];
const files = walk(start).filter((f) => /\.(json|csv|js|html)$/.test(f));

// Демо-данные должны содержать только коды, а не имена людей.
const namePattern = /[А-ЯЁ][а-яё]+ [А-ЯЁ][а-яё]+(?:ович|евич|овна|евна|ична)/;
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const match = text.match(namePattern);
  if (match) problems.push(`${relative(root, file)}: похоже на ФИО — «${match[0]}»`);
  if (/@/.test(text) && file.endsWith('.json') && /email/i.test(text)) {
    problems.push(`${relative(root, file)}: поле email в данных`);
  }
}

const mustNotExist = ['data/real', 'netlogo/results.csv'];
for (const item of mustNotExist) {
  const full = join(start, item);
  try {
    statSync(full);
    problems.push(`в сборке есть ${item} — реальные данные и результаты не публикуются`);
  } catch {
    /* нет — и правильно */
  }
}

if (problems.length) {
  console.error('Публиковать нельзя:');
  for (const p of problems) console.error(` - ${p}`);
  process.exit(1);
}
console.log(`Проверено файлов: ${files.length}. Персональных данных не найдено.`);
