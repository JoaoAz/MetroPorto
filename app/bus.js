(function () {
  'use strict';

  var REFRESH_MS = 30000;
  var PREFS_KEY = 'metro-bus-planner-prefs';

  if (!window.BUS_SCHEDULES || !window.MetroEngine || !window.METRO) {
    document.getElementById('bus-error').classList.remove('hidden');
    return;
  }

  var DATA = window.BUS_SCHEDULES;
  var engine = window.MetroEngine;
  var holidays = window.METRO.holidays || {};

  var DAY_LABEL = {
    weekday: 'dia útil',
    saturday: 'sábado',
    sunday_holiday: 'domingo/feriado'
  };

  var state = {
    origin: null,
    dest: null
  };

  var allLines = [];
  DATA.municipalities.forEach(function (municipality) {
    municipality.lines.forEach(function (line) {
      allLines.push(line);
    });
  });

  var stopsById = {};
  DATA.stops.forEach(function (stop) {
    stopsById[stop.id] = stop;
  });

  var stopLines = {};
  allLines.forEach(function (line) {
    line.directions.forEach(function (direction) {
      direction.stopIds.forEach(function (stopId) {
        if (!stopLines[stopId]) stopLines[stopId] = {};
        stopLines[stopId][line.code] = true;
      });
    });
  });

  var searchEntries = DATA.stops.map(function (stop) {
    return {
      stop: stop,
      key: normalize(stop.name)
    };
  });

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function normalize(text) {
    return String(text || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function dateISO(date) {
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  function fmtDate(date) {
    var text = new Intl.DateTimeFormat('pt-PT', {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    }).format(date);
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function fmtDur(minutes) {
    if (minutes < 60) return minutes + ' min';
    return Math.floor(minutes / 60) + ' h ' + (minutes % 60 ? (minutes % 60) + ' min' : '');
  }

  function stationName(stopId) {
    return stopsById[stopId] ? stopsById[stopId].name : stopId;
  }

  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; }
    catch (e) { return {}; }
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        origin: state.origin,
        dest: state.dest
      }));
    } catch (e) { /* sem persistência */ }
  }

  function buildShareUrl() {
    var p = new URLSearchParams();
    if (state.origin) p.set('de', state.origin);
    if (state.dest) p.set('para', state.dest);
    var di = document.getElementById('bus-date');
    if (di.value && di.value !== dateISO(new Date())) p.set('data', di.value);
    var qs = p.toString();
    return location.origin + location.pathname + (qs ? '?' + qs : '');
  }

  function syncUrl() {
    try {
      var url = buildShareUrl();
      if (url !== location.href) history.replaceState(null, '', url);
    } catch (e) { /* indisponível */ }
  }

  function readUrlState() {
    var p = new URLSearchParams(location.search);
    if (!p.has('de') && !p.has('para') && !p.has('data')) return false;
    var de = p.get('de'), para = p.get('para');
    if (de && stopsById[de]) state.origin = de;
    if (para && stopsById[para]) state.dest = para;
    var data = p.get('data');
    if (data && /^\d{4}-\d{2}-\d{2}$/.test(data)) {
      document.getElementById('bus-date').value = data;
    }
    return true;
  }

  function shareCurrent(btn) {
    var url = buildShareUrl();
    var text = 'Autocarros UNIR: ' + stationName(state.origin) + ' → ' + stationName(state.dest);
    if (navigator.share) {
      navigator.share({ title: 'Horários de autocarros UNIR', text: text, url: url })
        .catch(function () { /* cancelado */ });
      return;
    }
    var done = function () {
      var original = btn.textContent;
      btn.textContent = '✓ Link copiado';
      btn.classList.add('copied');
      setTimeout(function () { btn.textContent = original; btn.classList.remove('copied'); }, 2000);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, function () { window.prompt('Copie o link:', url); });
    } else {
      window.prompt('Copie o link:', url);
    }
  }

  function renderShareButton() {
    var row = el('div', 'share-row');
    var btn = el('button', 'share-btn', '⤴ Partilhar viagem');
    btn.type = 'button';
    btn.addEventListener('click', function () { shareCurrent(btn); });
    row.appendChild(btn);
    return row;
  }

  function searchStops(query, limit) {
    var q = normalize(query);
    if (!q) return [];
    var scored = [];
    searchEntries.forEach(function (entry) {
      var pos = entry.key.indexOf(q);
      if (pos === -1) return;
      scored.push({
        stop: entry.stop,
        score: (pos === 0 ? 0 : 10) + pos / 100
      });
    });
    scored.sort(function (a, b) {
      return a.score - b.score || a.stop.name.localeCompare(b.stop.name, 'pt');
    });
    return scored.slice(0, limit || 8).map(function (item) { return item.stop; });
  }

  function stopLineCodes(stopId) {
    return Object.keys(stopLines[stopId] || {}).sort().slice(0, 4);
  }

  function attachAutocomplete(inputId, sugId, onPick) {
    var input = document.getElementById(inputId);
    var sug = document.getElementById(sugId);
    var clearBtn = document.querySelector('.clear-btn[data-for="' + inputId + '"]');

    function close() {
      sug.classList.add('hidden');
      sug.textContent = '';
    }

    function render(list) {
      sug.textContent = '';
      if (!list.length) {
        close();
        return;
      }
      list.forEach(function (stop) {
        var item = el('div', 'suggestion');
        item.appendChild(el('span', 'sug-name', stop.name));
        var codes = el('span', 'bus-sug-lines');
        stopLineCodes(stop.id).forEach(function (code) {
          codes.appendChild(el('span', 'bus-mini-code', code));
        });
        item.appendChild(codes);
        item.addEventListener('mousedown', function (event) {
          event.preventDefault();
          input.value = stop.name;
          clearBtn.classList.remove('hidden');
          close();
          onPick(stop.id);
        });
        sug.appendChild(item);
      });
      sug.classList.remove('hidden');
    }

    input.addEventListener('input', function () {
      onPick(null);
      clearBtn.classList.toggle('hidden', !input.value);
      render(searchStops(input.value, 8));
    });
    input.addEventListener('focus', function () {
      if (input.value && !state[inputId === 'bus-origin-input' ? 'origin' : 'dest']) {
        render(searchStops(input.value, 8));
      }
    });
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        var first = sug.querySelector('.suggestion');
        if (first) first.dispatchEvent(new MouseEvent('mousedown'));
      } else if (event.key === 'Escape') {
        close();
      }
    });
    input.addEventListener('blur', function () { setTimeout(close, 150); });
    clearBtn.addEventListener('click', function () {
      input.value = '';
      clearBtn.classList.add('hidden');
      close();
      onPick(null);
      input.focus();
    });

    return {
      set: function (stopId) {
        input.value = stopId ? stationName(stopId) : '';
        clearBtn.classList.toggle('hidden', !stopId);
      }
    };
  }

  function selectedDate(now) {
    var input = document.getElementById('bus-date');
    if (!input.value) return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var parts = input.value.split('-');
    return new Date(+parts[0], +parts[1] - 1, +parts[2]);
  }

  function queryContext(now) {
    var selected = selectedDate(now);
    var live = dateISO(selected) === dateISO(now);
    var dayType = engine.dayTypeFor(selected, holidays);
    return {
      selected: selected,
      live: live,
      dayType: dayType,
      startMin: live ? now.getHours() * 60 + now.getMinutes() : 0
    };
  }

  function renderDateChip(qctx) {
    var chip = document.getElementById('bus-daytype-chip');
    chip.textContent = (qctx.live ? 'Hoje - ao vivo - ' : 'Desde o início do dia - ') +
      DAY_LABEL[qctx.dayType];
    chip.className = 'daytype-chip' + (qctx.dayType === 'sunday_holiday' ? ' holiday' : '');
  }

  function positionsOf(list, value) {
    var positions = [];
    list.forEach(function (item, index) {
      if (item === value) positions.push(index);
    });
    return positions;
  }

  function collectJourneys(originId, destId, dayType, startMin) {
    var journeys = [];
    allLines.forEach(function (line) {
      line.directions.forEach(function (direction) {
        var originPositions = positionsOf(direction.stopIds, originId);
        var destPositions = positionsOf(direction.stopIds, destId);
        if (!originPositions.length || !destPositions.length) return;
        var day = direction.dayTypes[dayType];
        if (!day || !day.trips || !day.trips.length) return;

        originPositions.forEach(function (originIndex) {
          destPositions.forEach(function (destIndex) {
            if (originIndex >= destIndex) return;
            day.trips.forEach(function (trip) {
              var mins = engine.tripMinutes(trip);
              var depMin = mins[originIndex];
              var arrMin = mins[destIndex];
              if (depMin === null || arrMin === null || arrMin < depMin || depMin < startMin) {
                return;
              }
              journeys.push({
                lineCode: line.code,
                lineName: line.name,
                municipality: line.municipality,
                direction: direction.headsign,
                from: originId,
                to: destId,
                dep: engine.fmtMin(depMin),
                arr: engine.fmtMin(arrMin),
                depMin: depMin,
                arrMin: arrMin,
                durationMin: arrMin - depMin
              });
            });
          });
        });
      });
    });

    journeys.sort(function (a, b) {
      return a.depMin - b.depMin || a.arrMin - b.arrMin || a.lineCode.localeCompare(b.lineCode);
    });
    return journeys;
  }

  function nextService(originId, destId, fromDate) {
    for (var offset = 1; offset <= 7; offset++) {
      var date = new Date(fromDate.getTime());
      date.setDate(date.getDate() + offset);
      var dayType = engine.dayTypeFor(date, holidays);
      var journeys = collectJourneys(originId, destId, dayType, 0);
      if (journeys.length) {
        return { date: date, dayType: dayType, journeys: journeys };
      }
    }
    return null;
  }

  function renderMessage(html) {
    var card = el('div', 'card state-msg');
    var p = el('p');
    p.innerHTML = html;
    card.appendChild(p);
    return card;
  }

  function renderJourney(journey, opts) {
    opts = opts || {};
    var card = el('div', 'card bus-journey' + (opts.highlight ? ' next-card' : ''));
    var head = el('div', 'journey-head');
    head.appendChild(el('p', 'journey-times', journey.dep + ' -> ' + journey.arr));
    head.appendChild(el('p', 'journey-meta', fmtDur(journey.durationMin)));
    card.appendChild(head);
    if (opts.waitMin !== undefined && opts.waitMin !== null) {
      var wait = el('p', 'next-wait', opts.waitMin <= 0 ? 'a partir agora' : 'parte em ' + fmtDur(opts.waitMin));
      if (opts.waitMin <= 1) wait.classList.add('now');
      card.appendChild(wait);
    }

    var line = el('div', 'bus-result-line');
    line.appendChild(el('span', 'bus-line-code', journey.lineCode));
    var text = el('div', 'bus-result-text');
    text.appendChild(el('p', 'bus-result-name', journey.lineName));
    text.appendChild(el('p', 'muted', journey.municipality + ' - ' + journey.direction));
    line.appendChild(text);
    card.appendChild(line);
    card.appendChild(el('p', 'bus-route-note', stationName(journey.from) + ' -> ' + stationName(journey.to)));
    if (opts.highlight) card.appendChild(renderShareButton());
    return card;
  }

  function renderCompactJourney(journey) {
    var row = el('div', 'bus-compact-journey');
    row.appendChild(el('span', 'bus-line-code', journey.lineCode));
    row.appendChild(el('span', 'dep-time', journey.dep + ' -> ' + journey.arr));
    row.appendChild(el('span', 'bus-compact-name', journey.lineName));
    row.appendChild(el('span', 'dep-arr', fmtDur(journey.durationMin)));
    return row;
  }

  var resultEl = document.getElementById('bus-results');

  function render() {
    var now = new Date();
    var qctx = queryContext(now);
    renderDateChip(qctx);
    syncUrl();
    resultEl.textContent = '';

    if (!state.origin || !state.dest) {
      resultEl.appendChild(renderMessage('Escolha a <strong>origem</strong> e o <strong>destino</strong>.'));
      return;
    }
    if (state.origin === state.dest) {
      resultEl.appendChild(renderMessage('A origem e o destino são a mesma paragem.'));
      return;
    }

    var journeys = collectJourneys(state.origin, state.dest, qctx.dayType, qctx.startMin);
    if (!journeys.length && qctx.live) {
      var next = nextService(state.origin, state.dest, qctx.selected);
      if (next) {
      resultEl.appendChild(renderMessage('<strong>Já não há viagens hoje</strong> entre estas paragens. Primeiras de ' +
          fmtDate(next.date).toLowerCase() + ' (' + DAY_LABEL[next.dayType] + '):'));
        journeys = next.journeys;
      }
    }

    if (!journeys.length) {
      resultEl.appendChild(renderMessage('Não encontrei ligação direta entre estas paragens principais para esta data.'));
      return;
    }

    var first = journeys[0];
    resultEl.appendChild(renderJourney(first, {
      highlight: true,
      waitMin: qctx.live && dateISO(qctx.selected) === dateISO(now) ? first.depMin - qctx.startMin : null
    }));

    var following = journeys.slice(1, 7);
    if (following.length) {
      var list = el('div', 'card');
      list.appendChild(el('p', 'list-title', 'Opções seguintes'));
      following.forEach(function (journey) {
        list.appendChild(renderCompactJourney(journey));
      });
      resultEl.appendChild(list);
    }
  }

  var originAC = attachAutocomplete('bus-origin-input', 'bus-origin-suggestions', function (id) {
    state.origin = id;
    savePrefs();
    render();
  });
  var destAC = attachAutocomplete('bus-dest-input', 'bus-dest-suggestions', function (id) {
    state.dest = id;
    savePrefs();
    render();
  });

  document.getElementById('bus-swap').addEventListener('click', function () {
    var origin = state.origin;
    state.origin = state.dest;
    state.dest = origin;
    originAC.set(state.origin);
    destAC.set(state.dest);
    savePrefs();
    render();
  });
  document.getElementById('bus-date').addEventListener('change', render);

  var dateInput = document.getElementById('bus-date');
  dateInput.value = dateISO(new Date());
  dateInput.min = dateISO(new Date());

  // O URL (link partilhado) tem prioridade sobre as preferências guardadas.
  if (!readUrlState()) {
    var prefs = loadPrefs();
    if (prefs.origin && stopsById[prefs.origin]) state.origin = prefs.origin;
    if (prefs.dest && stopsById[prefs.dest]) state.dest = prefs.dest;
  }
  originAC.set(state.origin);
  destAC.set(state.dest);

  document.getElementById('bus-summary').textContent =
    allLines.length + ' linhas, ' + DATA.stops.length +
    ' paragens principais e próximas partidas por origem/destino.';
  document.getElementById('bus-app').hidden = false;
  render();
  setInterval(render, REFRESH_MS);
})();
