# -*- coding: utf-8 -*-
r"""
extract.py — Extrai horários do(s) PDF(s) oficiais do Metro do Porto.

Suporta o livro completo da rede (múltiplas linhas, páginas em retrato e
paisagem) e PDFs de uma só linha. Cada página é classificada por linha,
tipo de dia e sentido fazendo corresponder os cabeçalhos rodados (nomes de
estações reconstruídos por coordenadas) às linhas de data\network.json.

Uso:
    python extract.py [caminho\para\horarios.pdf]
Sem argumento, usa o PDF mais recente em ..\pdfs\.

Saídas:
    data\schedules\line-<id>.json — uma por linha encontrada (formato unificado)
    data\extraction-report.txt    — relatório de validação

Correções manuais (opcional): data\overrides.json
    { "removeTrips": ["b-weekday-fwd-003"],
      "editTrips":   { "b-weekday-fwd-005": { "times": [...] } } }

Depois de extrair, correr tools\build_data.py.
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
SCHEDULES_DIR = ROOT / "data" / "schedules"
REPORT_PATH = ROOT / "data" / "extraction-report.txt"
OVERRIDES_PATH = ROOT / "data" / "overrides.json"
NETWORK = json.loads((ROOT / "data" / "network.json").read_text(encoding="utf-8"))

TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
MAX_GAP_MIN = 20
MIN_GAP_MIN = 1

report_lines, errors = [], []


def log(msg):
    report_lines.append(msg)
    print(msg)


def err(msg):
    errors.append(msg)
    log(f"ERRO: {msg}")


def norm(s):
    s = unicodedata.normalize("NFKD", s.lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


NAME_TO_ID = {}
for _s in NETWORK["stations"]:
    for _label in [_s["name"]] + _s.get("aliases", []):
        NAME_TO_ID[norm(_label)] = _s["id"]

LINE_DEFS = {l["id"]: l for l in NETWORK["lines"]}


def to_minutes(hhmm):
    return int(hhmm[:2]) * 60 + int(hhmm[3:5])


def service_minutes(times):
    """Madrugada (antes das 04:00) pertence ao dia de serviço anterior.
    Mesma regra de build_data.py e app/engine.js."""
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


def cluster_1d(values, tol):
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


def classify_day(texts):
    blob = " ".join(texts)
    if "Dias Úteis" in blob or "Mondays" in blob:
        return "weekday"
    if "Sábados" in blob or "Saturdays" in blob:
        return "saturday"
    if "Domingos" in blob or "Sundays" in blob:
        return "sunday_holiday"
    return None


def extract_page(page, page_no):
    """Devolve {line, dayType, dir, trips} ou None (página sem tabela)."""
    words = page.extract_words()
    time_words = [w for w in words if TIME_RE.match(w["text"])]
    if len(time_words) < 50:
        return None  # capa ou página informativa

    col_centers = cluster_1d([(w["x0"] + w["x1"]) / 2 for w in time_words], tol=5)
    n_cols = len(col_centers)
    col_tol = min(b - a for a, b in zip(col_centers, col_centers[1:])) / 2

    # cabeçalhos rodados -> nomes de estações por coluna
    rot = [c for c in page.chars if not c.get("upright", True)]
    vlines = defaultdict(list)
    for c in rot:
        xc = (c["x0"] + c["x1"]) / 2
        key = next((k for k in vlines if abs(k - xc) <= 2.5), None)
        vlines[key if key is not None else xc].append(c)

    headers, labels = {}, []
    for xc, chars in vlines.items():
        text = "".join(ch["text"] for ch in sorted(chars, key=lambda c: -c["top"])).strip()
        ci = nearest(col_centers, xc, tol=4)
        if ci is None:
            labels.append(text)
            continue
        if text.endswith("BX"):
            text = text[:-2].strip()
        text = re.sub(r"\s+I\s+", " | ", text)
        headers[ci] = text

    if len(headers) != n_cols:
        err(f"pág. {page_no}: {len(headers)} cabeçalhos para {n_cols} colunas")
        return None

    station_ids = []
    for i in range(n_cols):
        sid = NAME_TO_ID.get(norm(headers[i]))
        if sid is None:
            err(f"pág. {page_no}: estação desconhecida no PDF: {headers[i]!r} "
                "(acrescentar alias em data/network.json)")
            return None
        station_ids.append(sid)

    # identificar linha e sentido pela sequência de estações
    line_id = direction = None
    for lid, ldef in LINE_DEFS.items():
        if station_ids == ldef["stations"]:
            line_id, direction = lid, "fwd"
            break
        if station_ids == list(reversed(ldef["stations"])):
            line_id, direction = lid, "rev"
            break
    if line_id is None:
        err(f"pág. {page_no}: sequência de {n_cols} estações não corresponde a "
            f"nenhuma linha da network.json (começa em {headers.get(0)!r})")
        return None

    day = classify_day([page.extract_text() or ""] + labels)
    if day is None:
        err(f"pág. {page_no}: tipo de dia não identificado")
        return None

    # linhas de horas
    cell_words = [w for w in words if TIME_RE.match(w["text"]) or w["text"] == "-"]
    rows = defaultdict(list)
    for w in cell_words:
        yc = (w["top"] + w["bottom"]) / 2
        key = next((k for k in rows if abs(k - yc) <= 2.0), None)
        rows[key if key is not None else yc].append(w)

    trips = []
    for yc in sorted(rows):
        cells = [None] * n_cols
        n_assigned = 0
        for w in rows[yc]:
            ci = nearest(col_centers, (w["x0"] + w["x1"]) / 2, tol=col_tol)
            if ci is None:
                continue
            if cells[ci] is not None:
                err(f"pág. {page_no} y={yc:.0f}: célula duplicada na coluna {ci}")
            cells[ci] = w["text"]
            n_assigned += 1
        if n_assigned == 0:
            continue
        if n_assigned < n_cols / 2:
            # artefacto (rodapé/nota com token tipo hora), não uma viagem
            log(f"aviso: pág. {page_no} y={yc:.0f}: {n_assigned} célula(s) "
                f"isolada(s) ignorada(s): {[w['text'] for w in rows[yc]]}")
            continue
        if n_assigned != n_cols:
            err(f"pág. {page_no} y={yc:.0f} ({line_id}/{day}): linha com "
                f"{n_assigned}/{n_cols} células")
            continue
        trips.append([None if c == "-" else c for c in cells])

    return {"line": line_id, "dayType": day, "dir": direction,
            "trips": trips, "page": page_no}


def service_label(line_id, times):
    """Vazios no meio do percurso = expresso (Bx); vazios só nas pontas =
    viagem parcial (curta), que mantém o serviço normal da linha."""
    served = [i for i, t in enumerate(times) if t is not None]
    if served and any(times[i] is None for i in range(served[0], served[-1] + 1)):
        return "Bx"
    return line_id.upper()


def validate_trip(times, label):
    mins = service_minutes(times)
    served = [(i, m) for i, m in enumerate(mins) if m is not None]
    if len(served) < 2:
        err(f"{label}: viagem com menos de 2 paragens")
        return False
    ok = True
    for (i1, m1), (i2, m2) in zip(served, served[1:]):
        gap = m2 - m1
        if gap < MIN_GAP_MIN or gap > MAX_GAP_MIN:
            err(f"{label}: intervalo implausível {times[i1]}->{times[i2]} ({gap} min)")
            ok = False
    return ok


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
    m = re.search(r"(\d{2})_(\d{2})_(\d{4})", pdf_path.name)
    valid_from = f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else None
    log(f"Validade (do nome do ficheiro): {valid_from}")

    by_line = defaultdict(list)
    with pdfplumber.open(pdf_path) as pdf:
        log(f"Páginas: {len(pdf.pages)}")
        for i, page in enumerate(pdf.pages, 1):
            data = extract_page(page, i)
            if data:
                by_line[data["line"]].append(data)

    overrides = {}
    if OVERRIDES_PATH.exists():
        overrides = json.loads(OVERRIDES_PATH.read_text(encoding="utf-8"))

    SCHEDULES_DIR.mkdir(parents=True, exist_ok=True)
    expected_combos = {(d, s) for d in ("weekday", "saturday", "sunday_holiday")
                       for s in ("fwd", "rev")}

    for line_id, pages in sorted(by_line.items()):
        combos = {(p["dayType"], p["dir"]) for p in pages}
        if combos != expected_combos:
            err(f"linha {line_id.upper()}: combinações em falta: "
                f"{expected_combos - combos}")
        all_trips = []
        for p in pages:
            valid = [t for t in p["trips"] if validate_trip(
                t, f"pág. {p['page']} ({line_id}/{p['dayType']}/{p['dir']})")]
            valid.sort(key=lambda t: service_minutes(t)[
                next(i for i, v in enumerate(t) if v is not None)])
            for n, times in enumerate(valid):
                all_trips.append({
                    "id": f"{line_id}-{p['dayType']}-{p['dir']}-{n:03d}",
                    "dayType": p["dayType"],
                    "dir": p["dir"],
                    "service": service_label(line_id, times),
                    "times": times,
                })
            n_bx = sum(1 for t in valid if any(x is None for x in t))
            log(f"pág. {p['page']}: {line_id.upper()}/{p['dayType']}/{p['dir']}: "
                f"{len(valid)} viagens" + (f" ({n_bx} Bx)" if n_bx else ""))

        applied = []
        for tid in overrides.get("removeTrips", []):
            before = len(all_trips)
            all_trips = [t for t in all_trips if t["id"] != tid]
            if len(all_trips) < before:
                applied.append(f"removida {tid}")
        for tid, patch in overrides.get("editTrips", {}).items():
            for t in all_trips:
                if t["id"] == tid:
                    t.update(patch)
                    applied.append(f"editada {tid}")
        for a in applied:
            log(f"override: {a}")

        out = {
            "line": line_id,
            "demo": False,
            "source": {"file": pdf_path.name, "sha256": sha,
                       "extractedAt": datetime.datetime.now(datetime.timezone.utc)
                           .strftime("%Y-%m-%dT%H:%M:%SZ"),
                       "publisher": "Metro do Porto",
                       "overridesApplied": applied},
            "validity": {"from": valid_from, "to": None},
            "notes": ["Tolerância de +/- 2 minutos para os tempos apresentados."],
            "trips": all_trips,
        }
        (SCHEDULES_DIR / f"line-{line_id}.json").write_text(
            json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
        log(f"linha {line_id.upper()}: {len(all_trips)} viagens -> "
            f"line-{line_id}.json")

    status = "FALHOU" if errors else "OK"
    log(f"\nLinhas extraídas: {', '.join(sorted(by_line)) or 'nenhuma'}")
    log(f"VALIDAÇÃO: {status} ({len(errors)} erro(s))")
    REPORT_PATH.write_text("\n".join(report_lines) + "\n", encoding="utf-8")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
