// Показатели прогона. Четыре обязательных по концепции:
// непроведённые занятия, нарушения ограничений, дополнительная нагрузка, затраты.

import { ACTIVE_STATUSES, buildIndex, checkLessons } from './constraints.js';

export function computeMetrics(lessons, passport) {
  const index = buildIndex(lessons);
  const byId = new Map(passport.teachers.map((t) => [t.id, t]));
  const rate = passport.budget.hourRate;
  const subRate = passport.budget.substitutionRate;

  const planned = lessons.length;
  const held = lessons.filter((l) => ACTIVE_STATUSES.has(l.status)).length;
  const missed = lessons.filter((l) => l.status === 'missed').length;
  const moved = lessons.filter((l) => l.status === 'moved').length;
  const substituted = lessons.filter((l) => l.status === 'substituted').length;
  const merged = lessons.filter((l) => l.status === 'merged').length;

  let substitutionCost = 0;
  for (const l of lessons) {
    if (l.status === 'substituted') substitutionCost += subRate;
  }

  const extraByTeacher = {};
  let extraHours = 0;
  let extraHoursMax = 0;
  for (const [k, hours] of index.load) {
    const [week, teacherId] = k.split('|');
    const teacher = byId.get(teacherId);
    if (!teacher) continue;
    const over = Math.max(0, hours - teacher.maxWeekly);
    if (over > 0) {
      extraHours += over;
      extraHoursMax = Math.max(extraHoursMax, over);
      extraByTeacher[teacherId] = extraByTeacher[teacherId] || { hours: 0, weeks: [] };
      extraByTeacher[teacherId].hours += over;
      extraByTeacher[teacherId].weeks.push(Number(week) + 1);
    }
  }

  const overtimeCost = extraHours * rate * (passport.budget.overtimeFactor - 1);
  const costTotal = substitutionCost + overtimeCost;

  const violations = checkLessons(lessons, passport, { costTotal });

  const values = Object.values(extraByTeacher).map((v) => v.hours);
  const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  const variance = values.length
    ? values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length
    : 0;

  return {
    lessonsPlanned: planned,
    lessonsHeld: held,
    lessonsMissed: missed,
    coveragePct: planned ? Math.round((held / planned) * 1000) / 10 : 100,
    moved,
    substituted,
    merged,
    extraHours,
    extraHoursMax,
    extraByTeacher,
    extraSpread: Math.round(Math.sqrt(variance) * 100) / 100,
    costSubstitution: Math.round(substitutionCost),
    costOvertime: Math.round(overtimeCost),
    costTotal: Math.round(costTotal),
    reserve: passport.budget.limit,
    violations,
    violationsCount: violations.length,
    errorsCount: violations.filter((v) => v.severity === 'error').length,
  };
}

export function deltaMetrics(a, b) {
  const keys = [
    'lessonsHeld',
    'lessonsMissed',
    'extraHours',
    'costTotal',
    'coveragePct',
    'violationsCount',
    'errorsCount',
  ];
  const out = {};
  for (const k of keys) out[k] = Math.round((b[k] - a[k]) * 100) / 100;
  return out;
}
