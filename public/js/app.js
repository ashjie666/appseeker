/* AppSeeker · 小程序机会雷达 —— 首页列表页逻辑 */
(function () {
  'use strict';

  var DATA = window.APPS_DATA;
  var state = {
    platforms: {},
    cat: 'all',
    pctl: 0.8,
    rateMax: 0.7,
    onlyFlagged: true,
    sort: 'opportunity',
    q: '',
    view: 'list'
  };

  var PLAT_TAG = { wechat: 'plat-wx', alipay: 'plat-ali' };
  /* ---------- 收藏（localStorage 持久化；不可用时降级为内存态） ---------- */
  var FAV_KEY = 'appseeker:favorites:v1';
  var storeOK = true;
  var favs = [];

  function storeRead() {
    try {
      var raw = window.localStorage.getItem(FAV_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return (arr instanceof Array) ? arr : [];
    } catch (e) {
      storeOK = false;
      return [];
    }
  }
  function storeWrite() {
    if (!storeOK) return;
    try { window.localStorage.setItem(FAV_KEY, JSON.stringify(favs)); }
    catch (e) { storeOK = false; }
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtTime(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function appById(id) {
    var a = DATA.apps || [];
    for (var i = 0; i < a.length; i++) { if (a[i].id === id) return a[i]; }
    return null;
  }
  function favIndexOf(id) {
    for (var i = 0; i < favs.length; i++) { if (favs[i].id === id) return i; }
    return -1;
  }
  function isFav(id) { return favIndexOf(id) >= 0; }

  function favStar(id) {
    var on = isFav(id);
    return '<button class="star' + (on ? ' on' : '') + '" data-fav="' + esc(id) + '" title="' +
      (on ? '取消收藏' : '收藏该条目') + '">' + (on ? '★' : '☆') + '</button>';
  }

  function renderFavCount() {
    var el = $('favCount');
    if (el) el.textContent = favs.length;
    var tab = document.querySelector('.vtab[data-view="fav"]');
    if (tab) tab.classList.toggle('has', favs.length > 0);
  }

  /* 收藏即快照：榜单数据每日更新两次，记录收藏当时的指标，配合收藏时间才有对照意义 */
  function toggleFav(app) {
    var i = favIndexOf(app.id);
    if (i >= 0) {
      favs.splice(i, 1);
    } else {
      favs.push({
        id: app.id,
        name: app.name,
        developer: app.developer,
        category: app.category,
        platform: app.platform,
        download_display: app.download_display,
        download_est: app.download_est,
        positive_rate: app.positive_rate,
        opportunity_score: app.opportunity_score,
        saved_at: fmtTime(new Date())
      });
    }
    storeWrite();
    renderFavCount();
    renderFavTable();
    if (state.view === 'list') { renderRows(currentRows()); }
  }

  function removeFav(id) {
    var i = favIndexOf(id);
    if (i >= 0) { favs.splice(i, 1); }
    storeWrite();
    renderFavCount();
    renderFavTable();
    if (state.view === 'list') { renderRows(currentRows()); }
  }

  function renderFavTable() {
    var tb = $('favRows'), empty = $('favEmpty'), note = $('favNote');
    if (!tb || !empty) return;

    if (note) {
      note.style.display = storeOK ? 'none' : 'block';
      if (!storeOK) {
        note.textContent = '当前浏览器环境无法写入本地存储（多为以 file:// 直接打开页面所致），收藏仅在本次会话内有效。改用 http 地址访问即可持久保存。';
      }
    }

    if (!favs.length) {
      tb.innerHTML = '';
      empty.style.display = 'block';
      empty.innerHTML = '<b>还没有收藏任何条目</b>回到「榜单列表」，点击每行最左侧的 ☆ 即可收藏，收藏时会自动记录收藏时间。';
      return;
    }
    empty.style.display = 'none';

    var rows = favs.slice().sort(function (a, b) {
      return String(b.saved_at || '').localeCompare(String(a.saved_at || ''));
    });
    tb.innerHTML = rows.map(function (f) {
      var gone = !appById(f.id);
      return '<tr data-id="' + esc(f.id) + '">' +
        '<td><div class="app">' + iconFor(f) + '<span class="nm"><b>' + esc(f.name) + '</b><span>' +
          esc(f.developer || '—') + ' · ' + esc(f.category || '—') + '</span></span></div>' +
          (gone ? '<span class="tag tmb" style="margin-left:8px">已下榜</span>' : '') + '</td>' +
        '<td><span class="tag ' + (PLAT_TAG[f.platform] || 'plat-other') + '">' + esc(PLAT_NAME[f.platform] || f.platform) + '</span></td>' +
        '<td><span class="mono">' + fmtDownload(f.download_est) + '</span>' +
          (f.download_display ? '<span class="mono" title="收藏时平台原文"> (' + esc(f.download_display) + ')</span>' : '') + '</td>' +
        '<td><div class="ratebar"><span class="bar"><i style="width:' + Math.round((f.positive_rate || 0) * 100) + '%"></i></span>' +
          '<span class="val">' + pct(f.positive_rate) + '</span></div></td>' +
        '<td><span class="score">' + (Number(f.opportunity_score) || 0).toFixed(1) + '</span></td>' +
        '<td><span class="mono">' + esc(f.saved_at) + '</span></td>' +
        '<td><button class="btn ghost xs" data-unfav="' + esc(f.id) + '">移除</button></td>' +
        '</tr>';
    }).join('');
  }

  function setView(v) {
    state.view = v;
    $('viewList').style.display = (v === 'list') ? '' : 'none';
    $('viewFav').style.display = (v === 'fav') ? '' : 'none';
    Array.prototype.forEach.call(document.querySelectorAll('.vtab'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-view') === v);
    });
    if (v === 'fav') { renderFavTable(); }
  }

  var ICON_COLORS = [
    ['#2F55E8', '#7B93FF'], ['#F2711C', '#FFB27A'], ['#0EA5A5', '#5EEAD4'],
    ['#7C3AED', '#C4B5FD'], ['#DC2626', '#FCA5A5'], ['#0F766E', '#5EEAD4'],
    ['#1D4ED8', '#93C5FD'], ['#B45309', '#FCD34D']
  ];

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pct(v) { return Math.round((v || 0) * 100) + '%'; }

  function fmtDownload(n) {
    if (!n || n <= 0) return '—';
    if (n >= 1e8) return (n / 1e8).toFixed(n >= 1e9 ? 0 : 1) + '亿+';
    if (n >= 1e4) { var v = n / 1e4; return (v >= 100 ? Math.round(v) : v.toFixed(1)) + '万+'; }
    return String(n);
  }

  function iconFor(app) {
    var h = 0;
    for (var i = 0; i < app.id.length; i++) h = (h * 31 + app.id.charCodeAt(i)) % 9973;
    var c = ICON_COLORS[h % ICON_COLORS.length];
    var ch = (app.name || '?').charAt(0);
    return '<span class="ico" style="background:linear-gradient(135deg,' + c[0] + ',' + c[1] + ')">' + esc(ch) + '</span>';
  }

  function quantile(sorted, p) {
    if (!sorted.length) return 0;
    var idx = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
    return sorted[idx];
  }

  function freshness(meta) {
    var gen = new Date(String(meta.generated_at || '').replace(' ', 'T'));
    if (isNaN(gen.getTime())) return { cls: 'warn', text: '未知' };
    var h = (Date.now() - gen.getTime()) / 3600000;
    var f = meta.freshness || { freshHours: 12, staleHours: 24 };
    if (h <= f.freshHours) return { cls: 'fresh', text: '数据最新' };
    if (h <= f.staleHours) return { cls: 'warn', text: '数据延迟 ' + Math.round(h) + ' 小时' };
    return { cls: 'stale', text: '数据已过期 ' + Math.round(h) + ' 小时' };
  }

  function renderHeader() {
    var m = DATA.meta;
    var f = freshness(m);
    $('upd').innerHTML =
      '数据更新于 <b>' + esc(m.stat_time) + '</b>' +
      '<span class="badge ' + f.cls + '">' + f.text + '</span><br>' +
      '覆盖 ' + m.platforms.length + ' 平台 / ' + m.total_rows + ' 条 · 反差命中 <b>' + m.flagged_count + '</b> 条' +
      '<br>下次更新 ' + esc(m.next_update) +
      ' · 数据源 ' + esc(m.data_source);
    $('footMeta').textContent = m.disclaimer + ' 最近生成：' + m.generated_at + '（' + m.timezone + '）';
    document.title = m.product + '（更新于 ' + m.stat_time + '）';
  }

  var PLAT_NAME = {};
  var PLAT_CODE = {};

  function renderKpis() {
    var m = DATA.meta, apps = DATA.apps;
    var avg = apps.length ? apps.reduce(function (s, a) { return s + a.positive_rate; }, 0) / apps.length : 0;
    var flagged = apps.filter(function (a) { return a.flag_high_dl_low_rating; });
    var topScore = flagged.length ? Math.max.apply(null, flagged.map(function (a) { return a.opportunity_score; })) : 0;
    var cards = [
      { v: m.platforms.length, l: '覆盖平台数', hl: false },
      { v: m.total_rows, l: '抓取条目数', hl: false },
      { v: m.flagged_count, l: '「需求强 · 体验差」命中', hl: true },
      { v: pct(avg), l: '全量平均好评率', hl: false }
    ];
    $('kpis').innerHTML = cards.map(function (c) {
      return '<div class="kpi' + (c.hl ? ' hl' : '') + '"><div class="v">' + esc(c.v) + '</div><div class="l">' + esc(c.l) + '</div></div>';
    }).join('') + '<div class="kpi hl" style="grid-column:1/-1"><div class="v" style="font-size:1.1rem">最高机会指数 ' + topScore.toFixed(1) + '</div><div class="l">机会指数 = 热度分位 ×（1 − 好评率）× 置信度，越高越值得关注</div></div>';
  }

  function renderFilterControls() {
    var m = DATA.meta, apps = DATA.apps;

    // 平台
    m.platforms.forEach(function (p) {
      PLAT_NAME[p.code] = p.name;
      state.platforms[p.code] = true;
    });
    $('platChips').innerHTML = m.platforms.map(function (p) {
      return '<button class="chip on" data-plat="' + esc(p.code) + '">' + esc(p.name) + ' (' + p.count + ')</button>';
    }).join('');

    // 品类
    var cats = {};
    apps.forEach(function (a) { cats[a.category] = (cats[a.category] || 0) + 1; });
    Object.keys(cats).sort().forEach(function (c) {
      PLAT_CODE[c] = cats[c];
      var o = document.createElement('option');
      o.value = c; o.textContent = c + ' (' + cats[c] + ')';
      $('cat').appendChild(o);
    });

    // 预设档位
    var presets = m.presets || {};
    var keys = ['loose', 'normal', 'strict'];
    $('pctlChips').innerHTML = keys.filter(function (k) { return presets[k]; }).map(function (k) {
      var p = presets[k];
      var on = (Number(p.downloadPctl) === state.pctl) ? ' on' : '';
      return '<button class="chip' + on + '" data-pctl="' + p.downloadPctl + '" data-rate="' + p.positiveRateMax + '" data-min="' + p.minReviews + '">' +
        esc(p.label || k) + ' · P' + Math.round(p.downloadPctl * 100) + '</button>';
    }).join('');

    $('rate').value = Math.round(state.rateMax * 100);
    $('rateVal').textContent = '≤ ' + Math.round(state.rateMax * 100) + '%';
  }

  function currentRows() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.apps.filter(function (a) {
      if (state.platforms[a.platform] === false) return false;
      if (state.cat !== 'all' && a.category !== state.cat) return false;
      if ((a.download_pctl || 0) < state.pctl - 1e-9) return false;
      if ((a.positive_rate || 0) > state.rateMax + 1e-9) return false;
      if (state.onlyFlagged && !a.flag_high_dl_low_rating) return false;
      if (q) {
        var hay = (a.name + ' ' + a.developer + ' ' + a.category).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });

    var by = state.sort;
    rows.sort(function (x, y) {
      if (by === 'download') return y.download_est - x.download_est;
      if (by === 'rate') return x.positive_rate - y.positive_rate;
      if (by === 'rank') return x.rank_no - y.rank_no;
      return y.opportunity_score - x.opportunity_score;
    });
    return rows;
  }

  function renderRows(rows) {
    var tb = $('rows'), empty = $('empty');
    $('resCount').textContent = '命中 ' + rows.length + ' 条 / 共 ' + DATA.apps.length + ' 条';

    if (!rows.length) {
      tb.innerHTML = '';
      empty.style.display = 'block';
      empty.innerHTML = '<b>没有符合条件的条目</b>试试放宽「热度门槛」或调高「好评率上限」，或关闭「仅看反差名单」。';
      return;
    }
    empty.style.display = 'none';

    tb.innerHTML = rows.map(function (a) {
      var rc = a.rank_change || 0;
      var rcHtml = rc > 0 ? '<span class="rk-up">▲' + rc + '</span>' : (rc < 0 ? '<span class="rk-down">▼' + Math.abs(rc) + '</span>' : '');
      var platCls = PLAT_TAG[a.platform] || 'plat-other';
      var tags = (a.tags || []).map(function (t) {
        var cls = t === '机会' ? 'opp' : (t === '疑似刷量' ? 'tmb' : (t === '排名跃升' ? 'rise' : ''));
        return '<span class="tag ' + cls + '">' + esc(t) + '</span>';
      }).join(' ');
      return '<tr data-id="' + esc(a.id) + '">' +
        '<td>' + favStar(a.id) + '</td>' +
        '<td><span class="rank">' + ('0' + a.rank_no).slice(-2) + '</span> ' + rcHtml + '</td>' +
        '<td><div class="app">' + iconFor(a) + '<span class="nm"><b>' + esc(a.name) + '</b><span>' + esc(a.developer) + ' · ' + esc(a.category) + '</span></span></div></td>' +
        '<td><span class="tag ' + platCls + '">' + esc(PLAT_NAME[a.platform] || a.platform) + '</span></td>' +
        '<td><span class="mono">' + fmtDownload(a.download_est) + '</span>' + (a.is_estimated ? '<span class="mono" title="平台仅展示区间值，此处为估算下界"> ≈</span>' : '') + '</td>' +
        '<td><div class="ratebar"><span class="bar"><i style="width:' + Math.round(a.positive_rate * 100) + '%"></i></span><span class="val">' + pct(a.positive_rate) + '</span></div></td>' +
        '<td><span class="score">' + a.opportunity_score.toFixed(1) + '</span></td>' +
        '<td class="col-hide">' + (tags || '<span class="tag">—</span>') + '</td>' +
        '</tr>';
    }).join('');
  }

  /* ---------- 象限散点图（手写 SVG，无第三方依赖） ---------- */
  function renderScatter(rows) {
    var W = 940, H = 430, L = 62, R = 22, T = 22, B = 50;
    var data = rows.length ? rows : DATA.apps;
    if (!data.length) { $('scatter').innerHTML = ''; return; }

    var dls = data.map(function (a) { return a.download_est || 0; }).filter(function (v) { return v > 0; }).sort(function (a, b) { return a - b; });
    var lo = Math.log10(Math.max(1, dls[0] || 1));
    var hi = Math.log10(Math.max(10, dls[dls.length - 1] || 10));
    if (hi - lo < 1) hi = lo + 1;
    var thr = quantile(dls, state.pctl);

    var x = function (v) { return L + (Math.log10(Math.max(1, v)) - lo) / (hi - lo) * (W - L - R); };
    var y = function (p) { return H - B - (p - 0.30) / (1.0 - 0.30) * (H - T - B); };

    var svg = [];
    svg.push('<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="display:block" preserveAspectRatio="xMidYMid meet">');

    // 目标象限
    svg.push('<rect class="qzone" x="' + x(thr).toFixed(1) + '" y="' + y(state.rateMax).toFixed(1) + '" width="' +
      (W - R - x(thr)).toFixed(1) + '" height="' + (H - B - y(state.rateMax)).toFixed(1) + '"></rect>');
    svg.push('<text x="' + (W - R - 14).toFixed(1) + '" y="' + (H - B - 10).toFixed(1) + '" text-anchor="end" fill="#F2711C" font-size="11" font-weight="bold" font-family="JetBrains Mono, monospace">目标象限：高热度 · 低好评</text>');

    // 阈值线
    svg.push('<line class="thr" x1="' + x(thr).toFixed(1) + '" y1="' + T + '" x2="' + x(thr).toFixed(1) + '" y2="' + (H - B) + '"></line>');
    svg.push('<line class="thr" x1="' + L + '" y1="' + y(state.rateMax).toFixed(1) + '" x2="' + (W - R) + '" y2="' + y(state.rateMax).toFixed(1) + '"></line>');
    svg.push('<text class="axis-txt" x="' + (x(thr) + 4).toFixed(1) + '" y="' + (T + 12) + '">P' + Math.round(state.pctl * 100) + ' 热度门槛 ' + fmtDownload(thr) + '</text>');

    // 坐标轴
    svg.push('<line class="axis" x1="' + L + '" y1="' + (H - B) + '" x2="' + (W - R) + '" y2="' + (H - B) + '"></line>');
    svg.push('<line class="axis" x1="' + L + '" y1="' + T + '" x2="' + L + '" y2="' + (H - B) + '"></line>');

    // 刻度
    [0.4, 0.6, 0.7, 0.8, 0.9, 1.0].forEach(function (p) {
      svg.push('<text class="axis-txt" x="' + (L - 8) + '" y="' + (y(p) + 3).toFixed(1) + '" text-anchor="end">' + Math.round(p * 100) + '%</text>');
    });
    for (var d = Math.ceil(lo); d <= Math.floor(hi); d++) {
      var v = Math.pow(10, d);
      svg.push('<text class="axis-txt" x="' + x(v).toFixed(1) + '" y="' + (H - B + 16) + '" text-anchor="middle">' + fmtDownload(v) + '</text>');
    }
    svg.push('<text class="axis-txt" x="' + ((W) / 2) + '" y="' + (H - 8) + '" text-anchor="middle">热度量级（对数刻度）</text>');
    svg.push('<text class="axis-txt" x="14" y="' + (T + 10) + '" text-anchor="start">好评率</text>');

    // 数据点
    data.forEach(function (a) {
      if (!a.download_est) return;
      var cx = x(a.download_est).toFixed(1), cy = y(a.positive_rate).toFixed(1);
      var fill = a.flag_high_dl_low_rating ? '#F2711C' : '#2F55E8';
      var op = a.flag_high_dl_low_rating ? 0.95 : 0.42;
      var r = a.flag_high_dl_low_rating ? 5.2 : 3.6;
      svg.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + fill + '" fill-opacity="' + op + '" stroke="#fff" stroke-width="' +
        (a.flag_high_dl_low_rating ? 1.2 : 0) + '"><title>' + esc(a.name) + ' · ' + esc(PLAT_NAME[a.platform] || a.platform) +
        '\n热度 ' + fmtDownload(a.download_est) + ' · 好评率 ' + pct(a.positive_rate) +
        '\n机会指数 ' + a.opportunity_score.toFixed(1) + '</title></circle>');
    });

    svg.push('</svg>');
    $('scatter').innerHTML = svg.join('');
  }

  function render() {
    var rows = currentRows();
    renderRows(rows);
    renderScatter(rows);
    syncUrl();
  }

  function syncUrl() {
    var p = Object.keys(state.platforms).filter(function (k) { return state.platforms[k]; }).join(',');
    var q = '?plat=' + encodeURIComponent(p) + '&cat=' + encodeURIComponent(state.cat) +
      '&pctl=' + state.pctl + '&rate=' + state.rateMax + '&flagged=' + (state.onlyFlagged ? 1 : 0) + '&sort=' + state.sort +
      (state.q ? '&q=' + encodeURIComponent(state.q) : '');
    try { history.replaceState(null, '', q); } catch (e) { }
  }

  function readUrl() {
    var s = location.search.replace(/^\?/, '');
    if (!s) return;
    s.split('&').forEach(function (kv) {
      var i = kv.indexOf('='); if (i < 0) return;
      var k = kv.slice(0, i), v = decodeURIComponent(kv.slice(i + 1));
      if (k === 'cat') state.cat = v;
      else if (k === 'pctl') state.pctl = Number(v) || state.pctl;
      else if (k === 'rate') state.rateMax = Number(v) || state.rateMax;
      else if (k === 'flagged') state.onlyFlagged = v === '1';
      else if (k === 'sort') state.sort = v;
      else if (k === 'q') state.q = v;
      else if (k === 'plat') state.platFilter = v.split(',').filter(Boolean);
    });
  }

  function bind() {
    $('platChips').addEventListener('click', function (e) {
      var b = e.target.closest('[data-plat]'); if (!b) return;
      var c = b.getAttribute('data-plat');
      var on = !(state.platforms[c] !== false);
      var anyOn = Object.keys(state.platforms).some(function (k) { return k !== c && state.platforms[k] !== false; });
      if (!on && !anyOn) return; // 至少保留一个平台
      state.platforms[c] = on;
      b.classList.toggle('on', on);
      render();
    });

    $('pctlChips').addEventListener('click', function (e) {
      var b = e.target.closest('[data-pctl]'); if (!b) return;
      state.pctl = Number(b.getAttribute('data-pctl'));
      state.rateMax = Number(b.getAttribute('data-rate'));
      $('rate').value = Math.round(state.rateMax * 100);
      $('rateVal').textContent = '≤ ' + Math.round(state.rateMax * 100) + '%';
      Array.prototype.forEach.call($('pctlChips').children, function (c) { c.classList.toggle('on', c === b); });
      render();
    });

    $('cat').addEventListener('change', function () { state.cat = this.value; render(); });

    $('rate').addEventListener('input', function () {
      state.rateMax = Number(this.value) / 100;
      $('rateVal').textContent = '≤ ' + this.value + '%';
      render();
    });

    $('onlyFlagged').addEventListener('change', function () { state.onlyFlagged = this.checked; render(); });

    var timer = null;
    $('q').addEventListener('input', function () {
      var v = this.value;
      clearTimeout(timer);
      timer = setTimeout(function () { state.q = v; render(); }, 180);
    });

    document.querySelector('.sorts').addEventListener('click', function (e) {
      var b = e.target.closest('[data-sort]'); if (!b) return;
      state.sort = b.getAttribute('data-sort');
      Array.prototype.forEach.call(this.querySelectorAll('.sortbtn'), function (x) { x.classList.toggle('on', x === b); });
      render();
    });

    $('reset').addEventListener('click', function () {
      state.cat = 'all'; state.pctl = 0.8; state.rateMax = 0.7; state.onlyFlagged = true; state.sort = 'opportunity'; state.q = '';
      Object.keys(state.platforms).forEach(function (k) { state.platforms[k] = true; });
      $('cat').value = 'all'; $('rate').value = 70; $('rateVal').textContent = '≤ 70%';
      $('onlyFlagged').checked = true; $('q').value = '';
      Array.prototype.forEach.call($('platChips').children, function (c) { c.classList.add('on'); });
      Array.prototype.forEach.call($('pctlChips').children, function (c) { c.classList.toggle('on', c.getAttribute('data-pctl') === '0.8'); });
      Array.prototype.forEach.call(document.querySelectorAll('.sortbtn'), function (x) { x.classList.toggle('on', x.getAttribute('data-sort') === 'opportunity'); });
      render();
    });

    // 视图切换：榜单列表 / 我的收藏
    document.querySelector('.viewtabs').addEventListener('click', function (e) {
      var b = e.target.closest('[data-view]'); if (!b) return;
      setView(b.getAttribute('data-view'));
    });

    // 榜单列表：点 ☆ 收藏 / 取消收藏，其余区域仍进入详情页
    $('rows').addEventListener('click', function (e) {
      var star = e.target.closest('[data-fav]');
      if (star) {
        var app = appById(star.getAttribute('data-fav'));
        if (app) toggleFav(app);
        return;
      }
      var tr = e.target.closest('tr'); if (!tr) return;
      location.href = 'detail.html?id=' + encodeURIComponent(tr.getAttribute('data-id'));
    });

    // 我的收藏：移除收藏 / 点击行进入详情页
    $('favRows').addEventListener('click', function (e) {
      var un = e.target.closest('[data-unfav]');
      if (un) { removeFav(un.getAttribute('data-unfav')); return; }
      var tr = e.target.closest('tr'); if (!tr) return;
      location.href = 'detail.html?id=' + encodeURIComponent(tr.getAttribute('data-id'));
    });
  }

  function emptyState() {
    $('upd').innerHTML = '尚未生成数据';
    $('kpis').innerHTML = '<div class="kpi hl" style="grid-column:1/-1"><div class="v" style="font-size:1rem">还没有榜单数据</div><div class="l">请先运行数据管道生成 public/data/latest.js</div></div>';
    $('rows').innerHTML = '';
    $('empty').style.display = 'block';
    $('empty').innerHTML = '<b>尚未生成榜单数据</b>在项目根目录执行：<br><code>powershell -NoProfile -ExecutionPolicy Bypass -File pipeline\\run.ps1</code><br>执行完成后刷新本页即可看到「高下载低好评」名单。';
  }

  if (!DATA || !DATA.meta || !DATA.apps) { emptyState(); return; }

  readUrl();
  favs = storeRead();
  try {
    renderHeader();
    renderFilterControls();
    renderFavCount();
    if (state.platFilter) {
      Object.keys(state.platforms).forEach(function (k) { state.platforms[k] = state.platFilter.indexOf(k) >= 0; });
    }
    if (state.sort !== 'opportunity') {
      Array.prototype.forEach.call(document.querySelectorAll('.sortbtn'), function (x) { x.classList.toggle('on', x.getAttribute('data-sort') === state.sort); });
    }
    if (state.cat !== 'all') { $('cat').value = state.cat; }
    if (!state.onlyFlagged) { $('onlyFlagged').checked = false; }
    if (state.q) { $('q').value = state.q; }
    bind();
    render();
  } catch (err) {
    $('upd').innerHTML = '渲染出错：' + esc(err.message);
  }
})();
