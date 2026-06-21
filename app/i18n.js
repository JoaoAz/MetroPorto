/*
 * i18n.js — Traduções PT/EN (carregar antes de app.js / bus.js / consent.js).
 * Os nomes de estações/paragens NÃO se traduzem (nomes próprios).
 * Idioma resolvido por: ?lang=en no URL > localStorage > idioma do browser > pt.
 * window.t(chave, params) devolve a string traduzida com {placeholders}.
 */
(function () {
  'use strict';

  var DICT = {
    pt: {
      loading: 'A carregar…',
      buses: 'Autocarros',
      metro: 'Metro',
      lang_pt: 'PT', lang_en: 'EN',
      lang_switch: 'Mudar idioma',

      tab_plan: 'Planear viagem',
      tab_line: 'Por linha',
      from: 'Origem',
      to: 'Destino',
      search_station: 'Pesquisar estação…',
      search_stop: 'Pesquisar paragem…',
      swap: 'Trocar origem e destino',
      line: 'Linha',
      travel_date: 'Data da viagem',

      day_weekday: 'dia útil',
      day_saturday: 'sábado',
      day_sunday_holiday: 'domingo/feriado',
      chip_today_live: 'Hoje · ',
      chip_from_service: 'Início do serviço · ',
      chip_from_day: 'Início do serviço · ',

      share_trip: '⤴ Partilhar viagem',
      link_copied: '✓ Link copiado',
      copy_prompt: 'Copie o link:',
      share_title: 'Horários Metro do Porto',
      share_text: 'Metro do Porto: {from} → {to}',
      bus_share_title: 'Horários de autocarros UNIR',
      bus_share_text: 'Autocarros UNIR: {from} → {to}',

      min: 'min',
      hour: 'h',
      wait_now: 'a partir agora',
      wait_in: 'parte em {dur}',
      direct: 'direto',
      transfer_one: 'transbordo',
      transfer_many: 'transbordos',
      transfer_at: '⇄ Transbordo em {station} · espera {min} min',
      transfer_at_short: '⇄ Transbordo em {station}',
      next_options: 'Opções seguintes',
      arrival: 'chegada {time}',

      msg_choose_plan: 'Escolha a <strong>origem</strong> e o <strong>destino</strong>. A app encontra a linha e, se necessário, o transbordo.',
      msg_choose_line: 'Escolha a linha e depois a origem e o destino dentro dessa linha.',
      msg_same_station: 'A origem e o destino são a mesma estação.',
      msg_same_stop: 'A origem e o destino são a mesma paragem.',
      msg_none_line: 'Estas estações não estão ambas na {line}. Use o modo <strong>Planear viagem</strong> para percursos com transbordo.',
      msg_none_plan: 'Não foi encontrado percurso entre estas estações.',
      msg_untimed: 'Há percurso, mas <strong>ainda não há horários carregados</strong> para a(s) linha(s) necessária(s).',
      msg_no_times_for: 'Sem horários para: {lines}',
      msg_tomorrow: '<strong>Já não há viagens hoje</strong> para este percurso. Primeira opção de {date} ({day}):',

      price_andante: 'Andante {title} — ',
      price_zones_note: 'Zonas estimadas a partir de {zone}. Confirmar preço e zonas no operador.',
      price_not_calc: 'Preço não calculado: {reason}.',
      reason_zones_missing: 'zonas por validar nos dados da rede',
      reason_zones_disconnected: 'zonas sem ligação no grafo de adjacência',
      reason_no_fare: 'sem tarifa conhecida para {title}',

      badge_temp: 'horários temporários',
      badge_temp_title: 'Este percurso usa uma linha sem horários reais no PDF carregado.',
      badge_estimated: 'Linha D: horário estimado',
      badge_estimated_title: 'Horário gerado por frequência a partir das imagens fornecidas; confirmar no operador.',
      bx_title: 'Serviço expresso — não para em todas as estações',

      src_official: 'Horários oficiais do PDF: {lines}',
      src_none: 'nenhum',
      src_since: ' (em vigor desde {date})',
      src_temp: '. Sem horários reais neste PDF: {lines} (usa horários temporários).',
      src_estimated: '. Estimados por frequência: {lines}.',
      fares_line: 'Tarifário Andante ocasional em vigor desde {date} ({source}).',
      notes_line: 'Tolerância de ±2 min nos horários. Preços e zonas estimados — confirmar sempre no operador.',
      stale_banner: 'Os horários da Linha B têm mais de {months} meses. Verifique se há versão mais recente do PDF.',

      boot_error_title: '<strong>Não foi possível iniciar a aplicação.</strong>',
      boot_error_body: 'Se é a primeira utilização, gere os dados: <code>python tools/build_data.py</code> e recarregue a página.',
      fare_warning: '<strong>Preços estimados.</strong> Confirma no operador antes de viajar. As zonas Andante (Z2, Z3, …) são calculadas a partir do mapa e podem ser imprecisas.',
      independent_line: 'Aplicação independente, sem relação oficial com a Metro do Porto. Para informações ou sugestões: <a href="mailto:info@horarios-metro.pt">info@horarios-metro.pt</a>.',
      bus_independent_line: 'Horários publicados pela AMP/UNIR para o lote UT3. Aplicação independente, sem relação oficial com a Metro do Porto ou UNIR.',

      consent_text: 'Usamos cookies do Google Analytics apenas para medir a utilização do site e melhorá-lo. Pode aceitar ou recusar — o site funciona na mesma.',
      consent_accept: 'Aceitar',
      consent_reject: 'Recusar',

      bus_h1: 'Autocarros UNIR',
      bus_kicker: 'Paragens principais UNIR',
      bus_hero_h2: 'Linhas municipais',
      bus_beta_note: 'Funcionalidade em testes, disponível apenas para <strong>Vila do Conde</strong> e <strong>Póvoa de Varzim</strong>. Confirme sempre os horários no operador.',
      bus_warning: '<strong>Horários planeados.</strong> A pesquisa usa as paragens principais publicadas nos PDFs oficiais. Podem existir outras paragens intermédias.',
      bus_summary: '{lines} linhas, {stops} paragens principais e próximas partidas por origem/destino.',
      bus_choose: 'Escolha a <strong>origem</strong> e o <strong>destino</strong>.',
      bus_no_direct: 'Não encontrei ligação direta entre estas paragens principais para esta data.',
      bus_tomorrow: '<strong>Já não há viagens hoje</strong> entre estas paragens. Primeiras de {date} ({day}):',
      bus_error: 'Não foi possível carregar os horários dos autocarros.',
      bus_footer: 'Horários publicados pela AMP/UNIR para o lote UT3. Aplicação independente, sem relação oficial com a Metro do Porto ou UNIR.',
      bus_title: 'Horários de autocarros | Póvoa de Varzim e Vila do Conde',
      bus_meta_desc: 'Consulte os horários em PDF dos autocarros UNIR dos municípios da Póvoa de Varzim e Vila do Conde.',

      doc_title: 'Horários Metro do Porto | Consulta rápida por estação',
      doc_desc: 'Consulte os horários do Metro do Porto de forma simples. Escolha a linha, a estação e o sentido da viagem para encontrar rapidamente o próximo metro.'
    },
    en: {
      loading: 'Loading…',
      buses: 'Buses',
      metro: 'Metro',
      lang_pt: 'PT', lang_en: 'EN',
      lang_switch: 'Change language',

      tab_plan: 'Plan a trip',
      tab_line: 'By line',
      from: 'From',
      to: 'To',
      search_station: 'Search station…',
      search_stop: 'Search stop…',
      swap: 'Swap origin and destination',
      line: 'Line',
      travel_date: 'Travel date',

      day_weekday: 'weekday',
      day_saturday: 'Saturday',
      day_sunday_holiday: 'Sunday/holiday',
      chip_today_live: 'Today · ',
      chip_from_service: 'Service start · ',
      chip_from_day: 'Service start · ',

      share_trip: '⤴ Share trip',
      link_copied: '✓ Link copied',
      copy_prompt: 'Copy the link:',
      share_title: 'Porto Metro timetables',
      share_text: 'Porto Metro: {from} → {to}',
      bus_share_title: 'UNIR bus timetables',
      bus_share_text: 'UNIR buses: {from} → {to}',

      min: 'min',
      hour: 'h',
      wait_now: 'leaving now',
      wait_in: 'leaves in {dur}',
      direct: 'direct',
      transfer_one: 'transfer',
      transfer_many: 'transfers',
      transfer_at: '⇄ Transfer at {station} · wait {min} min',
      transfer_at_short: '⇄ Transfer at {station}',
      next_options: 'Next options',
      arrival: 'arr. {time}',

      msg_choose_plan: 'Choose your <strong>origin</strong> and <strong>destination</strong>. The app finds the line and, if needed, the transfer.',
      msg_choose_line: 'Choose a line, then the origin and destination within it.',
      msg_same_station: 'Origin and destination are the same station.',
      msg_same_stop: 'Origin and destination are the same stop.',
      msg_none_line: 'These stations aren\'t both on {line}. Use <strong>Plan a trip</strong> for journeys with transfers.',
      msg_none_plan: 'No route found between these stations.',
      msg_untimed: 'There is a route, but <strong>timetables aren\'t loaded yet</strong> for the required line(s).',
      msg_no_times_for: 'No timetables for: {lines}',
      msg_tomorrow: '<strong>No more trips today</strong> on this route. First option on {date} ({day}):',

      price_andante: 'Andante {title} — ',
      price_zones_note: 'Zones estimated from {zone}. Confirm price and zones with the operator.',
      price_not_calc: 'Price not calculated: {reason}.',
      reason_zones_missing: 'zones not yet validated in the network data',
      reason_zones_disconnected: 'zones not connected in the adjacency graph',
      reason_no_fare: 'no known fare for {title}',

      badge_temp: 'temporary schedule',
      badge_temp_title: 'This route uses a line without real schedules in the loaded PDF.',
      badge_estimated: 'Line D: estimated schedule',
      badge_estimated_title: 'Schedule generated from frequencies in the provided images; confirm with the operator.',
      bx_title: 'Express service — doesn\'t stop at every station',

      src_official: 'Official PDF timetables: {lines}',
      src_none: 'none',
      src_since: ' (in force since {date})',
      src_temp: '. No real schedules in this PDF: {lines} (uses temporary schedules).',
      src_estimated: '. Estimated by frequency: {lines}.',
      fares_line: 'Andante single-trip fares in force since {date} ({source}).',
      notes_line: '±2 min tolerance on schedules. Prices and zones are estimates — always confirm with the operator.',
      stale_banner: 'Line B timetables are over {months} months old. Check for a newer PDF version.',

      boot_error_title: '<strong>The application could not start.</strong>',
      boot_error_body: 'On first use, generate the data: <code>python tools/build_data.py</code> and reload the page.',
      fare_warning: '<strong>Estimated prices.</strong> Confirm with the operator before travelling. Andante zones (Z2, Z3, …) are derived from the map and may be inaccurate.',
      independent_line: 'Independent app, with no official relation to Metro do Porto. For information or suggestions: <a href="mailto:info@horarios-metro.pt">info@horarios-metro.pt</a>.',
      bus_independent_line: 'Schedules published by AMP/UNIR for lot UT3. Independent app, with no official relation to Metro do Porto or UNIR.',

      consent_text: 'We use Google Analytics cookies only to measure site usage and improve it. You can accept or decline — the site works either way.',
      consent_accept: 'Accept',
      consent_reject: 'Decline',

      bus_h1: 'UNIR Buses',
      bus_kicker: 'UNIR main stops',
      bus_hero_h2: 'Municipal lines',
      bus_beta_note: 'Beta feature, available only for <strong>Vila do Conde</strong> and <strong>Póvoa de Varzim</strong>. Always confirm schedules with the operator.',
      bus_warning: '<strong>Planned schedules.</strong> Search uses the main stops published in the official PDFs. Other intermediate stops may exist.',
      bus_summary: '{lines} lines, {stops} main stops and next departures by origin/destination.',
      bus_choose: 'Choose the <strong>origin</strong> and <strong>destination</strong>.',
      bus_no_direct: 'No direct connection found between these main stops for this date.',
      bus_tomorrow: '<strong>No more trips today</strong> between these stops. First ones on {date} ({day}):',
      bus_error: 'Couldn\'t load the bus schedules.',
      bus_footer: 'Schedules published by AMP/UNIR for lot UT3. Independent app, with no official relation to Metro do Porto or UNIR.',
      bus_title: 'Bus timetables | Póvoa de Varzim and Vila do Conde',
      bus_meta_desc: 'Check the PDF timetables of UNIR buses for the Póvoa de Varzim and Vila do Conde municipalities.',

      doc_title: 'Porto Metro Timetables | Quick lookup by station',
      doc_desc: 'Check Porto Metro timetables easily. Pick the line, station and direction to find the next metro right away.'
    }
  };

  function resolveLang() {
    var valid = { pt: 1, en: 1 };
    try {
      var p = new URLSearchParams(location.search).get('lang');
      if (p && valid[p]) return p;
    } catch (e) { /* file:// */ }
    try {
      var s = localStorage.getItem('metro-lang');
      if (s && valid[s]) return s;
    } catch (e) { /* indisponível */ }
    var langs = navigator.languages || [navigator.language || 'pt'];
    for (var i = 0; i < langs.length; i++) {
      if (/^pt\b/i.test(langs[i])) return 'pt';
    }
    // browser sem português -> inglês (turistas)
    return langs.length ? 'en' : 'pt';
  }

  var LANG = resolveLang();
  document.documentElement.lang = LANG === 'en' ? 'en' : 'pt-PT';

  function t(key, params) {
    var s = (DICT[LANG] && DICT[LANG][key]);
    if (s === undefined) s = DICT.pt[key];
    if (s === undefined) return key;
    if (params) {
      s = s.replace(/\{(\w+)\}/g, function (m, k) {
        return params[k] !== undefined ? params[k] : m;
      });
    }
    return s;
  }

  function setLang(lang) {
    try { localStorage.setItem('metro-lang', lang); } catch (e) { /* */ }
    try {
      var u = new URL(location.href);
      if (lang === 'pt') u.searchParams.delete('lang');
      else u.searchParams.set('lang', 'en');
      location.href = u.toString();
    } catch (e) { location.reload(); }
  }

  // Traduz texto estático marcado com data-i18n / data-i18n-html / data-i18n-<attr>.
  function applyStatic(root) {
    root = root || document;
    root.querySelectorAll('[data-i18n]').forEach(function (n) {
      n.textContent = t(n.getAttribute('data-i18n'));
    });
    root.querySelectorAll('[data-i18n-html]').forEach(function (n) {
      n.innerHTML = t(n.getAttribute('data-i18n-html'));
    });
    ['placeholder', 'aria-label', 'title', 'content'].forEach(function (attr) {
      root.querySelectorAll('[data-i18n-' + attr + ']').forEach(function (n) {
        n.setAttribute(attr, t(n.getAttribute('data-i18n-' + attr)));
      });
    });
    var titleEl = document.querySelector('title[data-i18n-doc]');
    if (titleEl) document.title = t(titleEl.getAttribute('data-i18n-doc'));
    var desc = document.querySelector('meta[name="description"][data-i18n-desc]');
    if (desc) desc.setAttribute('content', t(desc.getAttribute('data-i18n-desc')));
  }

  // Botão de idioma (PT|EN) — injetado no elemento .lang-toggle, se existir.
  function mountToggle() {
    var host = document.querySelector('.lang-toggle');
    if (!host) return;
    [['pt', t('lang_pt')], ['en', t('lang_en')]].forEach(function (pair) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'lang-btn' + (LANG === pair[0] ? ' active' : '');
      b.textContent = pair[1];
      b.setAttribute('aria-label', t('lang_switch') + ': ' + pair[1]);
      if (LANG !== pair[0]) b.addEventListener('click', function () { setLang(pair[0]); });
      host.appendChild(b);
    });
  }

  function init() { applyStatic(document); mountToggle(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }

  window.MetroI18n = { lang: LANG, t: t, setLang: setLang, applyStatic: applyStatic };
  window.t = t;
})();
