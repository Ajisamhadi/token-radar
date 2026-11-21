/* Token Launch Radar — page logic. Everything renders from window.RADAR,
   the dataset main.ts writes beside this page. No fetches, no network. */
(function () {
  'use strict';

  var D = window.RADAR;
  if (!D) return;

  var view = { tab: 'board', q: '', category: '', chain: '', minTvl: 0, watchOnly: false, sortKey: 'rank', sortDir: 1 };

  /* ---------- tiny DOM helper ---------- */
  function node(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function add(parent) {
    for (var i = 1; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) parent.appendChild(c); });
      else parent.appendChild(child);
    }
    return parent;
  }

  /* ---------- formatting ---------- */
  function money(v) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    var a = Math.abs(v);
    if (a >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + Math.round(v / 1e3) + 'K';
    return '$' + Math.round(v);
  }
  function pct(v) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    return (v > 0 ? '+' : '') + v.toFixed(2) + '%';
  }
  function ageLabel(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 730) return (days / 365.25).toFixed(1) + ' yrs';
    if (days >= 30) return Math.round(days / 30.4) + ' mo';
    return days + ' d';
  }
  function mult(x) { return '×' + Number(x).toFixed(3); }

  /* ---------- masthead stats ---------- */
  var totalImplied = D.rows.reduce(function (sum, r) { return sum + r.implied_value_usd; }, 0);
  var stats = document.getElementById('stats');
  [
    ['Protocols scanned', D.universe_size],
    ['On the board', D.board_size],
    ['Watchlist covered', D.watchlist_size + ' / ' + D.watchlist_size],
    ['Combined implied value', money(totalImplied)],
    ['Snapshot date', D.as_of]
  ].forEach(function (pair) {
    var box = node('div');
    add(box, node('dt', null, pair[0]), node('dd', null, pair[1]));
    stats.appendChild(box);
  });

  /* ---------- method cards ---------- */
  var m = D.model;
  var cards = [
    ['1 · Peer multiple', 'For each category, take every tokenized protocol in this snapshot and compute market cap ÷ TVL. The board uses the category median (clamped to ' +
      m.multiple_floor + '–' + m.multiple_cap + '), so one outlier cannot set the price of a whole sector. Categories with fewer than ' + m.min_peers +
      ' tokenized peers fall back to the global median across all ' + D.peer_size + ' peers.'],
    ['2 · Momentum', 'The 7-day TVL change, clamped to ' + m.momentum_floor_pct + '%…+' + m.momentum_cap_pct + '% and weighted at ' + m.momentum_weight +
      '. Growth lifts a value modestly; shrinkage discounts it. A protocol with no reported change is scored as flat.'],
    ['3 · Maturity', 'Age counts from the day the snapshot source first tracked the protocol. The maturity factor runs from ' + m.maturity_base +
      ' for a brand-new listing to ' + (m.maturity_base + m.maturity_span) + ' at ' + m.maturity_horizon_days + ' days: survival is evidence, but it is never worth more than the peer multiple itself.'],
    ['4 · Chain breadth', 'Each chain beyond the first adds ' + (m.breadth_per_chain * 100) + '% (up to +' + (m.breadth_per_chain * m.breadth_max_extra * 100) +
      '%). A footprint on several chains is harder to fake and harder to replicate than a single deployment.'],
    ['The formula', 'implied value = TVL × peer multiple × momentum × maturity × breadth, rounded to whole dollars. Open any row to see its five factors and recompute it by hand. Model version: ' + D.model_tag + '.']
  ];
  var grid = document.getElementById('method-body');
  cards.forEach(function (c) {
    var card = node('article', 'method-card');
    add(card, node('h3', null, c[0]), node('p', null, c[1]));
    grid.appendChild(card);
  });

  /* ---------- filters ---------- */
  var qInput = document.getElementById('f-q');
  var catSel = document.getElementById('f-category');
  var chainSel = document.getElementById('f-chain');
  var tvlSel = document.getElementById('f-tvl');
  var watchBox = document.getElementById('f-watch');
  var countEl = document.getElementById('row-count');

  function fillSelect(sel, values, allLabel) {
    sel.appendChild(node('option', null, allLabel)).value = '';
    values.forEach(function (v) {
      var o = node('option', null, v);
      o.value = v;
      sel.appendChild(o);
    });
  }
  fillSelect(catSel, D.categories, 'All categories');
  fillSelect(chainSel, D.chains, 'All chains');

  function visibleRows() {
    var q = view.q.trim().toLowerCase();
    return D.rows.filter(function (r) {
      if (view.watchOnly && !r.watchlist) return false;
      if (view.category && (r.category || 'Uncategorized') !== view.category) return false;
      if (view.chain && r.chains.indexOf(view.chain) === -1) return false;
      if (r.tvl_usd < view.minTvl) return false;
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }

  function sorted(rows) {
    var key = view.sortKey, dir = view.sortDir;
    return rows.slice().sort(function (a, b) {
      var x = a[key], y = b[key];
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      if (typeof x === 'string') return dir * x.localeCompare(y);
      return dir * (x - y);
    });
  }

  /* ---------- board rendering ---------- */
  var body = document.getElementById('board-body');
  function renderBoard() {
    markSort();
    var rows = sorted(visibleRows());
    countEl.textContent = rows.length + ' of ' + D.board_size + ' protocols shown';
    body.textContent = '';
    rows.forEach(function (r) {
      var tr = node('tr');
      tr.setAttribute('data-slug', r.slug);
      var nameCell = node('td', 'name');
      nameCell.appendChild(document.createTextNode(r.name));
      if (r.watchlist) nameCell.appendChild(node('span', 'badge', 'Watchlist'));
      var slugLine = node('span', 'slug', r.slug);
      nameCell.appendChild(slugLine);
      var change = node('td', 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), pct(r.change_7d));
      add(tr,
        node('td', 'num', '#' + r.rank),
        nameCell,
        node('td', null, r.category || 'Uncategorized'),
        node('td', 'num', money(r.tvl_usd)),
        change,
        node('td', 'num', mult(r.multiple)),
        node('td', 'num implied', money(r.implied_value_usd)),
        node('td', 'num', ageLabel(r.age_days)));
      tr.addEventListener('click', function () { openDetail(r); });
      body.appendChild(tr);
    });
    if (rows.length === 0) {
      var tr = node('tr');
      var td = node('td', null, 'No protocol matches these filters. Loosen one and the radar sweeps again.');
      td.colSpan = 8;
      tr.appendChild(td);
      body.appendChild(tr);
    }
  }

  document.querySelectorAll('#board-table thead th').forEach(function (th) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-sort');
      if (view.sortKey === key) view.sortDir = -view.sortDir;
      else { view.sortKey = key; view.sortDir = key === 'name' || key === 'category' ? 1 : -1; }
      renderBoard();
    });
  });

  /* Mark the active sort column with a direction arrow. */
  var headerCells = document.querySelectorAll('#board-table thead th');
  headerCells.forEach(function (th) { th.setAttribute('data-label', th.textContent); });
  function markSort() {
    headerCells.forEach(function (th) {
      var label = th.getAttribute('data-label');
      th.textContent = th.getAttribute('data-sort') === view.sortKey
        ? label + (view.sortDir === 1 ? ' ↑' : ' ↓')
        : label;
    });
  }

  qInput.addEventListener('input', function () { view.q = qInput.value; renderBoard(); });
  catSel.addEventListener('change', function () { view.category = catSel.value; renderBoard(); });
  chainSel.addEventListener('change', function () { view.chain = chainSel.value; renderBoard(); });
  tvlSel.addEventListener('change', function () { view.minTvl = Number(tvlSel.value); renderBoard(); });
  watchBox.addEventListener('change', function () { view.watchOnly = watchBox.checked; renderBoard(); });

  /* ---------- live peers ---------- */
  var liveBody = document.getElementById('live-body');
  D.live.forEach(function (p) {
    var tr = node('tr');
    add(tr,
      node('td', 'name', p.name),
      node('td', null, p.category || 'Uncategorized'),
      node('td', 'num', money(p.tvl_usd)),
      node('td', 'num', money(p.mcap_usd)),
      node('td', 'num', p.mcap_tvl === null ? '—' : mult(p.mcap_tvl)),
      node('td', 'num ' + (p.change_7d === null ? '' : p.change_7d >= 0 ? 'pos' : 'neg'), pct(p.change_7d)));
    liveBody.appendChild(tr);
  });

  /* ---------- tabs ---------- */
  var boardWrap = document.getElementById('board-wrap');
  var liveWrap = document.getElementById('live-wrap');
  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('is-active'); });
      tab.classList.add('is-active');
      var which = tab.getAttribute('data-tab');
      boardWrap.classList.toggle('is-hidden', which !== 'board');
      liveWrap.classList.toggle('is-hidden', which !== 'live');
    });
  });

  /* ---------- detail drawer ---------- */
  var drawer = document.getElementById('drawer');
  var drawerBody = document.getElementById('drawer-body');
  var scrim = document.getElementById('scrim');
  function closeDetail() {
    drawer.classList.add('is-hidden');
    scrim.classList.add('is-hidden');
  }
  document.getElementById('drawer-close').addEventListener('click', closeDetail);
  scrim.addEventListener('click', closeDetail);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDetail(); });

  function factorRow(label, value, note) {
    var tr = node('tr');
    add(tr, node('td', null, label), node('td', 'v', value), node('td', null, note));
    return tr;
  }

  function openDetail(r) {
    drawerBody.textContent = '';
    var title = node('h2', null, r.name);
    var sub = node('p', 'sub',
      'Rank #' + r.rank + ' · ' + (r.category || 'Uncategorized') + ' · ' + r.slug +
      (r.watchlist ? ' · on the house watchlist' : ' · early radar (below the watchlist floor)'));
    add(drawerBody, title, sub);

    var kv = node('dl', 'kv');
    [
      ['Status', 'Records no token'],
      ['First tracked', r.listed_at || 'not recorded'],
      ['Age', ageLabel(r.age_days)],
      ['Chains', r.chains.length ? r.chains.join(', ') : '—']
    ].forEach(function (pair) {
      var box = node('div');
      add(box, node('dt', null, pair[0]), node('dd', null, pair[1]));
      kv.appendChild(box);
    });
    drawerBody.appendChild(kv);

    drawerBody.appendChild(node('h3', null, 'Why this implied value'));
    var wrap = node('div', 'breakdown');
    var table = node('table');
    var tb = node('tbody');
    add(tb,
      factorRow('TVL (snapshot)', money(r.tvl_usd), 'the base every factor scales'),
      factorRow('Peer multiple', mult(r.multiple), 'median MCap/TVL of ' + r.peer_count + ' tokenized peers'),
      factorRow('Momentum', mult(r.momentum), 'from the 7-day TVL change of ' + pct(r.change_7d)),
      factorRow('Maturity', mult(r.maturity), 'age ' + ageLabel(r.age_days) + ' against the ' + D.model.maturity_horizon_days + '-day horizon'),
      factorRow('Chain breadth', mult(r.breadth), r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's')));
    var total = node('tr', 'total');
    add(total, node('td', null, 'Implied launch value'), node('td', 'v', money(r.implied_value_usd)), node('td', null, 'our estimate'));
    tb.appendChild(total);
    table.appendChild(tb);
    wrap.appendChild(table);
    drawerBody.appendChild(wrap);

    drawerBody.appendChild(node('h3', null, 'Farm plan — what to do before any launch'));
    var list = node('ol', 'farm');
    r.farm_steps.forEach(function (step, i) {
      var li = node('li');
      var head = node('strong', null, 'Step ' + (i + 1) + '. ');
      li.appendChild(head);
      li.appendChild(document.createTextNode(step));
      list.appendChild(li);
    });
    drawerBody.appendChild(list);

    drawer.classList.remove('is-hidden');
    scrim.classList.remove('is-hidden');
    drawer.scrollTop = 0;
  }

  /* ---------- footer ---------- */
  document.getElementById('foot-line').textContent =
    'Data: ' + D.source + ' · Snapshot as of ' + D.as_of + ' · Watchlist floor ' + money(D.floor_usd) +
    ' · Model ' + D.model_tag + ' · Board generated from the sealed snapshot; nothing on this page was fetched live.';

  renderBoard();
})();
