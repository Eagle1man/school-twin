// Журнал действий и маркеры методики.
// Профиль — это перечень наблюдаемых действий и свидетельств для эксперта.
// Никакого балла, который «улучшает» результат прогона, здесь нет и не будет.

export const COMPONENTS = [
  { code: 'knowledge', name: 'Знание', question: 'Понимает показатели, происхождение данных и ограничения модели' },
  { code: 'awareness', name: 'Осознание', question: 'Учитывает последствия для людей и определяет ответственность' },
  { code: 'cognition', name: 'Познание', question: 'Проверяет сведения, выдвигает гипотезу, сравнивает альтернативы' },
  { code: 'preference', name: 'Предпочтение', question: 'Задаёт цель и ограничения до выбора варианта' },
  { code: 'impression', name: 'Впечатление', question: 'Объясняет, как совет и его подача повлияли на выбор' },
  { code: 'coadaptation', name: 'Коадаптация', question: 'После ошибки меняет порядок проверки или границы делегирования' },
];

export const EVENT_LABELS = {
  session_start: 'Начало сессии',
  data_opened: 'Открыл сведения о школе',
  data_source_opened: 'Открыл источник данных',
  constraint_set: 'Задал ограничения',
  goal_set: 'Задал цель',
  alternatives_compared: 'Сравнил альтернативы',
  alternative_selected: 'Изучил вариант',
  assistant_opened: 'Открыл совет помощника',
  assistant_checked: 'Проверил совет помощника',
  decision_made: 'Принял решение',
  explanation_written: 'Написал обоснование',
  result_viewed: 'Посмотрел последствия',
  error_detected: 'Обнаружил ошибку',
  adaptation_note: 'Сформулировал изменение порядка действий',
  export_made: 'Выгрузил журнал',
};

export class Journal {
  constructor(meta = {}) {
    this.meta = { startedAt: new Date().toISOString(), ...meta };
    this.events = [];
  }

  add(type, payload = {}) {
    const event = {
      seq: this.events.length + 1,
      at: new Date().toISOString(),
      type,
      payload,
    };
    this.events.push(event);
    return event;
  }

  count(type) {
    return this.events.filter((e) => e.type === type).length;
  }

  has(type) {
    return this.count(type) > 0;
  }

  first(type) {
    return this.events.find((e) => e.type === type) || null;
  }

  markers() {
    const ev = (t) => this.events.filter((e) => e.type === t);
    const evidence = {
      knowledge: [],
      awareness: [],
      cognition: [],
      preference: [],
      impression: [],
      coadaptation: [],
    };

    if (ev('data_opened').length) {
      evidence.knowledge.push(`Открывал сведения о школе: ${ev('data_opened').length} раз`);
    }
    if (ev('data_source_opened').length) {
      evidence.knowledge.push(`Открывал источник/дату данных: ${ev('data_source_opened').length} раз`);
    }
    if (ev('result_viewed').length) {
      evidence.knowledge.push('Смотрел расчётные последствия, а не только решение');
    }

    if (ev('explanation_written').length) {
      const text = ev('explanation_written').map((e) => e.payload?.text || '').join(' ');
      if (/ответствен|педагог|дет|класс|последств/i.test(text)) {
        evidence.awareness.push('В обосновании упомянуты люди и последствия');
      } else {
        evidence.awareness.push('Обоснование записано, последствия для людей явно не названы');
      }
    }

    if (ev('alternatives_compared').length) {
      evidence.cognition.push(`Сравнивал альтернативы: ${ev('alternatives_compared').length} раз`);
    }
    if (ev('assistant_checked').length) {
      evidence.cognition.push(`Проверял совет помощника: ${ev('assistant_checked').length} раз`);
    }
    if (ev('error_detected').length) {
      evidence.cognition.push('Обнаружил ошибку в рекомендации');
    }

    const firstConstraint = this.first('constraint_set');
    const firstDecision = this.first('decision_made');
    if (firstConstraint && firstDecision) {
      evidence.preference.push(
        firstConstraint.seq < firstDecision.seq
          ? 'Ограничения заданы до выбора варианта'
          : 'Ограничения заданы после выбора варианта — порядок нарушен',
      );
    } else if (firstDecision) {
      evidence.preference.push('Ограничения не заданы до выбора варианта');
    }

    if (ev('explanation_written').length) {
      const text = ev('explanation_written').map((e) => e.payload?.text || '').join(' ');
      if (/помощник|совет|подсказ|довер|убедил|подач/i.test(text)) {
        evidence.impression.push('В обосновании описано влияние совета на выбор');
      }
    }

    if (ev('adaptation_note').length) {
      evidence.coadaptation.push(
        `Сформулировано изменение порядка проверки: ${ev('adaptation_note').length} записей`,
      );
    }

    const components = COMPONENTS.map((c) => ({
      ...c,
      evidence: evidence[c.code],
      observed: evidence[c.code].length > 0,
    }));

    return {
      components,
      observedCount: components.filter((c) => c.observed).length,
      total: components.length,
      note: 'Это перечень наблюдаемых действий для эксперта, а не оценка. Итоговый вывод делает человек по протоколу.',
    };
  }

  toJSON() {
    return {
      meta: this.meta,
      events: this.events,
      markers: this.markers(),
    };
  }

  toCSV() {
    const rows = [['seq', 'at', 'type', 'payload']];
    for (const e of this.events) {
      rows.push([e.seq, e.at, e.type, JSON.stringify(e.payload)]);
    }
    return rows
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');
  }
}
