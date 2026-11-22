/* Token Launch Radar — page logic for the fitted model.
   Everything renders from window.RADAR, the dataset main.ts writes beside
   this page. No fetches, no imports, no network: the page is the dataset
   plus these functions. */
(function () {
  'use strict';

  var D = window.RADAR;
  if (!D) return;

  var state = {
    tab: 'board', q: '', category: '', chain: '', verdict: '',
    minTvl: 0, watchOnly: false, sortKey: 'rank', sortDir: 1,
  };

  /* ---------- small DOM helpers ---------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function put(parent) {
    for (var i = 1; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) parent.appendChild(x); });
      else parent.appendChild(c);
    }
    return parent;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }

  /* ---------- formatting ---------- */
  function money(v) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    var a = Math.abs(v);
    if (a >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + Math.round(v / 1e3) + 'K';
    return '$' + Math.round(v);
  }
  function pctChange(v) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    return (v > 0 ? '+' : '') + v.toFixed(1) + '%';
  }
  function mult(v) { return v.toFixed(v < 0.1 ? 3 : 2) + 'x'; }
  function oddsLabel(v) { return Math.round(v * 100) + '%'; }
  function ageLabel(days) {
    if (days === null || days === undefined) return 'age unknown';
    if (days < 365) return Math.round(days / 30) + ' months listed';
    return (days / 365).toFixed(1) + ' yrs listed';
  }
  function badge(verdict) {
    return el('span', 'badge badge-' + verdict.toLowerCase(), verdict);
  }

  /* ---------- KPI strip ---------- */
  function renderKpis() {
    var v = D.validation;
    var tiles = [
      ['Protocols scanned', String(D.universe_size), ''],
      ['Candidates ranked', String(D.board_size), 'watchlist ' + D.watchlist_size + '/' + D.watchlist_size + ' covered'],
      ['Aggregate implied value', money(D.aggregate_implied_usd), 'whole board'],
      ['Held-out median error', 'x' + Math.pow(10, v.median_abs_log10_error).toFixed(2), v.test_peers + ' unseen peers'],
      ['Snapshot date', D.as_of, 'sealed pull'],
    ];
    var dl = document.getElementById('kpis');
    clear(dl);
    tiles.forEach(function (t) {
      var dd = el('dd', null, t[1]);
      if (t[2]) dd.appendChild(el('small', null, ' ' + t[2]));
      put(dl, put(el('div', 'kpi'), el('dt', null, t[0]), dd));
    });
  }

  /* ---------- method + validation panels ---------- */
  function renderMethod() {
    var f = D.fit, cfg = D.config;
    var body = document.getElementById('method-body');
    clear(body);
    put(body,
      el('p', 'formula', 'implied value = TVL x fitted multiple x launch odds x momentum x maturity'),
      el('p', null, 'The multiple is fitted, not looked up: across the ' + D.peer_size + ' tokenized peers, log(market cap / TVL) is regressed on log(TVL) — slope ' + f.slope.toFixed(2) + ' per tenfold of TVL — with one intercept per category, each shrunk toward the global intercept with weight ' + cfg.shrink_k + ' so a category with two peers cannot dictate its own multiple. ' + f.categories_fitted + ' category intercepts were fitted. Predictions are clamped to ' + cfg.multiple_floor + 'x–' + cfg.multiple_cap + 'x.'),
      el('p', null, 'Launch odds are read off the snapshot itself: protocols are grouped by age band and TVL band, and a group\'s odds are the share of its members that already record a token, pooled toward the category share and then the market base rate of ' + Math.round(D.odds.base_rate * 100) + '% (' + D.odds.tokenized_count + ' of ' + D.universe_size + ' protocols record a token). Momentum scales the 7-day TVL change at weight ' + cfg.momentum_weight + ', clamped between ' + cfg.momentum_floor_pct + '% and +' + cfg.momentum_cap_pct + '%. Maturity lifts value from ' + cfg.maturity_base + ' to ' + (cfg.maturity_base + cfg.maturity_span).toFixed(2) + ' over ' + cfg.maturity_horizon_days + ' days listed.')
    );
    var vb = document.getElementById('validation-body');
    clear(vb);
    var v = D.validation;
    var errLine = el('p');
    put(errLine,
      el('span', 'big-err', 'x' + Math.pow(10, v.median_abs_log10_error).toFixed(2) + ' median miss'),
      document.createTextNode(' — half of the held-out peers were predicted within this factor of their real market cap, half were further off.')
    );
    put(vb,
      errLine,
      el('p', null, 'The ' + D.peer_size + ' peers were split by a stable hash of the slug: ' + v.train_peers + ' fitted the model, ' + v.test_peers + ' were held back and predicted blind. ' + v.within_2x_pct + '% of the blind predictions landed within 2x of the real market cap and ' + v.within_3x_pct + '% within 3x; the median absolute percentage error was ' + Math.round(v.median_abs_pct_error * 100) + '%.'),
      el('p', null, 'Why the error is wide: peer multiples themselves run from ' + f.peer_ratio_p10.toFixed(2) + 'x (10th percentile) through a median of ' + f.peer_ratio_median.toFixed(2) + 'x to ' + f.peer_ratio_p90.toFixed(2) + 'x (90th percentile). Any model built on them inherits that spread, so this board ranks and brackets — it does not price. The production fit uses all ' + D.peer_size + ' peers; the error above is always the held-out figure, never the in-sample one.')
    );
  }

  /* ---------- board ---------- */
  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    return D.rows.filter(function (r) {
      if (state.watchOnly && !r.watchlist) return false;
      if (state.category && (r.category || 'Uncategorized') !== state.category) return false;
      if (state.chain && r.chains.indexOf(state.chain) === -1) return false;
      if (state.verdict && r.verdict !== state.verdict) return false;
      if (r.tvl_usd < state.minTvl) return false;
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.indexOf(q) === -1) return false;
      return true;
    });
  }

  function sortedRows(rows) {
    var key = state.sortKey, dir = state.sortDir;
    return rows.slice().sort(function (a, b) {
      var x = a[key], y = b[key];
      if (key === 'verdict') { x = { Farm: 0, Thin: 1, Skip: 2 }[x]; y = { Farm: 0, Thin: 1, Skip: 2 }[y]; }
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      if (typeof x === 'string') return dir * x.localeCompare(y);
      return dir * (x - y);
    });
  }

  function renderBoard() {
    var rows = sortedRows(visibleRows());
    var tbody = clear(document.getElementById('board-body'));
    rows.forEach(function (r) {
      var nameCell = el('td');
      put(nameCell, el('span', 'pname', r.name), el('span', 'pslug', ' ' + r.slug));
      if (r.watchlist) nameCell.appendChild(el('span', 'watch-flag', 'watchlist'));
      var chg = el('td', 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), pctChange(r.change_7d));
      var tr = put(el('tr'),
        el('td', 'num', r.rank),
        nameCell,
        el('td', null, r.category || 'Uncategorized'),
        el('td', 'num', money(r.tvl_usd)),
        chg,
        el('td', 'num', mult(r.multiple)),
        el('td', 'num', oddsLabel(r.launch_odds)),
        el('td', 'num', money(r.implied_value_usd)),
        put(el('td'), badge(r.verdict))
      );
      tr.addEventListener('click', function () { openDrawer(r); });
      tbody.appendChild(tr);
    });
    document.getElementById('row-count').textContent =
      rows.length + ' of ' + D.board_size + ' candidates shown';
  }

  /* ---------- live peers ---------- */
  function renderLive() {
    var tbody = clear(document.getElementById('live-body'));
    D.live.forEach(function (p) {
      put(tbody, put(el('tr'),
        el('td', null, p.name),
        el('td', null, p.category || 'Uncategorized'),
        el('td', 'num', money(p.tvl_usd)),
        el('td', 'num', money(p.mcap_usd)),
        el('td', 'num', p.mcap_tvl === null ? '—' : mult(p.mcap_tvl)),
        el('td', 'num', pctChange(p.change_7d))
      ));
    });
  }

  /* ---------- detail drawer ---------- */
  function arithRow(label, why, value) {
    var left = el('td');
    put(left, document.createTextNode(label), el('span', 'why', why));
    return put(el('tr'), left, el('td', 'num', value));
  }

  function openDrawer(r) {
    var body = clear(document.getElementById('drawer-body'));
    var sub = (r.category || 'Uncategorized') + ' · ' + r.chains.join(', ') + ' · ' + ageLabel(r.age_days) +
      (r.listed_at ? ' (tracked since ' + r.listed_at + ')' : '') + (r.watchlist ? ' · on the house watchlist' : '');
    var verdictBox = el('div', 'verdict-box');
    put(verdictBox, badge(r.verdict), document.createTextNode(r.verdict_reason));

    var arith = el('table', 'arith');
    put(arith,
      arithRow('TVL', 'the protocol\'s own figure in the snapshot', money(r.tvl_usd)),
      arithRow('x fitted multiple', r.multiple_from === 'category'
        ? 'the ' + (r.category || 'category') + ' intercept, fitted on ' + r.category_peers + (r.category_peers === 1 ? ' tokenized peer' : ' tokenized peers') + ' and shrunk toward the global fit'
        : 'no tokenized peers in its category — the global fit applies', mult(r.multiple)),
      arithRow('x launch odds', 'of the ' + r.odds_cell_members + ' protocols in its age x size group, ' + Math.round(r.odds_cell_share * 100) + '% already record a token; its category share is ' + Math.round(r.odds_category_share * 100) + '%', oddsLabel(r.launch_odds)),
      arithRow('x momentum', '7-day TVL change ' + pctChange(r.change_7d) + ', clamped and weighted', 'x' + r.momentum.toFixed(2)),
      arithRow('x maturity', ageLabel(r.age_days) + ' with no token recorded', 'x' + r.maturity.toFixed(2))
    );
    var total = put(el('tr', 'total'), el('td', null, 'Implied launch value'), el('td', 'num', money(r.implied_value_usd)));
    arith.appendChild(total);

    var plan = el('ol', 'plan');
    r.farm_steps.forEach(function (s) { plan.appendChild(el('li', null, s)); });

    put(body,
      el('h2', null, r.name),
      el('p', 'd-sub', sub),
      verdictBox,
      el('h3', null, 'The arithmetic'),
      arith,
      el('h3', null, 'Farm plan — ' + r.verdict),
      plan
    );
    document.getElementById('drawer').classList.remove('is-hidden');
    document.getElementById('scrim').classList.remove('is-hidden');
  }

  function closeDrawer() {
    document.getElementById('drawer').classList.add('is-hidden');
    document.getElementById('scrim').classList.add('is-hidden');
  }

  /* ---------- wiring ---------- */
  function fillSelect(id, values, allLabel) {
    var sel = document.getElementById(id);
    sel.appendChild(el('option', null, allLabel));
    sel.options[0].value = '';
    values.forEach(function (v) {
      var o = el('option', null, v);
      o.value = v;
      sel.appendChild(o);
    });
  }

  function init() {
    renderKpis();
    renderMethod();
    renderBoard();
    renderLive();
    fillSelect('f-category', D.categories, 'All categories');
    fillSelect('f-chain', D.chains, 'All chains');

    document.getElementById('foot-line').textContent =
      'Model ' + D.model_tag + ' · fitted on ' + D.peer_size + ' tokenized peers · verdicts on the board: ' +
      D.verdict_counts.Farm + ' Farm, ' + D.verdict_counts.Thin + ' Thin, ' + D.verdict_counts.Skip + ' Skip · ' +
      'snapshot: ' + D.source;

    document.getElementById('f-q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); });
    document.getElementById('f-category').addEventListener('change', function (e) { state.category = e.target.value; renderBoard(); });
    document.getElementById('f-chain').addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); });
    document.getElementById('f-verdict').addEventListener('change', function (e) { state.verdict = e.target.value; renderBoard(); });
    document.getElementById('f-tvl').addEventListener('change', function (e) { state.minTvl = Number(e.target.value); renderBoard(); });
    document.getElementById('f-watch').addEventListener('change', function (e) { state.watchOnly = e.target.checked; renderBoard(); });

    var heads = document.querySelectorAll('#board-table th[data-sort]');
    heads.forEach(function (th) {
      th.addEventListener('click', function () {
        var key = th.getAttribute('data-sort');
        if (state.sortKey === key) state.sortDir = -state.sortDir;
        else { state.sortKey = key; state.sortDir = key === 'name' || key === 'category' ? 1 : -1; }
        if (key === 'rank') state.sortDir = 1;
        renderBoard();
      });
    });

    var tabs = document.querySelectorAll('.tab');
    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        tabs.forEach(function (x) { x.classList.remove('is-active'); });
        t.classList.add('is-active');
        state.tab = t.getAttribute('data-tab');
        document.getElementById('board-wrap').classList.toggle('is-hidden', state.tab !== 'board');
        document.getElementById('live-wrap').classList.toggle('is-hidden', state.tab !== 'live');
      });
    });

    document.getElementById('drawer-close').addEventListener('click', closeDrawer);
    document.getElementById('scrim').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });
  }

  init();
})();
