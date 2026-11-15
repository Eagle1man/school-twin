// Дымовой прогон интерфейса против ПОДНЯТОГО сервера.
// Проверяет то, что не проверяют юнит-тесты: что страница реально работает
// в браузере, что данные дошли и что кнопки доводят до чисел.
import { chromium } from 'playwright';

const BASE = process.env.TWIN_URL || 'http://127.0.0.1:8081/';
const errors = [];
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
});
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.scenario-item', { timeout: 15000 });
check('страница загрузилась, сценарии отрисованы', (await page.locator('.scenario-item').count()) === 3);

// Тренажёр, сценарий 1
await page.click('#btn-solve');
await page.waitForSelector('#metric-cards .metric', { timeout: 15000 });
const cards = await page.locator('#metric-cards .metric').allInnerTexts();
check('расчёт выдал четыре показателя', cards.length === 4, cards.join(' | ').replace(/\n/g, ' '));
const missed = await page.locator('#metric-cards .metric').first().locator('.value').innerText();
check('непроведённые занятия — число', /^\d+$/.test(missed.trim()), missed);

const comparisonRows = await page.locator('#comparison-table tbody tr').count();
check('сравнение альтернатив: 6 вариантов', comparisonRows === 6, `строк ${comparisonRows}`);

const runBadge = await page.locator('#run-id').innerText();
check('прогон получил идентификатор', /прогон [0-9a-f]{12}/.test(runBadge), runBadge);

const profileCards = await page.locator('#profile-grid .profile-card').count();
check('маркеры методики отрисованы', profileCards === 6, `карточек ${profileCards}`);

const journalItems = await page.locator('#journal-list li').count();
check('журнал пишет действия', journalItems >= 4, `записей ${journalItems}`);

// Сценарий 3: проверка устаревшего совета
await page.locator('.scenario-item').nth(2).click();
await page.waitForSelector('#assistant-card:not([hidden])');
await page.click('[data-check="rec-1"]');
await page.waitForSelector('[data-rec="rec-1"] .rec-details');
const conflicts = await page.locator('[data-rec="rec-1"] .rec-details li').count();
check('проверка совета нашла расхождения', conflicts > 0, `пунктов ${conflicts}`);

await page.click('[data-accept="rec-1"]');
await page.click('#btn-solve');
await page.waitForSelector('#metric-cards .metric');
await page.waitForTimeout(300);
const violationsText = await page.locator('#violations').innerText();
check('принятие устаревшего совета даёт нарушение', /UNAVAILABLE/.test(violationsText), violationsText.split('\n')[0]?.slice(0, 90));

// Песочница
await page.click('.tab[data-tab="sandbox"]');
await page.waitForSelector('#sandbox-metrics .metric', { timeout: 20000 });
check('песочница считает', (await page.locator('#sandbox-metrics .metric').count()) === 4);
await page.waitForSelector('#timetable tbody tr', { timeout: 15000 });
const timetableRows = await page.locator('#timetable tbody tr').count();
check('расписание класса отрисовано', timetableRows === 7, `строк ${timetableRows}`);
check('нагрузка учителей показана', (await page.locator('#load-table tbody tr').count()) > 0);

// Эксперимент
await page.click('.tab[data-tab="experiment"]');
await page.fill('#repeats', '3');
await page.click('#btn-series');
await page.waitForSelector('#series-table tbody tr', { timeout: 60000 });
const seriesRows = await page.locator('#series-table tbody tr').count();
check('серия прогонов посчитана', seriesRows >= 10, `строк ${seriesRows}`);
check('график серии отрисован', (await page.locator('#series-chart svg').count()) === 1);

// Методика
await page.click('.tab[data-tab="method"]');
check('описание методики на месте', (await page.locator('#method-components .profile-card').count()) === 6);

check('ошибок в консоли нет', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\nИтого: ${results.length - failed.length}/${results.length} проверок пройдено`);
if (failed.length) {
  console.log('Провалено:');
  for (const f of failed) console.log(` - ${f.name}: ${f.detail}`);
  process.exit(1);
}
