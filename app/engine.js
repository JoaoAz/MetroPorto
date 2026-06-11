/*
 * engine.js — Motor de cálculo de horários (lógica pura, sem DOM).
 * Usado pelo browser (window.MetroEngine) e pelos testes em Node (module.exports).
 *
 * Conceito central: "dia de serviço". As viagens que partem depois da meia-noite
 * (00:01, 00:32, ...) pertencem ao dia de serviço anterior; internamente todas as
 * horas são minutos desde as 00:00 do dia de serviço (00:27 da madrugada = 1467).
 * O corte é às 04:00: entre as 00:00 e as 03:59 a app consulta o quadro do dia
 * anterior (não há partidas entre as ~01:35 e as ~05:44).
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

  // Horas de uma viagem -> minutos de serviço (mesma regra do extrator Python).
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

  function directionFor(data, originId, destId) {
    var order = data.directions.outbound.stationOrder;
    var oi = order.indexOf(originId), di = order.indexOf(destId);
    if (oi === -1 || di === -1 || oi === di) return null;
    return oi < di ? 'outbound' : 'inbound';
  }

  // Todas as partidas origem->destino de um tipo de dia, ordenadas.
  function departuresFor(data, dayType, direction, originId, destId) {
    var order = data.directions[direction].stationOrder;
    var oi = order.indexOf(originId), di = order.indexOf(destId);
    var result = [];
    for (var i = 0; i < data.trips.length; i++) {
      var trip = data.trips[i];
      if (trip.dayType !== dayType || trip.direction !== direction) continue;
      if (trip.times[oi] === null || trip.times[di] === null) continue;
      var mins = tripMinutes(trip.times);
      result.push({
        tripId: trip.id,
        service: trip.service,
        depMin: mins[oi],
        arrMin: mins[di],
        dep: fmtMin(mins[oi]),
        arr: fmtMin(mins[di]),
        afterMidnight: mins[oi] >= 1440
      });
    }
    result.sort(function (a, b) { return a.depMin - b.depMin; });
    return result;
  }

  /*
   * Consulta principal.
   * opts: { limit (default 6), dayTypeOverride ('weekday'|'saturday'|'sunday_holiday') }
   * Estados devolvidos em .state:
   *   'invalid'  — origem igual a destino / desconhecida
   *   'ok'       — há partidas no dia de serviço atual (next + following, waitMin)
   *   'tomorrow' — sem mais viagens hoje; partidas do dia de serviço seguinte
   *   'override' — listagem completa de um tipo de dia escolhido manualmente
   *   'none'     — sem qualquer viagem para o par pedido
   */
  function query(data, holidays, originId, destId, now, opts) {
    opts = opts || {};
    var limit = opts.limit || 6;
    var direction = directionFor(data, originId, destId);
    if (!direction) return { state: 'invalid' };

    if (opts.dayTypeOverride) {
      var all = departuresFor(data, opts.dayTypeOverride, direction, originId, destId);
      return {
        state: all.length ? 'override' : 'none',
        direction: direction,
        dayType: opts.dayTypeOverride,
        departures: all
      };
    }

    var ctx = serviceContext(now);
    var dayType = dayTypeFor(ctx.serviceDate, holidays);
    var todays = departuresFor(data, dayType, direction, originId, destId);
    var upcoming = todays.filter(function (d) { return d.depMin >= ctx.nowMin; });

    if (upcoming.length) {
      upcoming = upcoming.slice(0, limit).map(function (d) {
        d.waitMin = d.depMin - ctx.nowMin;
        return d;
      });
      return {
        state: 'ok',
        direction: direction,
        dayType: dayType,
        serviceDate: ctx.serviceDate,
        next: upcoming[0],
        following: upcoming.slice(1)
      };
    }

    // Sem mais viagens no dia de serviço atual -> primeiro(s) do dia seguinte.
    var nextDate = new Date(ctx.serviceDate.getTime());
    nextDate.setDate(nextDate.getDate() + 1);
    var nextDayType = dayTypeFor(nextDate, holidays);
    var tomorrows = departuresFor(data, nextDayType, direction, originId, destId)
      .slice(0, limit);
    if (!tomorrows.length) return { state: 'none', direction: direction };
    return {
      state: 'tomorrow',
      direction: direction,
      dayType: dayType,
      nextDayType: nextDayType,
      serviceDate: ctx.serviceDate,
      nextServiceDate: nextDate,
      next: tomorrows[0],
      following: tomorrows.slice(1)
    };
  }

  return {
    toMin: toMin,
    fmtMin: fmtMin,
    tripMinutes: tripMinutes,
    dayTypeFor: dayTypeFor,
    serviceContext: serviceContext,
    directionFor: directionFor,
    departuresFor: departuresFor,
    query: query,
    SERVICE_DAY_CUTOFF_MIN: SERVICE_DAY_CUTOFF_MIN
  };
});
