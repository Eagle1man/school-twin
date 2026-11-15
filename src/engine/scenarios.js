// Сценарии: событие меняет состояние школы, решение руководителя — распределение.
// Решение никогда не «улучшает» расчёт само по себе: оно только меняет назначения.

import { buildIndex, loadOf, ACTIVE_STATUSES, VIOLATION_LABELS } from './constraints.js';
import { availableAt, SPECIAL_ROOM } from './model.js';
import { classFreeSlots, teacherBusySet, roomBusySet } from './schedule.js';

export const ACTIONS = {
  reassign: 'Перераспределить нагрузку',
  substitute: 'Привлечь замену',
  postpone: 'Перенести занятие',
  merge: 'Объединить классы',
  cancel: 'Отменить занятие',
};

export const POLICY_LABELS = {
  mixed: 'Свободные варианты, затем платные',
  reassign: 'Только перераспределение',
  substitute: 'Только замена',
  postpone: 'Только перенос',
  merge: 'Только объединение',
  cancel: 'Ничего не делать',
  manual: 'Ручные решения',
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function applyScenarioToPassport(passport, scenario) {
  const next = clone(passport);
  for (const absence of scenario.absentTeachers || []) {
    const teacher = next.teachers.find((t) => t.id === absence.teacherId);
    if (!teacher) continue;
    const weeks = absence.weeks && absence.weeks.length ? absence.weeks : null;
    const weekList = weeks || Array.from({ length: next.calendar.weeks }, (_, i) => i);
    for (const week of weekList) {
      for (let day = 0; day < next.calendar.days; day++) {
        for (let slot = 0; slot < next.calendar.slotsPerDay; slot++) {
          teacher.unavailable.push({ week, day, slot });
        }
      }
    }
  }
  if (scenario.budgetOverride) {
    next.budget = { ...next.budget, ...scenario.budgetOverride };
  }
  return next;
}

export function disruptedLessons(lessons, scenario) {
  const absent = new Map(
    (scenario.absentTeachers || []).map((a) => [
      a.teacherId,
      a.weeks && a.weeks.length ? new Set(a.weeks) : null,
    ]),
  );
  return lessons.filter(
    (l) => absent.has(l.teacherId) && (!absent.get(l.teacherId) || absent.get(l.teacherId).has(l.week)),
  );
}

// Состояние на момент, когда помощник даёт совет: событие уже произошло,
// решения ещё нет. Именно к нему относится рекомендация.
export function stateBeforeDecision(timetable, scenario) {
  const lessons = timetable.lessons.map((l) => ({
    ...l,
    status: 'held',
    disrupted: false,
    originalTeacherId: l.teacherId,
  }));
  const disrupted = disruptedLessons(lessons, scenario);
  const ids = new Set(disrupted.map((l) => l.id));
  for (const l of disrupted) {
    l.disrupted = true;
    l.status = 'pending';
    l.teacherId = null;
    l.roomId = null;
  }
  return lessons.filter((l) => ids.has(l.id) || l.status === 'held');
}

function qualifiedFree(state, passport, lesson, teacherId) {
  const teacher = passport.teachers.find((t) => t.id === teacherId);
  if (!teacher) return { ok: false, code: 'UNAVAILABLE', detail: `Учителя ${teacherId} нет в паспорте` };
  if (!teacher.subjects.includes(lesson.subject)) {
    return { ok: false, code: 'QUALIFICATION', detail: `Учитель ${teacherId} не ведёт «${lesson.subject}»` };
  }
  if (!availableAt(teacher, lesson.week, lesson.day, lesson.slot)) {
    return { ok: false, code: 'UNAVAILABLE', detail: `Учитель ${teacherId} недоступен в это время` };
  }
  if (state.teacherBusy.has(`${lesson.week}|${lesson.day}|${lesson.slot}|${teacherId}`)) {
    return { ok: false, code: 'TEACHER_CLASH', detail: `Учитель ${teacherId} уже занят в это время` };
  }
  return { ok: true, teacher };
}

function roomFree(state, passport, lesson, needStudents, roomId) {
  const room = passport.rooms.find((r) => r.id === roomId);
  if (!room) return { ok: false, code: 'NO_ROOM' };
  if (room.capacity < needStudents) return { ok: false, code: 'ROOM_CAPACITY' };
  if (state.roomBusy.has(`${lesson.week}|${lesson.day}|${lesson.slot}|${roomId}`)) {
    return { ok: false, code: 'ROOM_CLASH' };
  }
  return { ok: true, room };
}

function pickReassign(state, passport, lesson) {
  const candidates = passport.teachers
    .filter((t) => t.subjects.includes(lesson.subject) && t.id !== lesson.teacherId)
    .map((t) => ({ teacher: t, check: qualifiedFree(state, passport, lesson, t.id) }))
    .filter((c) => c.check.ok)
    .sort(
      (a, b) =>
        loadOf(state, lesson.week, a.teacher.id) - loadOf(state, lesson.week, b.teacher.id) ||
        a.teacher.id.localeCompare(b.teacher.id),
    );
  const under = candidates.find(
    (c) => loadOf(state, lesson.week, c.teacher.id) < c.teacher.maxWeekly,
  );
  return (under || candidates[0] || null)?.teacher || null;
}

function pickPostpone(state, passport, lesson) {
  const free = classFreeSlots(state.lessons, passport, lesson.classId);
  const teacherId = lesson.teacherId || lesson.originalTeacherId;
  const ordered = [
    ...free.filter((f) => f.week === lesson.week),
    ...free.filter((f) => f.week > lesson.week),
  ];
  for (const target of ordered) {
    const teacher = passport.teachers.find((t) => t.id === teacherId);
    if (!teacher) continue;
    if (!availableAt(teacher, target.week, target.day, target.slot)) continue;
    if (state.teacherBusy.has(`${target.week}|${target.day}|${target.slot}|${teacher.id}`)) continue;
    const required = SPECIAL_ROOM[lesson.subject] || 'general';
    const room = passport.rooms.find(
      (r) =>
        r.capacity >= lesson.students &&
        (required === 'general' ? true : r.type === required) &&
        !state.roomBusy.has(`${target.week}|${target.day}|${target.slot}|${r.id}`),
    );
    if (!room) continue;
    return { ...target, roomId: room.id };
  }
  return null;
}

function pickMerge(state, passport, lesson) {
  const parallel = String(lesson.grade);
  const hosts = state.lessons.filter(
    (l) =>
      l !== lesson &&
      ACTIVE_STATUSES.has(l.status) &&
      l.subject === lesson.subject &&
      l.week === lesson.week &&
      l.day === lesson.day &&
      l.slot === lesson.slot &&
      String(l.grade) === parallel,
  );
  for (const host of hosts) {
    const students = host.students + lesson.students;
    const hostRoom = passport.rooms.find((r) => r.id === host.roomId);
    if (hostRoom && hostRoom.capacity >= students) {
      return { host, room: hostRoom, students, movedHost: false };
    }
    // Ищем помещение, куда встанут оба класса; хозяин занятия переезжает вместе с гостем.
    const room = passport.rooms
      .filter(
        (r) =>
          r.capacity >= students &&
          !state.roomBusy.has(`${lesson.week}|${lesson.day}|${lesson.slot}|${r.id}`),
      )
      .sort((a, b) => a.capacity - b.capacity || a.id.localeCompare(b.id))[0];
    if (room) return { host, room, students, movedHost: true };
  }
  return null;
}

function applyAction(action, state, passport, lesson, decision) {
  if (decision && decision.teacherId) {
    // Совет помощника принят без проверки: назначаем именно его, а ограничения
    // проверит расчёт — тогда ошибка видна, а не спрятана.
    lesson.teacherId = decision.teacherId;
    lesson.status = action === 'substitute' ? 'substituted' : 'held';
    return { ok: true, detail: `Назначен ${decision.teacherId} по совету помощника, без проверки` };
  }
  if (action === 'reassign') {
    const teacher = pickReassign(state, passport, lesson);
    if (!teacher) return { ok: false, code: 'NO_TEACHER' };
    lesson.teacherId = teacher.id;
    lesson.status = 'held';
    // Класс остаётся в своём помещении: занятие не переезжает, меняется только учитель.
    if (lesson.originalRoomId) {
      const room = passport.rooms.find((r) => r.id === lesson.originalRoomId);
      const busy = state.roomBusy.has(`${lesson.week}|${lesson.day}|${lesson.slot}|${lesson.originalRoomId}`);
      if (room && !busy && room.capacity >= lesson.students) lesson.roomId = lesson.originalRoomId;
    }
    return { ok: true, detail: `Замену ведёт ${teacher.id}` };
  }
  if (action === 'substitute') {
    lesson.teacherId = `SUB:${lesson.id}`;
    lesson.status = 'substituted';
    return { ok: true, detail: 'Привлечён внешний преподаватель' };
  }
  if (action === 'postpone') {
    const target = pickPostpone(state, passport, lesson);
    if (!target) return { ok: false, code: 'NO_TEACHER' };
    lesson.week = target.week;
    lesson.day = target.day;
    lesson.slot = target.slot;
    lesson.roomId = target.roomId;
    lesson.status = 'moved';
    return { ok: true, detail: `Перенесено в неделю ${target.week + 1}` };
  }
  if (action === 'merge') {
    const merge = pickMerge(state, passport, lesson);
    if (!merge) return { ok: false, code: 'NO_ROOM' };
    if (merge.movedHost) merge.host.roomId = merge.room.id;
    lesson.teacherId = merge.host.teacherId;
    lesson.roomId = merge.room.id;
    lesson.students = merge.students;
    lesson.status = 'merged';
    lesson.mergedWith = merge.host.classId;
    return { ok: true, detail: `Объединено с ${merge.host.classId}, помещение ${merge.room.id}` };
  }
  if (action === 'cancel') {
    lesson.status = 'missed';
    return { ok: true, detail: 'Занятие не проведено' };
  }
  return { ok: false, code: 'NO_TEACHER', detail: 'Неизвестное действие' };
}

// Пересборка индекса занятости: наборы занятости считаем от активных занятий.
function rebuildIndex(state, lessons) {
  const index = buildIndex(lessons);
  state.teacherBusy = index.teacherBusy;
  state.roomBusy = index.roomBusy;
  state.load = index.load;
  state.lessons = lessons;
}

export function applyScenario(timetable, passport, scenario, options = {}) {
  const lessons = timetable.lessons.map((l) => ({
    ...l,
    status: 'held',
    disrupted: false,
    originalTeacherId: l.teacherId,
    originalRoomId: l.roomId,
  }));  const statePassport = applyScenarioToPassport(passport, scenario);
  const disrupted = disruptedLessons(lessons, scenario);
  for (const l of disrupted) l.disrupted = true;

  const state = { lessons };
  rebuildIndex(state, lessons);

  const decisions = options.decisions || {};
  const policy = options.policy || 'mixed';
  const chain =
    policy === 'manual'
      ? []
      : policy === 'mixed'
        ? ['reassign', 'merge', 'postpone', 'substitute', 'cancel']
        : [policy];

  const resolution = [];
  // Сначала снимаем с расписания все затронутые занятия, чтобы не занимать
  // освободившиеся слоты собственными старыми назначениями.
  for (const lesson of disrupted) {
    lesson.status = 'pending';
    lesson.teacherId = null;
    lesson.roomId = null;
  }
  rebuildIndex(state, lessons);

  for (const lesson of disrupted) {
    const decision = decisions[lesson.id];
    const requested = decision?.action || (policy === 'manual' ? 'cancel' : chain[0]);
    const tryList =
      policy === 'manual'
        ? [requested]
        : decision?.action
          ? [decision.action, ...chain.filter((a) => a !== decision.action)]
          : chain;
    let applied = null;
    let failure = null;
    for (const action of tryList) {
      const result = applyAction(action, state, statePassport, lesson, decision);
      if (result.ok) {
        applied = { action, detail: result.detail };
        rebuildIndex(state, lessons);
        break;
      }
      failure = result;
    }
    if (!applied) {
      lesson.status = 'missed';
      lesson.teacherId = null;
      lesson.roomId = null;
      rebuildIndex(state, lessons);
    }
    resolution.push({
      lessonId: lesson.id,
      classId: lesson.classId,
      subject: lesson.subject,
      week: lesson.week,
      requested,
      applied: applied?.action || 'cancel',
      detail: applied?.detail || failure?.detail || '',
      fellBack: Boolean(applied && applied.action !== requested),
    });
  }

  // Занятия, не затронутые событием, вернули себе статус «проведено».
  for (const l of lessons) {
    if (l.status === 'pending') l.status = 'held';
  }

  return { lessons, statePassport, resolution, disrupted };
}

export function comparePolicies(timetable, passport, scenario, policies = ['reassign', 'substitute', 'postpone', 'merge', 'cancel', 'mixed']) {
  const results = [];
  for (const policy of policies) {
    const res = applyScenario(timetable, passport, scenario, { policy });
    results.push({ policy, label: POLICY_LABELS[policy] || policy, result: res });
  }
  return results;
}

export function violationSummary(violations) {
  const map = new Map();
  for (const v of violations) {
    const label = VIOLATION_LABELS[v.code] || v.code;
    const cur = map.get(v.code) || { code: v.code, label, count: 0, detail: '' };
    cur.count += 1;
    if (!cur.detail) cur.detail = v.detail;
    map.set(v.code, cur);
  }
  return [...map.values()];
}
