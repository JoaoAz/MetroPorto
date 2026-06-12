/*
 * engine.js — Utilidades de tempo e calendário (lógica pura, sem DOM).
 * Usado pelo browser (window.MetroEngine) e por Node (module.exports).
 *
 * Conceito central: "dia de serviço". As viagens que partem depois da meia-noite
 * (00:01, 00:32, ...) pertencem ao dia de serviço anterior; internamente todas as
 * horas são minutos desde as 00:00 do dia de serviço (00:27 da madrugada = 1467).
 * O corte é às 04:00. A mesma regra existe em tools/extract.py e
 * tools/build_data.py (service_minutes) — alterar nos três sítios.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MetroEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SERVICE_DAY_CUTOFF_MIN = 4 * 60;
  var LATE_NIGHT_THRESHOLD_MIN = 4 * 60;

  function toMin(hm) {
    return parseInt(hm.slice(0, 2), 10) * 60 + parseInt(hm.slice(3, 5), 10);
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function fmtMin(serviceMin) {
    var m = serviceMin % 1440;
    return pad(Math.floor(m / 60)) + ':' + pad(m % 60);
  }

  // Horas de uma viagem -> minutos de serviço (regra partilhada com o pipeline).
  function tripMinutes(times) {
    var first = null;
    for (var i = 0; i < times.length; i++) {
      if (times[i] !== null) { first = times[i]; break; }
    }
    var offset = (first !== null && toMin(first) < LATE_NIGHT_THRESHOLD_MIN) ? 1440 : 0;
    var out = [], prev = null;
    for (var j = 0; j < times.length; j++) {
      if (times[j] === null) { out.push(null); continue; }
      var m = toMin(times[j]) + offset;
      if (prev !== null && m < prev) { offset += 1440; m += 1440; }
      out.push(m);
      prev = m;
    }
    return out;
  }

  function dateISO(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function isHoliday(date, holidays) {
    var list = holidays[String(date.getFullYear())];
    return !!list && list.indexOf(dateISO(date)) !== -1;
  }

  // Tipo de dia de uma data de calendário (feriados nacionais contam como domingo).
  function dayTypeFor(date, holidays) {
    if (isHoliday(date, holidays)) return 'sunday_holiday';
    var dow = date.getDay();
    if (dow === 0) return 'sunday_holiday';
    if (dow === 6) return 'saturday';
    return 'weekday';
  }

  // Instante atual -> dia de serviço + minutos de serviço.
  function serviceContext(now) {
    var minutes = now.getHours() * 60 + now.getMinutes();
    var serviceDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (minutes < SERVICE_DAY_CUTOFF_MIN) {
      serviceDate.setDate(serviceDate.getDate() - 1);
      minutes += 1440;
    }
    return { serviceDate: serviceDate, nowMin: minutes };
  }

  return {
    toMin: toMin,
    fmtMin: fmtMin,
    tripMinutes: tripMinutes,
    dayTypeFor: dayTypeFor,
    serviceContext: serviceContext,
    SERVICE_DAY_CUTOFF_MIN: SERVICE_DAY_CUTOFF_MIN
  };
});
