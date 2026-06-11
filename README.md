# Metro do Porto · Linha B — Horários

Web app de consulta dos próximos metros da Linha B (Estádio do Dragão ⇄ Póvoa de
Varzim), com dados extraídos do PDF oficial do Metro do Porto. Funciona
localmente, offline (PWA) e sem qualquer serviço externo.

## Estrutura

```
pdfs/                  PDFs oficiais (entrada do pipeline)
tools/extract.py       extrai o PDF -> dados estruturados (Python + pdfplumber)
tools/test_engine.js   testes do motor de cálculo (Node)
app/                   web app estática (HTML/CSS/JS puro)
app/engine.js            motor de cálculo (lógica pura, sem DOM)
app/app.js               camada de interface
app/data/schedule.json   horários estruturados (gerado — não editar)
app/data/schedule.js     idem, como script (permite abrir via file://)
app/data/holidays.json   feriados nacionais PT (gerado)
data/extraction-report.txt  relatório de validação da última extração
data/overrides.json    correções manuais (opcional, ver abaixo)
```

## Como executar

```powershell
# servir a app (qualquer servidor estático serve)
python -m http.server 8742 --directory app
# abrir http://localhost:8742
```

Também funciona abrindo `app/index.html` diretamente (sem offline/PWA).
Depois da primeira visita por http(s), a app funciona offline.

## Publicar online (GitHub Pages)

O repositório inclui um workflow (`.github/workflows/pages.yml`) que publica a
pasta `app/` automaticamente a cada push para `main`:

1. Criar um repositório em <https://github.com/new> (ex.: `metro-linha-b`).
2. `git remote add origin https://github.com/<utilizador>/metro-linha-b.git`
3. `git push -u origin main`
4. No GitHub: **Settings → Pages → Source: GitHub Actions** (só na 1.ª vez).

A app fica em `https://<utilizador>.github.io/metro-linha-b/`. Para atualizar
horários online: correr o extrator com o novo PDF, `git commit` e `git push`.

## Atualizar horários (novo PDF)

1. Colocar o novo PDF em `pdfs/` (manter a data no nome: `horarios_DD_MM_AAAA*.pdf`
   — é daí que vem a data de validade mostrada na app).
2. Correr:
   ```powershell
   python -m pip install pdfplumber   # só na primeira vez
   python -X utf8 tools\extract.py
   ```
3. Confirmar `VALIDAÇÃO: OK` no fim. O relatório completo fica em
   `data/extraction-report.txt`. Se houver erros, o extrator devolve exit code 1
   e **não se deve publicar** o resultado sem rever.
4. Correr os testes do motor: `node tools\test_engine.js`.

### Correções manuais

Se a extração automática falhar numa viagem concreta, criar `data/overrides.json`:

```json
{
  "removeTrips": ["weekday-outbound-003"],
  "editTrips":   { "weekday-outbound-005": { "times": ["06:01", "..."] } },
  "addTrips":    [ { "dayType": "weekday", "direction": "outbound",
                     "service": "B", "times": ["..."] } ]
}
```

e reexecutar o extrator. Os overrides aplicados ficam registados no relatório e
no campo `source.overridesApplied` do JSON.

## Modelo de dados (resumo)

- 36 estações; `directions.outbound/inbound.stationOrder` define a ordem.
- Cada viagem (`trips[]`) tem `times[]` com 36 entradas alinhadas à ordem do seu
  sentido; `null` = o expresso (Bx) não para nessa estação.
- Tipos de dia: `weekday`, `saturday`, `sunday_holiday` (o PDF junta domingos e
  feriados num só quadro).
- **Dia de serviço**: partidas depois da meia-noite (00:01–01:35) pertencem ao
  dia anterior. Entre as 00:00 e as 03:59 a app consulta o quadro do dia
  anterior. A mesma regra existe em `extract.py` (`service_minutes`) e em
  `engine.js` (`tripMinutes`/`serviceContext`) — alterar nos dois sítios.

## Limitações conhecidas

- Horários planeados, não tempo real (tolerância oficial: ±2 min).
- Feriados municipais (ex.: S. João) não são considerados — apenas os 13
  feriados nacionais, calculados até 5 anos à frente em `holidays.json`.
- O extrator assume o layout atual do PDF (6 páginas, 36 colunas, cabeçalhos
  rodados). Se o layout mudar, a validação falha de forma explícita — ajustar
  `tools/extract.py`.
