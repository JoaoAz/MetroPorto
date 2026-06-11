# -*- coding: utf-8 -*-
"""Inspeção inicial do PDF de horários do Metro do Porto."""
import sys
import pdfplumber

PDF = r"C:\Users\JoãoAzevedo\Downloads\horarios_06_04_2026_organized.pdf"

with pdfplumber.open(PDF) as pdf:
    print(f"PAGINAS: {len(pdf.pages)}")
    print(f"METADATA: {pdf.metadata}")
    for i, page in enumerate(pdf.pages):
        print(f"\n===== PAGINA {i+1} ({page.width:.0f}x{page.height:.0f}) =====")
        text = page.extract_text() or "(sem texto)"
        print(text[:3000])
        tables = page.extract_tables()
        print(f"\n--- {len(tables)} tabela(s) detetada(s) ---")
        for j, t in enumerate(tables):
            print(f"Tabela {j+1}: {len(t)} linhas x {len(t[0]) if t else 0} colunas")
            for row in t[:5]:
                print(row)
            if len(t) > 5:
                print("...")
