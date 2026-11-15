import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preparePassport, runTwin, journalFor } from '../src/engine/index.js';
import { runSeries, seriesToCsv } from '../src/engine/experiment.js';
import { disruptedLessons } from '../src/engine/scenarios.js';
import { buildTimetable } from '../src/engine/schedule.js';
import { canonicalize } from '../src/engine/hash.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const load = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const raw = load('data/demo-school/passport.json');
const { passport } = preparePassport(raw);
const scenario = load('data/scenarios/s1-absences.json');

test('маркеры различают порядок «ограничения до выбора» и «после»', () => {
  const before = journalFor({ scenarioId: 'x' });
  before.add('constraint_set', { text: 'резерв 20000' });
  before.add('decision_made', { policy: 'mixed' });
  const a = before.markers().components.find((c) => c.code === 'preference');
  assert.ok(a.evidence[0].includes('до выбора'), a.evidence[0]);

  const after = journalFor({ scenarioId: 'x' });
  after.add('decision_made', { policy: 'mixed' });
  after.add('constraint_set', { text: 'резерв 20000' });
  const b = after.markers().components.find((c) => c.code === 'preference');
  assert.ok(b.evidence[0].includes('после'), b.evidence[0]);
});

test('маркеры не превращаются в балл: у компонентов только свидетельства', () => {
  const journal = journalFor({ scenarioId: 'x' });
  journal.add('data_source_opened', { file: 'passport.json' });
  journal.add('assistant_checked', { recId: 'rec-1' });
  journal.add('explanation_written', { text: 'Совет помощника повлиял на выбор, ответственность за педагогов и классы.' });
  const markers = journal.markers();
  assert.equal(markers.components.length, 6);
  assert.ok(markers.components.every((c) => Array.isArray(c.evidence)));
  assert.ok(!('score' in markers));
  assert.ok(markers.note.includes('не оценка'));
});

test('журнал выгружается в CSV, и каждая запись на месте', () => {
  const journal = journalFor({ scenarioId: 'x' });
  journal.add('data_opened', {});
  journal.add('decision_made', { policy: 'substitute' });
  const csv = journal.toCSV();
  const lines = csv.trim().split('\n');
  assert.equal(lines.length, 3);
  assert.ok(lines[1].startsWith('"1"'), lines[1].slice(0, 20));
  assert.ok(csv.includes('decision_made'));
});

test('серия прогонов детерминирована и считает распределение', () => {
  const a = runSeries({ passport, scenario, sweepId: 'reserve', policies: ['mixed', 'cancel'], repeats: 3 });
  const b = runSeries({ passport, scenario, sweepId: 'reserve', policies: ['mixed', 'cancel'], repeats: 3 });
  assert.equal(a.rows.length, 5 * 2 * 3);
  assert.deepEqual(a.aggregate, b.aggregate);
  assert.deepEqual(a.rows, b.rows);
  assert.ok(a.aggregate.every((x) => x.missedMin <= x.missedMax));
  const csv = seriesToCsv(a.rows);
  assert.equal(csv.trim().split('\n').length, a.rows.length + 1);
});

test('развёртка «длительность отсутствия» меняет результат', () => {
  const series = runSeries({ passport, scenario, sweepId: 'absenceWeeks', policies: ['cancel'], repeats: 2 });
  const values = [...new Set(series.aggregate.map((a) => a.missedMean))];
  assert.ok(values.length > 1, 'длительность отсутствия не влияет на потери');
  assert.ok(series.aggregate.at(-1).missedMean > series.aggregate[0].missedMean);
});

test('принятый совет без проверки даёт нарушение, а не «улучшение»', async () => {
  const timetable = buildTimetable(passport, 'demo');
  const affected = disruptedLessons(timetable.lessons, scenario);
  const decisions = {};
  for (const l of affected) decisions[l.id] = { action: 'substitute', teacherId: 'T-999' };
  const run = await runTwin({ passport, scenario, policy: 'manual', decisions, seed: 'demo' });
  const unavailable = run.metrics.violations.filter((v) => v.code === 'UNAVAILABLE');
  assert.equal(unavailable.length, affected.length, 'каждое назначение «несуществующего» учителя должно быть видно');
  assert.ok(run.metrics.errorsCount >= affected.length);
  assert.ok(run.metrics.violations.some((v) => v.code === 'BUDGET'), 'платная замена должна упираться в резерв');
});

test('идентификатор прогона зависит от решения', async () => {
  const a = await runTwin({ passport, scenario, policy: 'cancel', seed: 'demo' });
  const b = await runTwin({ passport, scenario, policy: 'substitute', seed: 'demo' });
  assert.notEqual(a.runId, b.runId);
});

test('канонический вид не зависит от порядка ключей', () => {
  assert.equal(canonicalize({ b: 1, a: [2, { d: 4, c: 3 }] }), canonicalize({ a: [2, { c: 3, d: 4 }], b: 1 }));
});
