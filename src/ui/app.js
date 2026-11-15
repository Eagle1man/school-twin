import {
  preparePassport,
  runTwin,
  compareAlternatives,
  runSeries,
  seriesToCsv,
  journalFor,
  COMPONENTS,
  EVENT_LABELS,
  SWEEPS,
  POLICY_LABELS,
  ENGINE_VERSION,
  verifyRecommendations,
} from '../engine/index.js';
import { buildTimetable } from '../engine/schedule.js';
import { disruptedLessons, stateBeforeDecision, applyScenarioToPassport } from '../engine/scenarios.js';
import { ACTIVE_STATUSES } from '../engine/constraints.js';
import { subjectLabel } from '../engine/model.js';
import { barChart, lineChart } from './charts.js';

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт'];
const state = {
  passport: null,
  validation: null,
  scenarios: [],
  scenario: null,
  policy: 'mixed',
  seed: 'demo',
  run: null,
  alts: null,
  journal: null,
  series: null,
  accepted: new Map(), // recId -> принят ли совет
  sandbox: { reserve: 20000, absent: 2, week: 2, policy: 'mixed', klass: null, weekView: 0 },
};

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = (n) => new Intl.NumberFormat('ru-RU').format(n);
const rub = (n) => `${num(Math.round(n))} ₽`;

function download(name, text, type = 'application/json') {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

async function json(path) {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

// --- загрузка ---------------------------------------------------------------

async function loadData() {
  const raw = await json('data/demo-school/passport.json');
  const { passport, validation } = preparePassport(raw);
  state.passport = passport;
  state.validation = validation;
  const index = await json('data/scenarios/index.json');
  const list = [];
  for (const item of index) {
    list.push(await json(`data/scenarios/${item.id}.json`));
  }
  state.scenarios = list;
  $('footer-info').textContent = `${passport.meta.name} · версия паспорта ${passport.meta.version} · движок ${ENGINE_VERSION}`;
}

// --- общие блоки ------------------------------------------------------------

function renderSchoolFacts() {
  const p = state.passport;
  const weekly = p.classes.reduce(
    (sum, c) => sum + Object.values(p.plan[c.grade] || {}).reduce((a, b) => a + b, 0),
    0,
  );
  const teacherHours = p.teachers.reduce((a, t) => a + t.maxWeekly, 0);
  $('school-facts').innerHTML = `
    <dt>Классы</dt><dd>${p.classes.length} · ${num(p.classes.reduce((a, c) => a + c.students, 0))} учеников</dd>
    <dt>Учителя</dt><dd>${p.teachers.length} · норма ${num(teacherHours)} ч/нед</dd>
    <dt>Нагрузка</dt><dd>${num(weekly)} ч/нед по учебному плану</dd>
    <dt>Помещения</dt><dd>${p.rooms.length}</dd>
    <dt>Четверть</dt><dd>${p.calendar.weeks} недель · ${p.calendar.days} дней · ${p.calendar.slotsPerDay} уроков</dd>
    <dt>Резерв на замены</dt><dd>${rub(p.budget.limit)}</dd>
    <dt>Замена / час</dt><dd>${rub(p.budget.substitutionRate)}</dd>
    <dt>Данные</dt><dd>${esc(p.meta.asOf)} · условные</dd>
  `;
  $('constraint-list').innerHTML = [
    'Учитель не может вести два занятия одновременно',
    'Помещение не может быть занято дважды',
    'Класс должен помещаться в помещение',
    'Предмет ведёт только специалист по этому предмету',
    'Недельная нагрузка выше нормы считается переработкой и оплачивается',
    'Расходы выше резерва — нарушение',
    'Учебный план должен быть выполнен полностью',
  ]
    .map((t) => `<li>${esc(t)}</li>`)
    .join('');
}

function renderScenarioList() {
  $('scenario-list').innerHTML = state.scenarios
    .map(
      (s, i) => `
      <button class="scenario-item ${state.scenario?.id === s.id ? 'active' : ''}" data-scenario="${esc(s.id)}">
        <b>${i + 1}. ${esc(s.title)}</b>
        <span>${esc(s.brief)}</span>
      </button>`,
    )
    .join('');
  $('scenario-list')
    .querySelectorAll('[data-scenario]')
    .forEach((btn) => btn.addEventListener('click', () => selectScenario(btn.dataset.scenario)));
}

function selectScenario(id) {
  state.scenario = state.scenarios.find((s) => s.id === id);
  state.run = null;
  state.alts = null;
  state.accepted.clear();
  state.journal = journalFor({ scenarioId: id, title: state.scenario.title });
  state.journal.add('session_start', { scenarioId: id });
  state.journal.add('data_opened', { source: 'passport.json', asOf: state.passport.meta.asOf });
  if (state.scenario.assistant) {
    state.journal.add('assistant_opened', { dataAsOf: state.scenario.assistant.dataAsOf });
  }
  $('explanation').value = '';
  $('results').hidden = true;
  $('comparison').hidden = true;
  $('profile').hidden = true;
  $('run-id').textContent = 'прогон не выполнен';
  $('run-id').className = 'badge badge-muted';
  renderScenarioList();
  renderBrief();
  renderAffected();
  renderAssistantCard();
  renderJournal();
  renderPolicyList();
}

function renderBrief() {
  const s = state.scenario;
  const absent = (s.absentTeachers || [])
    .map(
      (a) =>
        `<li>${esc(a.teacherId)} — ${esc((a.reason || 'причина не указана').trim())}, неделя ${a.weeks.map((w) => w + 1).join(', ')}</li>`,
    )
    .join('');
  $('scenario-brief').innerHTML = `
    <div class="brief-body">${esc(s.brief)}</div>
    <div class="goal"><b>Цель:</b> ${esc(s.goal || '—')}</div>
    ${absent ? `<div class="questions"><b>Событие:</b><ul>${absent}</ul></div>` : ''}
    ${
      s.assistant
        ? `<div class="small">Сведения помощника: на ${esc(s.assistant.dataAsOf)}. Текущая дата: ${esc(s.assistant.currentAsOf)}.</div>`
        : ''
    }
    ${
      (s.questions || []).length
        ? `<div class="questions"><b>Вопросы:</b><ul>${s.questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ul></div>`
        : ''
    }
  `;
}

function currentTimetable() {
  if (!currentTimetable.cache || currentTimetable.seed !== state.seed || currentTimetable.passport !== state.passport) {
    currentTimetable.cache = buildTimetable(state.passport, state.seed);
    currentTimetable.seed = state.seed;
    currentTimetable.passport = state.passport;
  }
  return currentTimetable.cache;
}

function renderAffected() {
  const s = state.scenario;
  if (!s) return;
  const timetable = currentTimetable();
  const affected = disruptedLessons(timetable.lessons, s);
  const classes = new Set(affected.map((l) => l.classId));
  const teachers = new Set(affected.map((l) => l.teacherId));
  $('affected-summary').innerHTML = affected.length
    ? `<b>${affected.length}</b> занятий в ${classes.size} классах · ${teachers.size} учителя · ${affected.reduce((a, l) => a + l.students, 0)} учеников затронуто`
    : 'Событий нет';

  const rows = affected
    .slice()
    .sort((a, b) => a.week - b.week || a.day - b.day || a.slot - b.slot || a.classId.localeCompare(b.classId))
    .slice(0, 14);
  $('affected-table').innerHTML = `
    <thead><tr><th>Класс</th><th>Предмет</th><th>Когда</th><th>Учитель</th><th class="num">Учеников</th></tr></thead>
    <tbody>
      ${rows
        .map(
          (l) => `<tr>
            <td>${esc(l.classId)}</td>
            <td>${esc(subjectLabel(l.subject))}</td>
            <td>${l.week + 1} нед. · ${DAYS[l.day]} ${l.slot + 1}</td>
            <td>${esc(l.teacherId)}</td>
            <td class="num">${l.students}</td>
          </tr>`,
        )
        .join('')}
    </tbody>
  `;
  if (affected.length > rows.length) {
    $('affected-table').insertAdjacentHTML(
      'beforeend',
      `<tfoot><tr><td colspan="5" class="muted">Показаны первые ${rows.length} из ${affected.length}</td></tr></tfoot>`,
    );
  }
}

function renderPolicyList() {
  const options = [
    ['mixed', 'Свободные варианты, затем платные', 'Перераспределение → объединение → перенос → замена'],
    ['reassign', 'Перераспределить нагрузку', 'Только внутренние учителя, бесплатно, но с переработкой'],
    ['substitute', 'Привлечь замену', 'Внешний преподаватель: цена — ставка за час'],
    ['postpone', 'Перенести занятия', 'Позже в четверти, без доплат'],
    ['merge', 'Объединить классы', 'Два класса вместе, если помещение позволяет'],
    ['cancel', 'Ничего не делать', 'Занятия не проводятся'],
  ];
  $('policy-list').innerHTML = options
    .map(
      ([id, label, note]) => `
      <label class="policy ${state.policy === id ? 'checked' : ''}" data-policy="${id}">
        <input type="radio" name="policy" value="${id}" ${state.policy === id ? 'checked' : ''} />
        <span>${esc(label)}<small>${esc(note)}</small></span>
      </label>`,
    )
    .join('');
  $('policy-list')
    .querySelectorAll('input[name="policy"]')
    .forEach((input) =>
      input.addEventListener('change', () => {
        state.policy = input.value;
        state.journal.add('alternative_selected', { policy: state.policy });
        renderPolicyList();
        renderJournal();
      }),
    );
  void POLICY_LABELS;
}

// --- помощник ---------------------------------------------------------------

function renderAssistantCard() {
  const card = $('assistant-card');
  const s = state.scenario;
  if (!s?.assistant) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  const timetable = currentTimetable();
  const pre = stateBeforeDecision(timetable, s);
  const verification = verify(pre);

  $('assistant-body').innerHTML = `
    <p class="small">Совет собран на <b>${esc(s.assistant.dataAsOf)}</b>, текущее состояние — <b>${esc(s.assistant.currentAsOf)}</b>
      ${verification.staleDays != null ? `· снимку ${verification.staleDays} дн.` : ''}</p>
    ${verification.recommendations
      .map(
        (rec) => `
      <div class="assistant-rec ${state.accepted.has(rec.id) ? 'accepted' : ''}" data-rec="${esc(rec.id)}">
        <div class="rec-head">
          <b>${esc(rec.id === 'rec-1' ? 'Совет 1' : rec.id === 'rec-2' ? 'Совет 2' : rec.id)}</b>
          <span class="stamp">снимок ${esc(rec.dataAsOf)}</span>
        </div>
        <div class="small">${esc(rec.text)}</div>
        <div class="rec-actions">
          <button class="btn btn-small" data-check="${esc(rec.id)}">Проверить сведения</button>
          <button class="btn btn-small" data-accept="${esc(rec.id)}">Принять совет</button>
          <button class="btn btn-small" data-reject="${esc(rec.id)}">Отклонить</button>
        </div>
      </div>`,
      )
      .join('')}
  `;

  $('assistant-body')
    .querySelectorAll('[data-check]')
    .forEach((btn) =>
      btn.addEventListener('click', () => {
        const rec = verification.recommendations.find((r) => r.id === btn.dataset.check);
        state.journal.add('assistant_checked', { recId: rec.id, verdict: rec.verdict });
        if (rec.verdict === 'conflict') state.journal.add('error_detected', { recId: rec.id });
        showRecDetails(rec);
        renderJournal();
      }),
    );
  $('assistant-body')
    .querySelectorAll('[data-accept]')
    .forEach((btn) =>
      btn.addEventListener('click', () => {
        const rec = verification.recommendations.find((r) => r.id === btn.dataset.accept);
        state.accepted.set(rec.id, rec);
        state.journal.add('alternative_selected', { recId: rec.id, accepted: true, stale: true });
        renderAssistantCard();
        renderJournal();
      }),
    );
  $('assistant-body')
    .querySelectorAll('[data-reject]')
    .forEach((btn) =>
      btn.addEventListener('click', () => {
        state.journal.add('alternative_selected', { recId: btn.dataset.reject, accepted: false });
        renderJournal();
      }),
    );
}

function verify(pre) {
  return verifyRecommendations(
    state.scenario,
    pre,
    applyScenarioToPassport(state.passport, state.scenario),
  );
}

function showRecDetails(rec) {
  const box = document.querySelector(`[data-rec="${rec.id}"]`);
  if (!box) return;
  box.classList.add('checked');
  box.querySelector('.rec-details')?.remove();

  // Одинаковые нарушения по разным занятиям — это одно нарушение с числом,
  // а не пятнадцать одинаковых строк.
  const groups = new Map();
  for (const c of rec.conflicts) {
    const cur = groups.get(c.code) || { code: c.code, detail: c.detail, count: 0 };
    cur.count += 1;
    groups.set(c.code, cur);
  }
  const list = groups.size
    ? `<ul>${[...groups.values()]
        .map(
          (g) =>
            `<li><b>${esc(g.code)}</b> — ${esc(g.detail)}${g.count > 1 ? ` <span class="small">(занятий: ${g.count})</span>` : ''}</li>`,
        )
        .join('')}</ul>`
    : '<p class="small">Расхождений с актуальным паспортом не найдено.</p>';
  box.insertAdjacentHTML(
    'beforeend',
    `<div class="rec-details">${list}<p class="hint">Проверка идёт по актуальному паспорту и текущему расписанию, а не по снимку.</p></div>`,
  );
}

// --- журнал -----------------------------------------------------------------

function renderJournal() {
  const events = state.journal ? state.journal.events : [];
  $('journal-list').innerHTML = events
    .slice(-20)
    .map(
      (e) =>
        `<li><time>${new Date(e.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
         <span>${esc(EVENT_LABELS[e.type] || e.type)}</span></li>`,
    )
    .join('');
  $('journal-list').scrollTop = $('journal-list').scrollHeight;
}

// --- расчёт -----------------------------------------------------------------

function acceptedDecisions() {
  const decisions = {};
  if (!state.accepted.size) return decisions;
  const s = state.scenario;
  const timetable = currentTimetable();
  const affected = disruptedLessons(timetable.lessons, s);
  for (const rec of state.accepted.values()) {
    for (const lesson of affected) {
      decisions[lesson.id] = { action: rec.action, teacherId: rec.teacherId };
    }
  }
  return decisions;
}

async function solve() {
  const btn = $('btn-solve');
  btn.disabled = true;
  btn.textContent = 'Считаю…';
  try {
    const explanation = $('explanation').value.trim();
    if (explanation) state.journal.add('explanation_written', { text: explanation });
    const decisions = acceptedDecisions();
    const policy = decisions && Object.keys(decisions).length ? 'manual' : state.policy;
    state.journal.add('decision_made', { policy, explanation, acceptedRecommendations: [...state.accepted.keys()] });

    const run = await runTwin({ passport: state.passport, scenario: state.scenario, policy, decisions, seed: state.seed });
    state.run = run;
    const alts = await compareAlternatives({ passport: state.passport, scenario: state.scenario, seed: state.seed });
    state.alts = alts;
    state.journal.add('alternatives_compared', { count: alts.length, seed: state.seed });
    state.journal.add('result_viewed', { runId: run.runId, lessonsMissed: run.metrics.lessonsMissed });

    $('run-id').textContent = `прогон ${run.runId.slice(0, 12)}`;
    $('run-id').className = 'badge';
    renderResults(run);
    renderComparison(alts, run);
    $('results').hidden = false;
    $('comparison').hidden = false;
    $('profile').hidden = false;
    renderProfile();
    renderJournal();
  } catch (err) {
    console.error(err);
    $('solve-hint').textContent = `Ошибка расчёта: ${err.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Рассчитать последствия';
  }
}

function metricCard(label, value, note, tone = '') {
  return `<div class="metric ${tone}"><div class="label">${esc(label)}</div><div class="value">${value}</div><div class="note">${esc(note)}</div></div>`;
}

function renderResults(run) {
  const m = run.metrics;
  const missTone = m.lessonsMissed === 0 ? 'good' : m.lessonsMissed > 10 ? 'bad' : 'warn';
  const costTone = m.costTotal > m.reserve ? 'bad' : m.costTotal > m.reserve * 0.7 ? 'warn' : 'good';
  const violTone = m.errorsCount > 0 ? 'bad' : m.violationsCount > 0 ? 'warn' : 'good';

  $('metric-cards').innerHTML = [
    metricCard('Непроведённые занятия', `${m.lessonsMissed}`, `из ${num(m.lessonsPlanned)} запланированных · проведено ${m.coveragePct}%`, missTone),
    metricCard('Дополнительная нагрузка', `${m.extraHours} ч`, `максимум ${m.extraHoursMax} ч на учителя · разброс ${m.extraSpread}`, m.extraHours ? 'warn' : 'good'),
    metricCard('Расходы', rub(m.costTotal), `резерв ${rub(m.reserve)} · замены ${rub(m.costSubstitution)} · переработка ${rub(m.costOvertime)}`, costTone),
    metricCard('Нарушения ограничений', `${m.violationsCount}`, `${m.errorsCount} ошибок · ${m.violationsCount - m.errorsCount} предупреждений`, violTone),
  ].join('');

  const groups = new Map();
  for (const v of m.violations) {
    const cur = groups.get(v.code) || { code: v.code, severity: v.severity, count: 0, detail: v.detail };
    cur.count += 1;
    groups.set(v.code, cur);
  }
  $('violations').innerHTML = groups.size
    ? [...groups.values()]
        .map(
          (g) =>
            `<div class="violation ${g.severity}"><b>${esc(g.code)}</b> — ${esc(g.detail)}${g.count > 1 ? ` <span class="small">(всего ${g.count})</span>` : ''}</div>`,
        )
        .join('')
    : '<div class="violation" style="border-color:#15803d;background:#f0fdf4">Нарушений нет.</div>';
}

function renderComparison(alts, run) {
  const base = alts.find((a) => a.policy === 'cancel') || alts[0];
  $('comparison-table').innerHTML = `
    <thead>
      <tr>
        <th>Вариант</th>
        <th class="num">Проведено</th>
        <th class="num">Не проведено</th>
        <th class="num">Доп. часы</th>
        <th class="num">Расходы</th>
        <th class="num">Нарушения</th>
        <th class="num">Δ к «ничего не делать»</th>
      </tr>
    </thead>
    <tbody>
      ${alts
        .map((a) => {
          const m = a.metrics;
          const best = a.policy === (run?.policy || state.policy);
          const d = a.delta
            ? `${a.delta.lessonsMissed > 0 ? '+' : ''}${a.delta.lessonsMissed} зан. · ${a.delta.costTotal > 0 ? '+' : ''}${num(a.delta.costTotal)} ₽`
            : 'база';
          return `<tr class="${best ? 'best' : ''}">
            <td>${esc(a.label)}${best ? ' <span class="small">— ваш выбор</span>' : ''}</td>
            <td class="num">${m.lessonsHeld}</td>
            <td class="num">${m.lessonsMissed}</td>
            <td class="num">${m.extraHours}</td>
            <td class="num">${rub(m.costTotal)}</td>
            <td class="num">${m.violationsCount}</td>
            <td class="num">${esc(d)}</td>
          </tr>`;
        })
        .join('')}
    </tbody>
  `;
  barChart(
    $('comparison-chart'),
    alts.map((a) => ({
      label: a.label,
      value: a.metrics.lessonsMissed,
      color: a.policy === (run?.policy || state.policy) ? '#1f4e79' : '#9db8ce',
    })),
    { unit: ' зан.' },
  );
  void base;
}

function renderProfile() {
  const markers = state.journal.markers();
  $('profile-grid').innerHTML = markers.components
    .map(
      (c) => `
      <div class="profile-card ${c.observed ? 'observed' : ''}">
        <h3>${esc(c.name)}</h3>
        <div class="q">${esc(c.question)}</div>
        ${
          c.evidence.length
            ? `<ul>${c.evidence.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`
            : '<div class="none">Наблюдений нет</div>'
        }
      </div>`,
    )
    .join('');
}

// --- песочница --------------------------------------------------------------

function buildSandboxControls() {
  const pool = state.scenario?.sandboxPool || ['T-001', 'T-005', 'T-016', 'T-009', 'T-020', 'T-014'];
  $('sandbox-controls').innerHTML = `
    <label>Резерв на замены <span class="value" id="sb-reserve-val">${rub(state.sandbox.reserve)}</span>
      <input id="sb-reserve" type="range" min="0" max="40000" step="1000" value="${state.sandbox.reserve}" />
    </label>
    <label>Отсутствует учителей
      <select id="sb-absent">${[0, 1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}" ${n === state.sandbox.absent ? 'selected' : ''}>${n}</option>`).join('')}</select>
    </label>
    <label>Неделя отсутствия
      <select id="sb-week">${Array.from({ length: state.passport.calendar.weeks }, (_, i) => `<option value="${i}" ${i === state.sandbox.week ? 'selected' : ''}>${i + 1}</option>`).join('')}</select>
    </label>
    <label>Решение
      <select id="sb-policy">${Object.entries({
        mixed: 'Свободные, затем платные',
        reassign: 'Перераспределение',
        substitute: 'Замена',
        postpone: 'Перенос',
        merge: 'Объединение',
        cancel: 'Ничего не делать',
      })
        .map(([k, v]) => `<option value="${k}" ${k === state.sandbox.policy ? 'selected' : ''}>${v}</option>`)
        .join('')}</select>
    </label>
    <p class="hint">Пул учителей для эксперимента: ${pool.join(', ')}. Меняются только параметры — правила те же.</p>
  `;
  $('sb-reserve').addEventListener('input', (e) => {
    state.sandbox.reserve = Number(e.target.value);
    $('sb-reserve-val').textContent = rub(state.sandbox.reserve);
  });
  $('sb-absent').addEventListener('change', (e) => (state.sandbox.absent = Number(e.target.value)));
  $('sb-week').addEventListener('change', (e) => (state.sandbox.week = Number(e.target.value)));
  $('sb-policy').addEventListener('change', (e) => (state.sandbox.policy = e.target.value));
}

function sandboxScenario() {
  const pool = state.scenario?.sandboxPool || ['T-001'];
  return {
    id: 'sandbox',
    title: 'Песочница',
    asOf: state.passport.meta.asOf,
    absentTeachers: pool.slice(0, state.sandbox.absent).map((t) => ({ teacherId: t, weeks: [state.sandbox.week] })),
    budgetOverride: { limit: state.sandbox.reserve },
    assistant: null,
  };
}

async function runSandbox() {
  const btn = $('btn-sandbox');
  btn.disabled = true;
  try {
    const scenario = sandboxScenario();
    const policy = state.sandbox.absent ? state.sandbox.policy : 'cancel';
    const run = await runTwin({ passport: state.passport, scenario, policy, seed: state.seed });
    const m = run.metrics;
    $('sandbox-metrics').innerHTML = [
      metricCard('Не проведено', `${m.lessonsMissed}`, `проведено ${m.coveragePct}%`, m.lessonsMissed ? 'warn' : 'good'),
      metricCard('Доп. часы', `${m.extraHours}`, `максимум ${m.extraHoursMax}`, m.extraHours ? 'warn' : 'good'),
      metricCard('Расходы', rub(m.costTotal), `резерв ${rub(m.reserve)}`, m.costTotal > m.reserve ? 'bad' : 'good'),
      metricCard('Нарушения', `${m.violationsCount}`, `${m.errorsCount} ошибок`, m.errorsCount ? 'bad' : 'good'),
    ].join('');
    $('sandbox-violations').innerHTML = m.violations.length
      ? [...new Map(m.violations.map((v) => [v.code, v])).values()]
          .map((v) => `<div class="violation ${v.severity}"><b>${esc(v.code)}</b> — ${esc(v.detail)}</div>`)
          .join('')
      : '';
    state.sandboxRun = run;
    renderTimetableSelectors(run);
    renderTimetable(run);
    renderLoadTable(run);
  } finally {
    btn.disabled = false;
  }
}

function renderTimetableSelectors(run) {
  const classes = [...new Set(state.passport.classes.map((c) => c.id))];
  if (!$('sandbox-class').options.length) {
    $('sandbox-class').innerHTML = classes.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    $('sandbox-class').addEventListener('change', () => renderTimetable(state.sandboxRun));
  }
  if (!$('sandbox-week').options.length) {
    $('sandbox-week').innerHTML = Array.from({ length: state.passport.calendar.weeks }, (_, i) => `<option value="${i}">${i + 1}</option>`).join('');
    $('sandbox-week').addEventListener('change', () => renderTimetable(state.sandboxRun));
  }
  void run;
}

function renderTimetable(run) {
  if (!run) return;
  const klass = $('sandbox-class').value;
  const week = Number($('sandbox-week').value);
  const rows = [];
  for (let slot = 0; slot < state.passport.calendar.slotsPerDay; slot++) {
    const cells = [];
    for (let day = 0; day < state.passport.calendar.days; day++) {
      const lesson = run.lessons.find(
        (l) => l.classId === klass && l.week === week && l.day === day && l.slot === slot,
      );
      if (!lesson) {
        cells.push('<td><span class="tt-cell dot-free">окно</span></td>');
      } else {
        const cls = { held: 'dot-held', substituted: 'dot-sub', moved: 'dot-moved', merged: 'dot-merged', missed: 'dot-missed' }[lesson.status] || 'dot-held';
        cells.push(
          `<td><span class="tt-cell ${cls}">
            <span class="tt-subject">${esc(subjectLabel(lesson.subject))}</span>
            <span class="tt-meta">${esc(lesson.teacherId || '—')} · ${esc(lesson.roomId || '—')}</span>
          </span></td>`,
        );
      }
    }
    rows.push(`<tr><td class="slot-label">${slot + 1}</td>${cells.join('')}</tr>`);
  }
  $('timetable').innerHTML = `<thead><tr><th></th>${DAYS.map((d) => `<th>${d}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody>`;
}

function renderLoadTable(run) {
  const byTeacher = new Map();
  for (const l of run.lessons) {
    if (!ACTIVE_STATUSES.has(l.status)) continue;
    if (!l.teacherId || l.teacherId.startsWith('SUB')) continue;
    const key = `${l.teacherId}|${l.week}`;
    byTeacher.set(key, (byTeacher.get(key) || 0) + 1);
  }
  const maxByTeacher = new Map();
  for (const [key, hours] of byTeacher) {
    const [teacherId] = key.split('|');
    maxByTeacher.set(teacherId, Math.max(maxByTeacher.get(teacherId) || 0, hours));
  }
  const rows = [...maxByTeacher.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([teacherId, hours]) => {
      const teacher = state.passport.teachers.find((t) => t.id === teacherId);
      const over = hours - teacher.maxWeekly;
      return `<tr class="${over > 0 ? 'worst' : ''}">
        <td>${esc(teacherId)}</td>
        <td>${esc(teacher.subjects.map(subjectLabel).join(', '))}</td>
        <td class="num">${hours}</td>
        <td class="num">${teacher.maxWeekly}</td>
        <td class="num">${over > 0 ? `+${over}` : '0'}</td>
      </tr>`;
    })
    .slice(0, 24);
  $('load-table').innerHTML = `<thead><tr><th>Учитель</th><th>Предметы</th><th class="num">Макс. ч/нед</th><th class="num">Норма</th><th class="num">Сверх</th></tr></thead><tbody>${rows.join('')}</tbody>`;
}

// --- эксперимент ------------------------------------------------------------

function buildExperimentControls() {
  $('sweep').innerHTML = Object.values(SWEEPS)
    .map((s) => `<option value="${s.id}">${esc(s.label)}</option>`)
    .join('');
  const policies = ['mixed', 'reassign', 'postpone', 'substitute', 'cancel'];
  $('policy-checks').innerHTML = policies
    .map(
      (p, i) =>
        `<label><input type="checkbox" value="${p}" ${i < 2 ? 'checked' : ''} /> ${esc(
          { mixed: 'Свободные, затем платные', reassign: 'Перераспределение', postpone: 'Перенос', substitute: 'Замена', cancel: 'Ничего не делать' }[p],
        )}</label>`,
    )
    .join('');
}

async function runExperiment() {
  const btn = $('btn-series');
  btn.disabled = true;
  btn.textContent = 'Считаю…';
  try {
    const policies = [...$('policy-checks').querySelectorAll('input:checked')].map((i) => i.value);
    if (!policies.length) throw new Error('Выберите хотя бы один вариант решения');
    const repeats = Math.max(1, Math.min(200, Number($('repeats').value) || 20));
    const sweepId = $('sweep').value;
    const series = runSeries({
      passport: state.passport,
      scenario: state.scenario,
      sweepId,
      policies,
      repeats,
      seedBase: $('exp-seed').value || 'series',
    });
    state.series = series;
    renderSeries(series);
    $('btn-series-csv').disabled = false;
  } catch (err) {
    $('series-note').textContent = `Ошибка: ${err.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Запустить серию';
  }
}

function renderSeries(series) {
  $('series-result').hidden = false;
  $('series-title').textContent = `Серия: ${series.sweep.label}`;
  const values = [...new Set(series.aggregate.map((a) => a.value))];
  $('series-table').innerHTML = `
    <thead><tr>
      <th>${esc(series.sweep.label)}</th><th>Решение</th><th class="num">Не проведено (сред.)</th>
      <th class="num">min–max</th><th class="num">Доп. часы</th><th class="num">Расходы (сред.)</th><th class="num">Выше резерва, %</th>
    </tr></thead>
    <tbody>
      ${series.aggregate
        .map(
          (a) => `<tr>
            <td>${esc(a.value)}</td>
            <td>${esc(POLICY_LABELS[a.policy] || a.policy)}</td>
            <td class="num">${a.missedMean}</td>
            <td class="num">${a.missedMin}–${a.missedMax}</td>
            <td class="num">${a.extraMean}</td>
            <td class="num">${rub(a.costMean)}</td>
            <td class="num">${a.overBudgetRate}</td>
          </tr>`,
        )
        .join('')}
    </tbody>`;
  const policies = [...new Set(series.aggregate.map((a) => a.policy))];
  lineChart(
    $('series-chart'),
    policies.map((p) => ({
      label: POLICY_LABELS[p] || p,
      values: values.map((v) => series.aggregate.find((a) => a.policy === p && a.value === v)?.missedMean ?? 0),
    })),
    { xLabels: values.map(String), unit: ' занятий' },
  );
  $('series-note').textContent = `Повторов на точку: ${series.aggregate[0]?.runs ?? 0}. Каждая точка — среднее по повторам с разными seed, поэтому виден разброс, а не одно число.`;
}

// --- методика ---------------------------------------------------------------

function renderMethod() {
  $('method-components').innerHTML = COMPONENTS.map(
    (c) => `<div class="profile-card"><h3>${esc(c.name)}</h3><div class="q">${esc(c.question)}</div></div>`,
  ).join('');
}

// --- запуск -----------------------------------------------------------------

function bind() {
  document.querySelectorAll('.tab').forEach((tab) =>
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${tab.dataset.tab}`));
      if (tab.dataset.tab === 'sandbox' && !state.sandboxRun) runSandbox();
    }),
  );
  $('seed').addEventListener('change', (e) => {
    state.seed = e.target.value.trim() || 'demo';
    state.run = null;
    $('run-id').textContent = 'прогон не выполнен';
    $('run-id').className = 'badge badge-muted';
    renderAffected();
    renderAssistantCard();
  });
  $('btn-solve').addEventListener('click', solve);
  $('btn-reset').addEventListener('click', () => selectScenario(state.scenario.id));
  $('btn-sandbox').addEventListener('click', runSandbox);
  $('btn-series').addEventListener('click', runExperiment);
  $('btn-journal-json').addEventListener('click', () =>
    download(`journal-${state.scenario.id}.json`, JSON.stringify(state.journal.toJSON(), null, 2)),
  );
  $('btn-journal-csv').addEventListener('click', () =>
    download(`journal-${state.scenario.id}.csv`, state.journal.toCSV(), 'text/csv'),
  );
  $('btn-series-csv').addEventListener('click', () => {
    if (!state.series) return;
    download('experiment-series.csv', seriesToCsv(state.series.rows), 'text/csv');
  });
  $('btn-export-run').addEventListener('click', () => {
    if (!state.run) return;
    const payload = {
      engine: ENGINE_VERSION,
      runId: state.run.runId,
      seed: state.run.seed,
      scenarioId: state.run.scenarioId,
      policy: state.run.policy,
      metrics: state.run.metrics,
      alternatives: state.alts?.map((a) => ({ policy: a.policy, metrics: a.metrics })),
      journal: state.journal.toJSON(),
      exportedAt: new Date().toISOString(),
    };
    download(`run-${state.run.runId.slice(0, 12)}.json`, JSON.stringify(payload, null, 2));
  });
}

async function main() {
  try {
    await loadData();
  } catch (err) {
    document.querySelector('main').insertAdjacentHTML(
      'afterbegin',
      `<div class="card"><b>Не удалось загрузить данные.</b> ${esc(err.message)}<br>
       Запустите сервер: <code>node tools/serve.mjs . 8081</code> и откройте http://127.0.0.1:8081/</div>`,
    );
    return;
  }
  renderSchoolFacts();
  renderScenarioList();
  selectScenario(state.scenarios[0].id);
  buildSandboxControls();
  buildExperimentControls();
  renderMethod();
  bind();
}

main();
