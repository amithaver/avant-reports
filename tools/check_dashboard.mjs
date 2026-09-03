/* Проверка расчётов дашборда позиций.
   Берёт настоящий app.js, отрезает блок старта (он про DOM) и прогоняет
   те же функции metrics/movement, что работают в браузере, по файлам data/.
   Запуск:  node tools/check_dashboard.mjs                                */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'otchety', 'pozicii');
const DATA = path.join(DIR, 'data');

const src = fs.readFileSync(path.join(DIR, 'app.js'), 'utf8');
const cut = src.indexOf('/* ══════════════════════════ старт');
if (cut < 0) throw new Error('не нашёл маркер блока старта в app.js');

const mod = new Function(
  'document', 'window', 'localStorage', 'fetch', 'location',
  src.slice(0, cut) + '\nreturn { metrics, movement, moveOf, deltaOf, ctr, setData(k, s) { K = k; S = s; } };'
)({ addEventListener() {}, getElementById: () => null },
  { addEventListener() {} }, { getItem: () => null, setItem() {} },
  () => {}, { protocol: 'http:' });

const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const man = read('index.json');
const K = read(man.keywords);
K.langS = K.lang.idx.map((i) => K.lang.dict[i]);
K.typeS = K.type.idx.map((i) => K.type.dict[i]);
K.themeS = K.theme.idx.map((i) => K.theme.dict[i]);

const S = man.slices.map((m) => {
  const d = read(m.file);
  return { date: m.date, label: m.label, partial: !!m.partial, pos: d.pos,
           url: d.url.idx.map((j) => d.url.dict[j]) };
});
mod.setData(K, S);

const by = Object.fromEntries(S.map((s) => [s.date, s]));
const ALL = [...K.pos ? [] : []].concat([...Array(K.count).keys()]);

let fails = 0;
const eq = (label, got, want, tol = 0) => {
  let ok;
  if (want === null) ok = got === null;
  else if (typeof want === 'number') ok = typeof got === 'number' && Math.abs(got - want) <= tol;
  else ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}: получено ${got}${ok ? '' : `, ожидалось ${want}`}`);
};

console.log('\nП1 · сверка со старой страницей, срез 19.08');
{
  const m = mod.metrics(by['2026-08-19'], ALL);
  eq('в первой сотне', m.ranked, 1136);
  eq('в топ-3', m.top3, 677);
  eq('в топ-10', m.top10, 958);
  eq('средняя позиция', +m.avg.toFixed(2), 6.12, 0.005);
}
console.log('\nП1b · те же метрики на срезах 09.08 и 12.08');
for (const [d, want] of [['2026-08-09', [1153, 670, 968, 6.22]], ['2026-08-12', [1134, 670, 948, 6.10]]]) {
  const m = mod.metrics(by[d], ALL);
  eq(`${d} сотня/топ3/топ10/средняя`,
     `${m.ranked}/${m.top3}/${m.top10}/${m.avg.toFixed(2)}`,
     `${want[0]}/${want[1]}/${want[2]}/${want[3].toFixed(2)}`);
}

console.log('\nП2 · сверка движения');
{
  const a = mod.movement(by['2026-08-09'], by['2026-08-12'], ALL);
  eq('09→12 выросли', a.up, 211); eq('09→12 упали', a.down, 199); eq('09→12 без движения', a.flat, 710);
  const b = mod.movement(by['2026-08-12'], by['2026-08-19'], ALL);
  eq('12→19 выросли', b.up, 224); eq('12→19 упали', b.down, 204); eq('12→19 без движения', b.flat, 692);
}

console.log('\nП3 · целостность разрезов (сумма должна давать 1335)');
for (const [name, arr] of [['направления', K.themeS], ['языки', K.langS], ['типы запроса', K.typeS]]) {
  const c = {};
  arr.forEach((v) => { c[v] = (c[v] || 0) + 1; });
  const sum = Object.values(c).reduce((s, v) => s + v, 0);
  eq(`${name} — групп ${Object.keys(c).length}, сумма`, sum, 1335);
}
eq('фраз с названием города', K.local.reduce((s, v) => s + v, 0), 52);
eq('фраз с нулевой частотностью', K.vol.filter((v) => !v).length, 941);

console.log('\nП4 · произвольная пара 09.08 ↔ 26.08 (не соседние)');
{
  const m = mod.movement(by['2026-08-09'], by['2026-08-26'], ALL);
  const tot = m.up + m.down + m.flat + m.gained + m.lost;
  console.log(`       выросли ${m.up}, упали ${m.down}, без движения ${m.flat}, новые ${m.gained}, выпали ${m.lost}, вне сотни оба раза ${m.none}`);
  eq('пять корзин + «вне сотни оба раза» = 1335', tot + m.none, 1335);
  eq('дельты не нулевые', m.up > 0 && m.down > 0 ? 1 : 0, 1);
}

console.log('\nП6 · граничные случаи');
{
  const a = by['2026-08-12'], b = by['2026-08-19'];
  const gained = [...Array(K.count).keys()].filter((i) => mod.moveOf(i, a, b) === 'gained');
  const lost = [...Array(K.count).keys()].filter((i) => mod.moveOf(i, a, b) === 'lost');
  eq('есть фраза, появившаяся в сотне', gained.length > 0 ? 1 : 0, 1);
  eq('есть фраза, выпавшая из сотни', lost.length > 0 ? 1 : 0, 1);
  console.log(`       пример новой: «${K.kw[gained[0]]}» ${a.pos[gained[0]]} → ${b.pos[gained[0]]}`);
  console.log(`       пример выпавшей: «${K.kw[lost[0]]}» ${a.pos[lost[0]]} → ${b.pos[lost[0]]}`);
  eq('дельта у новой фразы = null (нечего вычитать)', mod.deltaOf(gained[0], a, b), null);

  const zero = [...Array(K.count).keys()].filter((i) => !K.vol[i]);
  const m = mod.metrics(b, zero);
  eq('видимость по 941 фразе с частотностью 0 = null, а не NaN', m.vis, null);
  eq('видимость по всем фразам — конечное число', Number.isFinite(mod.metrics(b, ALL).vis) ? 1 : 0, 1);

  const empty = mod.metrics(b, []);
  eq('пустой набор: средняя = null', empty.avg, null);
  eq('пустой набор: видимость = null', empty.vis, null);

  const one = mod.movement(null, b, ALL);
  eq('один срез в манифесте: движения нет, а не выдуманный ноль', one.nobase ? 1 : 0, 1);
  eq('один срез: ни одна фраза не записана в «без движения»', one.flat, 0);

  const longest = K.kw.reduce((a2, b2) => (b2.length > a2.length ? b2 : a2));
  console.log(`       самая длинная фраза: ${longest.length} симв. — «${longest}»`);
  const apo = K.kw.filter((s) => /['’ʼ]/.test(s));
  console.log(`       фраз с апострофом: ${apo.length}${apo.length ? `, например «${apo[0]}»` : ''}`);

  // кластер, где на срезе не осталось ни одной фразы в сотне
  const groups = {};
  K.themeS.forEach((t, i) => { (groups[t] = groups[t] || []).push(i); });
  const dead = Object.entries(groups).filter(([, idx]) => mod.metrics(b, idx).ranked === 0);
  console.log(`       кластеров без единой фразы в сотне на 19.08: ${dead.length}` +
              (dead.length ? ` (${dead.map(([n]) => n).join(', ')})` : ''));
  const ecdis = [...Array(K.count).keys()].filter((i) => /ecdis|экнис|екніс/i.test(K.kw[i]));
  const outE = ecdis.filter((i) => b.pos[i] == null);
  console.log(`       фраз про ЭКНИС/ECDIS: ${ecdis.length}, из них вне сотни на 19.08: ${outE.length}`);
}

console.log('\nКодировка и целостность файлов');
for (const f of fs.readdirSync(DATA)) {
  const buf = fs.readFileSync(path.join(DATA, f));
  const bom = buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
  if (bom) { fails++; console.log(` FAIL  ${f}: есть BOM`); }
  try { JSON.parse(buf.toString('utf8')); } catch (e) { fails++; console.log(` FAIL  ${f}: ${e.message}`); }
}
if (!fails) console.log('  OK   все файлы data/ — валидный UTF-8 без BOM');

console.log(`\n${fails ? `ПРОВАЛЕНО ПРОВЕРОК: ${fails}` : 'Все проверки пройдены.'}`);
process.exit(fails ? 1 : 0);
