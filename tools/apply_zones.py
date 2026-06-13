# -*- coding: utf-8 -*-
"""
apply_zones.py — Preenche a camada de zonas Andante em data/network.json.

As zonas são ESTIMATIVAS ao nível do corredor do metro, derivadas do mapa
oficial Andante e calibradas pelos exemplos das FAQ do operador:
  - Trindade -> Senhora da Hora = Z2  (zonas adjacentes)
  - Trindade -> Pedras Rubras  = Z4  (3 anéis)
  - Trindade -> Mindelo        = Z5  (informação validada pelo utilizador)
O campo zonesEstimated mantém-se true até validação manual com o mapa
oficial ao nível da estação; a app apresenta os preços como estimativa.

Correr uma vez (idempotente): python apply_zones.py
"""
import json
from pathlib import Path

NETWORK = Path(__file__).resolve().parent.parent / "data" / "network.json"

# zona -> zonas adjacentes (o build normaliza para simétrico)
ADJACENCY = {
    "PRT":   ["MTS1", "MTS2", "VNG1", "GDM1"],
    "MTS1":  ["PRT", "MTS2", "MAI1", "MAI3"],
    "MTS2":  ["PRT", "MTS1", "MAI1"],
    "MAI1":  ["MTS1", "MTS2", "MAI2", "MAI3"],
    "MAI2":  ["MAI1", "MAI4", "VCD4"],
    "MAI3":  ["MTS1", "MAI1", "MAI4"],
    "MAI4":  ["MAI2", "MAI3"],
    "VCD4":  ["MAI2", "VCD9"],
    "VCD9":  ["VCD4", "PV_VC"],
    "PV_VC": ["VCD9"],
    "VNG1":  ["PRT", "VNG2"],
    "VNG2":  ["VNG1"],
    "GDM1":  ["PRT", "GDM2"],
    "GDM2":  ["GDM1"],
}

# zona -> estações (corredores; uma estação pode ter várias zonas se fronteira)
ASSIGN = {
    "PRT": ["estadio-do-dragao", "campanha", "heroismo", "campo-24-de-agosto",
            "bolhao", "trindade", "lapa", "carolina-michaelis", "casa-da-musica",
            "francos", "ramalde", "viso",
            "hospital-sao-joao", "ipo", "polo-universitario", "salgueiros",
            "combatentes", "marques", "faria-guimaraes", "aliados", "sao-bento",
            "contumil", "nasoni", "nau-vitoria"],
    "MTS1": ["sete-bicas", "senhora-da-hora", "fonte-do-cuco", "custoias"],
    "MTS2": ["vasco-da-gama", "estadio-do-mar", "pedro-hispano", "parque-real",
             "camara-de-matosinhos", "matosinhos-sul", "brito-capelo",
             "mercado", "senhor-de-matosinhos"],
    "MAI1": ["esposade", "crestins"],
    "MAI2": ["verdes", "botica", "aeroporto", "pedras-rubras", "lidador"],
    "MAI3": ["candido-dos-reis", "pias", "araujo", "custio"],
    "MAI4": ["parque-maia", "forum-maia", "zona-industrial", "mandim",
             "castelo-da-maia", "ismai"],
    "VCD4": ["vilar-do-pinheiro", "modivas-sul", "modivas-centro", "modivas",
             "mindelo"],
    "VCD9": ["espaco-natureza", "varziela", "arvore", "azurara"],
    "PV_VC": ["santa-clara", "vila-do-conde", "alto-de-pega", "portas-fronhas",
              "sao-bras", "povoa-de-varzim"],
    "VNG1": ["jardim-do-morro", "general-torres", "camara-de-gaia",
             "joao-de-deus", "d-joao-ii", "santo-ovidio"],
    "VNG2": ["manuel-leao", "hospital-santos-silva", "vila-deste"],
    "GDM1": ["levada", "rio-tinto", "campainha", "baguim"],
    "GDM2": ["carreira", "venda-nova", "fanzeres"],
}


def main():
    net = json.loads(NETWORK.read_text(encoding="utf-8"))
    by_station = {}
    for zone, sids in ASSIGN.items():
        for sid in sids:
            by_station.setdefault(sid, []).append(zone)
    missing = []
    for s in net["stations"]:
        zones = by_station.get(s["id"])
        if zones:
            s["zones"] = zones
        else:
            missing.append(s["id"])
    net["zones"] = {z: {"adjacent": adj} for z, adj in ADJACENCY.items()}
    net["zonesEstimated"] = True
    net["zonesNote"] = ("ESTIMATIVA ao nível do corredor (calibrada pelos exemplos "
                        "oficiais: Trindade-Senhora da Hora=Z2, Trindade-Pedras "
                        "Rubras=Z4; e pelo caso validado pelo utilizador: "
                        "Trindade-Mindelo=Z5). Validar/refinar com o mapa Andante; estações "
                        "de fronteira podem ter várias zonas no array.")
    NETWORK.write_text(json.dumps(net, ensure_ascii=False, indent=2) + "\n",
                       encoding="utf-8")
    print(f"zonas atribuídas a {len(by_station)} estações; sem zona: {missing}")


if __name__ == "__main__":
    main()
