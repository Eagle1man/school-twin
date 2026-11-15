// Проверка ограничений. Ограничения — это данные, а не мнение:
// каждое нарушение называется кодом, объектом и числом.

export const ACTIVE_STATUSES = new Set(['held', 'moved', 'substituted', 'merged']);

// Объединённое занятие не занимает отдельного учителя и помещения:
// два класса сидят вместе, и это одна пара, а не две.
export const OCCUPYING_STATUSES = new Set(['held', 'moved', 'substituted']);

export const VIOLATION_LABELS = {
  TEACHER_CLASH: 'Учитель в двух местах одновременно',
  ROOM_CLASH: 'Помещение занято дважды',
  ROOM_CAPACITY: 'Класс не помещается в помещение',
  QUALIFICATION: 'Предмет ведёт неспециалист',
  OVERLOAD: 'Недельная нагрузка выше нормы',
  BUDGET: 'Расходы выше резерва',
  UNAVAILABLE: 'Учитель недоступен в это время',
  NO_ROOM: 'Нет подходящего помещения',
  NO_TEACHER: 'Нет свободного специалиста',
  MISSED: 'Занятие не проведено',
};

const key = (week, day, slot, id) => `${week}|${day}|${slot}|${id}`;

// Внешний преподаватель — не человек из паспорта: у него нет расписания,
// поэтому проверять двойные назначения и квалификацию по нему нельзя.
export const isExternal = (teacherId) =>
  typeof teacherId === 'string' && teacherId.startsWith('SUB');

export function buildIndex(lessons) {
  const teacherBusy = new Set();
  const roomBusy = new Set();
  const classBusy = new Set();
  const load = new Map(); // `${week}|${teacherId}` -> часы
  for (const l of lessons) {
    if (!OCCUPYING_STATUSES.has(l.status)) continue;
    if (l.teacherId) teacherBusy.add(key(l.week, l.day, l.slot, l.teacherId));
    if (l.roomId) roomBusy.add(key(l.week, l.day, l.slot, l.roomId));
    classBusy.add(key(l.week, l.day, l.slot, l.classId));
    if (l.teacherId) {
      const k = `${l.week}|${l.teacherId}`;
      load.set(k, (load.get(k) || 0) + 1);
    }
  }
  return { teacherBusy, roomBusy, classBusy, load };
}

export function loadOf(index, week, teacherId) {
  return index.load.get(`${week}|${teacherId}`) || 0;
}

export function checkLessons(lessons, passport, options = {}) {
  const violations = [];
  const byId = new Map(passport.teachers.map((t) => [t.id, t]));
  const roomById = new Map(passport.rooms.map((r) => [r.id, r]));

  // Двойные назначения
  const teacherSlots = new Map();
  const roomSlots = new Map();
  for (const l of lessons) {
    if (!OCCUPYING_STATUSES.has(l.status)) continue;
    if (l.teacherId && !isExternal(l.teacherId)) {
      const k = key(l.week, l.day, l.slot, l.teacherId);
      if (teacherSlots.has(k)) {
        violations.push({
          code: 'TEACHER_CLASH',
          severity: 'error',
          lessonId: l.id,
          teacherId: l.teacherId,
          detail: `Учитель ${l.teacherId}: занятия ${teacherSlots.get(k)} и ${l.id} в неделю ${l.week + 1}, день ${l.day + 1}, слот ${l.slot + 1}`,
        });
      } else {
        teacherSlots.set(k, l.id);
      }
    }
    if (l.roomId) {
      const k = key(l.week, l.day, l.slot, l.roomId);
      if (roomSlots.has(k)) {
        violations.push({
          code: 'ROOM_CLASH',
          severity: 'error',
          lessonId: l.id,
          roomId: l.roomId,
          detail: `Помещение ${l.roomId}: занятия ${roomSlots.get(k)} и ${l.id}`,
        });
      } else {
        roomSlots.set(k, l.id);
      }
    }
  }

  // Вместимость, квалификация, доступность
  for (const l of lessons) {
    if (!ACTIVE_STATUSES.has(l.status)) continue;
    const room = l.roomId ? roomById.get(l.roomId) : null;
    if (room && l.students > room.capacity) {
      violations.push({
        code: 'ROOM_CAPACITY',
        severity: 'error',
        lessonId: l.id,
        roomId: l.roomId,
        detail: `Класс ${l.classId} (${l.students} чел.) не помещается в ${l.roomId} (${room.capacity} мест)`,
      });
    }
    if (l.teacherId && !isExternal(l.teacherId)) {
      const teacher = byId.get(l.teacherId);
      if (!teacher) {
        violations.push({
          code: 'UNAVAILABLE',
          severity: 'error',
          lessonId: l.id,
          teacherId: l.teacherId,
          detail: `Учителя ${l.teacherId} нет в актуальном паспорте школы`,
        });
      } else {
        if (!teacher.subjects.includes(l.subject)) {
          violations.push({
            code: 'QUALIFICATION',
            severity: 'error',
            lessonId: l.id,
            teacherId: l.teacherId,
            detail: `Учитель ${l.teacherId} не ведёт предмет «${l.subject}»`,
          });
        }
        const blocked = (teacher.unavailable || []).some(
          (u) => u.week === l.week && u.day === l.day && u.slot === l.slot,
        );
        if (blocked) {
          violations.push({
            code: 'UNAVAILABLE',
            severity: 'error',
            lessonId: l.id,
            teacherId: l.teacherId,
            detail: `Учитель ${l.teacherId} недоступен: неделя ${l.week + 1}, день ${l.day + 1}, слот ${l.slot + 1}`,
          });
        }
      }
    }
  }

  // Недельная нагрузка сверх нормы
  const load = new Map();
  for (const l of lessons) {
    if (!OCCUPYING_STATUSES.has(l.status)) continue;
    if (!l.teacherId || isExternal(l.teacherId)) continue;
    const k = `${l.week}|${l.teacherId}`;
    load.set(k, (load.get(k) || 0) + 1);
  }
  for (const [k, hours] of load) {
    const [week, teacherId] = k.split('|');
    const teacher = byId.get(teacherId);
    if (!teacher) continue;
    const over = hours - teacher.maxWeekly;
    if (over > 0) {
      violations.push({
        code: 'OVERLOAD',
        severity: 'warning',
        teacherId,
        week: Number(week),
        hours,
        over,
        detail: `Учитель ${teacherId}: ${hours} ч/нед при норме ${teacher.maxWeekly} — переработка ${over} ч`,
      });
    }
  }

  // Бюджет
  if (options.costTotal != null && passport.budget?.limit != null) {
    if (options.costTotal > passport.budget.limit) {
      violations.push({
        code: 'BUDGET',
        severity: 'error',
        amount: options.costTotal - passport.budget.limit,
        detail: `Расходы ${Math.round(options.costTotal)} ₽ выше резерва ${Math.round(passport.budget.limit)} ₽`,
      });
    }
  }

  return violations;
}
