# Metro do Porto — Planeador de viagens

Web app estática (HTML/CSS/JS puro, sem build nem backend) para planear viagens
na rede do Metro do Porto: próximos horários, percursos diretos ou com
transbordo, duração, zonas Andante e preço estimado. Funciona offline (PWA) e
sem serviços externos. Publicada em <https://joaoaz.github.io/MetroPorto/>.

## Estado dos dados

| Dados | Estado | Onde |
|---|---|---|
| Horários Linha B | **Reais** (PDF oficial 06/04/2026) | `data/schedules/line-b.json` |
| Horários A, C, D, E, F | **Fictícios** (demonstração, marcados na app) | `data/schedules/line-*.demo.json` |
| Topologia das 6 linhas (85 estações) | Triangulada de fontes públicas | `data/network.json` |
| Tarifário Andante ocasional | Real (01/01/2026, metrodoporto.pt) | `data/fares.json` |
| Zonas Andante por estação | **Por preencher** — a app não calcula preço até validar | `data/network.json` |

## Estrutura

```
pdfs/                       PDFs oficiais (entrada)
data/network.json           EDITÁVEL: estações, aliases, zonas, linhas
data/fares.json             EDITÁVEL: tarifário Andante
data/schedules/             horários por linha (reais e .demo)
data/overrides.json         correções manuais à extração (opcional)
tools/extract.py            PDF -> data/schedules/line-b.json (pdfplumber)
tools/gen_demo_schedules.py horários fictícios para linhas sem PDF
tools/build_data.py         valida tudo e gera app/data/data.js
tools/test_engine.js        testes das utilidades de tempo (Node)
tools/test_router.js        testes do planeador, zonas e preço (Node)
app/engine.js               utilidades de tempo/dia de serviço (lógica pura)
app/router.js               pesquisa, percursos, transbordos, zonas, preço
app/app.js + index.html     interface (2 modos: Planear viagem / Por linha)
app/data/data.js            artefacto gerado — única dependência da app
```

## Como executar

```powershell
python -m http.server 8742 --directory app   # http://localhost:8742
```

## Pipeline de dados

```powershell
python -X utf8 tools\extract.py            # 1. extrai o PDF da linha B
python -X utf8 tools\gen_demo_schedules.py # 2. demos p/ linhas sem PDF (idempotente)
python -X utf8 tools\build_data.py         # 3. valida e gera app/data/data.js
node tools\test_engine.js                  # 4. testes
node tools\test_router.js
```

`build_data.py` falha (exit 1) com erros de coerência — não publicar nesse caso.
Relatórios: `data/extraction-report.txt` e `data/build-report.txt`.

### Atualizar horários (novo PDF da Linha B)

Colocar o PDF em `pdfs/` (com a data no nome: `horarios_DD_MM_AAAA*.pdf`) e
correr o pipeline acima. Correções pontuais: `data/overrides.json`.

### Adicionar horários reais de outra linha

1. Adaptar `tools/extract.py` ao PDF dessa linha (nº de colunas, nomes) e
   gravar como `data/schedules/line-<id>.json` no formato unificado
   (`trips[{dayType, dir: fwd|rev, service, times[]}]`, `demo: false`).
2. Os nomes das estações do PDF são mapeados pelos `aliases` de
   `data/network.json` — acrescentar aliases se o PDF usar nomes diferentes.
3. Correr `build_data.py` — o ficheiro real substitui automaticamente o demo.

### Preencher zonas (ativa o cálculo de preço)

No `data/network.json`, preencher `zones` de cada estação com os códigos do
diagrama oficial Andante (<https://andante.pt>): ex. `["C1"]`, ou
`["C1","C2"]` se a estação estiver na fronteira de duas zonas (a app escolhe a
que minimiza o preço). Enquanto um percurso atravessar estações sem zona, a
app diz «preço não calculado» em vez de inventar.

### Atualizar tarifário

Editar `data/fares.json` (preços, `validFrom`, `source`) e correr
`build_data.py`.

## Decisões de engenharia

- **Frontend estático + pipeline offline**: os dados mudam poucas vezes por
  ano; um backend seria custo permanente sem benefício.
- **Percursos por enumeração validada por horários** (não Dijkstra/RAPTOR):
  a rede tem 6 linhas em árvore com tronco comum — todos os pares atuais se
  resolvem com ≤1 transbordo. Enumeramos sequências de linhas (com fallback a
  2 transbordos), escolhemos as correspondências com menos paragens e
  validamos cada candidato contra os horários reais (próxima partida, tempo
  mínimo de transbordo de 4 min, madrugada). BFS sem horários daria resultados
  errados (ignora esperas); um motor time-expanded seria complexidade inútil.
- **Dia de serviço**: partidas 00:00–01:35 pertencem ao dia anterior; corte às
  04:00. Regra partilhada por `extract.py`, `build_data.py` e `engine.js` —
  alterar nos três sítios.
- **Zonas**: mínimo de zonas distintas ao longo do percurso, com programação
  dinâmica para estações multi-zona. Mecanismo testado com dados fictícios;
  dados reais por preencher (ver acima).

## Limitações conhecidas

- Horários planeados, não tempo real (tolerância oficial ±2 min).
- A, C, D, E, F: horários fictícios até haver PDFs oficiais (badge na app).
- Sequências de estações de A, C, D, E, F trianguladas de fontes públicas
  (`dataStatus: fontes-publicas` em `network.json`) — validar com PDFs oficiais.
- Zonas por estação não preenchidas → preço não calculado (mensagem clara).
- Feriados: apenas os 13 nacionais; feriados municipais (ex.: S. João) não
  são distinguidos — usar «Ver horário de» manualmente nesses dias.
- Linha Rosa (G) e extensões em construção não incluídas.
- Tempo de transbordo fixo (4 min) — não modela distâncias reais entre cais.
