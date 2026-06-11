# -*- coding: utf-8 -*-
"""Debug: reconstruir cabeçalhos rodados (estações) por coordenadas."""
import re
from collections import defaultdict
import pdfplumber

PDF = r"C:\Users\JoãoAzevedo\Downloads\horarios_06_04_2026_organized.pdf"
TIME_RE = re.compile(r'^([01]\d|2[0-3]|0\d):[0-5]\d$')


def cluster_1d(values, tol):
    """Agrupa valores 1D ordenados em clusters separados por > tol."""
    groups = []
    for v in sorted(values):
        if groups and v - groups[-1][-1] <= tol:
            groups[-1].append(v)
        else:
            groups.append([v])
    return [sum(g) / len(g) for g in groups]


with pdfplumber.open(PDF) as pdf:
    page = pdf.pages[0]

    # 1) centros das colunas a partir dos tokens de hora (texto normal)
    words = page.extract_words()
    time_xs = [(w['x0'] + w['x1']) / 2 for w in words if TIME_RE.match(w['text'])]
    col_centers = cluster_1d(time_xs, tol=6)
    print(f"colunas de horas detetadas: {len(col_centers)}")
    print([round(c, 1) for c in col_centers])

    # 2) linhas verticais de texto rodado
    rot = [c for c in page.chars if not c.get('upright', True)]
    print(f"\nchars rodados: {len(rot)}")
    lines = defaultdict(list)
    for c in rot:
        xc = (c['x0'] + c['x1']) / 2
        placed = False
        for key in list(lines):
            if abs(key - xc) <= 2.5:
                lines[key].append(c)
                placed = True
                break
        if not placed:
            lines[xc].append(c)

    print(f"linhas verticais: {len(lines)}")
    for xc in sorted(lines):
        chs = lines[xc]
        asc = ''.join(ch['text'] for ch in sorted(chs, key=lambda c: c['top']))
        desc = ''.join(ch['text'] for ch in sorted(chs, key=lambda c: -c['top']))
        size = round(chs[0].get('size', 0), 1)
        print(f"x={xc:7.1f} size={size:5} asc={asc[:45]!r} desc={desc[:45]!r}")
