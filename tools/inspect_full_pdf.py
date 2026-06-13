# -*- coding: utf-8 -*-
"""Inspeção do PDF completo da rede: páginas, linhas, tipos de dia, zonas."""
import re
import sys
import pdfplumber

PDF = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\JoãoAzevedo\Downloads\horarios_06_04_2026.pdf"

with pdfplumber.open(PDF) as pdf:
    print(f"PAGINAS: {len(pdf.pages)}")
    for i, page in enumerate(pdf.pages, 1):
        text = page.extract_text() or ""
        rot = [c for c in page.chars if not c.get("upright", True)]
        # rótulos rodados legíveis (de baixo para cima)
        from collections import defaultdict
        vlines = defaultdict(list)
        for c in rot:
            xc = round((c["x0"] + c["x1"]) / 2)
            key = next((k for k in vlines if abs(k - xc) <= 3), None)
            vlines[key if key is not None else xc].append(c)
        labels = []
        for xc in sorted(vlines):
            chs = sorted(vlines[xc], key=lambda c: -c["top"])
            labels.append("".join(ch["text"] for ch in chs).strip())
        first_labels = [l for l in labels if l][:6]
        n_times = len(re.findall(r"\b[0-2]\d:[0-5]\d\b", text))
        # procurar códigos de zona (PRT1, MAI2, VCD9...)
        zones = sorted(set(re.findall(r"\b[A-Z]{2,3}\d{1,2}\b", text)))
        flat_head = text[:120].replace("\n", " | ")
        print(f"\n--- pag {i} ({page.width:.0f}x{page.height:.0f}) "
              f"horas={n_times} zonas={zones[:12]}")
        print(f"  texto: {flat_head}")
        print(f"  rodado: {first_labels}")
