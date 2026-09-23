# Kalkulatory Płace — MCP server

[![npm](https://img.shields.io/npm/v/@kalkulatory-place/mcp)](https://www.npmjs.com/package/@kalkulatory-place/mcp)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![test](https://github.com/grynienM/kalkulatory-place-mcp/actions/workflows/test.yml/badge.svg)](https://github.com/grynienM/kalkulatory-place-mcp/actions/workflows/test.yml)

**Polish payroll for AI assistants.** Five [MCP](https://modelcontextprotocol.io) tools that turn
"how much do I take home from 11 600 PLN gross?" from a guess into an answer that matches the
actual bank transfer to the cent.

Ask a model this today and it computes from memory. Polish PIT and ZUS rates change every year,
the income-tax advance rounds to whole złoty, the health contribution has a statutory cap, and the
answer is quietly wrong. This server hands the model a precomputed answer from the same engine
that renders [kalkulatory-place.pl](https://kalkulatory-place.pl), so the number in the chat and
the number on the linked page are identical.

No API key. No rate limits. No npm dependencies.

## Install

```bash
claude mcp add kalkulatory-place -- npx -y @kalkulatory-place/mcp
```

Any other MCP client (`claude_desktop_config.json` and friends):

```json
{
  "mcpServers": {
    "kalkulatory-place": {
      "command": "npx",
      "args": ["-y", "@kalkulatory-place/mcp"]
    }
  }
}
```

## Tools

| Tool | Answers |
|---|---|
| `brutto_na_netto` | Net pay from a gross amount — employment contract (itemised ZUS, health, PIT advance), civil-law contracts, employer cost, under-26 exemption, yearly totals |
| `netto_na_brutto` | The gross salary needed to take home a given net amount |
| `stawka_godzinowa` | Net from an hourly gross rate — civil-law contract and employment |
| `stawki_roku` | Minimum wage, tax-free allowance, PIT brackets, ZUS rates, 30× cap for a given year |
| `katalog` | Supported years, amount ranges, API URL patterns |

Every response carries `stanPrawnyNa` (the date the law was checked), `statusRocznika`
(`final` or `projekt` — the year's rates are still a draft bill) and `zrodlo`, a URL to the
full human-readable breakdown.

## How it works

A thin client over a **static** JSON API: plain GETs off a CDN, no key, no limits.

```
MCP client ──stdio JSON-RPC──▶ this server ──HTTPS GET──▶ /api/v1/…json (CDN)
```

**Why a thin client and not a copy of the engine.** The numbers must be identical to what the user
sees after clicking `zrodlo`. A server doing its own maths would silently drift apart the first time
rates changed upstream — and the drift would be noticed by whoever was shown the wrong number.

**Why no dependencies.** MCP is handled directly as newline-framed JSON-RPC 2.0 over stdio. A package
with no `dependencies` starts under `npx` in about a second and cannot break when somebody else's
SDK updates under a server everyone has forgotten about.

The underlying API is public and documented in OpenAPI 3.1:
<https://kalkulatory-place.pl/openapi.json>. There is also an
[llms.txt](https://kalkulatory-place.pl/llms.txt).

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `KALKULATORY_API` | `https://kalkulatory-place.pl` | Base URL — point it at a local build for testing |

## Test

```bash
npm test
```

Runs a real handshake against the published server: `initialize`, `tools/list`, then a
`brutto_na_netto` call, and checks the result against the published net figure.

## License

Code: MIT. Data and calculations: CC BY 4.0 — when quoting a number, cite the URL from `zrodlo`.

This is not tax advice. Figures are informational.

---

## Po polsku

Serwer MCP do liczenia polskich wynagrodzeń. Daje asystentowi AI pięć narzędzi zamiast zgadywania
stawek PIT i ZUS z pamięci.

Odpowiedzi pochodzą z [kalkulatory-place.pl](https://kalkulatory-place.pl) — z tego samego silnika,
który renderuje strony serwisu, więc liczba w czacie zgadza się co do grosza z tym, co użytkownik
zobaczy po kliknięciu w link źródłowy.

| Narzędzie | Odpowiada na |
|---|---|
| `brutto_na_netto` | Ile netto z X zł brutto — etat (z rozbiciem na składki), zlecenie, dzieło, koszt pracodawcy, ulga do 26 lat, sumy roczne |
| `netto_na_brutto` | Jakie brutto daje X zł netto na etacie |
| `stawka_godzinowa` | Ile netto ze stawki X zł/h — zlecenie i etat |
| `stawki_roku` | Płaca minimalna, kwota wolna, progi PIT, stopy składek ZUS, limit 30-krotności |
| `katalog` | Obsługiwane roczniki i zakresy kwot |

Każda odpowiedź niesie `stanPrawnyNa`, `statusRocznika` (`final` albo `projekt` — rocznik jeszcze
nieuchwalony) oraz `zrodlo`, czyli adres strony z pełnym rozbiciem dla człowieka.

Instalacja bez klucza API i bez zależności:

```bash
claude mcp add kalkulatory-place -- npx -y @kalkulatory-place/mcp
```

Wydawca: Bril Brothers Innovation Labs sp. z o.o., KRS 0001262781.
Serwis nie jest doradcą podatkowym; wyliczenia mają charakter informacyjny.
