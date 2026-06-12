/* Testes do planeador de percursos — correr com: node tools/test_router.js */
'use strict';
const path = require('path');
const { createRouter } = require(path.join(__dirname, '..', 'app', 'router.js'));
const METRO = require(path.join(__dirname, '..', 'app', 'data', 'data.json'));

let failures = 0;
function check(label, cond, detail) {
  if (cond) { console.log('  ok  ' + label); }
  else { failures++; console.error('FALHA ' + label + (detail ? ' — ' + JSON.stringify(detail) : '')); }
}

const router = createRouter(METRO);
const THU = new Date(2026, 5, 11, 8, 0); // quinta-feira, 08:00

// ================================================== pesquisa de estações
{
  const r1 = router.searchStations('sao bento');
  check('P1 pesquisa sem acentos', r1[0] && r1[0].id === 'sao-bento', r1[0]);
  const r2 = router.searchStations('norteshopping');
  check('P2 pesquisa por alias', r2[0] && r2[0].id === 'sete-bicas', r2[0]);
  const r3 = router.searchStations('cust').map(s => s.id);
  check('P3 nomes semelhantes: Custóias e Custió distintos',
    r3.includes('custoias') && r3.includes('custio'), r3);
  const r4 = router.searchStations('24');
  check('P4 pesquisa numérica', r4[0] && r4[0].id === 'campo-24-de-agosto', r4[0]);
}

// ================================================== percursos diretos (B real)
{
  const r = router.plan('estadio-do-dragao', 'povoa-de-varzim', THU);
  check('D1 estado ok', r.state === 'ok', r.state);
  check('D2 direto sem transbordo', r.best.nTransfers === 0, r.best);
  check('D3 partida >= 08:00', r.best.depMin >= 480, r.best.dep);
  check('D4 duração plausível (50-80 min)',
    r.best.durationMin >= 50 && r.best.durationMin <= 80, r.best.durationMin);
  check('D5 dados reais (não demo)', r.best.demo === false);
  check('D6 alternativas seguintes ordenadas',
    r.following.every((o, i, a) => i === 0 || a[i - 1].depMin <= o.depMin));
  check('D7 preço indisponível com razão clara (zonas por validar)',
    r.best.price.available === false && /zonas/.test(r.best.price.reason), r.best.price);
}

// ================================================== sentido e filtro de linha
{
  const r = router.plan('povoa-de-varzim', 'estadio-do-dragao', THU);
  check('S1 sentido inverso ok', r.state === 'ok' && r.best.nTransfers === 0);
  const f = router.plan('estadio-do-dragao', 'povoa-de-varzim', THU, { lineFilter: 'b' });
  check('S2 modo "só linha B" ok', f.state === 'ok' && f.best.legs[0].lineId === 'b');
  const bad = router.plan('estadio-do-dragao', 'povoa-de-varzim', THU, { lineFilter: 'a' });
  check('S3 linha errada não dá percurso', bad.state === 'none', bad.state);
}

// ================================================== transbordos (com demos)
{
  // Póvoa (só B) -> Vila d'Este (só D): transbordo obrigatório na Trindade
  const r = router.plan('povoa-de-varzim', 'vila-deste', THU);
  check('T1 estado ok', r.state === 'ok', r.state);
  check('T2 exatamente 1 transbordo', r.best.nTransfers === 1, r.best.legs);
  check('T3 transbordo na Trindade', r.best.transfers[0].station === 'trindade',
    r.best.transfers);
  check('T4 espera >= tempo mínimo', r.best.transfers[0].waitMin >= 4,
    r.best.transfers);
  check('T5 marcado como demo (linha D fictícia)', r.best.demo === true);
  const arrOk = r.best.legs[1].depMin >= r.best.legs[0].arrMin + 4;
  check('T6 ligação respeitada (partida 2 >= chegada 1 + 4 min)', arrOk, r.best.legs);

  // Fânzeres (F) -> Aeroporto (E)
  const r2 = router.plan('fanzeres', 'aeroporto', THU);
  check('T7 F->E com 1 transbordo', r2.state === 'ok' && r2.best.nTransfers === 1,
    r2.best && r2.best.legs.map(l => l.lineId));
}

// ================================================== fim de serviço / madrugada
{
  const r = router.plan('estadio-do-dragao', 'povoa-de-varzim',
    new Date(2026, 5, 13, 2, 30)); // 02:30 de sábado = serviço de sexta esgotado
  check('M1 sem serviço -> dia seguinte', r.state === 'tomorrow', r.state);
  check('M2 quadro de sábado', r.dayType === 'saturday', r.dayType);
  check('M3 primeira partida 05:54', r.best.dep === '05:54', r.best.dep);

  const late = router.plan('estadio-do-dragao', 'povoa-de-varzim',
    new Date(2026, 5, 11, 23, 55));
  check('M4 23:55 ainda apanha partida pós-meia-noite',
    late.state === 'ok' && late.best.depMin >= 1435, late.best && late.best.dep);
}

// ================================================== override de tipo de dia
{
  const r = router.plan('estadio-do-dragao', 'povoa-de-varzim', THU,
    { dayTypeOverride: 'saturday' });
  check('O1 override sábado, primeira partida do dia', r.best.dep === '05:54', r.best.dep);
}

// ================================================== zonas e preço (fixture fictícia)
{
  const fixture = {
    network: {
      transferMinMinutes: 4,
      stations: [
        { id: 's1', name: 'Um', aliases: [], zones: ['A'], lines: ['x'] },
        { id: 's2', name: 'Dois', aliases: [], zones: ['A', 'B'], lines: ['x'] },
        { id: 's3', name: 'Três', aliases: [], zones: ['B'], lines: ['x', 'y'] },
        { id: 's4', name: 'Quatro', aliases: [], zones: ['C'], lines: ['x'] },
        { id: 's5', name: 'Cinco', aliases: [], zones: ['C'], lines: ['y'] },
        { id: 's6', name: 'Seis', aliases: [], zones: [], lines: ['y'] }
      ],
      lines: [
        { id: 'x', name: 'Linha X', color: '#000', stations: ['s1', 's2', 's3', 's4'] },
        { id: 'y', name: 'Linha Y', color: '#111', stations: ['s3', 's5', 's6'] }
      ]
    },
    schedules: {
      x: { demo: false, trips: [
        { dayType: 'weekday', dir: 'fwd', service: 'X', times: ['10:00', '10:04', '10:10', '10:15'] },
        { dayType: 'weekday', dir: 'fwd', service: 'X', times: ['10:20', '10:24', '10:30', '10:35'] }
      ]},
      y: { demo: false, trips: [
        { dayType: 'weekday', dir: 'fwd', service: 'Y', times: ['10:12', '10:20', '10:25'] },
        { dayType: 'weekday', dir: 'fwd', service: 'Y', times: ['10:30', '10:38', '10:43'] }
      ]}
    },
    fares: { minZones: 2, occasional: { Z2: 1.0, Z3: 1.5 } },
    holidays: {}
  };
  const rt = createRouter(fixture);
  const NOW = new Date(2026, 5, 11, 9, 0);

  // zona em fronteira conta uma vez: s1(A) s2(A|B) s3(B) -> 2 zonas
  const zc = rt.zoneCount(['s1', 's2', 's3']);
  check('Z1 estação multi-zona minimiza contagem', zc.count === 2, zc);
  const zc2 = rt.zoneCount(['s2', 's3']);
  check('Z2 mínimo de zonas do percurso é 1, título Z2', zc2.count === 1, zc2);
  const zc3 = rt.zoneCount(['s3', 's5', 's6']);
  check('Z3 estação sem zona -> indisponível', zc3.available === false, zc3);

  const p = rt.plan('s1', 's4', NOW);
  check('Z4 preço calculado: 3 zonas = 1.5', p.best.price.available &&
    p.best.price.zoneCount === 3 && p.best.price.price === 1.5, p.best.price);

  // transbordo demasiado justo: X chega a s3 às 10:10, Y das 10:12 perde-se
  // (10:10 + 4 > 10:12) -> tem de apanhar o Y das 10:30
  const t = rt.plan('s1', 's5', NOW);
  check('Z5 ligação justa rola para a viagem seguinte',
    t.best.legs[1].dep === '10:30', t.best.legs);
  check('Z6 espera reportada (20 min)', t.best.transfers[0].waitMin === 20,
    t.best.transfers);

  // destino sem zona -> percurso ok mas preço honesto
  const u = rt.plan('s1', 's6', NOW);
  check('Z7 percurso ok, preço indisponível', u.state === 'ok' &&
    u.best.price.available === false, u.best.price);
}

console.log(failures ? `\n${failures} teste(s) falharam` : '\nTodos os testes passaram');
process.exit(failures ? 1 : 0);
