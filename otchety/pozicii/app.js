/* Дашборд позиций tcsavant.com.
   Все цифры считаются здесь, в браузере, из файлов data/. В самих файлах
   лежат только позиции и разметка — ничего предпосчитанного, иначе выбор
   произвольной пары срезов не работал бы.

   Договорённость о данных: позиции нет в первой сотне -> null.
   Частотность 0 (таких 941 из 1335) — не ошибка; взвешенные метрики
   просто не дают таким фразам веса. */

'use strict';

/* ══════════════════════════ мелочи ══════════════════════════ */

var $ = function (id) { return document.getElementById(id); };
var THEME_KEY = 'avant-pozicii-theme';

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function n0(v) { return v == null ? '—' : Math.round(v).toLocaleString('ru-RU'); }
function n1(v) { return v == null ? '—' : v.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
function n2(v) { return v == null ? '—' : v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function sgn(v, fmt) {
  if (v == null || !isFinite(v)) return '—';
  var f = fmt || n0;
  if (Math.abs(v) < 1e-9) return '±0';
  return (v > 0 ? '+' : '−') + f(Math.abs(v));
}
function plural(k, one, few, many) {
  var a = Math.abs(k) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

/* Типовой CTR по позиции. Нужен только для одной метрики — «видимости».
   Кривая усреднённая, точность здесь не важна: метрика сравнительная,
   её смысл — «стало заметнее или нет», а не «столько-то визитов». */
var CTR = [0, .316, .247, .187, .133, .095, .068, .049, .035, .025, .018,
  .014, .012, .010, .009, .008, .007, .006, .006, .005, .005];
function ctr(p) {
  if (p == null) return 0;
  if (p <= 20) return CTR[p] || 0;
  if (p <= 50) return .003;
  if (p <= 100) return .001;
  return 0;
}

/* ══════════════════════════ данные ══════════════════════════ */

var K = null;      // словарь фраз
var S = [];        // срезы по возрастанию даты
var LANGS = { ru: 'Русский', ua: 'Українська', en: 'English' };

var st = {
  now: 0, base: 0,
  metric: 'top10',
  clusterMetric: 'count',
  cluster: null, lang: null, type: null, geo: null,
  tab: 'all',
  q: '',
  sort: 'pos', dir: 1,
  page: 1
};
var PER_PAGE = 50;

function load() {
  var base = 'data/';
  return fetch(base + 'index.json', { cache: 'no-cache' })
    .then(function (r) {
      if (!r.ok) throw new Error('index.json: HTTP ' + r.status);
      return r.json();
    })
    .then(function (man) {
      MAN = man;
      var jobs = [fetch(base + (man.keywords || 'keywords.json')).then(function (r) { return r.json(); })];
      man.slices.forEach(function (s) {
        jobs.push(fetch(base + s.file).then(function (r) {
          if (!r.ok) throw new Error(s.file + ': HTTP ' + r.status);
          return r.json();
        }));
      });
      return Promise.all(jobs);
    })
    .then(function (res) {
      K = res[0];
      K.langS = K.lang.idx.map(function (i) { return K.lang.dict[i]; });
      K.typeS = K.type.idx.map(function (i) { return K.type.dict[i]; });
      K.themeS = K.theme.idx.map(function (i) { return K.theme.dict[i]; });

      S = MAN.slices.map(function (m, i) {
        var d = res[i + 1];
        return {
          date: m.date,
          label: m.label || m.date,
          partial: !!m.partial,
          pos: d.pos,
          url: d.url.idx.map(function (j) { return d.url.dict[j]; })
        };
      });
      S.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    });
}
var MAN = null;

/* ══════════════════════════ счёт ══════════════════════════ */

function allIdx() {
  var a = [], i;
  for (i = 0; i < K.count; i++) a.push(i);
  return a;
}

/* Метрики по набору фраз на одном срезе. */
function metrics(sl, idx) {
  var top3 = 0, top10 = 0, ranked = 0, sum = 0, wv = 0, wt = 0;
  for (var j = 0; j < idx.length; j++) {
    var i = idx[j], p = sl.pos[i], v = K.vol[i];
    if (p != null) { ranked++; sum += p; if (p <= 3) top3++; if (p <= 10) top10++; }
    if (v > 0) { wt += v; wv += v * ctr(p); }
  }
  return {
    top3: top3, top10: top10, ranked: ranked,
    total: idx.length,
    avg: ranked ? sum / ranked : null,
    // делить на ноль нечем: у фраз с частотностью 0 веса нет вовсе
    vis: wt > 0 ? (wv / wt) * 100 : null
  };
}

/* Движение фраз между двумя срезами.
   Пять корзин покрывают только те фразы, что были в сотне хотя бы на одном
   из двух срезов. Остальные попадают в `none` — их надо показывать отдельно,
   иначе у читателя не сойдётся сумма. */
function movement(a, b, idx) {
  var r = { up: 0, down: 0, flat: 0, gained: 0, lost: 0, none: 0, upSum: 0, downSum: 0 };
  if (!a || a === b) { r.none = idx.length; r.nobase = true; return r; }
  for (var j = 0; j < idx.length; j++) {
    var i = idx[j], x = a.pos[i], y = b.pos[i];
    if (x != null && y != null) {
      if (y < x) { r.up++; r.upSum += x - y; }
      else if (y > x) { r.down++; r.downSum += y - x; }
      else r.flat++;
    } else if (y != null) r.gained++;
    else if (x != null) r.lost++;
    else r.none++;
  }
  return r;
}

/* Класс движения одной фразы: up / down / flat / gained / lost / none */
function moveOf(i, a, b) {
  var x = a ? a.pos[i] : null, y = b.pos[i];
  if (x != null && y != null) return y < x ? 'up' : (y > x ? 'down' : 'flat');
  if (y != null) return a ? 'gained' : 'flat';
  if (x != null) return 'lost';
  return 'none';
}
function deltaOf(i, a, b) {
  if (!a) return null;
  var x = a.pos[i], y = b.pos[i];
  if (x == null || y == null) return null;
  return x - y;                       // >0 значит поднялись
}

/* Индексы, прошедшие текущие фильтры (без поиска и без вкладок). */
function filtered() {
  var out = [];
  for (var i = 0; i < K.count; i++) {
    if (st.cluster && K.themeS[i] !== st.cluster) continue;
    if (st.lang && K.langS[i] !== st.lang) continue;
    if (st.type && K.typeS[i] !== st.type) continue;
    if (st.geo === 'local' && !K.local[i]) continue;
    if (st.geo === 'nolocal' && K.local[i]) continue;
    out.push(i);
  }
  return out;
}

function isNarrow() { return window.innerWidth < 760; }

function nowSlice() { return S[st.now]; }
function baseSlice() { return st.base === st.now ? null : S[st.base]; }

/* ══════════════════════════ отрисовка ══════════════════════════ */

function renderAll(flash) {
  var app = $('app');
  renderPeriod();
  renderWarnings();
  renderKpis();
  renderChart();
  renderMoves();
  renderClusters();
  renderCuts();
  renderFilters();
  renderTable();
  if (flash) {
    app.classList.remove('flash');
    void app.offsetWidth;
    app.classList.add('flash');
  }
}

/* ── строка периода ── */
function renderPeriod() {
  var a = baseSlice(), b = nowSlice();
  var h = '<span class="pill pill--now"><i class="pill__dot"></i>Срез ' + esc(b.label) + '</span>';
  if (a) {
    h += '<span style="color:var(--muted)">против</span>' +
      '<span class="pill pill--base"><i class="pill__dot"></i>' + esc(a.label) + '</span>';
    var days = Math.round((new Date(b.date) - new Date(a.date)) / 864e5);
    h += '<span style="color:var(--muted)">интервал ' + Math.abs(days) + ' ' +
      plural(Math.abs(days), 'день', 'дня', 'дней') + '</span>';
  } else {
    h += '<span style="color:var(--muted)">сравнивать не с чем — это единственный срез в наборе</span>';
  }
  $('periodLine').innerHTML = h;
}

function renderWarnings() {
  var w = [];
  [baseSlice(), nowSlice()].forEach(function (s) {
    if (s && s.partial) {
      var m = metrics(s, allIdx());
      w.push('Срез <b>' + esc(s.label) + '</b> неполный: позиции сняты у ' + n0(m.ranked) +
        ' фраз из ' + n0(K.count) + '. Для сравнения он не годится — цифры будут ложными.');
    }
  });
  $('warnings').innerHTML = w.map(function (t) {
    return '<div class="warn"><span>⚠</span><span>' + t + '</span></div>';
  }).join('');
}

/* ── плитки ── */
var KPI_DEFS = [
  { k: 'top3', l: 'В тройке', hero: true, fmt: n0, good: 1, hint: 'Фразы на позициях 1–3. Это места, которые реально приносят переходы.' },
  { k: 'top10', l: 'В десятке', fmt: n0, good: 1, hint: 'Фразы на позициях 1–10, то есть на первой странице выдачи.' },
  { k: 'ranked', l: 'В первой сотне', fmt: n0, good: 1, hint: 'Фразы, по которым сайт вообще найден в первой сотне результатов. Остальные — за её пределами.' },
  { k: 'avg', l: 'Средняя позиция', fmt: n2, good: -1, hint: 'Среднее по фразам, которые попали в первую сотню. Чем меньше, тем лучше.' },
  { k: 'vis', l: 'Видимость', fmt: n1, suffix: ' %', good: 1, hint: 'Позиции, взвешенные по частотности запроса и типовому CTR. 100 % — все запросы на первом месте. У 941 фразы частотность нулевая, веса они не дают.' }
];

function renderKpis() {
  var idx = allIdx();
  var mNow = metrics(nowSlice(), idx);
  var a = baseSlice();
  var mBase = a ? metrics(a, idx) : null;

  $('kpis').innerHTML = KPI_DEFS.map(function (d) {
    var v = mNow[d.k];
    var dv = mBase && v != null && mBase[d.k] != null ? v - mBase[d.k] : null;
    var cls = 'same';
    if (dv != null && Math.abs(dv) > 1e-9) cls = (dv * d.good > 0) ? 'up' : 'down';
    var arrow = dv == null || Math.abs(dv) < 1e-9 ? '' : (dv > 0 ? '↑' : '↓');
    var dtxt = mBase
      ? '<span class="' + cls + '">' + arrow + ' ' + sgn(dv, d.fmt) + '</span>' +
        '<span class="kpi__note">к ' + esc(a.label) + '</span>'
      : '<span class="kpi__note">не с чем сравнить</span>';
    return '<div class="kpi' + (d.hero ? ' kpi--hero' : '') + '">' +
      '<div class="kpi__l">' + esc(d.l) +
        '<span class="hint" data-tip="' + esc(d.hint) + '">?</span></div>' +
      '<div class="kpi__v num" data-count="' + (v == null ? '' : v) + '">' +
        (v == null ? '—' : d.fmt(v) + (d.suffix || '')) + '</div>' +
      '<div class="kpi__d">' + dtxt + '</div>' +
    '</div>';
  }).join('');
}

/* ── график истории ── */
var CHART_METRICS = [
  { k: 'top3', l: 'В тройке', fmt: n0, invert: false },
  { k: 'top10', l: 'В десятке', fmt: n0, invert: false },
  { k: 'ranked', l: 'В сотне', fmt: n0, invert: false },
  { k: 'avg', l: 'Средняя позиция', fmt: n2, invert: true },
  { k: 'vis', l: 'Видимость', fmt: n1, invert: false, suffix: ' %' }
];

function renderChart() {
  $('chartTabs').innerHTML = CHART_METRICS.map(function (m) {
    return '<button class="tab' + (m.k === st.metric ? ' is-on' : '') +
      '" data-metric="' + m.k + '" type="button">' + esc(m.l) + '</button>';
  }).join('');

  var def = CHART_METRICS.filter(function (m) { return m.k === st.metric; })[0];
  var idx = allIdx();
  /* Неполные срезы на график не идут: 242 фразы против 1135 сплющивают
     ось так, что настоящая динамика превращается в прямую линию. Точка
     никуда не девается — срез остаётся в выпадающем списке, а под графиком
     стоит подпись, что именно не показано. */
  var pts = S.map(function (s) {
    return { s: s, v: s.partial ? null : metrics(s, idx)[def.k], skipped: s.partial };
  });
  var real = pts.filter(function (p) { return p.v != null; });
  if (!real.length) { $('chart').innerHTML = '<div class="empty">Нет данных для графика.</div>'; return; }

  /* На телефоне viewBox 1000×280 ужимается втрое и подписи осей становятся
     нечитаемыми. Поэтому у узкого экрана своя геометрия: холст меньше,
     шрифт внутри — крупнее, часть подписей по оси X пропускается. */
  var narrow = isNarrow();
  var W = narrow ? 520 : 1000, H = narrow ? 330 : 280;
  var PL = narrow ? 52 : 54, PR = narrow ? 10 : 18;
  var PT = narrow ? 16 : 22, PB = narrow ? 46 : 40;
  var FS = narrow ? 17 : 12;
  var iw = W - PL - PR, ih = H - PT - PB;
  var vals = real.map(function (p) { return p.v; });
  var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
  if (hi === lo) { hi = lo + Math.max(1, Math.abs(lo) * .05); lo = lo - Math.max(1, Math.abs(lo) * .05); }
  var pad = (hi - lo) * .3; lo -= pad; hi += pad;
  if (def.k !== 'avg' && lo < 0) lo = 0;

  // круглые деления оси: 940, 950, 960 читаются, 1103 / 848 / 593 — нет
  var TN = 4;
  var raw = (hi - lo) / TN;
  var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
  var step = [1, 2, 2.5, 5, 10].filter(function (m) { return m * mag >= raw; })[0] * mag;
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  if (def.k !== 'avg' && lo < 0) lo = 0;

  var X = function (i) { return PL + (S.length === 1 ? iw / 2 : iw * i / (S.length - 1)); };
  var Y = function (v) {
    var t = (v - lo) / (hi - lo);
    return PT + (def.invert ? t * ih : (1 - t) * ih);
  };

  var ticks = [], t;
  for (t = lo; t <= hi + step / 1e6; t += step) ticks.push(+t.toFixed(10));

  var g = [];
  g.push('<defs><linearGradient id="fillg" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0%" stop-color="var(--navy)" stop-opacity=".22"/>' +
    '<stop offset="100%" stop-color="var(--navy)" stop-opacity="0"/></linearGradient></defs>');

  ticks.forEach(function (v) {
    var y = Y(v);
    g.push('<line x1="' + PL + '" y1="' + y.toFixed(1) + '" x2="' + (W - PR) + '" y2="' + y.toFixed(1) +
      '" stroke="var(--line)" stroke-width="1"/>');
    g.push('<text x="' + (PL - 8) + '" y="' + (y + FS * .35).toFixed(1) + '" text-anchor="end" ' +
      'font-size="' + FS + '" fill="var(--muted)">' + esc(def.fmt(v)) + '</text>');
  });

  // ломаная: разрывается там, где значения нет
  var segs = [], cur = [];
  pts.forEach(function (p, i) {
    if (p.v == null) { if (cur.length) segs.push(cur); cur = []; return; }
    cur.push([X(i), Y(p.v), p.s.partial]);
  });
  if (cur.length) segs.push(cur);

  segs.forEach(function (seg) {
    if (seg.length > 1) {
      var area = 'M' + seg.map(function (p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' L ') +
        ' L ' + seg[seg.length - 1][0].toFixed(1) + ' ' + (PT + ih) + ' L ' + seg[0][0].toFixed(1) + ' ' + (PT + ih) + ' Z';
      g.push('<path d="' + area + '" fill="url(#fillg)"/>');
    }
    for (var i = 1; i < seg.length; i++) {
      var dashed = seg[i][2] || seg[i - 1][2];
      g.push('<line x1="' + seg[i - 1][0].toFixed(1) + '" y1="' + seg[i - 1][1].toFixed(1) +
        '" x2="' + seg[i][0].toFixed(1) + '" y2="' + seg[i][1].toFixed(1) +
        '" stroke="var(--navy)" stroke-width="2.5" stroke-linecap="round"' +
        (dashed ? ' stroke-dasharray="5 5" opacity=".55"' : '') + '/>');
    }
  });

  // на узком экране подписи налезают друг на друга — оставляем каждую вторую,
  // выбранный срез и края показываем всегда
  var everyN = narrow && S.length > 3 ? 2 : 1;
  pts.forEach(function (p, i) {
    var x = X(i);
    var showLabel = i % everyN === 0 || i === st.now || i === S.length - 1;
    if (showLabel) {
      g.push('<text x="' + x.toFixed(1) + '" y="' + (H - PB / 3) + '" text-anchor="middle" ' +
        'font-size="' + FS + '" fill="' + (i === st.now ? 'var(--ink)' : 'var(--muted)') + '"' +
        (i === st.now ? ' font-weight="650"' : '') + '>' + esc(p.s.label) + '</text>');
    }
    if (p.v == null) return;
    var y = Y(p.v);
    if (i === st.now) {
      g.push('<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (narrow ? 11 : 9) + '" fill="var(--gold)" opacity=".28"/>');
      g.push('<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (narrow ? 7 : 5.5) + '" fill="var(--gold)" stroke="var(--surface)" stroke-width="2"/>');
    } else if (i === st.base && st.base !== st.now) {
      g.push('<rect x="' + (x - 5).toFixed(1) + '" y="' + (y - 5).toFixed(1) + '" width="10" height="10" ' +
        'transform="rotate(45 ' + x.toFixed(1) + ' ' + y.toFixed(1) + ')" fill="var(--navy)" stroke="var(--surface)" stroke-width="2"/>');
    } else {
      g.push('<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="4" fill="var(--surface)" stroke="var(--navy)" stroke-width="2"' +
        (p.s.partial ? ' stroke-dasharray="2 2"' : '') + '/>');
    }
  });

  // прозрачные зоны наведения
  pts.forEach(function (p, i) {
    var x = X(i), half = S.length > 1 ? iw / (S.length - 1) / 2 : iw / 2;
    var prev = p.v == null ? null : (i > 0 ? pts[i - 1].v : null);
    var d = (p.v != null && prev != null) ? p.v - prev : null;
    var dtxt = d == null ? '' : '<br>к прошлому съёму: ' + sgn(d, def.fmt);
    var tip = p.skipped
      ? '<b>' + esc(p.s.label) + '</b><br>неполный съём — на графике не показан'
      : '<b>' + esc(p.s.label) + '</b><br>' + esc(def.l) + ': ' +
        (p.v == null ? '—' : esc(def.fmt(p.v) + (def.suffix || ''))) + dtxt;
    g.push('<rect x="' + (x - half).toFixed(1) + '" y="' + PT + '" width="' + (half * 2).toFixed(1) +
      '" height="' + ih + '" fill="transparent" style="cursor:pointer" data-slice="' + i +
      '" data-tip="' + esc(tip) + '"/>');
  });

  var skipped = pts.filter(function (p) { return p.skipped; });
  var note = skipped.length
    ? '<p class="movenote">На графике не показаны неполные съёмы: ' +
      skipped.map(function (p) { return esc(p.s.label); }).join(', ') +
      '. Данных там слишком мало, кривую они искажают. Выбрать такой срез в шапке всё равно можно.</p>'
    : '';

  $('chart').innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" ' +
    'aria-label="История метрики «' + esc(def.l) + '» по всем срезам">' + g.join('') + '</svg>' + note;
}

/* ── движение ── */
var MOVE_DEFS = [
  { k: 'up', l: 'выросли', c: 'var(--good)', tab: 'up' },
  { k: 'down', l: 'упали', c: 'var(--bad)', tab: 'down' },
  { k: 'flat', l: 'без движения', c: 'var(--flat)', tab: 'flat' },
  { k: 'gained', l: 'появились в сотне', c: 'var(--gold-2)', tab: 'gained' },
  { k: 'lost', l: 'выпали из сотни', c: 'var(--navy-2)', tab: 'lost' }
];

function renderMoves() {
  var a = baseSlice(), b = nowSlice();
  var m = movement(a, b, allIdx());
  $('movePeriod').textContent = a
    ? 'С ' + a.label + ' по ' + b.label + '. Клик по числу отбирает эти фразы в таблице.'
    : 'Выбран один срез — движение показать не с чем.';

  $('moves').innerHTML = MOVE_DEFS.map(function (d) {
    var v = m[d.k] || 0;
    return '<button class="move" type="button" data-tab="' + d.tab + '"' +
      (m.nobase ? ' disabled' : '') + '>' +
      '<div class="move__v num" style="color:' + (m.nobase ? 'var(--muted)' : d.c) + '">' +
      (m.nobase ? '—' : n0(v)) + '</div>' +
      '<div class="move__l">' + esc(d.l) + '</div></button>';
  }).join('');

  var tot = MOVE_DEFS.reduce(function (s, d) { return s + (m[d.k] || 0); }, 0) || 1;
  $('moveStack').innerHTML = m.nobase ? '' : MOVE_DEFS.map(function (d) {
    var v = m[d.k] || 0;
    if (!v) return '';
    return '<i style="width:' + (v / tot * 100).toFixed(2) + '%;background:' + d.c + '" ' +
      'title="' + esc(d.l + ': ' + n0(v)) + '"></i>';
  }).join('');

  // сумма пяти корзин меньше числа фраз: остальные не были в сотне ни разу
  var rest = $('moveRest');
  rest.textContent = (!m.nobase && m.none)
    ? 'Сумма выше — ' + n0(tot) + '. Остальные ' + n0(m.none) + ' ' +
      plural(m.none, 'фраза', 'фразы', 'фраз') + ' не попали в первую сотню ни на одном из двух срезов, ' +
      'поэтому движения у них нет.'
    : '';
}

/* ── направления ── */
function renderClusters() {
  $('clusterTabs').innerHTML =
    '<button class="tab' + (st.clusterMetric === 'count' ? ' is-on' : '') + '" data-cm="count" type="button">по числу фраз</button>' +
    '<button class="tab' + (st.clusterMetric === 'vol' ? ' is-on' : '') + '" data-cm="vol" type="button">по частотности</button>';

  var a = baseSlice(), b = nowSlice();
  var groups = {};
  for (var i = 0; i < K.count; i++) {
    var t = K.themeS[i];
    (groups[t] = groups[t] || []).push(i);
  }
  var rows = Object.keys(groups).map(function (name) {
    var idx = groups[name];
    var mv = movement(a, b, idx);
    var mNow = metrics(b, idx);
    var mBase = a ? metrics(a, idx) : null;
    var vol = idx.reduce(function (s, i) { return s + K.vol[i]; }, 0);
    return {
      name: name, idx: idx, count: idx.length, vol: vol,
      mv: mv, top10: mNow.top10, ranked: mNow.ranked,
      dTop10: mBase ? mNow.top10 - mBase.top10 : null
    };
  });
  var key = st.clusterMetric === 'vol' ? 'vol' : 'count';
  rows.sort(function (x, y) { return y[key] - x[key]; });
  var max = Math.max.apply(null, rows.map(function (r) { return r[key]; })) || 1;

  var head = '<div class="cl cl--head">' +
    '<div>Направление</div><div>Движение фраз за период</div>' +
    '<div class="cl__num">Фраз</div><div class="cl__num cl__num--vol">Частот.</div>' +
    '<div class="cl__num">В десятке</div></div>';

  $('clusters').innerHTML = head + rows.map(function (r) {
    var tot = r.count || 1;
    var seg = [
      ['up', r.mv.up, 'var(--good)'], ['flat', r.mv.flat, 'var(--flat)'],
      ['gained', r.mv.gained, 'var(--gold-2)'], ['lost', r.mv.lost, 'var(--navy-2)'],
      ['down', r.mv.down, 'var(--bad)']
    ].filter(function (s) { return s[1] > 0; });
    var scale = r[key] / max;
    var bar = '<div class="cl__bar" style="width:' + Math.max(8, scale * 100).toFixed(1) + '%">' +
      seg.map(function (s) {
        return '<i style="width:' + (s[1] / tot * 100).toFixed(2) + '%;background:' + s[2] + '"></i>';
      }).join('') + '</div>';
    var dcls = r.dTop10 == null || r.dTop10 === 0 ? 'same' : (r.dTop10 > 0 ? 'up' : 'down');
    var tip = r.name + ': выросли ' + r.mv.up + ', упали ' + r.mv.down + ', без движения ' + r.mv.flat +
      (r.mv.gained ? ', появились ' + r.mv.gained : '') + (r.mv.lost ? ', выпали ' + r.mv.lost : '') +
      (r.mv.none ? ', вне сотни оба раза ' + r.mv.none + ' (бледный хвост полосы)' : '') +
      '. В первой сотне ' + r.ranked + ' из ' + r.count + '.';
    return '<button class="cl' + (st.cluster === r.name ? ' is-on' : '') + '" type="button" ' +
      'data-cluster="' + esc(r.name) + '" data-tip="' + esc(tip) + '">' +
      '<div class="cl__n">' + esc(r.name) + '</div>' + bar +
      '<div class="cl__num num">' + n0(r.count) + '</div>' +
      '<div class="cl__num cl__num--vol num">' + n0(r.vol) + '</div>' +
      '<div class="cl__mv"><span class="num">' + n0(r.top10) + '</span>' +
      (r.dTop10 == null ? '' : '<span class="' + dcls + ' num">' + sgn(r.dTop10) + '</span>') +
      '</div></button>';
  }).join('');
}

/* ── разрезы ── */
function segBlock(items, kind) {
  var max = Math.max.apply(null, items.map(function (it) { return it.count; })) || 1;
  return items.map(function (it) {
    var on = st[kind] === it.key;
    var dcls = it.d == null || it.d === 0 ? 'same' : (it.d > 0 ? 'up' : 'down');
    return '<button class="seg' + (on ? ' is-on' : '') + '" type="button" data-cut="' + kind +
      '" data-key="' + esc(it.key) + '">' +
      '<span class="seg__n">' + esc(it.label) + '</span>' +
      '<span class="seg__c num">' + n0(it.count) + ' ' + plural(it.count, 'фраза', 'фразы', 'фраз') + '</span>' +
      '<span class="seg__b"><i style="width:' + (it.count / max * 100).toFixed(1) + '%"></i></span>' +
      '<span class="seg__m">в десятке <b class="num">' + n0(it.top10) + '</b>' +
        (it.d == null ? '' : ' <span class="' + dcls + ' num">' + sgn(it.d) + '</span>') +
        ' · средняя <b class="num">' + n2(it.avg) + '</b></span>' +
    '</button>';
  }).join('');
}

function cutItems(keyer, keys, labels) {
  var a = baseSlice(), b = nowSlice();
  return keys.map(function (k) {
    var idx = [];
    for (var i = 0; i < K.count; i++) if (keyer(i) === k) idx.push(i);
    var mNow = metrics(b, idx), mBase = a ? metrics(a, idx) : null;
    return {
      key: k, label: labels[k] || k, count: idx.length,
      top10: mNow.top10, avg: mNow.avg,
      d: mBase ? mNow.top10 - mBase.top10 : null
    };
  }).filter(function (it) { return it.count > 0; })
    .sort(function (x, y) { return y.count - x.count; });
}

function renderCuts() {
  $('cutLang').innerHTML = segBlock(
    cutItems(function (i) { return K.langS[i]; }, K.lang.dict, LANGS), 'lang');

  $('cutType').innerHTML = segBlock(
    cutItems(function (i) { return K.typeS[i]; }, K.type.dict, {
      'комм': 'Коммерческие', 'инфо': 'Информационные', 'бренд': 'Брендовые', 'навиг': 'Навигационные'
    }), 'type');

  $('cutGeo').innerHTML = segBlock(
    cutItems(function (i) { return K.local[i] ? 'local' : 'nolocal'; }, ['local', 'nolocal'], {
      local: 'С названием города', nolocal: 'Без названия города'
    }), 'geo');
}

/* ── активные фильтры ── */
function renderFilters() {
  var chips = [];
  if (st.cluster) chips.push(['cluster', 'Направление: ' + st.cluster]);
  if (st.lang) chips.push(['lang', 'Язык: ' + (LANGS[st.lang] || st.lang)]);
  if (st.type) chips.push(['type', 'Тип: ' + st.type]);
  if (st.geo) chips.push(['geo', st.geo === 'local' ? 'С названием города' : 'Без названия города']);

  var el = $('filters');
  if (!chips.length) {
    el.innerHTML = '<span class="filters__l">Фильтров нет — показаны все ' + n0(K.count) + ' фраз. ' +
      'Кликните направление или разрез выше.</span>';
    return;
  }
  el.innerHTML = '<span class="filters__l">Отбор:</span>' +
    chips.map(function (c) {
      return '<button class="chip" type="button" data-drop="' + c[0] + '">' + esc(c[1]) +
        '<span class="chip__x">×</span></button>';
    }).join('') +
    '<button class="chip chip--clear" type="button" data-drop="all">снять всё</button>';
}

/* ── таблица ── */
var COLS = [
  { k: 'kw', l: 'Фраза', cls: 'c-kw' },
  { k: 'lang', l: 'Яз.', cls: '' },
  { k: 'theme', l: 'Направление', cls: '' },
  { k: 'pos', l: 'Позиция', cls: 'c-num' },
  { k: 'delta', l: 'Δ', cls: 'c-num' },
  { k: 'hist', l: 'История', cls: 'c-spark', nosort: true },
  { k: 'vol', l: 'Частот.', cls: 'c-num' },
  { k: 'url', l: 'Посадочная', cls: 'c-url' }
];
var TABS = [
  { k: 'all', l: 'Все' }, { k: 'up', l: 'Выросли' }, { k: 'down', l: 'Упали' },
  { k: 'flat', l: 'Без движения' }, { k: 'gained', l: 'Новые в сотне' }, { k: 'lost', l: 'Выпали' }
];

function sparkline(i) {
  var W = 96, H = 24, P = 3;
  var pts = S.map(function (s) { return s.pos[i]; });
  var has = pts.filter(function (p) { return p != null; });
  if (!has.length) return '<svg width="' + W + '" height="' + H + '"></svg>';
  // корневая шкала 1..100: разница между 3-м и 8-м местом видна, хвост не давит
  var Y = function (p) {
    var t = (Math.sqrt(p) - 1) / (Math.sqrt(100) - 1);
    return P + t * (H - P * 2);
  };
  var X = function (k) { return P + (S.length === 1 ? (W - P * 2) / 2 : (W - P * 2) * k / (S.length - 1)); };
  var g = [], segs = [], cur = [];
  pts.forEach(function (p, k) {
    if (p == null) { if (cur.length) segs.push(cur); cur = []; return; }
    cur.push([X(k), Y(p)]);
  });
  if (cur.length) segs.push(cur);
  segs.forEach(function (seg) {
    if (seg.length > 1) {
      g.push('<polyline points="' + seg.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ') +
        '" fill="none" stroke="var(--navy)" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>');
    }
  });
  pts.forEach(function (p, k) {
    // где замера нет — просто разрыв линии; точка внизу читалась бы как провал
    if (p == null) return;
    var last = k === st.now;
    g.push('<circle cx="' + X(k).toFixed(1) + '" cy="' + Y(p).toFixed(1) + '" r="' + (last ? 2.8 : 1.6) +
      '" fill="' + (last ? 'var(--gold)' : 'var(--navy)') + '"/>');
  });
  return '<svg width="' + W + '" height="' + H + '" aria-hidden="true">' + g.join('') + '</svg>';
}

function tableRows() {
  var a = baseSlice(), b = nowSlice();
  var rows = filtered().filter(function (i) {
    if (st.q && K.kw[i].toLowerCase().indexOf(st.q) === -1) return false;
    if (st.tab === 'all') return true;
    return moveOf(i, a, b) === st.tab;
  });

  var dir = st.dir;
  rows.sort(function (x, y) {
    var vx, vy;
    switch (st.sort) {
      case 'kw': return dir * K.kw[x].localeCompare(K.kw[y], 'ru');
      case 'lang': return dir * K.langS[x].localeCompare(K.langS[y]);
      case 'theme': return dir * K.themeS[x].localeCompare(K.themeS[y], 'ru');
      case 'vol': vx = K.vol[x]; vy = K.vol[y]; break;
      case 'url': return dir * (b.url[x] || '~').localeCompare(b.url[y] || '~', 'ru');
      case 'delta':
        vx = deltaOf(x, a, b); vy = deltaOf(y, a, b);
        if (vx == null && vy == null) return 0;
        if (vx == null) return 1;         // «нет дельты» всегда в хвост
        if (vy == null) return -1;
        break;
      default:
        vx = b.pos[x]; vy = b.pos[y];
        if (vx == null && vy == null) return 0;
        if (vx == null) return 1;         // «не в сотне» всегда в хвост
        if (vy == null) return -1;
    }
    return dir * (vx - vy);
  });
  return rows;
}

function renderTable() {
  // без базы сравнения вкладки движения смысла не имеют — их просто нет
  var hasBase = !!baseSlice();
  if (!hasBase) st.tab = 'all';
  $('tableTabs').innerHTML = TABS.filter(function (t) { return hasBase || t.k === 'all'; })
    .map(function (t) {
      return '<button class="tab' + (t.k === st.tab ? ' is-on' : '') + '" data-ttab="' + t.k + '" type="button">' +
        esc(t.l) + '</button>';
    }).join('');

  $('thead').innerHTML = COLS.map(function (c) {
    var on = st.sort === c.k;
    return '<th class="' + c.cls + '"' + (c.nosort ? '' : ' data-sort="' + c.k + '"') +
      (on ? ' aria-sort="' + (st.dir === 1 ? 'ascending' : 'descending') + '"' : '') + '>' +
      esc(c.l) + (on ? ' <span class="ar">' + (st.dir === 1 ? '▲' : '▼') + '</span>' : '') + '</th>';
  }).join('');

  var a = baseSlice(), b = nowSlice();
  var rows = tableRows();
  var pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  if (st.page > pages) st.page = pages;
  var from = (st.page - 1) * PER_PAGE;
  var slice = rows.slice(from, from + PER_PAGE);

  $('tableCount').textContent = rows.length === K.count
    ? 'Все ' + n0(K.count) + ' отслеживаемых фраз.'
    : n0(rows.length) + ' ' + plural(rows.length, 'фраза', 'фразы', 'фраз') + ' из ' + n0(K.count) + ' по текущему отбору.';

  if (!slice.length) {
    $('tbody').innerHTML = '<tr><td colspan="' + COLS.length + '"><div class="empty">' +
      'По такому отбору фраз нет. Снимите часть фильтров или очистите поиск.</div></td></tr>';
  } else {
    $('tbody').innerHTML = slice.map(function (i) {
      var p = b.pos[i], d = deltaOf(i, a, b), mv = moveOf(i, a, b);
      var badge;
      if (mv === 'gained') badge = '<span class="badge badge--up">новая</span>';
      else if (mv === 'lost') badge = '<span class="badge badge--down">выпала</span>';
      else if (d == null || d === 0) badge = '<span class="badge badge--flat">0</span>';
      else badge = '<span class="badge badge--' + (d > 0 ? 'up' : 'down') + '">' + (d > 0 ? '↑' : '↓') + ' ' + Math.abs(d) + '</span>';

      var u = b.url[i];
      var lang = K.langS[i];
      return '<tr>' +
        '<td class="c-kw"><span title="' + esc(K.kw[i]) + '">' + esc(K.kw[i]) + '</span></td>' +
        '<td><span class="tag tag--' + esc(lang) + '">' + esc(lang) + '</span></td>' +
        '<td>' + esc(K.themeS[i]) + '</td>' +
        '<td class="c-num num">' + (p == null ? '<span class="same">не в сотне</span>' : p) + '</td>' +
        '<td class="c-num">' + badge + '</td>' +
        '<td class="c-spark">' + sparkline(i) + '</td>' +
        '<td class="c-num num">' + n0(K.vol[i]) + '</td>' +
        '<td class="c-url">' + (u
          ? '<a href="https://tcsavant.com' + esc(u) + '" target="_blank" rel="noopener" title="' + esc(u) + '">' + esc(u) + '</a>'
          : '<span class="same">—</span>') + '</td>' +
      '</tr>';
    }).join('');
  }

  $('pagerInfo').textContent = rows.length
    ? 'Показаны ' + n0(from + 1) + '–' + n0(Math.min(from + PER_PAGE, rows.length)) + ' из ' + n0(rows.length)
    : '';

  var btns = ['<button class="pgbtn" data-page="' + (st.page - 1) + '"' + (st.page === 1 ? ' disabled' : '') + '>‹</button>'];
  var list = pageList(st.page, pages);
  list.forEach(function (p) {
    btns.push(p === '…'
      ? '<span class="pager__i" style="padding:6px 2px">…</span>'
      : '<button class="pgbtn' + (p === st.page ? ' is-on' : '') + '" data-page="' + p + '">' + p + '</button>');
  });
  btns.push('<button class="pgbtn" data-page="' + (st.page + 1) + '"' + (st.page === pages ? ' disabled' : '') + '>›</button>');
  $('pagerBtns').innerHTML = btns.join('');
}

function pageList(cur, total) {
  if (total <= 7) { var a = [], i; for (i = 1; i <= total; i++) a.push(i); return a; }
  var out = [1];
  if (cur > 3) out.push('…');
  for (var p = Math.max(2, cur - 1); p <= Math.min(total - 1, cur + 1); p++) out.push(p);
  if (cur < total - 2) out.push('…');
  out.push(total);
  return out;
}

/* ══════════════════════════ подвал ══════════════════════════ */

function renderFoot() {
  var last = S[S.length - 1];
  $('foot').innerHTML =
    'Источник — Serpstat Rank Tracker, проект ' + esc(MAN.project || '') +
    ', регион ' + esc(MAN.region || '—') + '. Съём еженедельный, по средам. ' +
    'В наборе ' + S.length + ' ' + plural(S.length, 'срез', 'среза', 'срезов') +
    ', последний — ' + esc(last.label) + '. Отслеживается ' + n0(K.count) + ' фраз.<br>' +
    'Позиции показаны как есть: где данных нет, там пусто — ничего не достраивается и не усредняется. ' +
    'Все цифры страница считает сама из файлов <code>data/</code> в момент открытия.';
  $('brandSub').textContent = (MAN.project || '') + ' · ' + n0(K.count) + ' фраз · регион: ' + (MAN.region || '—');
}

/* ══════════════════════════ события ══════════════════════════ */

function fillSelectors() {
  var opt = function (s, i) {
    return '<option value="' + i + '">' + esc(s.label) + (s.partial ? ' · неполный' : '') + '</option>';
  };
  $('selNow').innerHTML = S.map(opt).join('');
  var baseOpts = S.map(function (s, i) {
    return '<option value="' + i + '"' + (i === st.now ? ' disabled' : '') + '>' +
      esc(s.label) + (s.partial ? ' · неполный' : '') + '</option>';
  });
  $('selBase').innerHTML = baseOpts.join('');
  $('selNow').value = st.now;
  $('selBase').value = st.base;
}

function tipShow(el, html) {
  var t = $('tip');
  t.innerHTML = html;
  t.classList.add('is-on');
  var r = el.getBoundingClientRect();
  var w = t.offsetWidth, h = t.offsetHeight;
  var x = Math.min(window.innerWidth - w - 10, Math.max(10, r.left + r.width / 2 - w / 2));
  var y = r.top - h - 9;
  if (y < 8) y = r.bottom + 9;
  t.style.left = x + 'px';
  t.style.top = y + 'px';
}
function tipHide() { $('tip').classList.remove('is-on'); }

function scrollToTable() {
  var el = $('tableTabs');
  if (el) el.scrollIntoView({ block: 'center' });
}

function wire() {
  $('selNow').addEventListener('change', function () {
    st.now = +this.value;
    if (st.base === st.now) st.base = st.now > 0 ? st.now - 1 : (S.length > 1 ? 1 : st.now);
    st.page = 1;
    fillSelectors();
    renderAll(true);
  });
  $('selBase').addEventListener('change', function () {
    st.base = +this.value;
    st.page = 1;
    renderAll(true);
  });

  $('btnTheme').addEventListener('click', function () {
    var next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
  });

  $('search').addEventListener('input', function () {
    st.q = this.value.trim().toLowerCase();
    st.page = 1;
    renderTable();
  });

  document.addEventListener('click', function (e) {
    var t;

    if ((t = e.target.closest('[data-metric]'))) { st.metric = t.dataset.metric; renderChart(); return; }
    if ((t = e.target.closest('[data-cm]'))) { st.clusterMetric = t.dataset.cm; renderClusters(); return; }

    if ((t = e.target.closest('[data-slice]'))) {         // клик по графику меняет срез
      st.now = +t.dataset.slice;
      if (st.base === st.now) st.base = st.now > 0 ? st.now - 1 : (S.length > 1 ? 1 : st.now);
      st.page = 1; fillSelectors(); tipHide(); renderAll(true); return;
    }

    if ((t = e.target.closest('[data-cluster]'))) {
      st.cluster = st.cluster === t.dataset.cluster ? null : t.dataset.cluster;
      st.page = 1; renderClusters(); renderFilters(); renderTable(); scrollToTable(); return;
    }

    if ((t = e.target.closest('[data-cut]'))) {
      var kind = t.dataset.cut, key = t.dataset.key;
      st[kind] = st[kind] === key ? null : key;
      st.page = 1; renderCuts(); renderFilters(); renderTable(); scrollToTable(); return;
    }

    if ((t = e.target.closest('[data-drop]'))) {
      var d = t.dataset.drop;
      if (d === 'all') { st.cluster = st.lang = st.type = st.geo = null; }
      else st[d] = null;
      st.page = 1; renderClusters(); renderCuts(); renderFilters(); renderTable(); return;
    }

    if ((t = e.target.closest('[data-tab]'))) {
      st.tab = t.dataset.tab; st.page = 1; renderTable(); scrollToTable(); return;
    }
    if ((t = e.target.closest('[data-ttab]'))) { st.tab = t.dataset.ttab; st.page = 1; renderTable(); return; }

    if ((t = e.target.closest('[data-sort]'))) {
      var k = t.dataset.sort;
      if (st.sort === k) st.dir = -st.dir;
      else { st.sort = k; st.dir = (k === 'vol' || k === 'delta') ? -1 : 1; }
      st.page = 1; renderTable(); return;
    }

    if ((t = e.target.closest('[data-page]'))) {
      var p = +t.dataset.page;
      if (p >= 1) { st.page = p; renderTable(); }
      return;
    }
  });

  // тултипы: одна пара обработчиков на всю страницу
  document.addEventListener('mouseover', function (e) {
    var t = e.target.closest ? e.target.closest('[data-tip]') : null;
    if (t) tipShow(t, t.dataset.tip);
  });
  document.addEventListener('mouseout', function (e) {
    if (e.target.closest && e.target.closest('[data-tip]')) tipHide();
  });
  window.addEventListener('scroll', tipHide, { passive: true });

  // геометрия графика зависит от ширины экрана — перерисовываем при переходе
  var wasNarrow = isNarrow(), rt;
  window.addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(function () {
      if (isNarrow() !== wasNarrow) { wasNarrow = isNarrow(); renderChart(); }
    }, 150);
  });
}

/* ══════════════════════════ старт ══════════════════════════ */

load().then(function () {
  if (!S.length) throw new Error('В манифесте нет ни одного среза.');

  // по умолчанию — самый свежий полный срез против предыдущего полного
  var full = [];
  S.forEach(function (s, i) { if (!s.partial) full.push(i); });
  var pool = full.length ? full : S.map(function (_, i) { return i; });
  st.now = pool[pool.length - 1];
  st.base = pool.length > 1 ? pool[pool.length - 2] : st.now;

  fillSelectors();
  wire();
  renderFoot();
  renderAll(false);
  $('boot').hidden = true;
  $('app').hidden = false;
}).catch(function (err) {
  var local = location.protocol === 'file:';
  $('boot').innerHTML = '<p><b>Данные не загрузились.</b></p><p style="margin-top:8px">' + esc(err.message) + '</p>' +
    (local
      ? '<p style="margin-top:14px">Страница открыта с диска, а браузер запрещает читать соседние файлы напрямую. ' +
        'Поднимите локальный сервер в папке отчёта:</p><p style="margin-top:8px"><code>python -m http.server 8000</code></p>' +
        '<p style="margin-top:8px">и откройте <code>http://localhost:8000/</code>. На сайте всё работает без этого.</p>'
      : '<p style="margin-top:14px">Проверьте, что папка <code>data/</code> лежит рядом с этой страницей.</p>');
  console.error(err);
});
