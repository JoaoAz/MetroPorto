/* app.js — camada de interface. Toda a lógica de horários vive em engine.js. */
(function () {
  'use strict';

  var REFRESH_MS = 30000;
  var STALE_AFTER_DAYS = 300;
  var PREFS_KEY = 'metro-linha-b-prefs';

  var resultEl = document.getElementById('result');

  if (!window.METRO_DATA || !window.MetroEngine) {
    // Mantém a mensagem estática do index.html (dados não processados).
    return;
  }

  var data = window.METRO_DATA;
  var holidays = window.METRO_HOLIDAYS || {};
  var engine = window.MetroEngine;

  var originSel = document.getElementById('origin');
  var destSel = document.getElementById('destination');
  var overrideSel = document.getElementById('daytype-override');
  var swapBtn = document.getElementById('swap');

  // ---------------------------------------------------------- utilidades

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function stationName(id) {
    for (var i = 0; i < data.stations.length; i++) {
      if (data.stations[i].id === id) return data.stations[i].name;
    }
    return id;
  }

  function shortName(id) {
    // "VC Fashion Outlet | Modivas" -> nome tradicional para textos corridos
    var n = stationName(id);
    return n.indexOf('|') !== -1 ? n.split('|').pop().trim() : n;
  }

  function fmtDate(d) {
    var s = new Intl.DateTimeFormat('pt-PT',
      { weekday: 'long', day: 'numeric', month: 'long' }).format(d);
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function waitShort(min) {
    if (min < 60) return min + ' min';
    return Math.floor(min / 60) + ' h ' + (min % 60) + ' min';
  }

  function waitText(min) {
    if (min <= 0) return 'a partir agora';
    if (min === 1) return 'parte em 1 minuto';
    return 'parte em ' + waitShort(min);
  }

  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; }
    catch (e) { return {}; }
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        origin: originSel.value, destination: destSel.value
      }));
    } catch (e) { /* armazenamento indisponível: preferências não persistem */ }
  }

  // ---------------------------------------------------------- arranque

  function populateSelects() {
    var order = data.directions.outbound.stationOrder;
    order.forEach(function (id) {
      originSel.appendChild(new Option(stationName(id), id));
      destSel.appendChild(new Option(stationName(id), id));
    });
    var prefs = loadPrefs();
    var ids = order.slice();
    originSel.value = ids.indexOf(prefs.origin) !== -1 ? prefs.origin : 'estadio-do-dragao';
    destSel.value = ids.indexOf(prefs.destination) !== -1 ? prefs.destination : 'povoa-de-varzim';
  }

  function renderStaticInfo() {
    var src = document.getElementById('source-line');
    var validity = data.validity.from
      ? ' Em vigor desde ' + data.validity.from.split('-').reverse().join('/') + '.'
      : '';
    src.textContent = 'Fonte: PDF oficial ' + data.source.publisher +
      ' (' + data.source.file + ').' + validity;
    document.getElementById('notes-line').textContent = (data.notes || []).join(' ');

    if (data.validity.from) {
      var age = (Date.now() - new Date(data.validity.from).getTime()) / 86400000;
      if (age > STALE_AFTER_DAYS) {
        var banner = document.getElementById('stale-banner');
        banner.textContent = 'Estes horários têm mais de ' + Math.floor(age / 30) +
          ' meses. Verifique se o Metro do Porto publicou uma versão mais recente.';
        banner.classList.remove('hidden');
      }
    }
  }

  // ---------------------------------------------------------- renderização

  function badge(service) {
    if (service !== 'Bx') return null;
    var b = el('span', 'badge bx', 'Bx');
    b.title = 'Serviço expresso — não para em todas as estações';
    return b;
  }

  function renderNextCard(next, destId) {
    var card = el('div', 'card next-card');
    card.appendChild(el('p', 'next-label', 'Próximo metro'));
    var time = el('p', 'next-time', next.dep);
    var b = badge(next.service);
    if (b) time.appendChild(b);
    card.appendChild(time);
    if (typeof next.waitMin === 'number') {
      var wait = el('p', 'next-wait', waitText(next.waitMin));
      if (next.waitMin <= 1) wait.classList.add('now');
      card.appendChild(wait);
    }
    card.appendChild(el('p', 'next-arr',
      'Chegada a ' + shortName(destId) + ' às ' + next.arr));
    return card;
  }

  function renderFollowing(list, title, withWait) {
    var card = el('div', 'card');
    card.appendChild(el('p', 'list-title', title));
    var ul = el('ul', 'dep-list');
    list.forEach(function (d) {
      var li = el('li');
      li.appendChild(el('span', 'dep-time', d.dep));
      var b = badge(d.service);
      if (b) { b.classList.add('dep-badge'); li.appendChild(b); }
      if (withWait && typeof d.waitMin === 'number') {
        li.appendChild(el('span', 'dep-wait', 'em ' + waitShort(d.waitMin)));
      }
      li.appendChild(el('span', 'dep-arr', 'chegada ' + d.arr));
      ul.appendChild(li);
    });
    card.appendChild(ul);
    return card;
  }

  function renderMessage(html) {
    var card = el('div', 'card state-msg');
    var p = el('p');
    p.innerHTML = html;
    card.appendChild(p);
    return card;
  }

  function render() {
    var now = new Date();
    var override = overrideSel.value || null;
    var r = engine.query(data, holidays, originSel.value, destSel.value, now,
      { limit: 6, dayTypeOverride: override });

    var ctx = engine.serviceContext(now);
    var autoDayType = engine.dayTypeFor(ctx.serviceDate, holidays);
    document.getElementById('date-line').textContent =
      fmtDate(now) + ' · ' + data.dayTypes[autoDayType];

    resultEl.textContent = '';

    if (r.state === 'invalid') {
      resultEl.appendChild(renderMessage(
        'Escolha uma <strong>origem e um destino diferentes</strong> para consultar os horários.'));
      return;
    }

    if (r.state === 'none') {
      resultEl.appendChild(renderMessage(
        'Não foram encontradas viagens para este par de estações. ' +
        'Os dados podem estar incompletos — reprocesse o PDF.'));
      return;
    }

    if (r.state === 'override') {
      var info = el('div', 'banner info',
        'A ver o quadro completo de ' + data.dayTypes[r.dayType].toLowerCase() +
        ' (escolhido manualmente).');
      resultEl.appendChild(info);
      resultEl.appendChild(renderFollowing(r.departures,
        'Todas as partidas · ' + shortName(originSel.value) + ' → ' +
        shortName(destSel.value), false));
      return;
    }

    if (r.state === 'tomorrow') {
      resultEl.appendChild(renderMessage(
        '<strong>Já não há viagens hoje</strong> neste sentido. ' +
        'Primeiro metro de ' + fmtDate(r.nextServiceDate).toLowerCase() +
        ' (' + data.dayTypes[r.nextDayType].toLowerCase() + '):'));
      resultEl.appendChild(renderNextCard(r.next, destSel.value));
      if (r.following.length) {
        resultEl.appendChild(renderFollowing(r.following, 'Partidas seguintes', false));
      }
      return;
    }

    // state === 'ok'
    resultEl.appendChild(renderNextCard(r.next, destSel.value));
    if (r.following.length) {
      resultEl.appendChild(renderFollowing(r.following, 'Partidas seguintes', true));
    }
  }

  // ---------------------------------------------------------- eventos

  function onChange() { savePrefs(); render(); }

  originSel.addEventListener('change', onChange);
  destSel.addEventListener('change', onChange);
  overrideSel.addEventListener('change', render);
  swapBtn.addEventListener('click', function () {
    var o = originSel.value;
    originSel.value = destSel.value;
    destSel.value = o;
    onChange();
  });

  populateSelects();
  renderStaticInfo();
  render();
  setInterval(render, REFRESH_MS);

  // PWA: só funciona em http(s); em file:// a app funciona na mesma, sem cache.
  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    navigator.serviceWorker.register('sw.js').catch(function () { /* opcional */ });
  }
})();
