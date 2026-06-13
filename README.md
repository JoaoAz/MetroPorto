# Metro do Porto - Planeador de Viagens

Web app estatica (HTML/CSS/JS puro, sem build nem backend) para planear viagens
na rede publicada do Metro do Porto: proximos horarios, percursos diretos ou com
transbordo, duracao, zonas Andante e preco estimado. Funciona offline (PWA) e
sem servicos externos.

App publicada: <https://joaoaz.github.io/MetroPorto/>

Aplicacao independente, sem relacao oficial com a Metro do Porto. Informacoes
ou sugestoes: <info@horarios-metro.pt>.

## Estado Dos Dados

| Dados | Estado | Onde |
|---|---|---|
| Horarios A, B, C, E, F | Reais, extraidos do PDF oficial `horarios_06_04_2026.pdf` | `data/schedules/line-*.json` |
| Horarios Linha D | Estimados por frequencia a partir das imagens fornecidas | `data/schedules/line-d.estimated.json` |
| Topologia publicada | 6 linhas, 85 estacoes, aliases e linhas servidas | `data/network.json` |
| Zonas Andante | Estimadas a partir do mapa e calibradas com exemplos | `data/network.json` |
| Tarifario Andante ocasional | Real, em vigor desde 01/01/2026 | `data/fares.json` |

Calibracao de zonas atualmente testada:

- Trindade -> Senhora da Hora = Z2
- Trindade -> Pedras Rubras = Z4
- Trindade -> Mindelo = Z5
- Trindade -> Aeroporto = Z4
- Trindade -> Povoa de Varzim = Z7

Os precos aparecem como estimativa porque as zonas foram atribuidas ao nivel do
corredor do metro. O algoritmo ja suporta estacoes em mais do que uma zona e
escolhe a origem tarifaria mais favoravel quando existir essa informacao.

## Estrutura

```text
pdfs/                       PDFs oficiais (entrada)
data/network.json           EDITAVEL: estacoes, aliases, zonas, linhas
data/fares.json             EDITAVEL: tarifario Andante
data/schedules/             horarios por linha (reais e .demo)
data/overrides.json         correcoes manuais da extracao (opcional)
tools/extract.py            PDF completo -> data/schedules/line-*.json
tools/apply_zones.py        aplica zonas estimadas no network.json
tools/gen_estimated_line_d.py gera a Linha D estimada por frequencia
tools/gen_demo_schedules.py horarios ficticios para linhas sem PDF
tools/build_data.py         valida tudo e gera app/data/data.js e data.json
tools/test_engine.js        testes das utilidades de tempo
tools/test_router.js        testes do planeador, transbordos, zonas e preco
app/engine.js               utilidades de tempo/dia de servico
app/router.js               pesquisa, percursos, transbordos, zonas, preco
app/app.js + index.html     interface
app/data/data.js            artefacto gerado, usado pela app
```

## Como Executar Localmente

```powershell
python -m http.server 8742 --directory app
```

Abrir: <http://localhost:8742>

## Pipeline De Dados

```powershell
python -X utf8 tools\extract.py pdfs\horarios_06_04_2026.pdf
python -X utf8 tools\apply_zones.py
python -X utf8 tools\gen_estimated_line_d.py
python -X utf8 tools\gen_demo_schedules.py
python -X utf8 tools\build_data.py
node tools\test_engine.js
node tools\test_router.js
```

`build_data.py` falha com exit 1 se encontrar incoerencias. Nao publicar nesse
caso. Relatorios:

- `data/extraction-report.txt`
- `data/build-report.txt`

## Atualizar Horarios

1. Colocar o novo PDF em `pdfs/`.
2. Correr `tools\extract.py` com o caminho do PDF.
3. Se o extrator acusar nomes desconhecidos, adicionar aliases em
   `data/network.json`.
4. Correr `apply_zones.py`, `gen_estimated_line_d.py`, `gen_demo_schedules.py`,
   `build_data.py` e os testes.
5. Commit + push. O GitHub Pages publica a pasta `app/` automaticamente.

O extrator atual suporta o PDF completo de 31 paginas com horarios das linhas
A, B, C, E e F. A Linha D nao aparece nesse PDF; por isso e gerada como
estimativa por frequencia a partir das capturas fornecidas.

## Atualizar Zonas E Tarifas

Zonas:

- Editar `data/network.json` diretamente, ou alterar `tools/apply_zones.py` e
  voltar a corrê-lo.
- Usar codigos Andante reais quando confirmados no mapa oficial.
- Se uma estacao estiver numa fronteira, usar varias zonas no array, por
  exemplo `["PRT1", "MTS1"]`.

Tarifas:

- Editar `data/fares.json`.
- Manter `validFrom`, `source`, moeda e tabela `occasional`.
- Correr `build_data.py` e os testes.

## Regras De Calculo

- Hoje: modo ao vivo por dia civil. Mesmo depois da meia-noite, 13/06 e tratado
  como sabado, nao como prolongamento de sexta.
- Outra data: consulta desde o inicio do servico desse dia, sem contagem
  regressiva artificial.
- Horarios depois da meia-noite no PDF continuam ordenados no fim do respetivo
  quadro diario, para suportar viagens que terminam no dia seguinte.
- Transbordo minimo: 4 minutos.
- Percursos: enumera sequencias de linhas ate 2 transbordos, escolhe candidatos
  com menos paragens e valida-os contra horarios reais.
- Preco: calcula o titulo Andante pela distancia em aneis de zonas a partir da
  zona da primeira validacao. Z2 e o minimo tarifario.

## Limitacoes Conhecidas

- Horarios planeados, nao tempo real; ha tolerancia oficial de +/- 2 min.
- Linha D usa horarios estimados por frequencia; confirmar sempre no operador.
- Zonas ainda marcadas como estimadas; confirmar/refinar com mapa oficial.
- Feriados: apenas nacionais; feriados municipais nao sao distinguidos.
- Linha Rosa/G e futuras extensoes nao incluidas.
- Tempo de transbordo fixo; nao modela distancia real entre cais.
