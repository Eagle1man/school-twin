// Публичный API движка. Один вход — один воспроизводимый прогон.

import { normalizePassport, validatePassport } from './model.js';
import { buildTimetable } from './schedule.js';
import { applyScenario, comparePolicies, stateBeforeDecision, POLICY_LABELS, ACTIONS } from './scenarios.js';
import { computeMetrics, deltaMetrics } from './metrics.js';
import { verifyRecommendations } from './assistant.js';
import { ENGINE_VERSION, canonicalize, sha256Hex, runIdOf } from './hash.js';
import { Journal, COMPONENTS, EVENT_LABELS } from './journal.js';
import { runSeries, seriesToCsv, SWEEPS } from './experiment.js';
import { checkLessons } from './constraints.js';

export {
  ENGINE_VERSION,
  Journal,
  COMPONENTS,
  EVENT_LABELS,
  SWEEPS,
  runSeries,
  seriesToCsv,
  comparePolicies,
  deltaMetrics,
  validatePassport,
  normalizePassport,
  canonicalize,
  sha256Hex,
  verifyRecommendations,
  POLICY_LABELS,
  ACTIONS,
};

export function preparePassport(raw) {
  const passport = normalizePassport(raw);
  const validation = validatePassport(passport);
  return { passport, validation };
}

// Прогон: расписание строится по паспорту и seed, затем применяется сценарий.
// Паспорт для расчёта — с уже применёнными событиями (отсутствия, бюджет).
export async function runTwin({ passport, scenario, policy = 'mixed', decisions = {}, seed = 'demo' }) {
  const timetable = buildTimetable(passport, seed);
  const applied = applyScenario(timetable, passport, scenario, { policy, decisions });
  const metrics = computeMetrics(applied.lessons, applied.statePassport);
  const assistant = verifyRecommendations(
    scenario,
    stateBeforeDecision(timetable, scenario),
    applied.statePassport,
  );
  const runId = await runIdOf({
    engine: ENGINE_VERSION,
    seed,
    scenarioId: scenario.id,
    policy,
    decisions,
    passport: passportFingerprint(passport),
  });
  return {
    runId,
    engineVersion: ENGINE_VERSION,
    seed,
    scenarioId: scenario.id,
    scenarioTitle: scenario.title,
    policy,
    decisions,
    timetable,
    lessons: applied.lessons,
    statePassport: applied.statePassport,
    resolution: applied.resolution,
    disrupted: applied.disrupted,
    metrics,
    assistant,
    violations: metrics.violations,
  };
}

export function passportFingerprint(passport) {
  return {
    classes: passport.classes.map((c) => [c.id, c.grade, c.students]),
    teachers: passport.teachers.map((t) => [t.id, t.subjects, t.maxWeekly, t.unavailable.length]),
    rooms: passport.rooms.map((r) => [r.id, r.capacity, r.type]),
    plan: passport.plan,
    calendar: passport.calendar,
    budget: passport.budget,
  };
}

// Сравнение альтернатив на одном и том же состоянии и одном seed.
export async function compareAlternatives({ passport, scenario, policies, seed = 'demo' }) {
  const timetable = buildTimetable(passport, seed);
  const results = comparePolicies(timetable, passport, scenario, policies).map(({ policy, label, result }) => {
    const metrics = computeMetrics(result.lessons, result.statePassport);
    return { policy, label, metrics, resolution: result.resolution };
  });
  const baseline = results.find((r) => r.policy === 'cancel') || results[0];
  for (const r of results) {
    r.delta = r === baseline ? null : deltaMetrics(baseline.metrics, r.metrics);
  }
  return results;
}

export function journalFor(meta) {
  return new Journal({ engine: ENGINE_VERSION, ...meta });
}
