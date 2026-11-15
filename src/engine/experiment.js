// Серии прогонов: одна идея проверяется не одним числом, а распределением.
// Развёртка параметра × политика × seed. Результат — таблица строк для CSV.

import { buildTimetable } from './schedule.js';
import { applyScenario } from './scenarios.js';
import { computeMetrics } from './metrics.js';

export const SWEEPS = {
  reserve: {
    id: 'reserve',
    label: 'Резерв на замены, ₽',
    values: [0, 5000, 10000, 20000, 40000],
    apply(passport, scenario, value) {
      const p = JSON.parse(JSON.stringify(passport));
      p.budget.limit = Number(value);
      return { passport: p, scenario };
    },
  },
  absentCount: {
    id: 'absentCount',
    label: 'Число отсутствующих учителей',
    values: [1, 2, 3, 4, 5],
    apply(passport, scenario, value) {
      const s = JSON.parse(JSON.stringify(scenario));
      s.absentTeachers = (s.absentTeachers || []).slice(0, Number(value));
      if (!s.absentTeachers.length) s.absentTeachers = [{ teacherId: 'T-001', weeks: [2] }];
      return { passport, scenario: s };
    },
  },
  absenceWeeks: {
    id: 'absenceWeeks',
    label: 'Длительность отсутствия, недель',
    values: [1, 2, 3, 4],
    apply(passport, scenario, value) {
      const s = JSON.parse(JSON.stringify(scenario));
      s.absentTeachers = (s.absentTeachers || []).map((a) => ({
        ...a,
        weeks: Array.from({ length: Number(value) }, (_, i) => 2 + i),
      }));
      return { passport, scenario: s };
    },
  },
};

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function runSeries({
  passport,
  scenario,
  sweepId,
  policies,
  repeats = 20,
  seedBase = 'series',
}) {
  const sweep = SWEEPS[sweepId];
  if (!sweep) throw new Error(`Неизвестная развёртка: ${sweepId}`);
  const rows = [];
  const aggregate = [];

  for (const value of sweep.values) {
    const variant = sweep.apply(passport, scenario, value);
    for (const policy of policies) {
      const runs = [];
      for (let i = 0; i < repeats; i++) {
        const seed = `${seedBase}|${value}|${policy}|${i}`;
        const timetable = buildTimetable(variant.passport, seed);
        const res = applyScenario(timetable, variant.passport, variant.scenario, { policy });
        const metrics = computeMetrics(res.lessons, res.statePassport);
        rows.push({
          value,
          policy,
          seed,
          lessonsMissed: metrics.lessonsMissed,
          coveragePct: metrics.coveragePct,
          extraHours: metrics.extraHours,
          costTotal: metrics.costTotal,
          errorsCount: metrics.errorsCount,
          violationsCount: metrics.violationsCount,
          overBudget: metrics.costTotal > variant.passport.budget.limit ? 1 : 0,
        });
        runs.push(metrics);
      }
      aggregate.push({
        value,
        policy,
        runs: repeats,
        missedMean: Math.round((runs.reduce((a, m) => a + m.lessonsMissed, 0) / runs.length) * 10) / 10,
        missedMin: Math.min(...runs.map((m) => m.lessonsMissed)),
        missedMax: Math.max(...runs.map((m) => m.lessonsMissed)),
        missedMedian: median(runs.map((m) => m.lessonsMissed)),
        costMean: Math.round(runs.reduce((a, m) => a + m.costTotal, 0) / runs.length),
        extraMean: Math.round((runs.reduce((a, m) => a + m.extraHours, 0) / runs.length) * 10) / 10,
        overBudgetRate:
          Math.round((runs.filter((m) => m.costTotal > variant.passport.budget.limit).length / runs.length) * 1000) /
          10,
      });
    }
  }

  return { sweep, rows, aggregate };
}

export function seriesToCsv(rows) {
  if (!rows.length) return '';
  const header = Object.keys(rows[0]);
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(header.map((h) => row[h]).join(','));
  }
  return lines.join('\n');
}
