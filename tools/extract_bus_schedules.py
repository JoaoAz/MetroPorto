#!/usr/bin/env python3
"""Extract structured UNIR bus schedules from local PDF timetables."""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pdfplumber

TIME_RE = re.compile(r"^(?:\d{1,2}:\d{2}|-+)$")
MINUTE_RE = re.compile(r"^\d+$")
FOOTER_PREFIXES = (
    "226 ",
    "GERAL@",
    "HORARIO ",
    "HORÁRIO ",
    "OS HORARIOS ",
    "OS HORÁRIOS ",
    "PODEM EXISTIR ",
)

DAY_HEADERS = (
    ("weekday", ("DIAS", "UTEIS")),
    ("saturday", ("SABADOS",)),
    ("sunday_holiday", ("DOMINGOS", "FERIADOS")),
)


@dataclass
class Word:
    text: str
    x0: float
    x1: float
    top: float
    bottom: float


@dataclass
class Line:
    words: list[Word]
    top: float
    bottom: float

    @property
    def text(self) -> str:
        return " ".join(w.text for w in self.words)


@dataclass
class TimeCell:
    value: str | None
    x: float


@dataclass
class StopRow:
    name: str
    top: float
    cells: list[TimeCell] = field(default_factory=list)


@dataclass
class FrequencyMarker:
    interval_min: int
    x: float
    top: float
    bottom: float


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract bus schedule data from pdfs/unir/municipios."
    )
    parser.add_argument(
        "--input-dir",
        default="pdfs/unir/municipios",
        help="Directory with municipality folders and index.json files.",
    )
    parser.add_argument(
        "--app-output",
        default="app/data/bus-lines.js",
        help="Generated JS data file for the app.",
    )
    parser.add_argument(
        "--json-output",
        default="data/bus-schedules.json",
        help="Generated JSON copy for inspection.",
    )
    return parser.parse_args()


def strip_accents(text: str) -> str:
    return "".join(
        ch for ch in unicodedata.normalize("NFD", text)
        if unicodedata.category(ch) != "Mn"
    )


def normalize_key(text: str) -> str:
    text = strip_accents(text).lower()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text or "paragem"


def normalize_for_match(text: str) -> str:
    text = strip_accents(text).upper()
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def clean_stop_name(text: str) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    return text


def clean_time_token(text: str) -> str | None:
    if text.startswith("-"):
        return None
    hour, minute = text.split(":", 1)
    return f"{int(hour):02d}:{minute}"


def to_minutes(value: str) -> int:
    hour, minute = value.split(":", 1)
    return int(hour) * 60 + int(minute)


def fmt_minutes(value: int) -> str:
    value %= 24 * 60
    return f"{value // 60:02d}:{value % 60:02d}"


def group_words(raw_words: list[dict[str, Any]], tolerance: float = 4.5) -> list[Line]:
    words = [
        Word(
            text=str(w["text"]),
            x0=float(w["x0"]),
            x1=float(w["x1"]),
            top=float(w["top"]),
            bottom=float(w["bottom"]),
        )
        for w in raw_words
    ]
    words.sort(key=lambda w: (w.top, w.x0))
    lines: list[Line] = []
    for word in words:
        if not lines or abs(word.top - lines[-1].top) > tolerance:
            lines.append(Line(words=[word], top=word.top, bottom=word.bottom))
        else:
            lines[-1].words.append(word)
            lines[-1].bottom = max(lines[-1].bottom, word.bottom)
            lines[-1].top = min(lines[-1].top, word.top)
    for line in lines:
        line.words.sort(key=lambda w: w.x0)
    return lines


def day_type_from_header(text: str) -> str | None:
    norm = normalize_for_match(text)
    if "PARAGENS" not in norm or "PRINCIPAIS" not in norm:
        return None
    for day_type, required in DAY_HEADERS:
        if all(part in norm for part in required):
            return day_type
    return None


def is_footer_or_note(text: str) -> bool:
    norm = normalize_for_match(text)
    if not norm:
        return True
    if any(norm.startswith(normalize_for_match(prefix)) for prefix in FOOTER_PREFIXES):
        return True
    if re.match(r"^[A-Z]\)", norm):
        return True
    return False


def is_possible_name_line(line: Line) -> bool:
    text = line.text.strip()
    if not text or is_footer_or_note(text):
        return False
    if day_type_from_header(text):
        return False
    if any(TIME_RE.match(w.text) for w in line.words):
        return False
    if not any(re.search(r"[A-Za-zÀ-ÿ]", w.text) for w in line.words):
        return False
    if min(w.x0 for w in line.words) > 360:
        return False
    norm = normalize_for_match(text)
    if norm in {"A", "B", "A B", "A, B", "20 / 20 MIN"}:
        return False
    return True


def append_name(base: str, extra: str) -> str:
    extra = clean_stop_name(extra)
    if not base:
        return extra
    if not extra:
        return base
    return clean_stop_name(base + " " + extra)


def find_frequency_markers(words: list[Word]) -> list[FrequencyMarker]:
    markers: list[FrequencyMarker] = []
    for word in words:
        if normalize_for_match(word.text) != "MIN":
            continue
        center = (word.x0 + word.x1) / 2
        nearby_numbers = [
            w for w in words
            if MINUTE_RE.match(w.text)
            and abs(((w.x0 + w.x1) / 2) - center) <= 36
            and word.top - 110 <= w.top <= word.top
        ]
        if not nearby_numbers:
            continue
        nearby_numbers.sort(key=lambda w: w.top)
        interval = int(nearby_numbers[-1].text)
        if 0 < interval <= 120:
            markers.append(
                FrequencyMarker(
                    interval_min=interval,
                    x=center,
                    top=min(w.top for w in nearby_numbers + [word]),
                    bottom=word.bottom,
                )
            )
    return markers


def fill_frequency_gaps(rows: list[StopRow], markers: list[FrequencyMarker]) -> None:
    if not rows or not markers:
        return
    for row in rows:
        filled: list[TimeCell] = []
        for index, cell in enumerate(row.cells):
            filled.append(cell)
            if index >= len(row.cells) - 1:
                continue
            current = cell.value
            nxt = row.cells[index + 1].value
            if current is None or nxt is None:
                continue
            marker = next(
                (
                    m for m in markers
                    if cell.x < m.x < row.cells[index + 1].x
                    and m.interval_min > 0
                ),
                None,
            )
            if not marker:
                continue
            start = to_minutes(current)
            end = to_minutes(nxt)
            if end <= start:
                end += 24 * 60
            if end - start <= marker.interval_min:
                continue
            next_minute = start + marker.interval_min
            while next_minute < end:
                filled.append(TimeCell(value=fmt_minutes(next_minute), x=marker.x))
                next_minute += marker.interval_min
        row.cells = filled


def rows_to_trips(rows: list[StopRow]) -> list[list[str | None]]:
    if not rows:
        return []
    max_cols = max(len(row.cells) for row in rows)
    trips: list[list[str | None]] = []
    for col in range(max_cols):
        trip = [row.cells[col].value if col < len(row.cells) else None for row in rows]
        if any(value is not None for value in trip):
            trips.append(trip)
    return trips


def extract_page(page: Any, page_index: int) -> dict[str, Any]:
    raw_words = page.extract_words(x_tolerance=2, y_tolerance=3, keep_blank_chars=False)
    words = [
        Word(
            text=str(w["text"]),
            x0=float(w["x0"]),
            x1=float(w["x1"]),
            top=float(w["top"]),
            bottom=float(w["bottom"]),
        )
        for w in raw_words
    ]
    lines = group_words(raw_words)
    page_markers = find_frequency_markers(words)

    day_rows: dict[str, list[StopRow]] = {
        "weekday": [],
        "saturday": [],
        "sunday_holiday": [],
    }
    day_markers: dict[str, list[FrequencyMarker]] = {
        "weekday": [],
        "saturday": [],
        "sunday_holiday": [],
    }
    current_day: str | None = None
    pending_name = ""
    last_row: StopRow | None = None

    def markers_for_section(start: float, end: float | None = None) -> list[FrequencyMarker]:
        return [
            marker for marker in page_markers
            if marker.top >= start and (end is None or marker.top < end)
        ]

    header_positions: list[tuple[float, str]] = []
    for line in lines:
        day_type = day_type_from_header(line.text)
        if day_type:
            header_positions.append((line.top, day_type))
    for i, (top, day_type) in enumerate(header_positions):
        end = header_positions[i + 1][0] if i + 1 < len(header_positions) else None
        day_markers[day_type].extend(markers_for_section(top, end))

    for line in lines:
        text = line.text.strip()
        day_type = day_type_from_header(text)
        if day_type:
            current_day = day_type
            pending_name = ""
            last_row = None
            continue
        if current_day is None or is_footer_or_note(text):
            continue

        time_words = [w for w in line.words if TIME_RE.match(w.text)]
        if time_words:
            first_time_x = min(w.x0 for w in time_words)
            name_words = [
                w for w in line.words
                if not TIME_RE.match(w.text) and w.x0 < first_time_x - 18
            ]
            name = clean_stop_name(" ".join(w.text for w in name_words))
            if pending_name:
                name = append_name(pending_name, name)
            if not name:
                continue
            row = StopRow(
                name=name,
                top=line.top,
                cells=[
                    TimeCell(value=clean_time_token(w.text), x=w.x0)
                    for w in sorted(time_words, key=lambda w: w.x0)
                ],
            )
            day_rows[current_day].append(row)
            pending_name = ""
            last_row = row
            continue

        if is_possible_name_line(line):
            name_text = clean_stop_name(text)
            if last_row and 0 <= line.top - last_row.top <= 34:
                last_row.name = append_name(last_row.name, name_text)
            else:
                pending_name = append_name(pending_name, name_text)

    result_days: dict[str, dict[str, Any]] = {}
    for day_type, rows in day_rows.items():
        fill_frequency_gaps(rows, day_markers[day_type])
        result_days[day_type] = {
            "stops": [row.name for row in rows],
            "trips": rows_to_trips(rows),
        }

    stop_names = []
    for rows in day_rows.values():
        if rows:
            stop_names = [row.name for row in rows]
            break

    return {
        "id": f"dir-{page_index + 1}",
        "stops": stop_names,
        "dayTypes": result_days,
        "frequencyMarkers": [
            {
                "dayType": day_type,
                "intervalMin": marker.interval_min,
                "x": round(marker.x, 1),
            }
            for day_type, markers in day_markers.items()
            for marker in markers
        ],
    }


def load_municipality_indexes(input_dir: Path) -> list[tuple[Path, dict[str, Any]]]:
    indexes: list[tuple[Path, dict[str, Any]]] = []
    for index_path in sorted(input_dir.glob("*/index.json")):
        data = json.loads(index_path.read_text(encoding="utf-8-sig"))
        indexes.append((index_path.parent, data))
    return indexes


def unique_stop_id(name: str, used: dict[str, int]) -> str:
    base = normalize_key(name)
    count = used.get(base, 0)
    used[base] = count + 1
    return base if count == 0 else f"{base}-{count + 1}"


def build_payload(input_dir: Path) -> dict[str, Any]:
    municipalities = []
    global_stop_ids: dict[str, str] = {}
    global_stop_names: dict[str, str] = {}
    used_stop_ids: dict[str, int] = {}

    for municipality_dir, index in load_municipality_indexes(input_dir):
        lines = []
        for item in sorted(index["files"], key=lambda row: str(row["codamp"])):
            code = str(item["codamp"])
            pdf_path = municipality_dir / item["pdfFile"]
            directions = []
            with pdfplumber.open(pdf_path) as pdf:
                for page_index, page in enumerate(pdf.pages):
                    direction = extract_page(page, page_index)
                    if not direction["stops"]:
                        continue
                    for stop in direction["stops"]:
                        key = normalize_for_match(stop)
                        if key not in global_stop_ids:
                            global_stop_ids[key] = unique_stop_id(stop, used_stop_ids)
                            global_stop_names[key] = stop
                    direction["stopIds"] = [
                        global_stop_ids[normalize_for_match(stop)]
                        for stop in direction["stops"]
                    ]
                    direction["headsign"] = (
                        f"{direction['stops'][0]} → {direction['stops'][-1]}"
                        if len(direction["stops"]) >= 2
                        else direction["stops"][0]
                    )
                    directions.append(direction)

            line_payload = {
                "code": code,
                "name": item["designa"],
                "municipality": index["municipality"],
                "sourcePdfUrl": item["sourcePdfUrl"],
                "directions": directions,
            }
            lines.append(line_payload)

        municipalities.append(
            {
                "id": municipality_dir.name,
                "name": index["municipality"],
                "lineCount": len(lines),
                "lines": lines,
            }
        )

    stops = sorted(
        (
            {"id": stop_id, "name": global_stop_names[key]}
            for key, stop_id in (
                (key, value) for key, value in global_stop_ids.items()
            )
        ),
        key=lambda item: normalize_for_match(item["name"]),
    )

    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "https://paragens.amp.pt/web/horarios_pdf/pages/schedules.html?ut=3",
        "note": "Dados extraidos das paragens principais publicadas nos PDFs oficiais UNIR.",
        "stops": stops,
        "municipalities": municipalities,
    }


def main() -> int:
    args = parse_args()
    input_dir = Path(args.input_dir)
    app_output = Path(args.app_output)
    json_output = Path(args.json_output)

    payload = build_payload(input_dir)
    json_output.parent.mkdir(parents=True, exist_ok=True)
    json_output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    app_output.parent.mkdir(parents=True, exist_ok=True)
    app_output.write_text(
        "window.BUS_SCHEDULES = "
        + json.dumps(payload, ensure_ascii=False, indent=2)
        + ";\n",
        encoding="utf-8",
    )

    line_count = sum(len(m["lines"]) for m in payload["municipalities"])
    direction_count = sum(
        len(line["directions"])
        for municipality in payload["municipalities"]
        for line in municipality["lines"]
    )
    trip_count = sum(
        len(day["trips"])
        for municipality in payload["municipalities"]
        for line in municipality["lines"]
        for direction in line["directions"]
        for day in direction["dayTypes"].values()
    )
    print(
        f"Extracted {line_count} lines, {direction_count} directions, "
        f"{len(payload['stops'])} stops and {trip_count} trips."
    )
    print(f"Wrote {app_output} and {json_output}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
