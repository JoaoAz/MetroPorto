'use strict';

const fs = require('fs');
const vm = require('vm');
const engine = require('../app/engine.js');

const context = { window: {} };
vm.createContext(context);
vm.runInContext(fs.readFileSync('app/data/bus-lines.js', 'utf8'), context);

const DATA = context.window.BUS_SCHEDULES;

let failures = 0;
function ok(name, condition) {
  if (condition) console.log('  ok ', name);
  else {
    failures += 1;
    console.error('FAIL', name);
  }
}

function normalize(text) {
  return String(text || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const stopsByName = {};
DATA.stops.forEach((stop) => {
  stopsByName[normalize(stop.name)] = stop.id;
});

function allLines() {
  return DATA.municipalities.flatMap((municipality) => municipality.lines);
}

function directJourneys(originId, destId, dayType) {
  const journeys = [];
  allLines().forEach((line) => {
    line.directions.forEach((direction) => {
      const originIndex = direction.stopIds.indexOf(originId);
      const destIndex = direction.stopIds.indexOf(destId);
      if (originIndex === -1 || destIndex === -1 || originIndex >= destIndex) return;
      const day = direction.dayTypes[dayType];
      day.trips.forEach((trip) => {
        const minutes = engine.tripMinutes(trip);
        if (minutes[originIndex] === null || minutes[destIndex] === null) return;
        journeys.push({
          line: line.code,
          dep: engine.fmtMin(minutes[originIndex]),
          arr: engine.fmtMin(minutes[destIndex])
        });
      });
    });
  });
  return journeys;
}

ok('B1 tem dois municipios', DATA.municipalities.length === 2);
ok('B2 tem 42 linhas', allLines().length === 42);
ok('B3 tem paragens principais extraidas', DATA.stops.length >= 180);

const povoaCct = stopsByName['povoa de varzim cct'];
const hospital = stopsByName['hospital s joao circunvalacao'];
const hospitalJourneys = directJourneys(povoaCct, hospital, 'weekday');
ok('B4 encontra Povoa CCT -> Hospital Sao Joao', hospitalJourneys.length > 20);
ok('B5 primeira viagem 3503 bate com o PDF', hospitalJourneys.some((j) => (
  j.line === '3503' && j.dep === '06:00' && j.arr === '07:05'
)));

const line3306 = allLines().find((line) => line.code === '3306');
const weekday3306 = line3306.directions[0].dayTypes.weekday.trips;
ok('B6 frequencia 20/20 da 3306 foi expandida', weekday3306.length >= 35);

if (failures) process.exit(1);
console.log('\nTodos os testes de autocarros passaram');
