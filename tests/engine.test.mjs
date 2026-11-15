import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preparePassport, runTwin, compareAlternatives } from '../src/engine/index.js';
import { buildTimetable } from '../src/engine/schedule.js';
import { computeMetrics } from '../src/engine/metrics.js';
import { checkLessons, buildIndex } from '../src/engine/constraints.js';
import { passportFromCsv } from '../src/engine/model.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const load = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const csv = (p) => readFileSync(join(root, p), 'utf8');

const raw = load('data/demo-school/passport.json');
const { passport, validation } = preparePassport(raw);

test('демо-паспорт проходит проверку без ошибок', () => {
  assert.equal(validation.ok, true, validation.errors.join('; '));
  assert.equal(validation.warnings.length, 0, validation.warnings.join('; '));
});

test('расписание покрывает весь учебный план: ничего не потеряно', () => {
  const timetable = buildTimetable(passport, 'demo');
  assert.equal(timetable.unplaced.length, 0, `не размещено ${timetable.unplaced.length}`);

  const expected = passport.classes.reduce((sum, c) => {
    const plan = passport.plan[c.grade] || {};
    const hours = Object.values(plan).reduce((a, b) => a + b, 0);
    return sum + hours * passport.calendar.weeks;
  }, 0);
  assert.equal(timetable.lessons.length, expected);
});

test('базовое расписание не нарушает ограничений', () => {
  const timetable = buildTimetable(passport, 'demo');
  const violations = checkLessons(timetable.lessons, passport, { costTotal: 0 });
  assert.deepEqual(
    violations.map((v) => v.code),
    [],
    violations.map((v) => v.detail).join('\n'),
  );
});

test('нагрузка ни одного учителя не выше нормы', () => {
  const timetable = buildTimetable(passport, 'demo');
  const index = buildIndex(timetable.lessons);
  for (const [k, hours] of index.load) {
    const teacherId = k.split('|')[1];
    const teacher = passport.teachers.find((t) => t.id === teacherId);
    assert.ok(hours <= teacher.maxWeekly, `${teacherId}: ${hours} > ${teacher.maxWeekly}`);
  }
});

test('прогон детерминирован: тот же seed — те же числа и тот же runId', async () => {
  const scenario = load('data/scenarios/s1-absences.json');
  const a = await runTwin({ passport, scenario, seed: 'seed-1' });
  const b = await runTwin({ passport, scenario, seed: 'seed-1' });
  assert.deepEqual(a.metrics, b.metrics);
  assert.equal(a.runId, b.runId);
  assert.deepEqual(a.resolution, b.resolution);
});

test('другой seed даёт другое расписание, но те же правила', async () => {
  const scenario = load('data/scenarios/s1-absences.json');
  const a = await runTwin({ passport, scenario, seed: 'seed-1' });
  const b = await runTwin({ passport, scenario, seed: 'seed-2' });
  assert.notEqual(a.runId, b.runId);
  const sig = (r) => r.lessons.map((l) => `${l.id}:${l.teacherId}:${l.roomId}`).join(',');
  assert.notEqual(sig(a), sig(b));
  assert.equal(a.metrics.lessonsPlanned, b.metrics.lessonsPlanned);
});

test('сценарий 1: «ничего не делать» теряет ровно затронутые занятия', async () => {
  const scenario = load('data/scenarios/s1-absences.json');
  const run = await runTwin({ passport, scenario, seed: 'demo', policy: 'cancel' });
  assert.equal(run.disrupted.length, 34);
  assert.equal(run.metrics.lessonsMissed, run.disrupted.length);
  assert.equal(run.metrics.costTotal, 0);
});

test('сценарий 1: полная замена стоит ровно «ставка × часы»', async () => {
  const scenario = load('data/scenarios/s1-absences.json');
  const run = await runTwin({ passport, scenario, seed: 'demo', policy: 'substitute' });
  assert.equal(run.metrics.lessonsMissed, 0);
  assert.equal(run.metrics.costTotal, run.disrupted.length * passport.budget.substitutionRate);
});

test('сценарий 1: перенос спасает занятия, объединение — часть', async () => {
  const scenario = load('data/scenarios/s1-absences.json');
  const alts = await compareAlternatives({ passport, scenario, seed: 'demo' });
  const by = Object.fromEntries(alts.map((a) => [a.policy, a.metrics]));
  assert.ok(by.postpone.lessonsMissed < by.cancel.lessonsMissed, 'перенос не улучшил результат');
  assert.ok(by.merge.lessonsMissed <= by.cancel.lessonsMissed, 'объединение ухудшило результат');
});

test('сценарий 2: при резерве 3000 ₽ платная замена нарушает бюджет', async () => {
  const scenario = load('data/scenarios/s2-budget.json');
  const run = await runTwin({ passport, scenario, seed: 'demo', policy: 'substitute' });
  assert.ok(run.metrics.costTotal > 3000);
  assert.ok(run.metrics.violations.some((v) => v.code === 'BUDGET'));
});

test('сценарий 3: совет помощника по устаревшему снимку отвергается проверкой', async () => {
  const scenario = load('data/scenarios/s3-stale-data.json');
  const run = await runTwin({ passport, scenario, seed: 'demo' });
  const rec1 = run.assistant.recommendations.find((r) => r.id === 'rec-1');
  const rec2 = run.assistant.recommendations.find((r) => r.id === 'rec-2');
  assert.equal(run.assistant.staleDays, 2);
  assert.equal(rec1.verdict, 'conflict');
  assert.ok(rec1.conflicts.some((c) => c.code === 'UNAVAILABLE'));
  assert.ok(rec2.conflicts.some((c) => c.code === 'OVERLOAD'));
});

test('импорт паспорта из CSV совпадает с JSON-паспортом', () => {
  const fromCsv = passportFromCsv({
    classes: csv('data/demo-school/classes.csv'),
    teachers: csv('data/demo-school/teachers.csv'),
    plan: csv('data/demo-school/plan.csv'),
    rooms: csv('data/demo-school/rooms.csv'),
    meta: raw.meta,
    calendar: raw.calendar,
    budget: raw.budget,
  });
  assert.equal(fromCsv.classes.length, passport.classes.length);
  assert.equal(fromCsv.teachers.length, passport.teachers.length);
  assert.equal(fromCsv.rooms.length, passport.rooms.length);
  assert.deepEqual(fromCsv.plan, passport.plan);
  const t1 = buildTimetable(fromCsv, 'demo');
  const t2 = buildTimetable(passport, 'demo');
  assert.equal(t1.lessons.length, t2.lessons.length);
});

test('нарушения ловятся на намеренно испорченных данных', () => {
  const timetable = buildTimetable(passport, 'demo');
  const broken = timetable.lessons.slice(0, 40).map((l) => ({ ...l }));
  // один учитель в двух местах
  broken[1].teacherId = broken[0].teacherId;
  broken[1].week = broken[0].week;
  broken[1].day = broken[0].day;
  broken[1].slot = broken[0].slot;
  // класс больше помещения
  broken[2].students = 999;
  const violations = checkLessons(broken, passport, { costTotal: 0 });
  const codes = violations.map((v) => v.code);
  assert.ok(codes.includes('TEACHER_CLASH'), 'не пойман двойной учитель');
  assert.ok(codes.includes('ROOM_CAPACITY'), 'не поймана вместимость');
});

test('метрики считают переработку как часы сверх нормы, а не как «плохо»', () => {
  const timetable = buildTimetable(passport, 'demo');
  const teacher = passport.teachers.find((t) => t.id === 'T-001');
  const lessons = timetable.lessons.map((l) => ({ ...l, status: 'held' }));
  const extra = lessons
    .filter((l) => l.teacherId === 'T-001' && l.week === 0)
    .slice(0, 3)
    .map((l) => ({ ...l, teacherId: 'T-001' }));
  const shifted = lessons.map((l) =>
    l.status === 'held' && extra.some((e) => e.id === l.id) ? { ...l, status: 'held' } : l,
  );
  const metrics = computeMetrics(shifted, passport);
  const load = buildIndex(shifted).load.get(`0|T-001`);
  assert.equal(metrics.extraHours, Math.max(0, load - teacher.maxWeekly));
});
