// Генератор демонстрационного паспорта школы и CSV-файлов.
// Данные условные: ни одного реального имени и ни одной реальной ставки.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePassport, validatePassport } from '../src/engine/model.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outDir = join(root, 'data', 'demo-school');
const scenDir = join(root, 'data', 'scenarios');
mkdirSync(outDir, { recursive: true });
mkdirSync(scenDir, { recursive: true });

const classes = [
  { id: '5А', grade: 5, students: 26 },
  { id: '5Б', grade: 5, students: 27 },
  { id: '6А', grade: 6, students: 28 },
  { id: '6Б', grade: 6, students: 25 },
  { id: '7А', grade: 7, students: 27 },
  { id: '7Б', grade: 7, students: 26 },
  { id: '8А', grade: 8, students: 25 },
  { id: '8Б', grade: 8, students: 28 },
  { id: '9А', grade: 9, students: 26 },
  { id: '9Б', grade: 9, students: 27 },
  { id: '10А', grade: 10, students: 24 },
  { id: '11А', grade: 11, students: 22 },
];

const plan = {
  5: { math: 5, rus: 5, lit: 2, eng: 3, hist: 2, geo: 1, bio: 1, art: 1, pe: 3, tech: 2 },
  6: { math: 5, rus: 5, lit: 2, eng: 3, hist: 2, geo: 1, bio: 1, art: 1, pe: 3, tech: 2 },
  7: { math: 5, rus: 4, lit: 2, eng: 3, hist: 2, geo: 2, bio: 2, phys: 2, pe: 3, inf: 1, tech: 1 },
  8: { math: 5, rus: 4, lit: 2, eng: 3, hist: 2, geo: 2, bio: 2, phys: 2, chem: 2, pe: 3, inf: 1 },
  9: { math: 5, rus: 3, lit: 2, eng: 3, hist: 2, geo: 2, bio: 2, phys: 2, chem: 2, pe: 3, inf: 2 },
  10: { math: 5, rus: 2, lit: 2, eng: 3, hist: 2, geo: 1, bio: 1, phys: 2, chem: 2, inf: 2, pe: 3 },
  11: { math: 5, rus: 2, lit: 2, eng: 3, hist: 2, geo: 1, bio: 2, phys: 2, chem: 2, inf: 2, pe: 3 },
};

const teachers = [];
const add = (n, subjects, extra = {}) => {
  for (let i = 0; i < n; i++) {
    const id = `T-${String(teachers.length + 1).padStart(3, '0')}`;
    teachers.push({
      id,
      name: `Учитель ${id}`,
      subjects,
      maxWeekly: 18,
      hourRate: 600,
      ...extra,
    });
  }
};
add(4, ['math']); // T-001..T-004
add(4, ['rus', 'lit']); // T-005..T-008
add(3, ['eng']); // T-009..T-011
add(2, ['hist', 'geo']); // T-012..T-013
add(2, ['bio', 'chem']); // T-014..T-015
add(2, ['phys']); // T-016..T-017
add(2, ['inf']); // T-018..T-019
add(3, ['pe']); // T-020..T-022
add(1, ['art', 'tech']); // T-023
add(1, ['hist', 'geo']); // T-024

const rooms = [];
for (let i = 1; i <= 16; i++) {
  rooms.push({ id: `${100 + i}`, capacity: 30, type: 'general' });
}
rooms.push({ id: 'СЗ-1', capacity: 45, type: 'gym' });
rooms.push({ id: 'ИНФ-1', capacity: 28, type: 'computer' });
rooms.push({ id: 'ХИМ-1', capacity: 28, type: 'chem' });
rooms.push({ id: 'ФИЗ-1', capacity: 28, type: 'phys' });
rooms.push({ id: 'ТЕХ-1', capacity: 28, type: 'workshop' });
rooms.push({ id: 'АКТ-1', capacity: 60, type: 'general' });

const passportRaw = {
  meta: {
    name: 'Демо-школа (условные данные)',
    version: '1.0',
    asOf: '2026-11-16',
    note: 'Данные синтетические. Реальный паспорт школы подключается через CSV.',
  },
  calendar: { weeks: 8, days: 5, slotsPerDay: 7 },
  budget: { limit: 20000, hourRate: 600, substitutionRate: 700, overtimeFactor: 1.5 },
  classes,
  teachers,
  rooms,
  plan,
};

const passport = normalizePassport(passportRaw);
const validation = validatePassport(passport);
if (!validation.ok) {
  console.error('Демо-данные не проходят проверку:', validation.errors);
  process.exit(1);
}
if (validation.warnings.length) {
  console.warn('Предупреждения:', validation.warnings);
}

const write = (path, text) => writeFileSync(path, text, 'utf8');

write(join(outDir, 'passport.json'), JSON.stringify(passport, null, 2) + '\n');

const csv = (header, rows) =>
  [header.join(','), ...rows.map((r) => r.map((v) => String(v)).join(','))].join('\n') + '\n';

write(
  join(outDir, 'classes.csv'),
  csv(['id', 'grade', 'students'], classes.map((c) => [c.id, c.grade, c.students])),
);
write(
  join(outDir, 'teachers.csv'),
  csv(
    ['id', 'name', 'subjects', 'maxWeekly', 'hourRate'],
    teachers.map((t) => [t.id, t.name, t.subjects.join('|'), t.maxWeekly, t.hourRate]),
  ),
);
write(
  join(outDir, 'rooms.csv'),
  csv(['id', 'capacity', 'type'], rooms.map((r) => [r.id, r.capacity, r.type])),
);
const planRows = [];
for (const [grade, subjects] of Object.entries(plan)) {
  for (const [subject, hours] of Object.entries(subjects)) planRows.push([grade, subject, hours]);
}
write(join(outDir, 'plan.csv'), csv(['grade', 'subject', 'hours'], planRows));

const scenarios = {
  's1-absences': {
    id: 's1-absences',
    title: 'Отсутствуют два учителя',
    asOf: '2026-11-16',
    brief:
      'Два учителя отсутствуют на неделе. Нужно обеспечить занятия и не выйти за норму нагрузки и резерв.',
    goal: 'Провести как можно больше занятий, не превысив норму нагрузки и резерв на замены',
    absentTeachers: [
      { teacherId: 'T-001', weeks: [2], reason: 'Болезнь (подтверждена)' },
      { teacherId: 'T-005', weeks: [2], reason: 'Болезнь (подтверждена)' },
    ],
    sandboxPool: ['T-001', 'T-005', 'T-016', 'T-009', 'T-020', 'T-014'],
    assistant: null,
    questions: [
      'Какие занятия затронуты и в каких классах?',
      'Какой вариант дешевле и какой — лучше для классов?',
    ],
  },
  's2-budget': {
    id: 's2-budget',
    title: 'Ограничение бюджета',
    asOf: '2026-11-16',
    brief:
      'Отсутствуют три учителя на неделе, а резерв на замены сокращён до 3 000 ₽. Платные замены почти недоступны.',
    goal: 'Сохранить занятия при резерве 3 000 ₽',
    absentTeachers: [
      { teacherId: 'T-016', weeks: [3], reason: 'Курсы повышения квалификации' },
      { teacherId: 'T-009', weeks: [3], reason: 'Болезнь' },
      { teacherId: 'T-020', weeks: [3], reason: 'Соревнования' },
    ],
    budgetOverride: { limit: 3000 },
    assistant: null,
    questions: ['Что дешевле: перенос или перераспределение?', 'Сколько занятий придётся отменить?'],
  },
  's3-stale-data': {
    id: 's3-stale-data',
    title: 'Ошибка в сведениях цифрового помощника',
    asOf: '2026-11-16',
    brief:
      'Отсутствует учитель математики. Помощник предлагает замену по снимку данных от 14 ноября. Снимок устарел.',
    goal: 'Выбрать замену, проверив сведения помощника',
    absentTeachers: [{ teacherId: 'T-002', weeks: [1], reason: 'Болезнь' }],
    assistant: {
      dataAsOf: '2026-11-14',
      currentAsOf: '2026-11-16',
      recommendations: [
        {
          id: 'rec-1',
          action: 'substitute',
          teacherId: 'T-999',
          text: 'Привлечь внешнего преподавателя T-999: в снимке от 14.11 он свободен и готов вести математику.',
          lessonIds: null,
        },
        {
          id: 'rec-2',
          action: 'reassign',
          teacherId: 'T-001',
          text: 'Либо перераспределить часы на учителя T-001 — в снимке у него 12 ч/нед при норме 18.',
          lessonIds: null,
        },
      ],
    },
    questions: [
      'На какую дату собраны сведения помощника?',
      'Что изменится, если принять совет без проверки?',
      'Как школа будет проверять такие сведения в дальнейшем?',
    ],
  },
};

for (const [name, scenario] of Object.entries(scenarios)) {
  write(join(scenDir, `${name}.json`), JSON.stringify(scenario, null, 2) + '\n');
}
write(
  join(scenDir, 'index.json'),
  JSON.stringify(
    Object.values(scenarios).map((s) => ({ id: s.id, title: s.title, brief: s.brief })),
    null,
    2,
  ) + '\n',
);

console.log(`Демо-паспорт: классов ${classes.length}, учителей ${teachers.length}, помещений ${rooms.length}`);
console.log(`Файлы: ${outDir}`);
console.log(`Сценарии: ${scenDir}`);
