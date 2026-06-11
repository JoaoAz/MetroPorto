# -*- coding: utf-8 -*-
r"""
extract.py — Pipeline de extração dos horários do Metro do Porto (Linha B)
a partir do PDF oficial, gerando os dados estruturados usados pela web app.

Uso:
    python extract.py [caminho\para\horarios.pdf]

Sem argumento, usa o PDF mais recente em ..\pdfs\.

Saídas:
    app\data\schedule.json   — dados estruturados (fonte canónica)
    app\data\schedule.js     — mesmo conteúdo como script (funciona em file://)
    app\data\holidays.json   — feriados nacionais portugueses (calculados)
    data\extraction-report.txt — relatório de validação da extração

Correções manuais (opcional): data\overrides.json
    {
      "removeTrips": ["weekday-outbound-003"],
      "editTrips":   { "weekday-outbound-005": { "times": ["06:01", ...] } },
      "addTrips":    [ { "dayType": "...", "direction": "...", "service": "B",
                         "times": [...] } ]
    }
"""
import datetime
import hashlib
import json
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).resolve().parent.parent
APP_DATA = ROOT / "app" / "data"
REPORT_PATH = ROOT / "data" / "extraction-report.txt"
OVERRIDES_PATH = ROOT / "data" / "overrides.json"

TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
N_STATIONS_EXPECTED = 36

# Tempo máximo plausível (min) entre duas passagens consecutivas registadas
# numa viagem (um expresso pode saltar várias estações de ~2 min cada).
MAX_GAP_MIN = 20
MIN_GAP_MIN = 1

report_lines = []
errors = []


def log(msg):
    report_lines.append(msg)
    print(msg)


def err(msg):
    errors.append(msg)
    log(f"ERRO: {msg}")


def slugify(name):
    base = name.split("|")[-1].strip() if "|" in name else name
    norm = unicodedata.normalize("NFKD", base)
    norm = "".join(c for c in norm if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "-", norm.lower()).strip("-")


def cluster_1d(values, tol):
    """Agrupa valores 1D em clusters separados por mais de `tol`; devolve centros."""
    groups = []
    for v in sorted(values):
        if groups and v - groups[-1][-1] <= tol:
            groups[-1].append(v)
        else:
            groups.append([v])
    return [sum(g) / len(g) for g in groups]


def nearest(centers, x, tol):
    best, dist = None, None
    for i, c in enumerate(centers):
        d = abs(c - x)
        if dist is None or d < dist:
            best, dist = i, d
    return best if dist is not None and dist <= tol else None


def to_minutes(hhmm):
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def service_minutes(times):
    """Converte a lista de horas de uma viagem em minutos de serviço,
    somando 24h depois de cruzar a meia-noite. Uma viagem cuja primeira hora
    é antes das 04:00 pertence por inteiro à madrugada do dia de serviço
    (offset inicial de 24h). Devolve lista alinhada (None onde não para)."""
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


def classify_page(rotated_lines):
    """Determina o tipo de dia a partir dos rótulos rodados da página."""
    blob = " ".join(rotated_lines)
    if "Mondays to Fridays" in blob or "Dias Úteis" in blob or "Dias úteis" in blob:
        return "weekday"
    if "Saturdays" in blob or "Sábados" in blob:
        return "saturday"
    if "Sundays" in blob or "Domingos" in blob:
        return "sunday_holiday"
    return None


def extract_page(page, page_no):
    """Extrai de uma página: tipo de dia, ordem de estações, paragens Bx e viagens."""
    # --- 1. Colunas: centros x dos tokens HH:MM (texto normal) ---
    words = page.extract_words()
    time_words = [w for w in words if TIME_RE.match(w["text"])]
    col_centers = cluster_1d([(w["x0"] + w["x1"]) / 2 for w in time_words], tol=6)
    if len(col_centers) != N_STATIONS_EXPECTED:
        err(f"pág. {page_no}: esperava {N_STATIONS_EXPECTED} colunas, encontrei {len(col_centers)}")
        return None
    col_tol = (col_centers[1] - col_centers[0]) / 2  # ~8.4 pt

    # --- 2. Cabeçalhos: caracteres rodados agrupados por x ---
    rot_chars = [c for c in page.chars if not c.get("upright", True)]
    vlines = defaultdict(list)
    for c in rot_chars:
        xc = (c["x0"] + c["x1"]) / 2
        key = next((k for k in vlines if abs(k - xc) <= 2.5), None)
        vlines[key if key is not None else xc].append(c)

    headers = {}           # índice de coluna -> nome da estação
    bx_stops = set()       # índices de coluna com marcador Bx
    label_lines = []       # rótulos fora da tabela (tipo de dia, notas)
    for xc, chars in vlines.items():
        # leitura correta do texto vertical: de baixo para cima
        text = "".join(ch["text"] for ch in sorted(chars, key=lambda c: -c["top"])).strip()
        ci = nearest(col_centers, xc, tol=4)
        if ci is None:
            label_lines.append(text)
            continue
        if text.endswith("BX"):
            bx_stops.add(ci)
            text = text[:-2].strip()
        # separador "|" extraído como "I" isolado
        text = re.sub(r"\s+I\s+", " | ", text)
        headers[ci] = text

    if len(headers) != N_STATIONS_EXPECTED:
        err(f"pág. {page_no}: {len(headers)} cabeçalhos de estação (esperava {N_STATIONS_EXPECTED})")
        return None

    station_order = [headers[i] for i in range(N_STATIONS_EXPECTED)]
    day_type = classify_page(label_lines)
    if day_type is None:
        err(f"pág. {page_no}: não consegui identificar o tipo de dia; rótulos: {label_lines}")
        return None

    # --- 3. Viagens: tokens de hora e '-' agrupados por linha (y) ---
    cell_words = [w for w in words if TIME_RE.match(w["text"]) or w["text"] == "-"]
    rows = defaultdict(list)
    for w in cell_words:
        yc = (w["top"] + w["bottom"]) / 2
        key = next((k for k in rows if abs(k - yc) <= 2.0), None)
        rows[key if key is not None else yc].append(w)

    trips = []
    for yc in sorted(rows):
        cells = [None] * N_STATIONS_EXPECTED
        n_assigned = 0
        for w in rows[yc]:
            ci = nearest(col_centers, (w["x0"] + w["x1"]) / 2, tol=col_tol)
            if ci is None:
                continue  # token fora da grelha (ex.: notas)
            if cells[ci] is not None:
                err(f"pág. {page_no} y={yc:.0f}: célula duplicada na coluna {ci}")
            cells[ci] = w["text"]
            n_assigned += 1
        if n_assigned == 0:
            continue
        if n_assigned != N_STATIONS_EXPECTED:
            err(f"pág. {page_no} y={yc:.0f}: linha com {n_assigned}/{N_STATIONS_EXPECTED} células")
            continue
        times = [None if c == "-" else c for c in cells]
        trips.append(times)

    return {
        "dayType": day_type,
        "stationOrder": station_order,
        "bxStopIdx": bx_stops,
        "trips": trips,
        "page": page_no,
    }


def validate_trip(times, label):
    """Monotonia e plausibilidade dos intervalos dentro de uma viagem."""
    mins = service_minutes(times)
    served = [(i, m) for i, m in enumerate(mins) if m is not None]
    if len(served) < 2:
        err(f"{label}: viagem com menos de 2 paragens")
        return False
    ok = True
    for (i1, m1), (i2, m2) in zip(served, served[1:]):
        gap = m2 - m1
        if gap < MIN_GAP_MIN or gap > MAX_GAP_MIN:
            err(f"{label}: intervalo implausível {times[i1]}->{times[i2]} "
                f"({gap} min, colunas {i1}->{i2})")
            ok = False
    return ok


# ---------------------------------------------------------------- feriados

def easter(year):
    """Domingo de Páscoa (algoritmo gregoriano anónimo)."""
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
    """Feriados nacionais obrigatórios em Portugal."""
    e = easter(year)
    fixed = [(1, 1), (4, 25), (5, 1), (6, 10), (8, 15),
             (10, 5), (11, 1), (12, 1), (12, 8), (12, 25)]
    days = [datetime.date(year, m, d) for m, d in fixed]
    days += [e - datetime.timedelta(days=2), e, e + datetime.timedelta(days=60)]
    return sorted(d.isoformat() for d in days)


# ---------------------------------------------------------------- principal

def main():
    if len(sys.argv) > 1:
        pdf_path = Path(sys.argv[1])
    else:
        candidates = sorted((ROOT / "pdfs").glob("*.pdf"),
                            key=lambda p: p.stat().st_mtime, reverse=True)
        if not candidates:
            print("Nenhum PDF em pdfs\\ e nenhum caminho indicado.")
            sys.exit(1)
        pdf_path = candidates[0]

    log(f"PDF: {pdf_path}")
    sha = hashlib.sha256(pdf_path.read_bytes()).hexdigest()
    log(f"SHA-256: {sha}")

    # validade a partir do nome do ficheiro (ex.: horarios_06_04_2026...)
    m = re.search(r"(\d{2})_(\d{2})_(\d{4})", pdf_path.name)
    valid_from = f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else None
    log(f"Validade (do nome do ficheiro): {valid_from}")

    pages = []
    with pdfplumber.open(pdf_path) as pdf:
        log(f"Páginas: {len(pdf.pages)}")
        for i, page in enumerate(pdf.pages, start=1):
            data = extract_page(page, i)
            if data:
                pages.append(data)

    if len(pages) != 6:
        err(f"esperava 6 páginas extraídas, obtive {len(pages)}")

    # --- direção por página + coerência das listas de estações ---
    outbound_order = inbound_order = None
    for p in pages:
        first = p["stationOrder"][0]
        if "Estádio do Dragão" in first:
            p["direction"] = "outbound"
            if outbound_order is None:
                outbound_order = p["stationOrder"]
            elif p["stationOrder"] != outbound_order:
                err(f"pág. {p['page']}: ordem de estações outbound difere da pág. anterior")
        elif "Póvoa de Varzim" in first:
            p["direction"] = "inbound"
            if inbound_order is None:
                inbound_order = p["stationOrder"]
            elif p["stationOrder"] != inbound_order:
                err(f"pág. {p['page']}: ordem de estações inbound difere da pág. anterior")
        else:
            err(f"pág. {p['page']}: primeira estação inesperada: {first}")

    if outbound_order and inbound_order:
        if list(reversed(outbound_order)) != inbound_order:
            err("lista inbound não é o espelho da lista outbound")
        else:
            log("OK: lista de estações inbound = espelho da outbound")

    combos = {(p["dayType"], p["direction"]) for p in pages}
    expected = {(d, s) for d in ("weekday", "saturday", "sunday_holiday")
                for s in ("outbound", "inbound")}
    if combos != expected:
        err(f"combinações dia/sentido em falta: {expected - combos}")

    # --- estações e ids ---
    station_ids = [slugify(n) for n in outbound_order]
    if len(set(station_ids)) != len(station_ids):
        err(f"ids de estação duplicados: {station_ids}")
    stations = [{"id": sid, "name": name}
                for sid, name in zip(station_ids, outbound_order)]
    id_by_name = {name: sid for sid, name in zip(station_ids, outbound_order)}

    # --- viagens: validar, classificar, ordenar ---
    all_trips = []
    for p in pages:
        day, direction = p["dayType"], p["direction"]
        valid_trips = []
        for times in p["trips"]:
            label = f"pág. {p['page']} ({day}/{direction}) partida {next(t for t in times if t)}"
            if validate_trip(times, label):
                valid_trips.append(times)
        valid_trips.sort(key=lambda t: service_minutes(t)[
            next(i for i, v in enumerate(t) if v is not None)])
        # validar paragens Bx: nulls só em colunas sem marcador Bx
        for times in valid_trips:
            if any(t is None for t in times):
                bad = [i for i, t in enumerate(times) if t is None and i in p["bxStopIdx"]]
                if bad:
                    err(f"{day}/{direction}: expresso salta estação marcada como paragem Bx: "
                        f"{[p['stationOrder'][i] for i in bad]}")
        for n, times in enumerate(valid_trips):
            all_trips.append({
                "id": f"{day}-{direction}-{n:03d}",
                "dayType": day,
                "direction": direction,
                "service": "Bx" if any(t is None for t in times) else "B",
                "times": times,
            })
        n_bx = sum(1 for t in valid_trips if any(x is None for x in t))
        log(f"pág. {p['page']}: {day}/{direction}: {len(valid_trips)} viagens "
            f"({n_bx} Bx), primeira {valid_trips[0][0] or '-'} / última "
            f"{[t for t in valid_trips[-1] if t][0]}")

    # partidas ordenadas e sem duplicados por quadro
    for day, direction in expected:
        deps = []
        for t in all_trips:
            if t["dayType"] == day and t["direction"] == direction:
                idx = next(i for i, v in enumerate(t["times"]) if v is not None)
                deps.append(service_minutes(t["times"])[idx])
        if deps != sorted(deps):
            err(f"{day}/{direction}: partidas não ordenadas após ordenação (?)")
        if len(deps) != len(set(deps)):
            err(f"{day}/{direction}: viagens duplicadas com a mesma hora de partida")

    # --- overrides manuais ---
    overrides_applied = []
    if OVERRIDES_PATH.exists():
        ov = json.loads(OVERRIDES_PATH.read_text(encoding="utf-8"))
        for tid in ov.get("removeTrips", []):
            before = len(all_trips)
            all_trips = [t for t in all_trips if t["id"] != tid]
            overrides_applied.append(f"removida {tid} ({before - len(all_trips)} ocorrências)")
        for tid, patch in ov.get("editTrips", {}).items():
            for t in all_trips:
                if t["id"] == tid:
                    t.update(patch)
                    overrides_applied.append(f"editada {tid}")
        for trip in ov.get("addTrips", []):
            trip.setdefault("id", f"manual-{len(all_trips):03d}")
            all_trips.append(trip)
            overrides_applied.append(f"adicionada {trip['id']}")
        for line in overrides_applied:
            log(f"override: {line}")

    # --- feriados ---
    this_year = datetime.date.today().year
    holidays = {str(y): portuguese_holidays(y) for y in range(this_year, this_year + 6)}

    schedule = {
        "schemaVersion": 1,
        "line": {"id": "B", "name": "Linha B", "color": "#E31E24"},
        "source": {
            "file": pdf_path.name,
            "sha256": sha,
            "extractedAt": datetime.datetime.now(datetime.timezone.utc)
                .strftime("%Y-%m-%dT%H:%M:%SZ"),
            "publisher": "Metro do Porto",
            "overridesApplied": overrides_applied,
        },
        "validity": {"from": valid_from, "to": None},
        "notes": ["Tolerância de +/- 2 minutos para os tempos apresentados.",
                  "Bx: serviço expresso — não para em todas as estações."],
        "stations": stations,
        "directions": {
            "outbound": {
                "label": f"{outbound_order[0]} → {outbound_order[-1]}",
                "stationOrder": [id_by_name[n] for n in outbound_order],
            },
            "inbound": {
                "label": f"{inbound_order[0]} → {inbound_order[-1]}",
                "stationOrder": [id_by_name[n] for n in inbound_order],
            },
        },
        "dayTypes": {
            "weekday": "Dias úteis",
            "saturday": "Sábados",
            "sunday_holiday": "Domingos e feriados",
        },
        "trips": all_trips,
    }

    APP_DATA.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)

    (APP_DATA / "schedule.json").write_text(
        json.dumps(schedule, ensure_ascii=False, indent=1), encoding="utf-8")
    (APP_DATA / "holidays.json").write_text(
        json.dumps(holidays, ensure_ascii=False, indent=1), encoding="utf-8")
    (APP_DATA / "schedule.js").write_text(
        "// Gerado por tools/extract.py — NÃO editar à mão. "
        "Correções: data/overrides.json + reexecutar o extrator.\n"
        f"window.METRO_DATA = {json.dumps(schedule, ensure_ascii=False)};\n"
        f"window.METRO_HOLIDAYS = {json.dumps(holidays)};\n",
        encoding="utf-8")

    log(f"\nTotal de viagens: {len(all_trips)}")
    log(f"Estações ({len(stations)}): {', '.join(s['name'] for s in stations)}")
    status = "FALHOU" if errors else "OK"
    log(f"\nVALIDAÇÃO: {status} ({len(errors)} erro(s))")
    REPORT_PATH.write_text("\n".join(report_lines) + "\n", encoding="utf-8")
    print(f"\nRelatório: {REPORT_PATH}")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
