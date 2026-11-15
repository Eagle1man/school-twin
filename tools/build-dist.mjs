// Сборка статического сайта для публикации: только то, что нужно браузеру.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

// Копирование вручную: recursive cpSync на этой сборке Node падает с 0xC0000409.
function copyTree(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const src = join(from, entry.name);
    const dst = join(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dst);
    else copyFileSync(src, dst);
  }
}

for (const item of ['index.html', 'assets', 'src']) {
  if (statSync(join(root, item)).isDirectory()) copyTree(join(root, item), join(dist, item));
  else mkdirSync(dirname(join(dist, item)), { recursive: true }), copyFileSync(join(root, item), join(dist, item));
}
copyTree(join(root, 'data', 'demo-school'), join(dist, 'data', 'demo-school'));
copyTree(join(root, 'data', 'scenarios'), join(dist, 'data', 'scenarios'));

writeFileSync(join(dist, '.nojekyll'), '');

const must = ['index.html', 'assets/style.css', 'src/ui/app.js', 'src/engine/index.js', 'data/demo-school/passport.json'];
const missing = must.filter((p) => !existsSync(join(dist, p)));
if (missing.length) {
  console.error('Сборка неполная, нет файлов:', missing.join(', '));
  process.exit(1);
}
console.log(`Сборка готова: ${dist}`);
console.log('Проверка состава пройдена:', must.length, 'обязательных файлов на месте.');
