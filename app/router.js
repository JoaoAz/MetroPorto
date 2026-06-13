/*
 * router.js — Planeador de percursos (lógica pura, sem DOM).
 * Constrói índices sobre os dados (window.METRO), pesquisa estações,
 * enumera percursos candidatos (direto, 1 ou 2 transbordos) e valida-os
 * contra os horários reais, devolvendo opções ordenadas por hora de chegada.
 *
 * Algoritmo: a rede é pequena (~85 estações, 6 linhas, topologia em árvore com
 * tronco comum), por isso não se justifica Dijkstra/RAPTOR. Enumeramos
 * sequências de linhas possíveis (poucas dezenas), escolhemos as melhores
 * estações de transbordo pela contagem de paragens e validamos cada candidato
 * com os horários (próxima partida >= instante, tempo mínimo de transbordo,
 * madrugada com minutos de serviço > 1440). Errado seria BFS sem horários
 * (ignora esperas reais); excessivo seria um motor time-expanded completo.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./engine.js'));
  } else {
    root.MetroRouter = factory(root.MetroEngine);
  }
})(typeof self !== 'undefined' ? self : this, function (engine) {
  'use strict';

  function normalize(s) {
    return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function createRouter(METRO) {
    var net = METRO.network;
    var schedules = METRO.schedules || {};
    var holidays = METRO.holidays || {};
    var fares = METRO.fares || {};
    var TRANSFER_MIN = net.transferMinMinutes || 4;

    // ------------------------------------------------------------ índices
    var stationById = {};
    net.stations.forEach(function (s) { stationById[s.id] = s; });

    var lineById = {};
    var idxInLine = {};   // lineId -> {stationId: posição}
    net.lines.forEach(function (l) {
      lineById[l.id] = l;
      var idx = {};
      l.stations.forEach(function (sid, i) { idx[sid] = i; });
      idxInLine[l.id] = idx;
    });

    var searchEntries = net.stations.map(function (s) {
      return {
        station: s,
        keys: [normalize(s.name)].concat((s.aliases || []).map(normalize))
      };
    });

    // cache de minutos de serviço por viagem (lazy)
    var tripCache = new WeakMap ? new WeakMap() : null;
    function minsOf(trip) {
      if (tripCache) {
        var m = tripCache.get(trip);
        if (!m) { m = engine.tripMinutes(trip.times); tripCache.set(trip, m); }
        return m;
      }
      return engine.tripMinutes(trip.times);
    }

    // ------------------------------------------------------------ pesquisa
    function searchStations(query, limit) {
      var q = normalize(query || '');
      if (!q) return [];
      var scored = [];
      searchEntries.forEach(function (e) {
        var best = -1;
        e.keys.forEach(function (k, ki) {
          var pos = k.indexOf(q);
          if (pos === -1) return;
          // prefixo do nome > prefixo de palavra > substring; nome > alias
          var score = (pos === 0 ? 0 : (k[pos - 1] === ' ' ? 10 : 20)) + ki + pos / 100;
          if (best === -1 || score < best) best = score;
        });
        if (best !== -1) scored.push({ s: e.station, score: best });
      });
      scored.sort(function (a, b) {
        return a.score - b.score || a.s.name.localeCompare(b.s.name, 'pt');
      });
      return scored.slice(0, limit || 8).map(function (x) { return x.s; });
    }

    // ------------------------------------------------------- candidatos
    function sharedStations(l1, l2, exclude) {
      return lineById[l1].stations.filter(function (sid) {
        return idxInLine[l2][sid] !== undefined && exclude.indexOf(sid) === -1;
      });
    }

    function legStops(lineId, a, b) {
      return Math.abs(idxInLine[lineId][a] - idxInLine[lineId][b]);
    }

    // melhores estações de transbordo entre duas pernas (menos paragens totais)
    function bestTransfers(l1, from, l2, to, n) {
      var opts = sharedStations(l1, l2, [from, to]).map(function (t) {
        return { t: t, stops: legStops(l1, from, t) + legStops(l2, t, to) };
      });
      opts.sort(function (a, b) { return a.stops - b.stops; });
      return opts.slice(0, n).map(function (o) { return o.t; });
    }

    function candidateRoutes(originId, destId, lineFilter) {
      var oLines = stationById[originId].lines;
      var dLines = stationById[destId].lines;
      if (lineFilter) {
        oLines = oLines.filter(function (l) { return l === lineFilter; });
        dLines = dLines.filter(function (l) { return l === lineFilter; });
      }
      var routes = [], seen = {};
      function add(legs) {
        var sig = legs.map(function (g) { return g.line + ':' + g.from + '>' + g.to; }).join('|');
        if (!seen[sig]) { seen[sig] = true; routes.push(legs); }
      }
      // direto
      oLines.forEach(function (l) {
        if (dLines.indexOf(l) !== -1) add([{ line: l, from: originId, to: destId }]);
      });
      if (lineFilter) return routes;
      // 1 transbordo
      oLines.forEach(function (l1) {
        dLines.forEach(function (l2) {
          if (l1 === l2) return;
          bestTransfers(l1, originId, l2, destId, 2).forEach(function (t) {
            add([{ line: l1, from: originId, to: t },
                 { line: l2, from: t, to: destId }]);
          });
        });
      });
      // 2 transbordos — só se nada foi encontrado (rede atual nunca precisa,
      // mas mantém o planeador correto se a rede crescer)
      if (!routes.length) {
        oLines.forEach(function (l1) {
          dLines.forEach(function (l3) {
            net.lines.forEach(function (mid) {
              var l2 = mid.id;
              if (l2 === l1 || l2 === l3) return;
              bestTransfers(l1, originId, l2, destId, 1).forEach(function (t1) {
                bestTransfers(l2, t1, l3, destId, 1).forEach(function (t2) {
                  if (t1 === t2) return;
                  add([{ line: l1, from: originId, to: t1 },
                       { line: l2, from: t1, to: t2 },
                       { line: l3, from: t2, to: destId }]);
                });
              });
            });
          });
        });
      }
      return routes;
    }

    // ------------------------------------------------- avaliação horária
    // Próxima viagem na linha que sirva from->to com partida >= earliest.
    function nextLeg(lineId, fromId, toId, dayType, earliestMin) {
      var sched = schedules[lineId];
      if (!sched) return { missing: true };
      var line = lineById[lineId];
      var n = line.stations.length;
      var iF = idxInLine[lineId][fromId], iT = idxInLine[lineId][toId];
      var dir = iF < iT ? 'fwd' : 'rev';
      var pF = dir === 'fwd' ? iF : n - 1 - iF;
      var pT = dir === 'fwd' ? iT : n - 1 - iT;
      var best = null;
      for (var i = 0; i < sched.trips.length; i++) {
        var trip = sched.trips[i];
        if (trip.dayType !== dayType || trip.dir !== dir) continue;
        var mins = minsOf(trip);
        var dep = mins[pF], arr = mins[pT];
        if (dep === null || arr === null || dep < earliestMin) continue;
        if (!best || dep < best.depMin) {
          best = {
            depMin: dep,
            arrMin: arr,
            service: trip.service,
            demo: !!sched.demo,
            estimated: !!sched.estimated
          };
        }
      }
      return best || { none: true };
    }

    function evalRoute(legs, dayType, startMin) {
      var t = startMin, out = [], transfers = [];
      var demo = false, estimated = false, missing = [];
      for (var i = 0; i < legs.length; i++) {
        var g = legs[i];
        var r = nextLeg(g.line, g.from, g.to, dayType, t);
        if (r.missing) { missing.push(g.line); continue; }
        if (r.none) return { none: true };
        if (i > 0 && out.length) {
          transfers.push({ station: g.from, waitMin: r.depMin - out[out.length - 1].arrMin });
        }
        demo = demo || r.demo;
        estimated = estimated || r.estimated;
        out.push({
          lineId: g.line, from: g.from, to: g.to,
          depMin: r.depMin, arrMin: r.arrMin,
          dep: engine.fmtMin(r.depMin), arr: engine.fmtMin(r.arrMin),
          service: r.service, demo: r.demo, estimated: r.estimated
        });
        t = r.arrMin + TRANSFER_MIN;
      }
      if (missing.length) return { untimed: true, missingLines: missing };
      return { legs: out, transfers: transfers, demo: demo, estimated: estimated };
    }

    // ------------------------------------------------------ zonas e preço
    function pathStations(legs) {
      var ids = [];
      legs.forEach(function (g) {
        var line = lineById[g.line];
        var iF = idxInLine[g.line][g.from], iT = idxInLine[g.line][g.to];
        var step = iF < iT ? 1 : -1;
        for (var i = iF; i !== iT + step; i += step) {
          var sid = line.stations[i];
          if (ids[ids.length - 1] !== sid) ids.push(sid);
        }
      });
      return ids;
    }

    /*
     * Regra Andante (títulos ocasionais): um título Zn é válido na zona da
     * primeira validação e em n-1 anéis de zonas à sua volta. O título
     * necessário é portanto 1 + a maior distância (em anéis, no grafo de
     * adjacência de zonas) entre a zona de origem e qualquer zona atravessada.
     * Estações de fronteira (várias zonas) contam pela zona mais favorável.
     */
    var zoneGraph = net.zones || {};
    var distCache = {};

    function zoneDistances(fromZone) {
      if (distCache[fromZone]) return distCache[fromZone];
      var dist = {};
      dist[fromZone] = 0;
      var queue = [fromZone];
      while (queue.length) {
        var z = queue.shift();
        ((zoneGraph[z] && zoneGraph[z].adjacent) || []).forEach(function (n) {
          if (dist[n] === undefined) { dist[n] = dist[z] + 1; queue.push(n); }
        });
      }
      distCache[fromZone] = dist;
      return dist;
    }

    function ringTicket(stationIds) {
      var zonesSeq = stationIds.map(function (sid) {
        return stationById[sid].zones || [];
      });
      if (zonesSeq.some(function (z) { return z.length === 0; })) {
        return { available: false, reason: 'zonas por validar nos dados da rede' };
      }
      var best = null;
      zonesSeq[0].forEach(function (originZone) {   // 1.ª validação
        var dist = zoneDistances(originZone);
        var maxRing = 0, reachable = true;
        for (var i = 0; i < zonesSeq.length && reachable; i++) {
          var d = null;
          zonesSeq[i].forEach(function (z) {        // fronteira: zona favorável
            if (dist[z] !== undefined && (d === null || dist[z] < d)) d = dist[z];
          });
          if (d === null) reachable = false;
          else if (d > maxRing) maxRing = d;
        }
        if (reachable && (best === null || maxRing + 1 < best.rings)) {
          best = { rings: maxRing + 1, originZone: originZone };
        }
      });
      if (!best) {
        return { available: false, reason: 'zonas sem ligação no grafo de adjacência' };
      }
      return { available: true, rings: best.rings, originZone: best.originZone };
    }

    function priceInfo(legs) {
      var rt = ringTicket(pathStations(legs));
      if (!rt.available) return rt;
      var n = Math.max(rt.rings, fares.minZones || 2);
      var key = 'Z' + n;
      var table = fares.occasional || {};
      if (table[key] === undefined) {
        return { available: false, zoneCount: n,
                 reason: 'sem tarifa conhecida para ' + key };
      }
      return { available: true, zoneCount: n, originZone: rt.originZone,
               estimated: !!net.zonesEstimated, title: key, price: table[key] };
    }

    // -------------------------------------------------------------- plano
    function decorate(ev, candidate) {
      var first = ev.legs[0], last = ev.legs[ev.legs.length - 1];
      return {
        legs: ev.legs,
        transfers: ev.transfers,
        depMin: first.depMin, arrMin: last.arrMin,
        dep: first.dep, arr: last.arr,
        durationMin: last.arrMin - first.depMin,
        nTransfers: ev.legs.length - 1,
        demo: ev.demo,
        estimated: ev.estimated,
        price: priceInfo(candidate)
      };
    }

    /*
     * plan(originId, destId, now, opts)
     * opts: { dayTypeOverride, lineFilter, alternatives (default 4) }
     * Estados: 'invalid' | 'ok' | 'tomorrow' | 'untimed' | 'none'
     */
    function plan(originId, destId, now, opts) {
      opts = opts || {};
      if (!stationById[originId] || !stationById[destId] || originId === destId) {
        return { state: 'invalid' };
      }
      var candidates = candidateRoutes(originId, destId, opts.lineFilter || null);
      if (!candidates.length) return { state: 'none' };

      var calendarDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      var nowMin = now.getHours() * 60 + now.getMinutes();
      var dayType = opts.dayTypeOverride ||
        engine.dayTypeFor(calendarDate, holidays);
      var startMin = opts.dayTypeOverride ? 0 : nowMin;

      function evaluateAll(dt, t0) {
        var timed = [], untimed = [];
        candidates.forEach(function (c) {
          var ev = evalRoute(c, dt, t0);
          if (ev.none) return;
          if (ev.untimed) { untimed.push({ candidate: c, missingLines: ev.missingLines }); return; }
          timed.push(decorate(ev, c));
        });
        timed.sort(function (a, b) {
          return a.arrMin - b.arrMin || a.nTransfers - b.nTransfers ||
                 b.depMin - a.depMin;
        });
        return { timed: timed, untimed: untimed };
      }

      var res = evaluateAll(dayType, startMin);
      var state = 'ok', usedDayType = dayType, nextServiceDate = null;

      if (!res.timed.length && !opts.dayTypeOverride) {
        // sem mais viagens no dia civil atual -> dia seguinte
        nextServiceDate = new Date(calendarDate.getTime());
        nextServiceDate.setDate(nextServiceDate.getDate() + 1);
        usedDayType = engine.dayTypeFor(nextServiceDate, holidays);
        res = evaluateAll(usedDayType, 0);
        state = res.timed.length ? 'tomorrow' : 'untimed';
      } else if (!res.timed.length) {
        state = 'untimed';
      }

      // alternativas seguintes: replanear a partir da partida seguinte
      var following = [];
      if (res.timed.length) {
        var t = res.timed[0].depMin + 1;
        var dt = usedDayType;
        for (var k = 0; k < (opts.alternatives || 4); k++) {
          var again = evaluateAll(dt, t);
          if (!again.timed.length) break;
          following.push(again.timed[0]);
          t = again.timed[0].depMin + 1;
        }
      }

      // percursos sem horário (linhas sem dados): descrever apenas o trajeto
      var untimedRoutes = res.untimed.map(function (u) {
        return {
          legs: u.candidate.map(function (g) {
            return { lineId: g.line, from: g.from, to: g.to };
          }),
          missingLines: u.missingLines,
          price: priceInfo(u.candidate)
        };
      });

      if (!res.timed.length && !untimedRoutes.length) return { state: 'none' };

      return {
        state: res.timed.length ? state : 'untimed',
        dayType: usedDayType,
        serviceDate: calendarDate,
        nextServiceDate: nextServiceDate,
        best: res.timed[0] || null,
        following: following,
        untimedRoutes: untimedRoutes,
        nowMin: nowMin
      };
    }

    return {
      searchStations: searchStations,
      candidateRoutes: candidateRoutes,
      plan: plan,
      ringTicket: ringTicket,
      pathStations: pathStations,
      station: function (id) { return stationById[id]; },
      line: function (id) { return lineById[id]; }
    };
  }

  return { createRouter: createRouter, normalize: normalize };
});
