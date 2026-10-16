/* AppSeeker · 小程序机会雷达 —— 详情页逻辑 */
(function () {
  'use strict';

  var DATA = window.APPS_DATA;
  var HISTORY = window.APPS_HISTORY || {};
  var METRIC = '下载量';   // 当前平台的量纲名称，由 boot() 按平台覆写

  var PLAT_TAG = { wechat: 'plat-wx', alipay: 'plat-ali', html5: 'plat-other' };
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
    return '<span class="ico" style="background:linear-gradient(135deg,' + c[0] + ',' + c[1] + ');width:52px;height:52px;flex:0 0 52px;border-radius:15px;font-size:1.3rem">' +
      esc((app.name || '?').charAt(0)) + '</span>';
  }

  function platMeta(code) {
    var ps = (DATA.meta && DATA.meta.platforms) || [];
    for (var i = 0; i < ps.length; i++) { if (ps[i].code === code) return ps[i]; }
    return null;
  }

  function platName(code) {
    var p = platMeta(code);
    return p ? p.name : code;
  }

  /* 量纲名称：小程序为「下载量」，HTML5 游戏为「游玩次数」 */
  function metricOf(code) {
    var p = platMeta(code);
    return (p && p.metricLabel) || '下载量';
  }

  function getParam(name) {
    var s = location.search.replace(/^\?/, '');
    var out = '';
    s.split('&').forEach(function (kv) {
      var i = kv.indexOf('='); if (i < 0) return;
      if (kv.slice(0, i) === name) out = decodeURIComponent(kv.slice(i + 1));
    });
    return out;
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

  function renderChrome() {
    var m = DATA.meta, f = freshness(m);
    $('upd').innerHTML =
      '数据更新于 <b>' + esc(m.stat_time) + '</b><span class="badge ' + f.cls + '">' + f.text + '</span><br>' +
      '下次更新 ' + esc(m.next_update) + ' · 数据源 ' + esc(m.data_source);
    $('footMeta').textContent = m.disclaimer + ' 最近生成：' + m.generated_at + '（' + m.timezone + '）';
  }

  function renderHead(app) {
    var tags = (app.tags || []).map(function (t) {
      var cls = t === '机会' ? 'opp' : (t === '疑似刷量' ? 'tmb' : (t === '排名跃升' ? 'rise' : ''));
      return '<span class="tag ' + cls + '">' + esc(t) + '</span>';
    }).join(' ');
    var riskMap = { high: '高', mid: '中', low: '低' };
    $('dhead').innerHTML =
      '<div class="top">' + iconFor(app) +
        '<div style="min-width:0">' +
          '<h1>' + esc(app.name) + ' ' + (app.flag_high_dl_low_rating ? '<span class="tag opp">需求强 · 体验差</span>' : '') + '</h1>' +
          '<div class="sub">' + esc(app.developer || '未知开发者') + ' · ' + esc(app.category || '未分类') +
            ' · <span class="tag ' + (PLAT_TAG[app.platform] || 'plat-other') + '">' + esc(platName(app.platform)) + '</span>' +
            ' · 风险等级 ' + esc(riskMap[app.risk_level] || app.risk_level) + '</div>' +
        '</div>' +
        '<div style="margin-left:auto;text-align:right">' + (tags || '<span class="tag">无标签</span>') + '</div>' +
      '</div>';
    document.title = app.name + ' · AppSeeker';
  }

  function renderCards(app) {
    var cards = [
      { v: fmtDownload(app.download_est) + (app.is_estimated ? ' ≈' : ''), l: '估算' + METRIC + (app.download_display ? '（原文 ' + app.download_display + '）' : ''), warn: false },
      { v: pct(app.positive_rate), l: '好评率（' + app.rating_positive + ' / ' + app.rating_total + '）', warn: app.positive_rate <= 0.7 },
      { v: app.rating_avg.toFixed(1), l: '平均评分（满分 5）', warn: false },
      { v: '#' + app.rank_no + (app.rank_change ? (app.rank_change > 0 ? ' ▲' + app.rank_change : ' ▼' + Math.abs(app.rank_change)) : ''), l: platName(app.platform) + ' · ' + (app.category || '未分类') + ' 榜内排名', warn: false },
      { v: app.opportunity_score.toFixed(1), l: '机会指数 · P' + Math.round((app.download_pctl || 0) * 100), warn: true }
    ];
    $('dcards').innerHTML = cards.map(function (c) {
      return '<div class="dcard' + (c.warn ? ' warn' : '') + '"><div class="v">' + esc(c.v) + '</div><div class="l">' + esc(c.l) + '</div></div>';
    }).join('');
  }

  /* ---------- 趋势图（手写 SVG 双轴：柱=热度量级，线=好评率） ---------- */
  function renderTrend(points) {
    var box = $('trend');
    if (!points || points.length === 0) {
      box.innerHTML = '<div class="empty" style="padding:26px 12px"><b>暂无历史</b>趋势数据会随每日两次的抓取自动累积，请稍后再来。</div>';
      return;
    }

    var W = 940, H = 300, L = 66, R = 58, T = 20, B = 52;
    var n = points.length;
    var maxDl = 0;
    points.forEach(function (p) { if (p.dl > maxDl) maxDl = p.dl; });
    if (maxDl <= 0) maxDl = 1;

    var prLo = 0.30, prHi = 1.00;
    var plotW = W - L - R, plotH = H - T - B;
    var slot = plotW / n;
    var barW = Math.max(4, Math.min(26, slot * 0.55));

    function bx(i) { return L + slot * i + slot / 2; }               // 柱中心
    function hgt(dl) { return (dl / maxDl) * plotH; }                 // 高度
    function ly(pr) { return T + plotH - (pr - prLo) / (prHi - prLo) * plotH; } // 好评率 y

    var svg = [];
    svg.push('<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="display:block" preserveAspectRatio="xMidYMid meet">');

    // 右轴阈值参考线（70% 好评率 = 反差红线）
    var yr = ly(0.70);
    if (yr >= T && yr <= T + plotH) {
      svg.push('<line class="thr" x1="' + L + '" y1="' + yr.toFixed(1) + '" x2="' + (W - R) + '" y2="' + yr.toFixed(1) + '"></line>');
      svg.push('<text class="axis-txt" x="' + (L + 4) + '" y="' + (yr - 4).toFixed(1) + '">好评率 70% 参考线</text>');
    }

    // 坐标轴
    svg.push('<line class="axis" x1="' + L + '" y1="' + (T + plotH) + '" x2="' + (W - R) + '" y2="' + (T + plotH) + '"></line>');
    svg.push('<line class="axis" x1="' + L + '" y1="' + T + '" x2="' + L + '" y2="' + (T + plotH) + '"></line>');
    svg.push('<line class="axis" x1="' + (W - R) + '" y1="' + T + '" x2="' + (W - R) + '" y2="' + (T + plotH) + '"></line>');

    // 左轴刻度（热度量级）
    for (var k = 0; k <= 2; k++) {
      var v = maxDl * k / 2;
      svg.push('<text class="axis-txt" x="' + (L - 8) + '" y="' + (T + plotH - k / 2 * plotH + 3).toFixed(1) + '" text-anchor="end">' + fmtDownload(v) + '</text>');
    }
    // 右轴刻度（好评率）
    [0.4, 0.7, 1.0].forEach(function (p) {
      svg.push('<text class="axis-txt" x="' + (W - R + 8) + '" y="' + (ly(p) + 3).toFixed(1) + '" text-anchor="start">' + Math.round(p * 100) + '%</text>');
    });

    // 柱 + 折线
    var linePts = [];
    points.forEach(function (p, i) {
      var x = bx(i), h = hgt(p.dl), y = T + plotH - h;
      var cur = (i === n - 1);
      svg.push('<rect class="tbar' + (cur ? ' cur' : '') + '" x="' + (x - barW / 2).toFixed(1) + '" y="' + y.toFixed(1) +
        '" width="' + barW.toFixed(1) + '" height="' + Math.max(1, h).toFixed(1) + '" rx="3"><title>' + esc(p.t) +
        '\n估算' + METRIC + ' ' + fmtDownload(p.dl) + ' · 好评率 ' + pct(p.pr) + '</title></rect>');
      linePts.push({ x: x, y: ly(p.pr) });
    });

    svg.push('<polyline class="tline" points="' + linePts.map(function (p) { return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ') + '"></polyline>');
    linePts.forEach(function (p, i) {
      svg.push('<circle class="tdot' + (i === n - 1 ? ' cur' : '') + '" cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + (i === n - 1 ? 4.5 : 3) + '"></circle>');
    });

    // x 轴时间标签（首/中/尾）
    var idxs = n <= 3 ? points.map(function (_, i) { return i; }) : [0, Math.floor((n - 1) / 2), n - 1];
    idxs.forEach(function (i) {
      var t = String(points[i].t || '');
      var lab = t.replace(/^\d{4}-(\d{2}-\d{2}).*/, '$1');
      svg.push('<text class="axis-txt" x="' + bx(i).toFixed(1) + '" y="' + (T + plotH + 18) + '" text-anchor="middle">' + esc(lab) + '</text>');
    });

    svg.push('<text class="axis-txt" x="' + (L - 8) + '" y="' + (T - 6) + '" text-anchor="end">' + esc(METRIC) + '</text>');
    svg.push('<text class="axis-txt" x="' + (W - R + 8) + '" y="' + (T - 6) + '" text-anchor="start">好评率</text>');
    svg.push('</svg>');

    box.innerHTML = svg.join('') +
      '<div class="mono" style="margin-top:8px">共 ' + n + ' 个快照点 · 最新 ' + esc(points[n - 1].t) + '</div>';
  }

  /* ---------- 跨平台同名对比 ---------- */
  function renderCompare(app) {
    var peers = DATA.apps.filter(function (a) { return a.name === app.name; })
      .sort(function (x, y) { return y.opportunity_score - x.opportunity_score; });
    if (peers.length < 2) { $('cmpCard').style.display = 'none'; return; }
    $('cmpCard').style.display = '';

    var rows = peers.map(function (a) {
      var cur = a.id === app.id;
      return '<tr' + (cur ? ' style="background:var(--accent-soft)"' : '') + '>' +
        '<td><span class="tag ' + (PLAT_TAG[a.platform] || 'plat-other') + '">' + esc(platName(a.platform)) + '</span></td>' +
        '<td><span class="mono">#' + a.rank_no + '</span></td>' +
        '<td><span class="mono">' + fmtDownload(a.download_est) + '</span><span class="mono"> ' + esc(metricOf(a.platform)) + '</span></td>' +
        '<td><div class="ratebar"><span class="bar"><i style="width:' + Math.round(a.positive_rate * 100) + '%"></i></span><span class="val">' + pct(a.positive_rate) + '</span></div></td>' +
        '<td><span class="score">' + a.opportunity_score.toFixed(1) + '</span></td>' +
        '<td>' + (a.flag_high_dl_low_rating ? '<span class="tag opp">机会</span>' : '<span class="tag">—</span>') + '</td>' +
        '</tr>';
    }).join('');

    $('cmp').innerHTML = '<div style="border:1px solid var(--rule);border-radius:10px;overflow:hidden">' +
      '<table class="tbl"><thead><tr><th>平台</th><th>排名</th><th>热度量级</th><th>好评率</th><th>机会指数</th><th>标记</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
  }

  /* ---------- 数据来源与免责 ---------- */
  function renderProv(app) {
    var est = app.is_estimated
      ? '该平台仅公开区间值（如 "' + esc(app.download_display || '') + '"），本页' + esc(METRIC) + '为估算下界，用于横向排序比较，非精确值。'
      : '该平台公开了精确的' + esc(METRIC) + '数值。';
    var q = app.quality_flag || 'ok';
    var qText = q === 'ok' ? '正常' : (q === 'derived' ? '由好评率推导（原数据缺失平均分）' : (q === 'missing' ? '热度数据缺失' : q));
    var src = app.source_url
      ? '<a href="' + esc(app.source_url) + '" target="_blank" rel="noopener">' + esc(app.source_url) + '</a>'
      : '模拟示例数据（未指向真实来源）';

    $('prov').innerHTML =
      '<div><b>数据来源：</b>' + src + '</div>' +
      '<div><b>抓取时间：</b>' + esc(app.crawl_at || '—') + '　·　<b>统计口径：</b>' + esc(DATA.meta.stat_time || '—') + '（' + esc(DATA.meta.timezone) + '）</div>' +
      '<div><b>量纲说明：</b>' + est + '　·　<b>数据质量：</b>' + esc(qText) + '</div>' +
      '<div style="margin-top:6px">' + esc(DATA.meta.disclaimer) + '仅展示聚合统计口径，不收录任何评论原文或用户个人信息。</div>';
  }

  function emptyState(msg) {
    var m = DATA && DATA.meta;
    $('crumb').innerHTML = '<a href="index.html">← 返回榜单</a>';
    $('dhead').innerHTML = '<div class="top"><div><h1>未找到该记录</h1><div class="sub">' + esc(msg) + '</div></div></div>';
    $('dcards').innerHTML = '';
    $('trend').innerHTML = '';
    $('cmpCard').style.display = 'none';
    $('prov').innerHTML = m ? esc(m.disclaimer) : '请先运行数据管道生成榜单数据。';
    if (m) { $('upd').innerHTML = '数据更新于 <b>' + esc(m.stat_time) + '</b>'; }
  }

  function initSearch() {
    $('q').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var v = this.value.trim();
        if (v) location.href = 'index.html?q=' + encodeURIComponent(v);
      }
    });
  }

  function boot() {
    if (!DATA || !DATA.meta || !DATA.apps) {
      emptyState('尚未生成榜单数据，请先在项目根目录运行 pipeline\\run.ps1。');
      return;
    }
    renderChrome();
    initSearch();

    var id = getParam('id');
    $('crumb').innerHTML = '<a href="index.html' + (getParam('q') ? '?q=' + encodeURIComponent(getParam('q')) : '') + '">← 返回榜单</a>' +
      ' / <span>' + (id ? esc(id) : '未知 id') + '</span>';

    if (!id) { emptyState('URL 缺少 ?id= 参数。'); return; }
    var app = null;
    for (var i = 0; i < DATA.apps.length; i++) { if (DATA.apps[i].id === id) { app = DATA.apps[i]; break; } }
    if (!app) { emptyState('榜单中没有 id 为「' + id + '」的记录，可能该记录已被本轮抓取淘汰。'); return; }

    METRIC = metricOf(app.platform);

    try {
      renderHead(app);
      renderCards(app);
      renderTrend(HISTORY[id] || []);
      renderCompare(app);
      renderProv(app);
    } catch (err) {
      $('trend').innerHTML = '<div class="empty">渲染出错：' + esc(err.message) + '</div>';
    }
  }

  boot();
})();
