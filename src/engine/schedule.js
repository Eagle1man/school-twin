// Генерация расписания на четверть.
// Правила: один класс — одно занятие в слоте; учитель не может быть в двух местах;
// помещение не может быть занято дважды; недельная нагрузка не выше нормы;
// предмет ведёт только квалифицированный учитель.
// Всё детерминировано по seed: тот же seed — то же расписание, до занятия.

import { makeRng, shuffle, range } from './rng.js';
import { availableAt, SPECIAL_ROOM } from './model.js';

function loadOf(loadByWeek, week, teacherId) {
  const m = loadByWeek.get(week);
  if (!m) return 0;
  return m.get(teacherId) || 0;
}

function addLoad(loadByWeek, week, teacherId, hours) {
  let m = loadByWeek.get(week);
  if (!m) {
    m = new Map();
    loadByWeek.set(week, m);
  }
  m.set(teacherId, (m.get(teacherId) || 0) + hours);
}

export function buildTimetable(passport, seed = 'default') {
  const rng = makeRng(`timetable|${seed}`);
  const { weeks, days, slotsPerDay } = passport.calendar;
  const slotsTotal = days * slotsPerDay;
  const roomsByType = new Map();
  for (const room of passport.rooms) {
    if (!roomsByType.has(room.type)) roomsByType.set(room.type, []);
    roomsByType.get(room.type).push(room);
  }
  for (const list of roomsByType.values()) {
    list.sort((a, b) => a.capacity - b.capacity || a.id.localeCompare(b.id));
  }

  const teacherBusy = new Set(); // week|day|slot|teacherId
  const roomBusy = new Set(); // week|day|slot|roomId
  const loadByWeek = new Map();
  const lessons = [];
  const unplaced = [];

  for (let week = 0; week < weeks; week++) {
    for (const klass of passport.classes) {
      const plan = passport.plan[klass.grade] || {};
      const subjects = Object.keys(plan).filter((s) => plan[s] > 0);
      if (!subjects.length) continue;
      const subjectOrder = shuffle(subjects, makeRng(`plan|${klass.grade}|${week}`));
      const remaining = new Map(subjects.map((s) => [s, plan[s]]));
      const totalHours = subjects.reduce((a, s) => a + plan[s], 0);
      const windows = Math.max(0, slotsTotal - totalHours);
      const windowSet = new Set(
        shuffle(range(slotsTotal), makeRng(`windows|${klass.grade}|${week}`)).slice(0, windows),
      );
      const failedSlots = new Set();
      const perDay = new Map(); // day -> Map subject -> count

      for (let slotIdx = 0; slotIdx < slotsTotal; slotIdx++) {
        if (windowSet.has(slotIdx)) continue;
        const day = Math.floor(slotIdx / slotsPerDay);
        const slot = slotIdx % slotsPerDay;
        const dayCount = perDay.get(day) || new Map();

        const candidates = subjectOrder
          .filter((s) => (remaining.get(s) || 0) > 0)
          .map((s, idx) => ({
            subject: s,
            left: remaining.get(s) || 0,
            sameDay: dayCount.get(s) || 0,
            order: idx,
          }))
          .sort(
            (a, b) =>
              a.sameDay - b.sameDay ||
              b.left - a.left ||
              a.order - b.order,
          );

        let placed = false;
        for (const cand of candidates) {
          const required = SPECIAL_ROOM[cand.subject] || 'general';
          const roomPool = [
            ...(roomsByType.get(required) || []),
            ...(required === 'general' ? [] : roomsByType.get('general') || []),
          ];
          const room = roomPool.find(
            (r) =>
              r.capacity >= klass.students &&
              (required === 'general' || r.type === required) &&
              !roomBusy.has(`${week}|${day}|${slot}|${r.id}`),
          );
          if (!room) continue;

          const qualified = passport.teachers
            .filter(
              (t) =>
                t.subjects.includes(cand.subject) &&
                availableAt(t, week, day, slot) &&
                loadOf(loadByWeek, week, t.id) < t.maxWeekly &&
                !teacherBusy.has(`${week}|${day}|${slot}|${t.id}`),
            )
            .sort(
              (a, b) =>
                loadOf(loadByWeek, week, a.id) - loadOf(loadByWeek, week, b.id) ||
                a.id.localeCompare(b.id),
            );
          const teacher = qualified[0];
          if (!teacher) continue;

          lessons.push({
            week,
            day,
            slot,
            classId: klass.id,
            grade: klass.grade,
            students: klass.students,
            subject: cand.subject,
            teacherId: teacher.id,
            roomId: room.id,
            disrupted: false,
            status: 'held',
            origin: 'plan',
          });
          teacherBusy.add(`${week}|${day}|${slot}|${teacher.id}`);
          roomBusy.add(`${week}|${day}|${slot}|${room.id}`);
          addLoad(loadByWeek, week, teacher.id, 1);
          remaining.set(cand.subject, (remaining.get(cand.subject) || 0) - 1);
          dayCount.set(cand.subject, (dayCount.get(cand.subject) || 0) + 1);
          perDay.set(day, dayCount);
          placed = true;
          break;
        }

        if (!placed) {
          failedSlots.add(slotIdx);
          continue;
        }
      }

      // Остаток часов пробуем разложить в окна.
      const leftover = [...remaining.entries()].filter(([, h]) => h > 0);
      if (leftover.length) {
        for (const [subject, hours] of leftover) {
          for (let placed = 0; placed < hours; placed++) {
            let ok = false;
            for (const slotIdx of shuffle([...windowSet, ...failedSlots], rng)) {
              const day = Math.floor(slotIdx / slotsPerDay);
              const slot = slotIdx % slotsPerDay;
              const required = SPECIAL_ROOM[subject] || 'general';
              const roomPool = [
                ...(roomsByType.get(required) || []),
                ...(required === 'general' ? [] : roomsByType.get('general') || []),
              ];
              const room = roomPool.find(
                (r) =>
                  r.capacity >= klass.students &&
                  !roomBusy.has(`${week}|${day}|${slot}|${r.id}`),
              );
              if (!room) continue;
              const teacher = passport.teachers
                .filter(
                  (t) =>
                    t.subjects.includes(subject) &&
                    availableAt(t, week, day, slot) &&
                    loadOf(loadByWeek, week, t.id) < t.maxWeekly &&
                    !teacherBusy.has(`${week}|${day}|${slot}|${t.id}`),
                )
                .sort(
                  (a, b) =>
                    loadOf(loadByWeek, week, a.id) - loadOf(loadByWeek, week, b.id) ||
                    a.id.localeCompare(b.id),
                )[0];
              if (!teacher) continue;
              windowSet.delete(slotIdx);
              failedSlots.delete(slotIdx);
              lessons.push({
                week,
                day,
                slot,
                classId: klass.id,
                grade: klass.grade,
                students: klass.students,
                subject,
                teacherId: teacher.id,
                roomId: room.id,
                disrupted: false,
                status: 'held',
                origin: 'plan',
              });
              teacherBusy.add(`${week}|${day}|${slot}|${teacher.id}`);
              roomBusy.add(`${week}|${day}|${slot}|${room.id}`);
              addLoad(loadByWeek, week, teacher.id, 1);
              ok = true;
              break;
            }
            if (!ok) {
              unplaced.push({ classId: klass.id, subject, week, hours: 1 });
            }
          }
        }
      }
    }
  }

  lessons.sort(
    (a, b) =>
      a.week - b.week ||
      a.day - b.day ||
      a.slot - b.slot ||
      a.classId.localeCompare(b.classId),
  );
  lessons.forEach((l, i) => {
    l.id = `L${String(i + 1).padStart(4, '0')}`;
  });

  return { lessons, unplaced, seed, loadByWeek };
}

// Свободные слоты класса: куда можно перенести занятие.
export function classFreeSlots(lessons, passport, classId) {
  const taken = new Set(
    lessons.filter((l) => l.classId === classId).map((l) => `${l.week}|${l.day}|${l.slot}`),
  );
  const free = [];
  const { weeks, days, slotsPerDay } = passport.calendar;
  for (let week = 0; week < weeks; week++) {
    for (let day = 0; day < days; day++) {
      for (let slot = 0; slot < slotsPerDay; slot++) {
        if (!taken.has(`${week}|${day}|${slot}`)) free.push({ week, day, slot });
      }
    }
  }
  return free;
}

export function teacherBusySet(lessons) {
  const set = new Set();
  for (const l of lessons) {
    if (l.status !== 'held' && l.status !== 'moved' && l.status !== 'substituted' && l.status !== 'merged') {
      continue;
    }
    set.add(`${l.week}|${l.day}|${l.slot}|${l.teacherId}`);
  }
  return set;
}

export function roomBusySet(lessons) {
  const set = new Set();
  for (const l of lessons) {
    if (l.status === 'missed') continue;
    if (l.roomId) set.add(`${l.week}|${l.day}|${l.slot}|${l.roomId}`);
  }
  return set;
}
