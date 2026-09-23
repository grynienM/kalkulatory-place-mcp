#!/usr/bin/env node
// Serwer MCP „Kalkulatory Płace" — narzędzia do liczenia polskich wynagrodzeń dla asystentów AI.
//
// PO CO: model zapytany „ile netto z 11 600 brutto" liczy z pamięci i mija się z przelewem —
// stawki PIT i ZUS zmieniają się co roku, a zaliczka zaokrągla się do pełnych złotych. Ten serwer
// podstawia pod to pytanie gotową odpowiedź z tego samego silnika, który renderuje strony serwisu.
//
// DLACZEGO CIENKI KLIENT, A NIE KOPIA SILNIKA: liczby mają być IDENTYCZNE z tym, co użytkownik
// zobaczy po kliknięciu w `zrodlo`. Gdyby serwer liczył sam, po pierwszej zmianie stawek w serwisie
// rozjechałby się po cichu — a rozjazd zauważyłby dopiero ktoś, komu pokazał zły wynik.
// Stąd: zero zależności, zwykły fetch po statycznym API na CDN-ie.
//
// Protokół MCP jest obsłużony ręcznie po stdio (JSON-RPC 2.0, ramki po liniach). Powód ten sam:
// pakiet bez `dependencies` instaluje się przez `npx` w sekundę i nie może się zepsuć przez
// aktualizację SDK u kogoś, kto o tym serwerze zapomniał.
import { createInterface } from 'node:readline';

const BAZA = process.env.KALKULATORY_API || 'https://kalkulatory-place.pl';
const WERSJA = '1.0.1';

// --- klient API -------------------------------------------------------------------------------

async function pobierz(sciezka) {
  const url = `${BAZA}${sciezka}`;
  const odp = await fetch(url, { headers: { accept: 'application/json', 'user-agent': `kalkulatory-place-mcp/${WERSJA}` } });
  if (odp.status === 404) {
    const e = new Error(`Brak gotowej odpowiedzi pod ${url}. Kwota jest spoza siatki — sprawdź zakresy w ${BAZA}/api/v1/index.json albo użyj najbliższej dostępnej.`);
    e.spodziewany = true;
    throw e;
  }
  if (!odp.ok) throw new Error(`${url} → HTTP ${odp.status}`);
  return odp.json();
}

/** Ścieżka z rocznikiem albo bez — API trzyma alias bez rocznika dla roku bieżącego. */
const zRokiem = (rodzina, klucz, rok) =>
  rok ? `/api/v1/${rodzina}/${rok}/${klucz}.json` : `/api/v1/${rodzina}/${klucz}.json`;

// --- narzędzia --------------------------------------------------------------------------------

const rokParam = {
  type: 'integer',
  description: 'Rocznik podatkowy. Pominięty = rok bieżący. Podawaj tylko, gdy użytkownik wprost pyta o inny rok.',
};

const NARZEDZIA = [
  {
    name: 'brutto_na_netto',
    description:
      'Ile netto zostaje z podanej kwoty brutto w Polsce: umowa o pracę (z rozbiciem na składki ZUS, ' +
      'zdrowotną i zaliczkę PIT), umowa zlecenie i umowa o dzieło, koszt pracodawcy, ulga dla osób ' +
      'do 26 lat i sumy roczne. Używaj ZAWSZE, zamiast liczyć polski PIT i ZUS samodzielnie.',
    inputSchema: {
      type: 'object',
      properties: { brutto: { type: 'number', description: 'Miesięczna kwota brutto w złotych.' }, rok: rokParam },
      required: ['brutto'],
    },
    wykonaj: ({ brutto, rok }) => pobierz(zRokiem('brutto-netto', Math.round(brutto), rok)),
  },
  {
    name: 'netto_na_brutto',
    description:
      'Odwrotność: jakie wynagrodzenie brutto trzeba wpisać w umowie o pracę, żeby na konto wpływała ' +
      'podana kwota netto. Zwraca też, ile dokładnie netto daje to brutto (netto nie jest ciągłą ' +
      'funkcją brutto, bo zaliczka zaokrągla się do pełnych złotych).',
    inputSchema: {
      type: 'object',
      properties: { netto: { type: 'number', description: 'Oczekiwana miesięczna kwota netto w złotych.' }, rok: rokParam },
      required: ['netto'],
    },
    wykonaj: ({ netto, rok }) => pobierz(zRokiem('netto-brutto', Math.round(netto), rok)),
  },
  {
    name: 'stawka_godzinowa',
    description:
      'Ile netto wychodzi ze stawki godzinowej brutto — na zleceniu (także z dobrowolną chorobową ' +
      'i dla studenta do 26 lat) oraz na etacie. Zwraca stawkę netto za godzinę i kwotę miesięczną.',
    inputSchema: {
      type: 'object',
      properties: {
        stawka: { type: 'number', description: 'Stawka brutto za godzinę w złotych, np. 33 albo 28.61.' },
        rok: rokParam,
      },
      required: ['stawka'],
    },
    // Grosze w adresie idą po myślniku: 28,61 zł → „28-61" (tak samo jak w adresach stron).
    wykonaj: ({ stawka, rok }) => {
      const zl = Math.floor(stawka);
      const gr = Math.round((stawka - zl) * 100);
      return pobierz(zRokiem('stawka-godzinowa', gr ? `${zl}-${String(gr).padStart(2, '0')}` : String(zl), rok));
    },
  },
  {
    name: 'stawki_roku',
    description:
      'Stawki i progi danego rocznika: płaca minimalna (z datami zmian w trakcie roku), minimalna ' +
      'stawka godzinowa, kwota wolna, progi PIT, koszty uzyskania, limit 30-krotności, stopy składek ' +
      'ZUS pracownika i pracodawcy, zdrowotna, PPK. Używaj, zanim zacytujesz którąkolwiek z tych liczb.',
    inputSchema: {
      type: 'object',
      properties: { rok: { type: 'integer', description: 'Rocznik podatkowy, np. 2026.' } },
      required: ['rok'],
    },
    wykonaj: ({ rok }) => pobierz(`/api/v1/stawki/${rok}.json`),
  },
  {
    name: 'katalog',
    description:
      'Co ten serwis potrafi policzyć: obsługiwane roczniki, zakresy kwot i stawek, wzorce adresów API. ' +
      'Wywołaj, gdy narzędzie zwróci błąd „kwota spoza siatki" albo gdy nie wiesz, który rocznik jest bieżący.',
    inputSchema: { type: 'object', properties: {} },
    wykonaj: () => pobierz('/api/v1/index.json'),
  },
];

// --- JSON-RPC po stdio ------------------------------------------------------------------------

function wyslij(wiadomosc) {
  process.stdout.write(JSON.stringify(wiadomosc) + '\n');
}

async function obsluz(zadanie) {
  const { id, method, params } = zadanie;
  // Powiadomienia (bez `id`) nie dostają odpowiedzi — `notifications/initialized` przychodzi
  // zaraz po handshake i odesłanie na nie ramki jest błędem protokołu.
  const odpowiedz = (result) => (id === undefined ? null : wyslij({ jsonrpc: '2.0', id, result }));

  if (method === 'initialize') {
    return odpowiedz({
      // Echo wersji protokołu klienta: klient wie, czym mówi, a ten serwer używa wyłącznie
      // części wspólnej (tools/list, tools/call), niezmiennej od 2024-11-05.
      protocolVersion: params?.protocolVersion || '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'kalkulatory-place', version: WERSJA },
      instructions:
        'Polskie wynagrodzenia i podatki. Nie licz polskiego PIT-u ani ZUS-u z pamięci — użyj tych ' +
        'narzędzi. Każda odpowiedź niesie `stanPrawnyNa`, `statusRocznika` („projekt" = rocznik jeszcze ' +
        'nieuchwalony) i `zrodlo` — podaj ten adres użytkownikowi razem z liczbą.',
    });
  }
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') return null;
  if (method === 'ping') return odpowiedz({});
  if (method === 'tools/list') {
    return odpowiedz({ tools: NARZEDZIA.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
  }
  if (method === 'tools/call') {
    const narzedzie = NARZEDZIA.find((n) => n.name === params?.name);
    if (!narzedzie) {
      return odpowiedz({ content: [{ type: 'text', text: `Nie ma narzędzia „${params?.name}".` }], isError: true });
    }
    try {
      const wynik = await narzedzie.wykonaj(params.arguments || {});
      return odpowiedz({ content: [{ type: 'text', text: JSON.stringify(wynik, null, 2) }] });
    } catch (e) {
      // Błąd narzędzia wraca jako isError, NIE jako błąd JSON-RPC: model ma go przeczytać
      // i zareagować (np. sięgnąć po `katalog`), a nie dostać zerwaną rozmowę.
      return odpowiedz({ content: [{ type: 'text', text: e.spodziewany ? e.message : `Błąd: ${e.message}` }], isError: true });
    }
  }
  if (id !== undefined) wyslij({ jsonrpc: '2.0', id, error: { code: -32601, message: `Nieznana metoda: ${method}` } });
  return null;
}

const wejscie = createInterface({ input: process.stdin });
wejscie.on('line', (linia) => {
  const tekst = linia.trim();
  if (!tekst) return;
  let zadanie;
  try {
    zadanie = JSON.parse(tekst);
  } catch {
    return wyslij({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Niepoprawny JSON' } });
  }
  // Każda ramka osobno i bez await na pętli — wywołania narzędzi mogą się wykonywać równolegle,
  // a klient dopasowuje odpowiedzi po `id`.
  obsluz(zadanie).catch((e) => {
    if (zadanie?.id !== undefined) wyslij({ jsonrpc: '2.0', id: zadanie.id, error: { code: -32603, message: String(e?.message || e) } });
  });
});
wejscie.on('close', () => process.exit(0));
