// Быстрая проверка движка из командной строки: расписание, сценарии, метрики.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTwin, compareAlternatives, preparePassport } from '../src/engine/index.js';
import { buildTimetable } from '../src/engine/schedule.js';
import { computeMetrics } from '../src/engine/metrics.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const load = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));

const raw = load('data/demo-school/passport.json');
const { passport, validation } = preparePassport(raw);
console.log('Валидация:', validation.ok, validation.errors, validation.warnings);

const t0 = Date.now();
const timetable = buildTimetable(passport, 'demo');
console.log(`Расписание: ${timetable.lessons.length} занятий, не размещено ${timetable.unplaced.length}, ${Date.now() - t0} мс`);

const base = computeMetrics(timetable.lessons, passport);
console.log('Базовые метрики:', {
  planned: base.lessonsPlanned,
  held: base.lessonsHeld,
  missed: base.lessonsMissed,
  extra: base.extraHours,
  cost: base.costTotal,
  violations: base.violationsCount,
  errors: base.errorsCount,
});
if (base.violations.length) console.log(base.violations.slice(0, 10));

for (const f of ['s1-absences', 's2-budget', 's3-stale-data']) {
  const scenario = load(`data/scenarios/${f}.json`);
  const alts = await compareAlternatives({ passport, scenario, seed: 'demo' });
  console.log(`\n=== ${scenario.title} ===`);
  for (const a of alts) {
    console.log(
      `${a.policy.padEnd(11)} проведено ${String(a.metrics.lessonsHeld).padStart(4)}  не проведено ${String(a.metrics.lessonsMissed).padStart(3)}  доп.часы ${String(a.metrics.extraHours).padStart(3)}  расход ${String(a.metrics.costTotal).padStart(5)} ₽  наруш. ${a.metrics.violationsCount}`,
    );
  }
  const run = await runTwin({ passport, scenario, seed: 'demo', policy: 'mixed' });
  if (run.assistant) {
    for (const rec of run.assistant.recommendations) {
      console.log(`помощник ${rec.id}: ${rec.verdict}, конфликтов ${rec.conflicts.length}, снимок ${rec.dataAsOf} (${rec.staleDays} дн.)`);
      for (const c of rec.conflicts) console.log('   -', c.code, c.detail);
    }
  }
  console.log('runId:', run.runId.slice(0, 16));
}
