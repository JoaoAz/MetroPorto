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

  function stationName(id) { return router.station(id).name; }

  function fmtDate(d) {
    var s = new Intl.DateTimeFormat('pt-PT',
      { weekday: 'long', day: 'numeric', month: 'long' }).format(d);
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function fmtDur(min) {
    if (min < 60) return min + ' min';
    return Math.floor(min / 60) + ' h ' + (min % 60 ? (min % 60) + ' min' : '');
  }

  function fmtPrice(v) { return v.toFixed(2).replace('.', ',') + ' €'; }

  var DAY_LABEL = {
    weekday: 'dia útil', saturday: 'sábado', sunday_holiday: 'domingo/feriado'
  };

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
    b.title = line.name;
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
      var chip = el('button', 'line-chip', line.name);
      chip.type = 'button';
      chip.setAttribute('role', 'radio');
      chip.dataset.line = line.id;
      chip.style.setProperty('--line-color', line.color);
      if (METRO.schedules[line.id] && METRO.schedules[line.id].demo) {
        chip.classList.add('demo-line');
        chip.title = 'Linha sem horários reais neste PDF; usa horários temporários.';
      } else if (METRO.schedules[line.id] && METRO.schedules[line.id].estimated) {
        chip.classList.add('estimated-line');
        chip.title = 'Horários estimados por frequência; confirmar no operador.';
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
      names.appendChild(badge('Bx', 'bx', 'Serviço expresso — não para em todas as estações'));
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
      main.textContent = 'Andante ' + price.title + ' — ' +
        (price.estimated ? '≈ ' : '') + fmtPrice(price.price);
      p.appendChild(main);
      p.appendChild(el('p', 'price-note',
        'Zonas estimadas a partir de ' + price.originZone +
        '. Confirmar preço e zonas no operador.'));
      if (price.estimated) {
        p.title = 'Estimativa: zonas atribuídas a partir do mapa Andante, por validar.';
      }
    } else {
      p.classList.add('muted');
      p.textContent = 'Preço não calculado: ' + price.reason + '.';
    }
    return p;
  }

  function renderJourneyCard(j, opts) {
    opts = opts || {};
    var card = el('div', 'card journey' + (opts.highlight ? ' next-card' : ''));
    var head = el('div', 'journey-head');
    var times = el('p', 'journey-times', j.dep + ' → ' + j.arr);
    head.appendChild(times);
    var meta = el('p', 'journey-meta', fmtDur(j.durationMin) +
      (j.nTransfers ? ' · ' + j.nTransfers + ' transbordo' + (j.nTransfers > 1 ? 's' : '') : ' · direto'));
    head.appendChild(meta);
    card.appendChild(head);
    if (opts.waitMin !== undefined && opts.waitMin !== null) {
      var w = el('p', 'next-wait', opts.waitMin <= 0 ? 'a partir agora'
        : 'parte em ' + fmtDur(opts.waitMin));
      if (opts.waitMin <= 1) w.classList.add('now');
      card.appendChild(w);
    }
    j.legs.forEach(function (leg, i) {
      if (i > 0) {
        var tr = j.transfers[i - 1];
        card.appendChild(el('p', 'transfer-row',
          '⇄ Transbordo em ' + stationName(tr.station) + ' · espera ' + tr.waitMin + ' min'));
      }
      card.appendChild(renderLeg(leg));
    });
    card.appendChild(renderPriceRow(j.price));
    if (j.demo) {
      card.appendChild(badge('horários temporários', 'demo',
        'Este percurso usa uma linha sem horários reais no PDF carregado.'));
    } else if (j.estimated) {
      card.appendChild(badge('Linha D: horário estimado', 'estimated',
        'Horário gerado por frequência a partir das imagens fornecidas; confirmar no operador.'));
    }
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
    chip.textContent = (qctx.live ? 'Hoje · ao vivo · ' : 'Desde o início do serviço · ') + DAY_LABEL[dt];
    chip.className = 'daytype-chip' + (dt === 'sunday_holiday' ? ' holiday' : '');
  }

  function render() {
    var now = new Date();
    var qctx = queryContext(now);
    var autoDay = engine.dayTypeFor(qctx.selected, METRO.holidays);
    document.getElementById('date-line').textContent =
      fmtDate(qctx.selected) + ' · ' + DAY_LABEL[autoDay];
    renderDateChip(qctx);

    resultEl.textContent = '';
    var q = currentQuery();

    if (!q.origin || !q.dest) {
      resultEl.appendChild(renderMessage(state.mode === 'plan'
        ? 'Escolha a <strong>origem</strong> e o <strong>destino</strong>. A app encontra a linha e, se necessário, o transbordo.'
        : 'Escolha a linha e depois a origem e o destino dentro dessa linha.'));
      return;
    }
    if (q.origin === q.dest) {
      resultEl.appendChild(renderMessage('A origem e o destino são a mesma estação.'));
      return;
    }

    var r = router.plan(q.origin, q.dest, qctx.queryNow, {
      dayTypeOverride: qctx.dayTypeOverride, lineFilter: q.lineFilter, alternatives: 4
    });

    if (r.state === 'none') {
      resultEl.appendChild(renderMessage(state.mode === 'line'
        ? 'Estas estações não estão ambas na ' + router.line(state.line).name +
          '. Use o modo <strong>Planear viagem</strong> para percursos com transbordo.'
        : 'Não foi encontrado percurso entre estas estações.'));
      return;
    }

    if (r.state === 'untimed') {
      resultEl.appendChild(renderMessage('Há percurso, mas <strong>ainda não há horários ' +
        'carregados</strong> para a(s) linha(s) necessária(s).'));
      r.untimedRoutes.forEach(function (u) {
        var card = el('div', 'card journey');
        u.legs.forEach(function (leg, i) {
          if (i > 0) card.appendChild(el('p', 'transfer-row',
            '⇄ Transbordo em ' + stationName(leg.from)));
          card.appendChild(renderLeg(leg));
        });
        card.appendChild(renderPriceRow(u.price));
        card.appendChild(el('p', 'muted',
          'Sem horários para: ' + u.missingLines.map(function (l) {
            return router.line(l).name;
          }).join(', ')));
        resultEl.appendChild(card);
      });
      return;
    }

    if (r.state === 'tomorrow') {
      resultEl.appendChild(renderMessage('<strong>Já não há viagens hoje</strong> para este percurso. ' +
        'Primeira opção de ' + fmtDate(r.nextServiceDate).toLowerCase() +
        ' (' + DAY_LABEL[r.dayType] + '):'));
      resultEl.appendChild(renderJourneyCard(r.best, { highlight: true }));
      return;
    }

    // r.state === 'ok'
    var waitMin = qctx.live ? r.best.depMin - r.nowMin : null;
    resultEl.appendChild(renderJourneyCard(r.best, { highlight: true, waitMin: waitMin }));
    if (r.following.length) {
      var listCard = el('div', 'card');
      listCard.appendChild(el('p', 'list-title', 'Opções seguintes'));
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
      if (s && s.estimated) estimated.push(l.name);
      else if (s && !s.demo) real.push(l.name);
      else demo.push(l.name);
    });
    var src = 'Horários oficiais do PDF: ' + (real.join(', ') || 'nenhum');
    var bSched = METRO.schedules.b;
    if (bSched && bSched.validity && bSched.validity.from) {
      src += ' (em vigor desde ' + bSched.validity.from.split('-').reverse().join('/') + ')';
    }
    if (demo.length) {
      src += '. Sem horários reais neste PDF: ' + demo.join(', ') + ' (usa horários temporários).';
    }
    if (estimated.length) {
      src += '. Estimados por frequência: ' + estimated.join(', ') + '.';
    }
    document.getElementById('source-line').textContent = src;

    var f = METRO.fares;
    document.getElementById('fares-line').textContent =
      'Tarifário Andante ocasional em vigor desde ' +
      f.validFrom.split('-').reverse().join('/') + ' (' + f.source + ').';
    document.getElementById('notes-line').textContent =
      'Tolerância de ±2 min nos horários. Preços e zonas estimados — confirmar sempre no operador.';

    if (bSched && bSched.validity && bSched.validity.from) {
      var age = (Date.now() - new Date(bSched.validity.from).getTime()) / 86400000;
      if (age > STALE_AFTER_DAYS) {
        var banner = document.getElementById('stale-banner');
        banner.textContent = 'Os horários da Linha B têm mais de ' + Math.floor(age / 30) +
          ' meses. Verifique se há versão mais recente do PDF.';
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
  var prefs = loadPrefs();
  if (prefs.origin && router.station(prefs.origin)) {
    state.origin = prefs.origin; originAC.set(prefs.origin);
  }
  if (prefs.dest && router.station(prefs.dest)) {
    state.dest = prefs.dest; destAC.set(prefs.dest);
  }
  state.lineOrigin = prefs.lineOrigin || null;
  state.lineDest = prefs.lineDest || null;
  if (prefs.line && router.line(prefs.line)) pickLine(prefs.line);
  renderStaticInfo();
  setMode(prefs.mode === 'line' ? 'line' : 'plan');
  setInterval(render, REFRESH_MS);

  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    navigator.serviceWorker.register('sw.js').catch(function () { /* opcional */ });
  }
})();
