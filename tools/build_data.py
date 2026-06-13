# -*- coding: utf-8 -*-
r"""
build_data.py — Valida e funde os dados da app num único artefacto.

Entradas (em data\):
    network.json            rede canónica EDITÁVEL (estações, aliases, zonas, linhas)
    fares.json              tarifário Andante EDITÁVEL
    schedules\line-<id>.json            horários reais (extract.py)
    schedules\line-<id>.estimated.json  horários estimados por frequência
    schedules\line-<id>.demo.json       horários fictícios (gen_demo_schedules.py);
                                        usados apenas se não existir real/estimado

Saídas:
    app\data\data.js        window.METRO = {...} (usado pela app, funciona em file://)
    app\data\data.json      cópia legível para inspeção
    data\build-report.txt   relatório de validação

Falha (exit 1) se houver erros de coerência — não publicar nesse caso.
"""
import datetime
import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
APP_DATA = ROOT / "app" / "data"

report, errors = [], []


def log(msg):
    report.append(msg)
    print(msg)


def err(msg):
    errors.append(msg)
    log(f"ERRO: {msg}")


def norm(s):
    s = unicodedata.normalize("NFKD", s.lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def to_minutes(hhmm):
    return int(hhmm[:2]) * 60 + int(hhmm[3:5])


def service_minutes(times):
    """Mesma regra do extract.py / engine.js (madrugada pertence ao dia anterior)."""
    first = next((t for t in times if t is not None), None)
    offset = 1440 if first is not None and to_minutes(first) < 240 else 0
    out, prev = [], None
    for t in times:
        if t is None:
            out.append(None)
            continue
        m = to_minutes(t) + offset
        if prev is not None and m < prev:
            offset += 1440
            m += 1440
        out.append(m)
        prev = m
    return out


def easter(year):
    a = year % 19
    b, c = divmod(year, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month, day = divmod(h + l - 7 * m + 114, 31)
    return datetime.date(year, month, day + 1)


def portuguese_holidays(year):
    e = easter(year)
    fixed = [(1, 1), (4, 25), (5, 1), (6, 10), (8, 15),
             (10, 5), (11, 1), (12, 1), (12, 8), (12, 25)]
    days = [datetime.date(year, m, d) for m, d in fixed]
    days += [e - datetime.timedelta(days=2), e, e + datetime.timedelta(days=60)]
    return sorted(d.isoformat() for d in days)


# ------------------------------------------------------------ normalização

def convert_legacy_b(raw, name_to_id, line_def):
    """Converte o formato do extract.py (linha B) para o formato unificado."""
    # mapear ids antigos -> nomes -> ids canónicos
    old_names = {s["id"]: s["name"] for s in raw["stations"]}
    fwd_old = raw["directions"]["outbound"]["stationOrder"]
    fwd_canon = []
    for old_id in fwd_old:
        name = old_names[old_id]
        canon = name_to_id.get(norm(name))
        if canon is None:
            err(f"linha B: estação do PDF sem correspondência canónica: {name!r}")
            return None
        fwd_canon.append(canon)
    if fwd_canon != line_def["stations"]:
        err("linha B: ordem de estações do PDF difere da network.json:\n"
            f"  PDF:     {fwd_canon}\n  network: {line_def['stations']}")
        return None
    trips = [{
        "dayType": t["dayType"],
        "dir": "fwd" if t["direction"] == "outbound" else "rev",
        "service": t["service"],
        "times": t["times"],
    } for t in raw["trips"]]
    return {
        "line": "b",
        "demo": False,
        "source": raw["source"],
        "validity": raw["validity"],
        "notes": raw.get("notes", []),
        "trips": trips,
    }


def validate_schedule(sched, line_def):
    n = len(line_def["stations"])
    label = f"linha {sched['line'].upper()}"
    count = 0
    for t in sched["trips"]:
        if len(t["times"]) != n:
            err(f"{label}: viagem com {len(t['times'])} tempos (esperava {n})")
            continue
        mins = service_minutes(t["times"])
        served = [m for m in mins if m is not None]
        if len(served) < 2:
            err(f"{label}: viagem com menos de 2 paragens")
        if any(b <= a for a, b in zip(served, served[1:])):
            err(f"{label}: tempos não crescentes na viagem {t}")
        if t["dir"] not in ("fwd", "rev"):
            err(f"{label}: direção inválida {t['dir']!r}")
        if t["dayType"] not in ("weekday", "saturday", "sunday_holiday"):
            err(f"{label}: dayType inválido {t['dayType']!r}")
        count += 1
    suffix = ""
    if sched.get("demo"):
        suffix = " (DEMO)"
    elif sched.get("estimated"):
        suffix = " (ESTIMADO)"
    log(f"{label}: {count} viagens{suffix}")


def main():
    network = json.loads((DATA / "network.json").read_text(encoding="utf-8"))
    fares = json.loads((DATA / "fares.json").read_text(encoding="utf-8"))

    # --- validar rede ---
    stations = network["stations"]
    ids = [s["id"] for s in stations]
    if len(set(ids)) != len(ids):
        err("ids de estação duplicados na network.json")
    name_to_id = {}
    for s in stations:
        for label in [s["name"]] + s.get("aliases", []):
            key = norm(label)
            if key in name_to_id and name_to_id[key] != s["id"]:
                err(f"nome/alias ambíguo: {label!r} -> {name_to_id[key]} e {s['id']}")
            name_to_id[key] = s["id"]

    id_set = set(ids)
    lines_by_station = {}
    for line in network["lines"]:
        if len(line["stations"]) < 2:
            err(f"linha {line['id']}: menos de 2 estações")
        for sid in line["stations"]:
            if sid not in id_set:
                err(f"linha {line['id']}: estação desconhecida {sid!r}")
            lines_by_station.setdefault(sid, []).append(line["id"])
        if len(set(line["stations"])) != len(line["stations"]):
            err(f"linha {line['id']}: estações repetidas na sequência")
    orphans = [sid for sid in ids if sid not in lines_by_station]
    if orphans:
        err(f"estações sem linha: {orphans}")
    log(f"rede: {len(stations)} estações, {len(network['lines'])} linhas")
    multi = sum(1 for v in lines_by_station.values() if len(v) > 1)
    log(f"estações servidas por mais de uma linha: {multi}")

    # --- zonas (aviso, não erro: o cálculo de preço degrada com mensagem clara) ---
    sem_zona = sum(1 for s in stations if not s.get("zones"))
    if sem_zona:
        log(f"AVISO: {sem_zona} estações sem zona Andante atribuída — o preço "
            "não será calculado em percursos que as atravessem (preencher em "
            "data/network.json, ver zonesNote)")
    zones = network.get("zones", {})
    # adjacência simétrica (preencher o recíproco se faltar)
    for z, info in zones.items():
        for adj in info.get("adjacent", []):
            if adj not in zones:
                err(f"zona {z}: adjacente desconhecida {adj!r}")
            elif z not in zones[adj].get("adjacent", []):
                zones[adj].setdefault("adjacent", []).append(z)
    for s in stations:
        for z in s.get("zones", []):
            if z not in zones:
                err(f"estação {s['id']}: zona desconhecida {z!r}")
    if zones:
        log(f"zonas: {len(zones)} ({'estimadas' if network.get('zonesEstimated') else 'validadas'})")

    # --- tarifário ---
    if not fares.get("occasional"):
        err("fares.json sem tabela 'occasional'")
    for k, v in fares.get("occasional", {}).items():
        if not re.match(r"^Z\d+$", k) or not isinstance(v, (int, float)) or v <= 0:
            err(f"tarifa inválida: {k}={v}")

    # --- horários: real > estimated > demo > nenhum ---
    schedules = {}
    for line in network["lines"]:
        lid = line["id"]
        real = DATA / "schedules" / f"line-{lid}.json"
        estimated = DATA / "schedules" / f"line-{lid}.estimated.json"
        demo = DATA / "schedules" / f"line-{lid}.demo.json"
        if real.exists():
            raw = json.loads(real.read_text(encoding="utf-8"))
            if "directions" in raw:  # formato legado do extract.py
                sched = convert_legacy_b(raw, name_to_id, line)
            else:
                sched = raw
        elif estimated.exists():
            sched = json.loads(estimated.read_text(encoding="utf-8"))
        elif demo.exists():
            sched = json.loads(demo.read_text(encoding="utf-8"))
        else:
            log(f"linha {lid.upper()}: SEM horários (percursos sem tempos)")
            continue
        if sched is None:
            continue
        validate_schedule(sched, line)
        schedules[lid] = sched

    # --- montar artefacto ---
    this_year = datetime.date.today().year
    holidays = {str(y): portuguese_holidays(y) for y in range(this_year, this_year + 6)}
    bundle = {
        "schemaVersion": 2,
        "builtAt": datetime.datetime.now(datetime.timezone.utc)
            .strftime("%Y-%m-%dT%H:%M:%SZ"),
        "network": {
            "transferMinMinutes": network.get("transferMinMinutes", 4),
            "zones": network.get("zones", {}),
            "zonesEstimated": bool(network.get("zonesEstimated")),
            "stations": [{
                "id": s["id"],
                "name": s["name"],
                "aliases": s.get("aliases", []),
                "zones": s.get("zones", []),
                "lines": lines_by_station.get(s["id"], []),
            } for s in stations],
            "lines": network["lines"],
        },
        "schedules": schedules,
        "fares": fares,
        "holidays": holidays,
    }

    status = "FALHOU" if errors else "OK"
    log(f"\nVALIDAÇÃO: {status} ({len(errors)} erro(s))")
    (DATA / "build-report.txt").write_text("\n".join(report) + "\n", encoding="utf-8")

    if errors:
        sys.exit(1)

    APP_DATA.mkdir(parents=True, exist_ok=True)
    (APP_DATA / "data.json").write_text(
        json.dumps(bundle, ensure_ascii=False, indent=1), encoding="utf-8")
    (APP_DATA / "data.js").write_text(
        "// Gerado por tools/build_data.py — NÃO editar à mão.\n"
        "// Editáveis: data/network.json, data/fares.json; horários: tools/extract.py.\n"
        f"window.METRO = {json.dumps(bundle, ensure_ascii=False)};\n",
        encoding="utf-8")
    print(f"\nEscrito: {APP_DATA / 'data.js'}")


if __name__ == "__main__":
    main()
