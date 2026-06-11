/* Testes do motor de cálculo — correr com: node tools/test_engine.js */
'use strict';
const path = require('path');
const engine = require(path.join(__dirname, '..', 'app', 'engine.js'));
const data = require(path.join(__dirname, '..', 'app', 'data', 'schedule.json'));
const holidays = require(path.join(__dirname, '..', 'app', 'data', 'holidays.json'));

const ESTADIO = 'estadio-do-dragao';
const POVOA = 'povoa-de-varzim';
const FONTE_CUCO = 'fonte-do-cuco';

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log('  ok  ' + label); }
  else { failures++; console.error('FALHA ' + label + (detail ? ' — ' + JSON.stringify(detail) : '')); }
}

// 1) Dia útil normal, 08:00, Estádio -> Póvoa
{
  const now = new Date(2026, 5, 11, 8, 0); // quinta-feira
  const r = engine.query(data, holidays, ESTADIO, POVOA, now);
  check('1.1 estado ok', r.state === 'ok', r);
  check('1.2 dia útil', r.dayType === 'weekday', r.dayType);
  check('1.3 sentido outbound', r.direction === 'outbound', r.direction);
  check('1.4 partida >= 08:00 e mínima', r.next.depMin >= 480 && r.next.depMin < 510, r.next);
  check('1.5 espera coerente', r.next.waitMin === r.next.depMin - 480, r.next);
  check('1.6 chegada depois da partida', r.next.arrMin > r.next.depMin, r.next);
  check('1.7 lista seguinte ordenada', r.following.every((d, i, a) => i === 0 || a[i - 1].depMin <= d.depMin));
}

// 2) Fim de noite, 23:55 de dia útil — ainda há partidas (00:01/00:32 do mesmo dia de serviço)
{
  const now = new Date(2026, 5, 11, 23, 55);
  const r = engine.query(data, holidays, ESTADIO, POVOA, now);
  check('2.1 estado ok', r.state === 'ok', r.state);
  check('2.2 partida pós-meia-noite (min >= 1435)', r.next.depMin >= 1435, r.next);
  check('2.3 marcada afterMidnight', r.next.afterMidnight === true, r.next);
}

// 3) 00:30 de sexta-feira = dia de serviço de quinta (weekday)
{
  const now = new Date(2026, 5, 12, 0, 30);
  const r = engine.query(data, holidays, ESTADIO, POVOA, now);
  check('3.1 estado ok', r.state === 'ok', r.state);
  check('3.2 quadro de dia útil', r.dayType === 'weekday', r.dayType);
  check('3.3 partida 00:3x', r.next.dep.slice(0, 4) === '00:3', r.next.dep);
}

// 4) 02:30 de sábado = serviço de sexta esgotado -> primeiros de sábado
{
  const now = new Date(2026, 5, 13, 2, 30);
  const r = engine.query(data, holidays, ESTADIO, POVOA, now);
  check('4.1 estado tomorrow', r.state === 'tomorrow', r.state);
  check('4.2 dia seguinte é sábado', r.nextDayType === 'saturday', r.nextDayType);
  check('4.3 primeira partida de sábado 05:54', r.next.dep === '05:54', r.next.dep);
}

// 5) Feriado nacional (10 de junho de 2026, quarta-feira) -> domingos e feriados
{
  const now = new Date(2026, 5, 10, 10, 0);
  const r = engine.query(data, holidays, ESTADIO, POVOA, now);
  check('5.1 feriado usa quadro de domingo', r.dayType === 'sunday_holiday', r.dayType);
  const sat = engine.dayTypeFor(new Date(2026, 5, 13), holidays);
  check('5.2 sábado normal', sat === 'saturday', sat);
  const xmas = engine.dayTypeFor(new Date(2026, 11, 25), holidays);
  check('5.3 Natal é feriado', xmas === 'sunday_holiday', xmas);
}

// 6) Origem saltada pelo expresso: nenhuma partida devolvida pode ser de viagem
//    que não pare em Fonte do Cuco; e nos dias úteis há Bx entre Estádio e Póvoa
{
  const now = new Date(2026, 5, 11, 8, 0);
  const r = engine.query(data, holidays, FONTE_CUCO, POVOA, now);
  check('6.1 estado ok', r.state === 'ok', r.state);
  const all = [r.next].concat(r.following);
  check('6.2 sem viagens Bx que saltem a origem', all.every(d => {
    const trip = data.trips.find(t => t.id === d.tripId);
    const oi = data.directions[r.direction].stationOrder.indexOf(FONTE_CUCO);
    return trip.times[oi] !== null;
  }));
  const r2 = engine.query(data, holidays, ESTADIO, POVOA, now);
  const hasBx = [r2.next].concat(r2.following).some(d => d.service === 'Bx');
  check('6.3 dias úteis Estádio->Póvoa inclui Bx às 08h', hasBx,
    [r2.next].concat(r2.following).map(d => d.service));
}

// 7) Sentido inverso
{
  const now = new Date(2026, 5, 11, 8, 0);
  const r = engine.query(data, holidays, POVOA, ESTADIO, now);
  check('7.1 sentido inbound', r.direction === 'inbound', r.direction);
  check('7.2 estado ok', r.state === 'ok', r.state);
}

// 8) Valores conferidos manualmente com o PDF (pág. 1, 1.ª viagem de dia útil):
//    Estádio 06:01 -> Póvoa 07:04
{
  const now = new Date(2026, 5, 11, 5, 0);
  const r = engine.query(data, holidays, ESTADIO, POVOA, now);
  check('8.1 primeira partida de dia útil 06:01', r.next.dep === '06:01', r.next.dep);
  check('8.2 chegada à Póvoa 07:04', r.next.arr === '07:04', r.next.arr);
}

// 9) Estados inválidos e override
{
  const now = new Date(2026, 5, 11, 8, 0);
  check('9.1 origem=destino é invalid',
    engine.query(data, holidays, ESTADIO, ESTADIO, now).state === 'invalid');
  const r = engine.query(data, holidays, ESTADIO, POVOA, now, { dayTypeOverride: 'saturday' });
  check('9.2 override devolve listagem completa', r.state === 'override' && r.departures.length === 51,
    r.departures && r.departures.length);
  check('9.3 override começa às 05:54', r.departures[0].dep === '05:54', r.departures[0]);
}

console.log(failures ? `\n${failures} teste(s) falharam` : '\nTodos os testes passaram');
process.exit(failures ? 1 : 0);
