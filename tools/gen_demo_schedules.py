# -*- coding: utf-8 -*-
"""
gen_demo_schedules.py — Gera horários FICTÍCIOS (demonstração) para as linhas
que ainda não têm PDF oficial extraído. Os ficheiros ficam marcados com
"demo": true e a app apresenta-os com o aviso "horário de demonstração".

Quando houver PDF oficial de uma linha, extrai-se com tools/extract.py
(adaptado à linha) e substitui-se o ficheiro data/schedules/line-<id>.json —
o build_data.py prefere sempre o ficheiro real ao demo.

Uso: python gen_demo_schedules.py
"""
import datetime
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NETWORK = json.loads((ROOT / "data" / "network.json").read_text(encoding="utf-8"))
OUT = ROOT / "data" / "schedules"

# Parâmetros plausíveis mas FICTÍCIOS, por linha:
# (headway dias úteis, sábado, domingo; minutos entre estações; início; fim)
PARAMS = {
    "a": (8, 10, 12, 2),
    "c": (10, 12, 15, 2),
    "d": (8, 10, 12, 2),
    "e": (12, 15, 20, 2),
    "f": (10, 12, 15, 2),
}
SERVICE_START = 6 * 60          # 06:00
SERVICE_END = 24 * 60 + 30      # 00:30 (madrugada do dia de serviço)


def fmt(minutes):
    m = minutes % 1440
    return f"{m // 60:02d}:{m % 60:02d}"


def gen_line(line):
    headways = PARAMS[line["id"]]
    n = len(line["stations"])
    dwell = headways[3]
    trips = []
    for day_type, headway in zip(
            ("weekday", "saturday", "sunday_holiday"), headways[:3]):
        for direction in ("fwd", "rev"):
            dep = SERVICE_START
            idx = 0
            while dep <= SERVICE_END:
                times = [fmt(dep + i * dwell) for i in range(n)]
                trips.append({
                    "id": f"{day_type}-{direction}-{idx:03d}",
                    "dayType": day_type,
                    "dir": direction,
                    "service": line["name"].split()[-1],
                    "times": times,
                })
                dep += headway
                idx += 1
    return {
        "line": line["id"],
        "demo": True,
        "source": {
            "file": None,
            "publisher": "DADOS FICTÍCIOS — gerados por tools/gen_demo_schedules.py",
            "extractedAt": datetime.datetime.now(datetime.timezone.utc)
                .strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
        "validity": {"from": None, "to": None},
        "notes": ["Horário de demonstração — NÃO corresponde ao serviço real."],
        "trips": trips,
    }


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for line in NETWORK["lines"]:
        if line["id"] not in PARAMS:
            continue
        real = OUT / f"line-{line['id']}.json"
        if real.exists():
            print(f"linha {line['id'].upper()}: ficheiro real existe, demo não gerado")
            continue
        out = OUT / f"line-{line['id']}.demo.json"
        out.write_text(json.dumps(gen_line(line), ensure_ascii=False, indent=1),
                       encoding="utf-8")
        print(f"linha {line['id'].upper()}: {out.name} gerado")


if __name__ == "__main__":
    main()
