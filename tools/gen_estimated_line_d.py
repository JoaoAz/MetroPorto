# -*- coding: utf-8 -*-
"""
Gera horarios estimados para a Linha D a partir de capturas de ecrã de
frequências/primeira/última partida.

Importante: isto NAO e uma extracao de tabela oficial partida-a-partida.
O ficheiro gerado fica marcado como estimated=true e a app apresenta aviso.
"""
import datetime
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NETWORK = ROOT / "data" / "network.json"
OUT = ROOT / "data" / "schedules" / "line-d.estimated.json"

LINE_ID = "d"

# Frequencias da imagem "Frequencias / Scheduled".
# Para cada tipo de dia: (inicio inclusivo, fim exclusivo, intervalo minutos).
FREQUENCIES = {
    "weekday": [
        ("06:00", "07:00", 15),
        ("07:00", "08:00", 12),
        ("08:00", "10:00", 10),
        ("10:00", "17:00", 12),
        ("17:00", "19:00", 10),
        ("19:00", "20:00", 12),
        ("20:00", "22:00", 15),
        ("22:00", "25:00", 20),
    ],
    "saturday": [
        ("06:00", "07:00", 20),
        ("07:00", "22:00", 15),
        ("22:00", "25:00", 20),
    ],
    "sunday_holiday": [
        ("06:00", "07:00", 20),
        ("07:00", "22:00", 15),
        ("22:00", "25:00", 20),
    ],
}

TERMINAL_START = {
    "fwd": "06:00",  # Hospital Sao Joao -> Vila d'Este
    "rev": "06:00",  # Vila d'Este -> Hospital Sao Joao
}

TERMINAL_LAST = {
    "fwd": "25:03",  # imagem: ultima partida Hospital Sao Joao 01:03
    "rev": "24:56",  # imagem: ultima partida Vila d'Este 00:56
}

# Offsets por estacao no sentido Hospital Sao Joao -> Vila d'Este.
# Santo Ovidio -> Hospital Sao Joao foi inferido da captura 09:29 -> 09:55.
# Extensao Santo Ovidio -> Vila d'Este e estimada ate haver tabela oficial.
OFFSETS_FWD = [
    0,   # Hospital de Sao Joao
    2,   # IPO
    5,   # Polo Universitario
    7,   # Salgueiros
    8,   # Combatentes
    10,  # Marques
    12,  # Faria Guimaraes
    13,  # Trindade
    14,  # Aliados
    15,  # Sao Bento
    18,  # Jardim do Morro
    19,  # General Torres
    21,  # Camara Gaia
    22,  # Joao de Deus
    25,  # D. Joao II
    26,  # Santo Ovidio
    29,  # Manuel Leao (estimado)
    31,  # Hospital Santos Silva (estimado)
    33,  # Vila d'Este (estimado)
]


def to_min(hm):
    h, m = hm.split(":")
    return int(h) * 60 + int(m)


def fmt(minutes):
    minutes %= 1440
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def departures(day_type, direction):
    first = to_min(TERMINAL_START[direction])
    last = to_min(TERMINAL_LAST[direction])
    out = []
    for start_hm, end_hm, step in FREQUENCIES[day_type]:
        start = max(first, to_min(start_hm))
        end = min(last + 1, to_min(end_hm))
        t = start
        while t < end:
            if t <= last and (not out or out[-1] != t):
                out.append(t)
            t += step
    if last not in out:
        out.append(last)
    return sorted(out)


def build_trip_times(dep, direction):
    if direction == "fwd":
        return [fmt(dep + offset) for offset in OFFSETS_FWD]
    total = OFFSETS_FWD[-1]
    return [fmt(dep + (total - offset)) for offset in reversed(OFFSETS_FWD)]


def main():
    network = json.loads(NETWORK.read_text(encoding="utf-8"))
    line = next(line for line in network["lines"] if line["id"] == LINE_ID)
    if len(line["stations"]) != len(OFFSETS_FWD):
        raise SystemExit(
            f"Linha D tem {len(line['stations'])} estações, esperadas {len(OFFSETS_FWD)}"
        )

    trips = []
    for day_type in ("weekday", "saturday", "sunday_holiday"):
        for direction in ("fwd", "rev"):
            for idx, dep in enumerate(departures(day_type, direction)):
                trips.append({
                    "id": f"d-{day_type}-{direction}-{idx:03d}",
                    "dayType": day_type,
                    "dir": direction,
                    "service": "D",
                    "times": build_trip_times(dep, direction),
                })

    payload = {
        "line": "d",
        "demo": False,
        "estimated": True,
        "source": {
            "file": None,
            "publisher": "Estimativa criada a partir de capturas de ecrã de frequências da Linha D",
            "extractedAt": datetime.datetime.now(datetime.timezone.utc)
                .strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
        "validity": {"from": None, "to": None},
        "notes": [
            "Horário estimado por frequência, não oficial.",
            "Frequências e primeira/última partida derivadas das capturas fornecidas.",
            "Offsets Santo Ovídio -> Hospital São João inferidos da captura 09:29-09:55.",
            "Troço Santo Ovídio -> Vila d'Este estimado até haver tabela oficial.",
        ],
        "trips": trips,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n",
                   encoding="utf-8")
    print(f"Linha D estimada: {len(trips)} viagens -> {OUT}")


if __name__ == "__main__":
    main()
