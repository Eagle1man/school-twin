// Цифровой помощник. В прототипе рекомендации подготовлены заранее — так записано
// в концепции. Но проверка рекомендации идёт по актуальному состоянию, а не по снимку:
// именно расхождение снимка и факта воспроизводит ошибку из сценария.

import { availableAt } from './model.js';
import { buildIndex, loadOf } from './constraints.js';

export function daysBetween(fromIso, toIso) {
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

export function verifyRecommendations(scenario, lessons, passport) {
  const assistant = scenario.assistant;
  if (!assistant) return null;
  const byId = new Map(passport.teachers.map((t) => [t.id, t]));
  const index = buildIndex(lessons);
  const currentAsOf = assistant.currentAsOf || scenario.asOf || passport.meta?.asOf;
  const staleDays = daysBetween(assistant.dataAsOf, currentAsOf);

  const recommendations = (assistant.recommendations || []).map((rec) => {
    const conflicts = [];
    const targets = rec.lessonIds
      ? rec.lessonIds.map((id) => lessons.find((l) => l.id === id)).filter(Boolean)
      : lessons.filter((l) => l.disrupted);
    // Сколько часов рекомендация добавляет одному учителю: считаем накопительно,
    // иначе «+1 час» выглядит безобидно пятнадцать раз подряд.
    const projected = new Map();

    for (const lesson of targets) {
      const teacherId = rec.teacherId;
      if (rec.action === 'substitute' && !teacherId) {
        conflicts.push({
          code: 'NO_TEACHER',
          severity: 'info',
          detail: 'Внешний преподаватель без указания конкретного человека',
        });
        continue;
      }
      const teacher = teacherId ? byId.get(teacherId) : null;
      if (teacherId && !teacher) {
        conflicts.push({
          code: 'UNAVAILABLE',
          severity: 'error',
          lessonId: lesson.id,
          teacherId,
          detail: `В снимке от ${assistant.dataAsOf} учитель ${teacherId} был доступен. В актуальном паспорте такого учителя нет.`,
        });
        continue;
      }
      if (!teacher) continue;
      if (!teacher.subjects.includes(lesson.subject)) {
        conflicts.push({
          code: 'QUALIFICATION',
          severity: 'error',
          lessonId: lesson.id,
          teacherId,
          detail: `Учитель ${teacherId} не ведёт предмет «${lesson.subject}»`,
        });
      }
      if (!availableAt(teacher, lesson.week, lesson.day, lesson.slot)) {
        conflicts.push({
          code: 'UNAVAILABLE',
          severity: 'error',
          lessonId: lesson.id,
          teacherId,
          detail: `Учитель ${teacherId} недоступен ${lesson.week + 1} нед., ${lesson.day + 1} дн., слот ${lesson.slot + 1}`,
        });
      }
      if (index.teacherBusy.has(`${lesson.week}|${lesson.day}|${lesson.slot}|${teacherId}`)) {
        conflicts.push({
          code: 'TEACHER_CLASH',
          severity: 'error',
          lessonId: lesson.id,
          teacherId,
          detail: `Учитель ${teacherId} уже занят в это время по актуальному расписанию`,
        });
      }
      const loadKey = `${lesson.week}|${teacherId}`;
      const load = loadOf(index, lesson.week, teacherId) + (projected.get(loadKey) || 0) + 1;
      projected.set(loadKey, (projected.get(loadKey) || 0) + 1);
      if (load > teacher.maxWeekly) {
        conflicts.push({
          code: 'OVERLOAD',
          severity: 'warning',
          lessonId: lesson.id,
          teacherId,
          detail: `Нагрузка ${teacherId} станет ${load} ч/нед при норме ${teacher.maxWeekly}`,
        });
      }
    }

    return {
      ...rec,
      dataAsOf: assistant.dataAsOf,
      currentAsOf,
      staleDays,
      targets: targets.map((l) => l.id),
      conflicts,
      verdict: conflicts.some((c) => c.severity === 'error')
        ? 'conflict'
        : conflicts.length
          ? 'warning'
          : 'ok',
    };
  });

  return {
    dataAsOf: assistant.dataAsOf,
    currentAsOf,
    staleDays,
    recommendations,
    hasError: recommendations.some((r) => r.verdict === 'conflict'),
  };
}

export const CHECKS = [
  {
    id: 'freshness',
    label: 'Проверить, на какую дату собраны сведения помощника',
    reveals: 'UNAVAILABLE',
  },
  {
    id: 'load',
    label: 'Проверить фактическую нагрузку рекомендованного учителя',
    reveals: 'OVERLOAD',
  },
  {
    id: 'availability',
    label: 'Проверить доступность учителя в текущем паспорте',
    reveals: 'UNAVAILABLE',
  },
];
