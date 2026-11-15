// Паспорт школы: нормализация, проверка и импорт из CSV.
// Всё, что не задано, получает явное значение по умолчанию — молчаливых дыр нет.

export const SUBJECT_NAMES = {
  math: 'Математика',
  rus: 'Русский язык',
  lit: 'Литература',
  eng: 'Иностранный язык',
  hist: 'История',
  geo: 'География',
  bio: 'Биология',
  chem: 'Химия',
  phys: 'Физика',
  inf: 'Информатика',
  pe: 'Физическая культура',
  art: 'Изобразительное искусство',
  tech: 'Технология',
};

// Предмет требует особого помещения: иначе любая комната подойдёт.
export const SPECIAL_ROOM = {
  pe: 'gym',
  inf: 'computer',
  chem: 'chem',
  phys: 'phys',
  tech: 'workshop',
};

export const ROOM_TYPES = ['general', 'gym', 'computer', 'chem', 'phys', 'workshop'];

export const DEFAULTS = {
  calendar: { weeks: 8, days: 5, slotsPerDay: 7 },
  budget: { limit: 20000, hourRate: 600, substitutionRate: 600, overtimeFactor: 1.5 },
  teacher: { maxWeekly: 18, subjects: [] },
};

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizePassport(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Паспорт школы: ожидался объект');
  const calendar = {
    ...DEFAULTS.calendar,
    ...(raw.calendar || {}),
  };
  const budget = {
    ...DEFAULTS.budget,
    ...(raw.budget || {}),
  };
  const classes = (raw.classes || []).map((c) => ({
    id: String(c.id),
    grade: num(c.grade, parseInt(String(c.id), 10)),
    students: num(c.students, 25),
  }));
  const teachers = (raw.teachers || []).map((t) => ({
    id: String(t.id),
    name: t.name ? String(t.name) : String(t.id),
    subjects: (t.subjects || []).map(String),
    maxWeekly: num(t.maxWeekly, DEFAULTS.teacher.maxWeekly),
    hourRate: num(t.hourRate, budget.hourRate),
    external: Boolean(t.external),
    unavailable: (t.unavailable || []).map((u) => ({
      week: num(u.week, -1),
      day: num(u.day, -1),
      slot: num(u.slot, -1),
    })),
  }));
  const rooms = (raw.rooms || []).map((r) => ({
    id: String(r.id),
    capacity: num(r.capacity, 25),
    type: r.type && ROOM_TYPES.includes(r.type) ? r.type : 'general',
  }));
  const plan = {};
  for (const [grade, subjects] of Object.entries(raw.plan || {})) {
    plan[String(grade)] = {};
    for (const [subject, hours] of Object.entries(subjects || {})) {
      plan[String(grade)][String(subject)] = num(hours, 0);
    }
  }
  return {
    meta: raw.meta || { name: 'Школа без названия', version: '0', asOf: '' },
    calendar,
    budget,
    classes,
    teachers,
    rooms,
    plan,
  };
}

export function validatePassport(passport) {
  const errors = [];
  const warnings = [];
  const { classes, teachers, rooms, plan, calendar } = passport;

  if (!classes.length) errors.push('Нет ни одного класса');
  if (!teachers.length) errors.push('Нет ни одного учителя');
  if (!rooms.length) errors.push('Нет ни одного помещения');

  const ids = new Set();
  for (const c of classes) {
    if (ids.has(c.id)) errors.push(`Класс ${c.id} указан дважды`);
    ids.add(c.id);
    if (!plan[c.grade]) errors.push(`Для класса ${c.id} нет учебного плана на параллель ${c.grade}`);
  }
  const teacherIds = new Set();
  for (const t of teachers) {
    if (teacherIds.has(t.id)) errors.push(`Учитель ${t.id} указан дважды`);
    teacherIds.add(t.id);
    if (!t.subjects.length) errors.push(`У учителя ${t.id} не указаны предметы`);
    if (t.maxWeekly <= 0) errors.push(`У учителя ${t.id} некорректная норма часов`);
  }

  const slotsPerWeek = calendar.days * calendar.slotsPerDay;
  for (const [grade, subjects] of Object.entries(plan)) {
    const total = Object.values(subjects).reduce((a, b) => a + b, 0);
    if (total > slotsPerWeek) {
      errors.push(`План ${grade} класса (${total} ч) не помещается в неделю (${slotsPerWeek} слотов)`);
    }
    for (const subject of Object.keys(subjects)) {
      const qualified = teachers.filter((t) => t.subjects.includes(subject));
      if (!qualified.length) errors.push(`Предмет «${subject}» (${grade} кл.) некому вести: нет учителя с этим предметом`);
      const demand = classes
        .filter((c) => String(c.grade) === String(grade))
        .reduce((a, c) => a + (subjects[subject] || 0) * 1, 0);
      const capacity = qualified.reduce((a, t) => a + t.maxWeekly, 0);
      if (demand > capacity) {
        warnings.push(
          `«${subject}» ${grade} кл.: нужно ${demand} ч/нед, у квалифицированных учителей норма ${capacity} ч/нед`,
        );
      }
    }
  }

  const generalRooms = rooms.filter((r) => r.type === 'general').length;
  const maxParallel = Math.max(1, classes.length);
  if (generalRooms + rooms.filter((r) => r.type !== 'general').length < Math.min(maxParallel, slotsPerWeek)) {
    warnings.push('Помещений меньше, чем одновременных классов — часть занятий может не разместиться');
  }

  for (const r of rooms) {
    if (r.capacity <= 0) errors.push(`Помещение ${r.id}: вместимость должна быть больше нуля`);
  }

  return { ok: errors.length === 0, errors, warnings };
}

// --- CSV -------------------------------------------------------------------

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = String(text).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ',' || ch === ';') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  const clean = rows.filter((r) => r.some((v) => String(v).trim() !== ''));
  if (!clean.length) return [];
  const header = clean[0].map((h) => h.trim());
  return clean.slice(1).map((r) => {
    const obj = {};
    header.forEach((h, i) => {
      obj[h] = (r[i] ?? '').trim();
    });
    return obj;
  });
}

export function passportFromCsv({ classes, teachers, plan, rooms, meta, calendar, budget }) {
  const planMap = {};
  for (const row of parseCsv(plan || '')) {
    const grade = String(row.grade || row['параллель'] || '');
    const subject = String(row.subject || row['предмет'] || '');
    const hours = Number(row.hours || row['часы'] || 0);
    if (!grade || !subject) continue;
    planMap[grade] = planMap[grade] || {};
    planMap[grade][subject] = hours;
  }
  return normalizePassport({
    meta: meta || { name: 'Школа из CSV', version: '1', asOf: new Date().toISOString().slice(0, 10) },
    calendar: calendar || DEFAULTS.calendar,
    budget: budget || DEFAULTS.budget,
    classes: parseCsv(classes || '').map((r) => ({
      id: r.id,
      grade: Number(r.grade),
      students: Number(r.students),
    })),
    teachers: parseCsv(teachers || '').map((r) => ({
      id: r.id,
      name: r.name || r.id,
      subjects: String(r.subjects || '')
        .split(/[|,;]/)
        .map((s) => s.trim())
        .filter(Boolean),
      maxWeekly: Number(r.maxWeekly || DEFAULTS.teacher.maxWeekly),
      hourRate: Number(r.hourRate || 0) || undefined,
    })),
    rooms: parseCsv(rooms || '').map((r) => ({
      id: r.id,
      capacity: Number(r.capacity),
      type: r.type || 'general',
    })),
    plan: planMap,
  });
}

export function availableAt(teacher, week, day, slot) {
  return !(teacher.unavailable || []).some(
    (u) => u.week === week && u.day === day && u.slot === slot,
  );
}

export function subjectLabel(subject) {
  return SUBJECT_NAMES[subject] || subject;
}
