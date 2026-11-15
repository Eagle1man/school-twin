// Фикстура для сверки с NetLogo: одно состояние школы, три решения, ожидаемые числа.
// NetLogo не умеет строить расписание так же, как JS, поэтому сверяем не генератор,
// а то, что видит пользователь: принятие решения и расчёт последствий.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { preparePassport, runTwin } from '../src/engine/index.js';
import { buildTimetable } from '../src/engine/schedule.js';
import { applyScenario, disruptedLessons } from '../src/engine/scenarios.js';
import { ACTIVE_STATUSES } from '../src/engine/constraints.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outDir = join(root, 'netlogo', 'fixture');
mkdirSync(outDir, { recursive: true });

const load = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const raw = load('data/demo-school/passport.json');
const scenario = load('data/scenarios/s1-absences.json');
const { passport } = preparePassport(raw);

const timetable = buildTimetable(passport, 'demo');
const affected = new Set(disruptedLessons(timetable.lessons, scenario).map((l) => l.id));

// Для фикстуры берём только одну неделю — так модель в NetLogo остаётся проверяемой.
const week = scenario.absentTeachers[0].weeks[0];
const lessons = timetable.lessons.filter((l) => l.week === week);

const csv = (rows) => rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n') + '\n';

writeFileSync(
  join(outDir, 'lessons.csv'),
  csv([
    ['id', 'class', 'subject', 'teacher', 'room', 'students', 'week', 'day', 'slot', 'disrupted'],
    ...lessons.map((l) => [
      l.id,
      l.classId,
      l.subject,
      l.teacherId,
      l.roomId,
      l.students,
      l.week,
      l.day,
      l.slot,
      affected.has(l.id) ? 1 : 0,
    ]),
  ]),
  'utf8',
);

writeFileSync(
  join(outDir, 'teachers.csv'),
  csv([
    ['id', 'subjects', 'maxWeekly', 'hourRate'],
    ...passport.teachers.map((t) => [t.id, t.subjects.join('|'), t.maxWeekly, t.hourRate]),
  ]),
  'utf8',
);

// Плоская таблица «предмет — учитель»: в NetLogo не нужно разбирать строку с разделителем.
writeFileSync(
  join(outDir, 'teacher-subjects.csv'),
  csv([
    ['subject', 'teacher'],
    ...passport.teachers.flatMap((t) => t.subjects.map((s) => [s, t.id])),
  ]),
  'utf8',
);

writeFileSync(
  join(outDir, 'rooms.csv'),
  csv([
    ['id', 'capacity', 'type'],
    ...passport.rooms.map((r) => [r.id, r.capacity, r.type]),
  ]),
  'utf8',
);

writeFileSync(
  join(outDir, 'absences.csv'),
  csv([
    ['teacher', 'week'],
    ...scenario.absentTeachers
      .filter((a) => a.weeks.includes(week))
      .map((a) => [a.teacherId, week]),
  ]),
  'utf8',
);

writeFileSync(
  join(outDir, 'config.csv'),
  csv([
    ['key', 'value'],
    ['hourRate', passport.budget.hourRate],
    ['substitutionRate', passport.budget.substitutionRate],
    ['overtimeFactor', passport.budget.overtimeFactor],
    ['reserve', passport.budget.limit],
    ['week', week],
    ['days', passport.calendar.days],
    ['slotsPerDay', passport.calendar.slotsPerDay],
  ]),
  'utf8',
);

const expected = { fixture: { week, lessons: lessons.length, disrupted: affected.size }, policies: {} };

// NetLogo считает по одной неделе, поэтому эталон для паритета — недельные числа,
// посчитанные по тем же правилам, что и квартальные.
function weekMetrics(resolved, weekIndex) {
  const load = new Map();
  for (const l of resolved) {
    if (!ACTIVE_STATUSES.has(l.status)) continue;
    if (l.week !== weekIndex) continue;
    if (!l.teacherId || String(l.teacherId).startsWith('SUB')) continue;
    load.set(l.teacherId, (load.get(l.teacherId) || 0) + 1);
  }
  let extra = 0;
  for (const [teacherId, hours] of load) {
    const teacher = passport.teachers.find((t) => t.id === teacherId);
    if (teacher) extra += Math.max(0, hours - teacher.maxWeekly);
  }
  const missed = resolved.filter((l) => l.week === weekIndex && l.status === 'missed').length;
  const subs = resolved.filter((l) => l.week === weekIndex && l.status === 'substituted').length;
  const cost =
    subs * passport.budget.substitutionRate + extra * passport.budget.hourRate * (passport.budget.overtimeFactor - 1);
  return { missed, extra, cost: Math.round(cost) };
}

for (const policy of ['cancel', 'substitute', 'reassign']) {
  const res = applyScenario(timetable, passport, scenario, { policy });
  const run = await runTwin({ passport, scenario, policy, seed: 'demo' });
  expected.policies[policy] = {
    lessonsMissed: run.metrics.lessonsMissed,
    extraHours: run.metrics.extraHours,
    costTotal: run.metrics.costTotal,
    violations: run.metrics.violations.length,
    week: weekMetrics(res.lessons, week),
  };
}
writeFileSync(join(outDir, 'expected.json'), JSON.stringify(expected, null, 2) + '\n', 'utf8');

console.log(`Фикстура: неделя ${week + 1}, занятий ${lessons.length}, затронуто ${affected.size}`);
for (const [policy, values] of Object.entries(expected.policies)) {
  console.log(
    `  ${policy}: квартал — не проведено ${values.lessonsMissed}, доп. часы ${values.extraHours}, расход ${values.costTotal} ₽; неделя — ${values.week.missed}/${values.week.extra}/${values.week.cost}`,
  );
}
