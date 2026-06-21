(function () {
  'use strict';

  var REFRESH_MS = 30000;
  var STALE_AFTER_DAYS = 300;
  var PREFS_KEY = 'metro-planner-prefs';

  if (!window.METRO || !window.MetroEngine || !window.MetroRouter) return;

  var METRO = window.METRO;
  var engine = window.MetroEngine;
  var router = window.MetroRouter.createRouter(METRO);

  document.getElementById('boot-error').remove();

  // ---------------------------------------------------------- estado da UI
  var state = {
    mode: 'plan',            // 'plan' | 'line'
    origin: null,            // id de estação (modo planear)
    dest: null,
    line: null,              // id de linha (modo por linha)
    lineOrigin: null,
    lineDest: null
  };

  // ---------------------------------------------------------- utilidades
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  var LANG = (window.MetroI18n && window.MetroI18n.lang) || 'pt';
  var LOCALE = LANG === 'en' ? 'en-GB' : 'pt-PT';

  function stationName(id) { return router.station(id).name; }

  // Nome de linha localizado: "Linha B" / "Line B" (a letra mantém-se).
  function lineName(line) {
    return t('line') + ' ' + line.id.toUpperCase();
  }

  function fmtDate(d) {
    var s = new Intl.DateTimeFormat(LOCALE,
      { weekday: 'long', day: 'numeric', month: 'long' }).format(d);
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function fmtDur(min) {
    if (min < 60) return min + ' ' + t('min');
    return Math.floor(min / 60) + ' ' + t('hour') + ' ' +
      (min % 60 ? (min % 60) + ' ' + t('min') : '');
  }

  function fmtPrice(v) {
    return v.toFixed(2).replace('.', LANG === 'en' ? '.' : ',') + ' €';
  }

  function dayLabel(dt) { return t('day_' + dt); }

  function priceReason(price) {
    switch (price.reasonCode) {
      case 'zones_missing': return t('reason_zones_missing');
      case 'zones_disconnected': return t('reason_zones_disconnected');
      case 'no_fare': return t('reason_no_fare', { title: 'Z' + price.zoneCount });
      default: return price.reason || '';
    }
  }

  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        mode: state.mode, origin: state.origin, dest: state.dest,
        line: state.line, lineOrigin: state.lineOrigin, lineDest: state.lineDest
      }));
    } catch (e) { /* sem persistência */ }
  }

  function lineBadge(lineId) {
    var line = router.line(lineId);
    var b = el('span', 'line-dot', line.id.toUpperCase());
    b.style.background = line.color;
    b.title = lineName(line);
    return b;
  }

  // ---------------------------------------------------------- autocomplete
  function attachAutocomplete(inputId, sugId, onPick) {
    var input = document.getElementById(inputId);
    var sug = document.getElementById(sugId);
    var clearBtn = document.querySelector('.clear-btn[data-for="' + inputId + '"]');

    function close() { sug.classList.add('hidden'); sug.textContent = ''; }

    function render(list) {
      sug.textContent = '';
      if (!list.length) { close(); return; }
      list.forEach(function (s) {
        var item = el('div', 'suggestion');
        var nameWrap = el('span', 'sug-name', s.name);
        item.appendChild(nameWrap);
        var dots = el('span', 'sug-lines');
        s.lines.forEach(function (lid) { dots.appendChild(lineBadge(lid)); });
        item.appendChild(dots);
        item.addEventListener('mousedown', function (ev) {
          ev.preventDefault(); // antes do blur
          input.value = s.name;
          clearBtn.classList.remove('hidden');
          close();
          onPick(s.id);
        });
        sug.appendChild(item);
      });
      sug.classList.remove('hidden');
    }

    input.addEventListener('input', function () {
      onPick(null); // texto alterado invalida a escolha anterior
      clearBtn.classList.toggle('hidden', !input.value);
      render(router.searchStations(input.value, 7));
    });
    input.addEventListener('focus', function () {
      if (input.value && !state[inputId === 'origin-input' ? 'origin' : 'dest']) {
        render(router.searchStations(input.value, 7));
      }
    });
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        var first = sug.querySelector('.suggestion');
        if (first) first.dispatchEvent(new MouseEvent('mousedown'));
      } else if (ev.key === 'Escape') close();
    });
    input.addEventListener('blur', function () { setTimeout(close, 150); });
    clearBtn.addEventListener('click', function () {
      input.value = '';
      clearBtn.classList.add('hidden');
      onPick(null);
      input.focus();
    });

    return {
      set: function (id) {
        input.value = id ? stationName(id) : '';
        clearBtn.classList.toggle('hidden', !id);
      }
    };
  }

  // ---------------------------------------------------------- modo por linha
  function buildLineChips() {
    var wrap = document.getElementById('line-chips');
    METRO.network.lines.forEach(function (line) {
      var chip = el('button', 'line-chip', lineName(line));
      chip.type = 'button';
      chip.setAttribute('role', 'radio');
      chip.dataset.line = line.id;
      chip.style.setProperty('--line-color', line.color);
      if (METRO.schedules[line.id] && METRO.schedules[line.id].demo) {
        chip.classList.add('demo-line');
        chip.title = t('badge_temp_title');
      } else if (METRO.schedules[line.id] && METRO.schedules[line.id].estimated) {
        chip.classList.add('estimated-line');
        chip.title = t('badge_estimated_title');
      }
      chip.addEventListener('click', function () { pickLine(line.id); });
      wrap.appendChild(chip);
    });
  }

  function pickLine(lineId) {
    state.line = lineId;
    document.querySelectorAll('.line-chip').forEach(function (c) {
      c.classList.toggle('active', c.dataset.line === lineId);
      c.setAttribute('aria-checked', c.dataset.line === lineId ? 'true' : 'false');
    });
    var line = router.line(lineId);
    var selO = document.getElementById('line-origin');
    var selD = document.getElementById('line-dest');
    selO.textContent = ''; selD.textContent = '';
    line.stations.forEach(function (sid) {
      selO.appendChild(new Option(stationName(sid), sid));
      selD.appendChild(new Option(stationName(sid), sid));
    });
    selO.value = state.lineOrigin && line.stations.indexOf(state.lineOrigin) !== -1
      ? state.lineOrigin : line.stations[0];
    selD.value = state.lineDest && line.stations.indexOf(state.lineDest) !== -1
      ? state.lineDest : line.stations[line.stations.length - 1];
    state.lineOrigin = selO.value;
    state.lineDest = selD.value;
    document.getElementById('line-selects').classList.remove('hidden');
    savePrefs();
    render();
  }

  // ---------------------------------------------------------- renderização
  var resultEl = document.getElementById('result');

  function badge(text, cls, title) {
    var b = el('span', 'badge ' + (cls || ''), text);
    if (title) b.title = title;
    return b;
  }

  function renderLeg(leg) {
    var row = el('div', 'leg');
    row.appendChild(lineBadge(leg.lineId));
    var txt = el('div', 'leg-text');
    var names = el('p', 'leg-route',
      stationName(leg.from) + ' → ' + stationName(leg.to));
    if (leg.service === 'Bx') {
      names.appendChild(badge('Bx', 'bx', t('bx_title')));
    }
    txt.appendChild(names);
    if (leg.dep) txt.appendChild(el('p', 'leg-times', leg.dep + ' – ' + leg.arr));
    row.appendChild(txt);
    return row;
  }

  function renderPriceRow(price) {
    var p = el('div', 'price-row');
    if (price.available) {
      var main = el('p', 'price-main');
      main.textContent = t('price_andante', { title: price.title }) +
        (price.estimated ? '≈ ' : '') + fmtPrice(price.price);
      p.appendChild(main);
      p.appendChild(el('p', 'price-note',
        t('price_zones_note', { zone: price.originZone })));
    } else {
      p.classList.add('muted');
      p.textContent = t('price_not_calc', { reason: priceReason(price) });
    }
    return p;
  }

  function renderJourneyCard(j, opts) {
    opts = opts || {};
    var card = el('div', 'card journey' + (opts.highlight ? ' next-card' : ''));
    var head = el('div', 'journey-head');
    var times = el('p', 'journey-times', j.dep + ' → ' + j.arr);
    head.appendChild(times);
    var meta = el('p', 'journey-meta', fmtDur(j.durationMin) + ' · ' +
      (j.nTransfers
        ? j.nTransfers + ' ' + (j.nTransfers > 1 ? t('transfer_many') : t('transfer_one'))
        : t('direct')));
    head.appendChild(meta);
    card.appendChild(head);
    if (opts.waitMin !== undefined && opts.waitMin !== null) {
      var w = el('p', 'next-wait', opts.waitMin <= 0 ? t('wait_now')
        : t('wait_in', { dur: fmtDur(opts.waitMin) }));
      if (opts.waitMin <= 1) w.classList.add('now');
      card.appendChild(w);
    }
    j.legs.forEach(function (leg, i) {
      if (i > 0) {
        var tr = j.transfers[i - 1];
        card.appendChild(el('p', 'transfer-row',
          t('transfer_at', { station: stationName(tr.station), min: tr.waitMin })));
      }
      card.appendChild(renderLeg(leg));
    });
    card.appendChild(renderPriceRow(j.price));
    if (j.demo) {
      card.appendChild(badge(t('badge_temp'), 'demo', t('badge_temp_title')));
    } else if (j.estimated) {
      card.appendChild(badge(t('badge_estimated'), 'estimated', t('badge_estimated_title')));
    }
    if (opts.highlight) card.appendChild(renderShareButton());
    return card;
  }

  function renderMessage(html) {
    var card = el('div', 'card state-msg');
    var p = el('p');
    p.innerHTML = html;
    card.appendChild(p);
    return card;
  }

  function currentQuery() {
    if (state.mode === 'plan') {
      return { origin: state.origin, dest: state.dest, lineFilter: null };
    }
    return { origin: state.lineOrigin, dest: state.lineDest, lineFilter: state.line };
  }

  // ---------------------------------------------------------- URL partilhável
  function buildShareUrl() {
    var p = new URLSearchParams();
    if (state.mode === 'line') {
      p.set('modo', 'linha');
      if (state.line) p.set('linha', state.line);
      if (state.lineOrigin) p.set('de', state.lineOrigin);
      if (state.lineDest) p.set('para', state.lineDest);
    } else {
      if (state.origin) p.set('de', state.origin);
      if (state.dest) p.set('para', state.dest);
    }
    var di = document.getElementById('travel-date');
    if (di.value && di.value !== dateISO(new Date())) p.set('data', di.value);
    if (LANG === 'en') p.set('lang', 'en');
    var qs = p.toString();
    return location.origin + location.pathname + (qs ? '?' + qs : '');
  }

  function syncUrl() {
    try {
      var url = buildShareUrl();
      if (url !== location.href) history.replaceState(null, '', url);
    } catch (e) { /* file:// ou indisponível */ }
  }

  // Lê o estado a partir do URL; devolve true se havia algo para aplicar.
  function readUrlState() {
    var p = new URLSearchParams(location.search);
    if (!['de', 'para', 'linha', 'modo', 'data'].some(function (k) { return p.has(k); })) {
      return false;
    }
    var de = p.get('de'), para = p.get('para');
    if (p.get('modo') === 'linha' || p.has('linha')) {
      state.mode = 'line';
      if (de && router.station(de)) state.lineOrigin = de;
      if (para && router.station(para)) state.lineDest = para;
      var ln = p.get('linha');
      if (ln && router.line(ln)) state.line = ln;
    } else {
      state.mode = 'plan';
      if (de && router.station(de)) state.origin = de;
      if (para && router.station(para)) state.dest = para;
    }
    var data = p.get('data');
    if (data && /^\d{4}-\d{2}-\d{2}$/.test(data)) {
      document.getElementById('travel-date').value = data;
    }
    return true;
  }

  function shareCurrent(btn) {
    var url = buildShareUrl();
    var oId = state.mode === 'line' ? state.lineOrigin : state.origin;
    var dId = state.mode === 'line' ? state.lineDest : state.dest;
    var text = t('share_text', { from: stationName(oId), to: stationName(dId) });
    if (navigator.share) {
      navigator.share({ title: t('share_title'), text: text, url: url })
        .catch(function () { /* cancelado */ });
      return;
    }
    var done = function () {
      var original = btn.textContent;
      btn.textContent = t('link_copied');
      btn.classList.add('copied');
      setTimeout(function () { btn.textContent = original; btn.classList.remove('copied'); }, 2000);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, function () { window.prompt(t('copy_prompt'), url); });
    } else {
      window.prompt(t('copy_prompt'), url);
    }
  }

  function renderShareButton() {
    var row = el('div', 'share-row');
    var btn = el('button', 'share-btn', t('share_trip'));
    btn.type = 'button';
    btn.addEventListener('click', function () { shareCurrent(btn); });
    row.appendChild(btn);
    return row;
  }

  function dateISO(d) {
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function selectedTravelDate(now) {
    var input = document.getElementById('travel-date');
    if (!input.value) return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var parts = input.value.split('-');
    return new Date(+parts[0], +parts[1] - 1, +parts[2]);
  }

  function queryContext(now) {
    var selected = selectedTravelDate(now);
    var live = dateISO(selected) === dateISO(now);
    var queryNow = live ? now : new Date(
      selected.getFullYear(),
      selected.getMonth(),
      selected.getDate(),
      Math.floor(engine.SERVICE_DAY_CUTOFF_MIN / 60),
      0
    );
    return {
      selected: selected,
      live: live,
      queryNow: queryNow,
      dayTypeOverride: live ? null : engine.dayTypeFor(selected, METRO.holidays)
    };
  }

  function renderDateChip(qctx) {
    var chip = document.getElementById('daytype-chip');
    var dt = engine.dayTypeFor(qctx.selected, METRO.holidays);
    chip.textContent = (qctx.live ? t('chip_today_live') : t('chip_from_service')) + dayLabel(dt);
    chip.className = 'daytype-chip' + (dt === 'sunday_holiday' ? ' holiday' : '');
  }

  function render() {
    var now = new Date();
    var qctx = queryContext(now);
    document.getElementById('date-line').textContent = fmtDate(qctx.selected);
    renderDateChip(qctx);

    syncUrl();
    resultEl.textContent = '';
    var q = currentQuery();

    if (!q.origin || !q.dest) {
      resultEl.appendChild(renderMessage(t(state.mode === 'plan'
        ? 'msg_choose_plan' : 'msg_choose_line')));
      return;
    }
    if (q.origin === q.dest) {
      resultEl.appendChild(renderMessage(t('msg_same_station')));
      return;
    }

    var r = router.plan(q.origin, q.dest, qctx.queryNow, {
      dayTypeOverride: qctx.dayTypeOverride, lineFilter: q.lineFilter, alternatives: 4
    });

    if (r.state === 'none') {
      resultEl.appendChild(renderMessage(state.mode === 'line'
        ? t('msg_none_line', { line: lineName(router.line(state.line)) })
        : t('msg_none_plan')));
      return;
    }

    if (r.state === 'untimed') {
      resultEl.appendChild(renderMessage(t('msg_untimed')));
      r.untimedRoutes.forEach(function (u) {
        var card = el('div', 'card journey');
        u.legs.forEach(function (leg, i) {
          if (i > 0) card.appendChild(el('p', 'transfer-row',
            t('transfer_at_short', { station: stationName(leg.from) })));
          card.appendChild(renderLeg(leg));
        });
        card.appendChild(renderPriceRow(u.price));
        card.appendChild(el('p', 'muted',
          t('msg_no_times_for', { lines: u.missingLines.map(function (l) {
            return lineName(router.line(l));
          }).join(', ') })));
        resultEl.appendChild(card);
      });
      return;
    }

    if (r.state === 'tomorrow') {
      resultEl.appendChild(renderMessage(t('msg_tomorrow', {
        date: fmtDate(r.nextServiceDate).toLowerCase(), day: dayLabel(r.dayType)
      })));
      resultEl.appendChild(renderJourneyCard(r.best, { highlight: true }));
      return;
    }

    // r.state === 'ok'
    var waitMin = qctx.live ? r.best.depMin - r.nowMin : null;
    resultEl.appendChild(renderJourneyCard(r.best, { highlight: true, waitMin: waitMin }));
    if (r.following.length) {
      var listCard = el('div', 'card');
      listCard.appendChild(el('p', 'list-title', t('next_options')));
      var ul = el('ul', 'dep-list');
      r.following.forEach(function (j) {
        var li = el('li');
        li.appendChild(el('span', 'dep-time', j.dep + ' → ' + j.arr));
        var lines = el('span', 'sug-lines');
        j.legs.forEach(function (leg) { lines.appendChild(lineBadge(leg.lineId)); });
        li.appendChild(lines);
        li.appendChild(el('span', 'dep-arr', fmtDur(j.durationMin) +
          (j.nTransfers ? ' · ' + j.nTransfers + '×⇄' : '')));
        ul.appendChild(li);
      });
      listCard.appendChild(ul);
      resultEl.appendChild(listCard);
    }
  }

  // ---------------------------------------------------------- rodapé fixo
  function renderStaticInfo() {
    var real = [], estimated = [], demo = [];
    METRO.network.lines.forEach(function (l) {
      var s = METRO.schedules[l.id];
      var nm = lineName(l);
      if (s && s.estimated) estimated.push(nm);
      else if (s && !s.demo) real.push(nm);
      else demo.push(nm);
    });
    var src = t('src_official', { lines: real.join(', ') || t('src_none') });
    var bSched = METRO.schedules.b;
    if (bSched && bSched.validity && bSched.validity.from) {
      src += t('src_since', { date: bSched.validity.from.split('-').reverse().join('/') });
    }
    if (demo.length) src += t('src_temp', { lines: demo.join(', ') });
    if (estimated.length) src += t('src_estimated', { lines: estimated.join(', ') });
    document.getElementById('source-line').textContent = src;

    var f = METRO.fares;
    document.getElementById('fares-line').textContent = t('fares_line', {
      date: f.validFrom.split('-').reverse().join('/'), source: f.source
    });
    document.getElementById('notes-line').textContent = t('notes_line');

    if (bSched && bSched.validity && bSched.validity.from) {
      var age = (Date.now() - new Date(bSched.validity.from).getTime()) / 86400000;
      if (age > STALE_AFTER_DAYS) {
        var banner = document.getElementById('stale-banner');
        banner.textContent = t('stale_banner', { months: Math.floor(age / 30) });
        banner.classList.remove('hidden');
      }
    }
  }

  // ---------------------------------------------------------- modos / eventos
  function setMode(mode) {
    state.mode = mode;
    document.getElementById('tab-plan').classList.toggle('active', mode === 'plan');
    document.getElementById('tab-line').classList.toggle('active', mode === 'line');
    document.getElementById('tab-plan').setAttribute('aria-selected', mode === 'plan');
    document.getElementById('tab-line').setAttribute('aria-selected', mode === 'line');
    document.getElementById('mode-plan').classList.toggle('hidden', mode !== 'plan');
    document.getElementById('mode-line').classList.toggle('hidden', mode !== 'line');
    savePrefs();
    render();
  }

  var originAC = attachAutocomplete('origin-input', 'origin-suggestions', function (id) {
    state.origin = id; savePrefs(); render();
  });
  var destAC = attachAutocomplete('dest-input', 'dest-suggestions', function (id) {
    state.dest = id; savePrefs(); render();
  });

  document.getElementById('swap').addEventListener('click', function () {
    var o = state.origin;
    state.origin = state.dest;
    state.dest = o;
    originAC.set(state.origin);
    destAC.set(state.dest);
    savePrefs(); render();
  });

  document.getElementById('tab-plan').addEventListener('click', function () { setMode('plan'); });
  document.getElementById('tab-line').addEventListener('click', function () { setMode('line'); });
  document.getElementById('travel-date').addEventListener('change', render);
  document.getElementById('line-origin').addEventListener('change', function (e) {
    state.lineOrigin = e.target.value; savePrefs(); render();
  });
  document.getElementById('line-dest').addEventListener('change', function (e) {
    state.lineDest = e.target.value; savePrefs(); render();
  });

  // ---------------------------------------------------------- arranque
  var dateInput = document.getElementById('travel-date');
  dateInput.value = dateISO(new Date());
  dateInput.min = dateISO(new Date());
  buildLineChips();

  // O URL (link partilhado) tem prioridade sobre as preferências guardadas.
  var fromUrl = readUrlState();
  if (!fromUrl) {
    var prefs = loadPrefs();
    state.mode = prefs.mode === 'line' ? 'line' : 'plan';
    if (prefs.origin && router.station(prefs.origin)) state.origin = prefs.origin;
    if (prefs.dest && router.station(prefs.dest)) state.dest = prefs.dest;
    state.lineOrigin = prefs.lineOrigin || null;
    state.lineDest = prefs.lineDest || null;
    if (prefs.line && router.line(prefs.line)) state.line = prefs.line;
  }
  originAC.set(state.origin);
  destAC.set(state.dest);
  if (state.line) pickLine(state.line);
  renderStaticInfo();
  setMode(state.mode);
  setInterval(render, REFRESH_MS);

  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    navigator.serviceWorker.register('sw.js').catch(function () { /* opcional */ });
  }
})();
