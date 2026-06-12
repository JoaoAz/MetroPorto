/* Testes das utilidades de tempo/calendário — correr com: node tools/test_engine.js */
'use strict';
const path = require('path');
const engine = require(path.join(__dirname, '..', 'app', 'engine.js'));
const data = require(path.join(__dirname, '..', 'app', 'data', 'data.json'));
const holidays = data.holidays;

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log('  ok  ' + label); }
  else { failures++; console.error('FALHA ' + label + (detail ? ' — ' + JSON.stringify(detail) : '')); }
}

// 1) conversões básicas
check('1.1 toMin', engine.toMin('06:01') === 361);
check('1.2 fmtMin normal', engine.fmtMin(361) === '06:01');
check('1.3 fmtMin pós-meia-noite', engine.fmtMin(1467) === '00:27');

// 2) minutos de serviço de uma viagem
{
  const m = engine.tripMinutes(['23:49', null, '23:59', '00:01', '00:52']);
  check('2.1 cruzamento da meia-noite', m[3] === 1441 && m[4] === 1492, m);
  check('2.2 null preservado', m[1] === null);
  const late = engine.tripMinutes(['00:27', '00:30']);
  check('2.3 viagem de madrugada pertence ao dia anterior', late[0] === 1467, late);
}

// 3) tipo de dia
{
  check('3.1 quinta é dia útil',
    engine.dayTypeFor(new Date(2026, 5, 11), holidays) === 'weekday');
  check('3.2 sábado',
    engine.dayTypeFor(new Date(2026, 5, 13), holidays) === 'saturday');
  check('3.3 feriado 10 de junho conta como domingo',
    engine.dayTypeFor(new Date(2026, 5, 10), holidays) === 'sunday_holiday');
  check('3.4 Natal é feriado',
    engine.dayTypeFor(new Date(2026, 11, 25), holidays) === 'sunday_holiday');
}

// 4) contexto de serviço
{
  const a = engine.serviceContext(new Date(2026, 5, 12, 0, 30));
  check('4.1 00:30 usa dia de serviço anterior',
    a.serviceDate.getDate() === 11 && a.nowMin === 1470, a);
  const b = engine.serviceContext(new Date(2026, 5, 12, 8, 0));
  check('4.2 08:00 usa o próprio dia',
    b.serviceDate.getDate() === 12 && b.nowMin === 480, b);
}

console.log(failures ? `\n${failures} teste(s) falharam` : '\nTodos os testes passaram');
process.exit(failures ? 1 : 0);
