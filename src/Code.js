/**
 * LFK kamper — fixture sync fra fotball.no
 * ------------------------------------------
 * Henter Lillehammer FK sin offisielle kalenderstrøm (iCal) fra fotball.no,
 * filtrerer ned til lagene du følger, og oppdaterer regnearket.
 *
 * KOLONNER
 *
 * Påkrevd: Dato, Hjemmelag, Bortelag, Turnering — de tre siste kjenner igjen
 * raden, Dato fester kampen i tid. Alt annet er valgfritt, og en kolonne som
 * ikke finnes blir hverken lest eller skrevet.
 *
 * ARBEIDSDELINGEN MELLOM DE TO DATOKOLONNENE
 *
 *   Dato     = det fotball.no sier. Skrives alltid.
 *   Ny dato  = det dere har avtalt, og som ikke nødvendigvis er registrert
 *              i FIKS ennå. Dette er menneskets kolonne, og den er valgfri —
 *              uten den finnes ingen lokale avtaler, og alt følger fotball.no.
 *
 * En rad der de to er ulike har en lokal avtale på seg. Den avtalen er hele
 * poenget med kolonnen, og synken skal ikke kunne rive den bort. Derfor:
 *
 *   Ny dato  skrives bare når den i utgangspunktet speiler Dato — altså når
 *            det ikke ligger noen avtale der å ødelegge. Formler røres aldri.
 *   Dag      følger datoen dere faktisk spiller. På rader med lokal avtale
 *            står den til Ny dato og røres ikke.
 *   Tid, Bane følger alltid fotball.no.
 *   Hjemmelag, Bortelag skrives med fotball.no sin egen skrivemåte, ordrett
 *            slik den står i kalenderen ("Nordre Land IL/Torpa IL G15-2").
 *   Kommentar røres aldri.
 *
 * HVORDAN RADER GJENKJENNES
 *
 * Kalenderstrømmen har en UID per kamp, men fotball.no genererer den på nytt
 * mellom økter — samme kamp hadde tre forskjellige UID-er i løpet av én dag.
 * En lagret UID er derfor verdiløs, og et forsøk på å matche på den gjør at
 * hver eneste kamp ser ny ut og blir lagt til på nytt.
 *
 * Derfor matches rader på innhold: turnering + de to lagnavnene, normalisert.
 * Den kombinasjonen er unik innenfor en sesong og overlever både flytting av
 * dato, endret klokkeslett og bytte av bane — altså akkurat det synken er til
 * for. Ingenting lagres som må holdes i takt, så ingenting kan bli foreldet.
 *
 * Normaliseringen fjerner klubbord (IL, FK, SK) og lagregistreringen bakerst,
 * så "Nordre Land/Torpa 2" og "Nordre Land IL/Torpa IL G15-2" gir samme
 * nøkkel. Det er derfor synken kjenner igjen radene sine selv om skrivemåten
 * i arket endrer seg.
 *
 * Rader slettes aldri. Kamper som forsvinner fra strømmen blir rapportert —
 * strømmen er framoverskuende og mister ferdigspilte kamper.
 *
 * Førstegangsoppsett: kjør setup() én gang fra editoren.
 */

// ---------------------------------------------------------------- KONFIG ---

// Dette er bare startverdiene. Etter at setup() har laget arket "config",
// er det DET som gjelder — rediger der, ikke her.
const CONFIG = {
  SHEET_NAME: null,                   // null = første ark. Sett navnet hvis
                                      // arket ikke er det første i dokumentet.
  CONFIG_SHEET: 'config',
  TIMEZONE: 'Europe/Oslo',
  NIGHTLY_HOUR: 5,
  DEFAULTS: {
    'Klubb-ID': ['1683'],             // Lillehammer Fotballklubb
    'Lag': [
      'Lillehammer G15-1',
      'Lillehammer G15-2',
      'Lillehammer G16-1',
      'Lillehammer G16-2'
    ],
    'Varsle e-post': ['din@epost.no'],
    'Sorter etter dato': ['ja']
  }
};

function feedUrl_(clubId) {
  return 'https://www.fotball.no/footballapi/Calendar/GetCalendarForClub?clubId=' + clubId;
}

const COLS = ['Kommentar', 'Dato', 'Ny dato', 'Dag', 'Tid', 'Hjemmelag', 'Bortelag', 'Bane', 'Turnering'];
// Bare det som trengs for å kjenne igjen en rad og feste en dato på den.
// Alt annet — Ny dato, Dag, Tid, Bane, Kommentar — er valgfritt, og en kolonne
// som ikke finnes blir hverken lest eller skrevet.
const REQUIRED_COLS = ['Dato', 'Hjemmelag', 'Bortelag', 'Turnering'];
const DAY_NAMES = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'];

// --------------------------------------------------------------- CONFIG-ARK -

/**
 * Arket "config" har én kolonne per terminliste. Overskriften i kolonnen er
 * navnet på fanen den styrer, så ett regneark kan holde flere lag med hver
 * sine innstillinger.
 *
 *   Nøkkel              kampoppsett_2026     J13 2026
 *   Klubb-ID            1683                 1683
 *   Lag                 Lillehammer G15-1    Lillehammer J13-1
 *   Lag                 Lillehammer G15-2    Lillehammer J13-2
 *   Lag                 Lillehammer G16-1
 *   Lag                 Lillehammer G16-2
 *   Varsle e-post       din@epost.no         annen@epost.no
 *   Sorter etter dato   ja                   ja
 *
 * En nøkkel kan stå på flere rader — det er slik "Lag" blir en liste. Tomme
 * celler betyr bare at den kolonnen ikke bruker den raden, så kolonnene
 * trenger ikke være like lange.
 *
 * "Lag" er et PREFIKS. "Lillehammer G16-1" treffer bare det laget, mens
 * "Lillehammer G16" ville tatt med alle G16-lagene i klubben — også G16-3,
 * som spiller en serie dette arket ikke følger. Skriv så mye av navnet som
 * skal til for å treffe det du vil ha, og ikke mer.
 *
 * Poenget med å styre på lag i stedet for på serienavn: et lag beholder navnet
 * gjennom sesongen, mens serienavnene bytter hver gang laget rykker opp et
 * årstrinn. Nye serier og cupkamper for de samme lagene kommer med av seg selv.
 *
 * Den gamle enkolonne-varianten med overskriften "Verdi" leses fortsatt. Da
 * finnes fanen via nøkkelen "Ark", eller på innhold hvis den står tom.
 */
function loadProfiles_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.CONFIG_SHEET);
  if (!sheet) return [buildProfile_('', {})];

  const values = sheet.getDataRange().getValues();
  if (!values.length) return [buildProfile_('', {})];
  const header = values[0].map(function (c) { return String(c).trim(); });

  const profiles = [];
  for (var c = 1; c < header.length; c++) {
    if (!header[c]) continue;
    const raw = {};
    for (var r = 1; r < values.length; r++) {
      const key = String(values[r][0]).trim();
      const val = String(values[r][c]).trim();
      if (!key || !val) continue;
      (raw[key] = raw[key] || []).push(val);
    }
    if (!Object.keys(raw).length) continue;          // tom kolonne, hopp over
    profiles.push(buildProfile_(norm_(header[c]) === 'verdi' ? '' : header[c], raw));
  }
  return profiles.length ? profiles : [buildProfile_('', {})];
}

function buildProfile_(sheetName, raw) {
  const pick = function (key) {
    const hit = Object.keys(raw).find(function (k) { return norm_(k) === norm_(key); });
    return hit ? raw[hit] : CONFIG.DEFAULTS[key];
  };
  const teams = pick('Lag') || [];
  if (!teams.length) {
    throw new Error('Ingen "Lag" satt opp for kolonnen "' + (sheetName || 'Verdi') +
                    '" i arket "' + CONFIG.CONFIG_SHEET + '"');
  }
  return {
    sheetName: sheetName || (pick('Ark') || [''])[0],
    clubId: (pick('Klubb-ID') || ['1683'])[0],
    teams: teams,
    notifyEmail: (pick('Varsle e-post') || [''])[0],
    sortAfterSync: /^(ja|yes|true|1)$/i.test((pick('Sorter etter dato') || ['ja'])[0])
  };
}

/** Har fanen en "Turnering"-overskrift blant de øverste radene? */
function hasFixtureHeader_(sheet) {
  const rows = Math.min(10, sheet.getLastRow());
  const cols = sheet.getLastColumn();
  if (!rows || !cols) return false;
  return sheet.getRange(1, 1, rows, cols).getValues().some(function (r) {
    return r.some(function (c) { return norm_(c) === 'turnering'; });
  });
}

function ensureConfigSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const existing = ss.getSheetByName(CONFIG.CONFIG_SHEET);
  if (existing) return existing;

  // Kolonneoverskriften skal være navnet på fanen den styrer, så finn den.
  const target = ss.getSheets().filter(function (sh) {
    return sh.getName() !== CONFIG.CONFIG_SHEET && hasFixtureHeader_(sh);
  })[0];

  const sheet = ss.insertSheet(CONFIG.CONFIG_SHEET, ss.getNumSheets());
  const rows = [['Nøkkel', target ? target.getName() : 'Terminliste']];
  Object.keys(CONFIG.DEFAULTS).forEach(function (key) {
    CONFIG.DEFAULTS[key].forEach(function (v) { rows.push([key, v]); });
  });
  sheet.getRange(1, 1, rows.length, 2).setValues(rows);
  sheet.getRange(1, 1, 1, 2).setFontWeight('bold');
  sheet.setColumnWidth(1, 170);
  sheet.setColumnWidth(2, 240);
  return sheet;
}

/** Planer for alle terminlistene, eventuelt bare den ene du ber om. */
function buildPlans_(sheetFilter) {
  const profiles = loadProfiles_().filter(function (p) {
    return !sheetFilter || norm_(p.sheetName) === norm_(sheetFilter);
  });
  if (!profiles.length) {
    throw new Error('Ingen kolonne i "' + CONFIG.CONFIG_SHEET + '" heter "' + sheetFilter + '"');
  }
  return profiles.map(function (p) { return buildPlan_(p); });
}

// ----------------------------------------------------------------- OPPSETT -

function setup() {
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty('API_TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
    props.setProperty('API_TOKEN', token);
  }

  ensureConfigSheet_();
  const profiles = loadProfiles_();

  ScriptApp.getProjectTriggers()
    .filter(function (tr) { return tr.getHandlerFunction() === 'nightly'; })
    .forEach(function (tr) { ScriptApp.deleteTrigger(tr); });
  ScriptApp.newTrigger('nightly').timeBased().atHour(CONFIG.NIGHTLY_HOUR).everyDays(1).create();

  const msg = [
    '=========================================================',
    ' API_TOKEN: ' + token,
    '=========================================================',
    'Innstillinger i arket "' + CONFIG.CONFIG_SHEET + '" — én kolonne per terminliste.',
    profiles.map(function (p) {
      const t = locateTable_(p);
      return '  "' + t.sheet.getName() + '": ' + t.rows.length + ' rader, følger ' + p.teams.join(', ');
    }).join('\n'),
    'Nattlig synk satt opp ca. kl ' + CONFIG.NIGHTLY_HOUR + ':00 (' + CONFIG.TIMEZONE + ').',
    '',
    'Web-app er valgfritt — hele synken kan kjøres fra LFK kamper-menyen i arket.',
    'Skal Claude kunne kjøre den for deg, publiser som NETTAPP (ikke bibliotek):',
    '  Distribuer > Ny distribusjon > tannhjul > Nettapp',
    '  Kjør som: Meg      Hvem har tilgang: Alle'
  ].join('\n');
  Logger.log(msg);
  return msg;
}

/**
 * Engangsopprydding: fjerner kolonnene "Varsling" og "KampID".
 *
 * Kjøres fra editoren, ikke fra menyen — den sletter data, og da skal det
 * være et bevisst valg og ikke noe man kommer borti. Sletter bare kolonner
 * som heter nøyaktig dette, og sier fra hva den gjorde.
 */
function ryddKolonner() {
  const t = locateTable_(loadProfiles_()[0]);
  const doomed = ['Varsling', 'KampID'];
  const found = [];
  t.header.forEach(function (h, i) {
    if (doomed.some(function (d) { return norm_(d) === norm_(h); })) found.push({ name: h, idx: i });
  });
  if (!found.length) { Logger.log('Fant ingen av kolonnene ' + doomed.join(', ') + '. Ingenting gjort.'); return; }

  // Bakfra, ellers forskyver hver sletting indeksene til de neste.
  found.sort(function (a, b) { return b.idx - a.idx; })
       .forEach(function (c) { t.sheet.deleteColumn(c.idx + 1); });

  const msg = 'Slettet: ' + found.map(function (c) { return c.name; }).join(', ') +
              '. Arket "' + t.sheet.getName() + '" har nå ' + t.sheet.getLastColumn() + ' kolonner.';
  Logger.log(msg);
  return msg;
}

// ------------------------------------------------------------- MENY I ARKET -
// Menyfunksjoner kan ikke ha understrek til slutt — Apps Script regner slike
// navn som private og nekter å kalle dem fra en meny.

function onOpen() {
  SpreadsheetApp.getUi().createMenu('LFK kamper')
    .addItem('Forhåndsvis synk', 'menuPreview')
    .addItem('Kjør synk', 'menuApply')
    .addToUi();
}

function menuPreview() {
  const plans = buildPlans_();
  showText_('Forhåndsvisning', plans.map(renderPlan_).join('\n\n' + '='.repeat(60) + '\n\n'));
}

function menuApply() {
  const plans = buildPlans_();
  const pending = plans.filter(function (p) { return p.updates.length + p.additions.length; });
  const body = plans.map(renderPlan_).join('\n\n' + '='.repeat(60) + '\n\n');
  if (!pending.length) { showText_('Synk', body); return; }

  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Kjør synk?', body + '\n\nSkrive dette til arkene?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  const lines = pending.map(function (plan) {
    const res = applyPlan_(plan);
    return [plan.sheetName + ':',
            '  Rader oppdatert: ' + res.rowsUpdated + ', lagt til: ' + res.rowsAdded,
            res.sort && res.sort.sorted ? '  Sortert på Dato (' + res.sort.how + ')' : '',
            res.additionsHeld ? '  NYE RADER HOLDT TILBAKE — se advarselen i forhåndsvisningen.' : '',
            res.warnings.length ? '  Advarsler:\n   - ' + res.warnings.join('\n   - ') : ''
           ].filter(Boolean).join('\n');
  });
  showText_('Synk fullført', lines.join('\n\n'));
}

function showText_(title, body) {
  const html = HtmlService.createHtmlOutput(
    '<pre style="font:13px/1.45 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;margin:0">' +
    body.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</pre>')
    .setWidth(760).setHeight(560);
  SpreadsheetApp.getUi().showModalDialog(html, title);
}

// ------------------------------------------------------------------- API ---

function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); }
  catch (err) { return json_({ ok: false, error: 'invalid_json' }); }

  const expected = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
  if (!expected || body.token !== expected) return json_({ ok: false, error: 'unauthorized' });

  try {
    switch (body.action) {
      case 'ping': return json_({ ok: true, action: 'ping', sheets: loadProfiles_().map(function (p) {
        return locateTable_(p).sheet.getName();
      }) });
      case 'read': return json_({ ok: true, action: 'read', tables: loadProfiles_()
        .filter(function (p) { return !body.sheet || norm_(p.sheetName) === norm_(body.sheet); })
        .map(function (p) { return readTable_(p.sheetName); }) });
      case 'feed': return json_({ ok: true, action: 'feed', feeds: loadProfiles_()
        .filter(function (p) { return !body.sheet || norm_(p.sheetName) === norm_(body.sheet); })
        .map(function (p) { return { sheet: p.sheetName, fixtures: fetchFixtures_(p) }; }) });
      case 'config':  return json_({ ok: true, action: 'config', profiles: loadProfiles_() });
      case 'preview': return json_({ ok: true, action: 'preview', plans: buildPlans_(body.sheet) });
      case 'apply': {
        const results = buildPlans_(body.sheet).map(function (plan) {
          const p = filterPlan_(plan, body.only, body.exclude);
          if (body.forceAdditions) p.forceAdditions = true;
          return { sheet: p.sheetName, result: applyPlan_(p), skipped: p.skipped };
        });
        return json_({ ok: true, action: 'apply', results: results });
      }
      default: return json_({ ok: false, error: 'unknown_action', got: body.action });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err), stack: err.stack ? String(err.stack).slice(0, 2000) : null });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ------------------------------------------------------------ NATTLIG KJØR -

function nightly() {
  buildPlans_().forEach(function (plan) {
    const notable = plan.updates.length + plan.additions.length +
                    plan.missingFromFeed.length + plan.resolved.length + plan.conflicts.length;
    if (notable === 0) return;

    const res = applyPlan_(plan);
    const body = renderPlan_(plan) +
      '\n\n---\nSkrevet: ' + res.rowsUpdated + ' rad(er) oppdatert, ' + res.rowsAdded + ' lagt til.' +
      (res.additionsHeld ? '\nNye rader ble holdt tilbake — se advarselen over.' : '') +
      (res.warnings.length ? '\n\nAdvarsler:\n- ' + res.warnings.join('\n- ') : '');

    // Hver kolonne i config har sin egen mottaker, så varselet går dit.
    if (plan.notifyEmail) {
      MailApp.sendEmail(plan.notifyEmail, 'LFK kamper: endringer i ' + plan.sheetName, body);
    }
  });
}

// ------------------------------------------------------------ KALENDERSTRØM -

function fetchFixtures_(settings) {
  settings = settings || loadProfiles_()[0];
  const res = UrlFetchApp.fetch(feedUrl_(settings.clubId), { muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() !== 200) throw new Error('fotball.no svarte ' + res.getResponseCode());

  const text = res.getContentText('UTF-8').replace(/\r?\n[ \t]/g, '');   // RFC 5545 line folding
  const prefixes = settings.teams.map(norm_);
  const ours = function (name) {
    const n = norm_(name);
    return prefixes.some(function (p) { return n.indexOf(p) === 0; });
  };

  const out = [];
  text.split('BEGIN:VEVENT').slice(1).forEach(function (block) {
    const get = function (key) {
      const m = block.match(new RegExp('^' + key + '(?:;[^:\\n]*)?:(.*)$', 'm'));
      return m ? m[1].trim() : '';
    };
    const desc = get('DESCRIPTION');
    if (!desc) return;
    const parts = desc.split('\\n');

    const teams = splitTeams_((parts[2] || '').trim());
    if (!ours(teams.home) && !ours(teams.away)) return;

    const serie = (parts[0] || '').replace(/\s*\(runde\s*\d+\)\s*$/i, '').trim();
    const start = parseIcsDate_(get('DTSTART'));
    if (!start) return;

    const dayM = (parts[3] || '').match(/\b(mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag)\b/i);
    const roundM = (parts[0] || '').match(/\(runde\s*(\d+)\)/i);

    out.push({
      key: matchKey_(serie, teams.home, teams.away),
      serie: serie,
      runde: roundM ? Number(roundM[1]) : null,
      homeLong: teams.home,
      awayLong: teams.away,
      bane: get('LOCATION'),
      dato: Utilities.formatDate(start, CONFIG.TIMEZONE, 'dd.MM.yyyy'),
      tid: Utilities.formatDate(start, CONFIG.TIMEZONE, 'HH:mm'),
      dag: dayM ? dayM[1].toLowerCase() : DAY_NAMES[start.getDay()],
      iso: Utilities.formatDate(start, CONFIG.TIMEZONE, "yyyy-MM-dd'T'HH:mm")
    });
  });

  out.sort(function (a, b) { return a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0; });
  return out;
}

/**
 * Nøkkelen en rad kjennes igjen på. Turnering pluss de to lagnavnene er unikt
 * innenfor en sesong, og endrer seg ikke når en kamp flyttes.
 */
function matchKey_(serie, home, away) {
  return [norm_(serie), canonKey_(home), canonKey_(away)].join(' | ');
}

function splitTeams_(line) {
  const idxs = [];
  let i = line.indexOf(' - ');
  while (i !== -1) { idxs.push(i); i = line.indexOf(' - ', i + 1); }
  if (idxs.length === 1) return { home: line.slice(0, idxs[0]).trim(), away: line.slice(idxs[0] + 3).trim() };
  if (idxs.length > 1) {
    // Et lagnavn inneholder " - ". Velg delingen der bare én side er Lillehammer.
    for (var k = 0; k < idxs.length; k++) {
      const h = line.slice(0, idxs[k]).trim(), a = line.slice(idxs[k] + 3).trim();
      if (/lillehammer/i.test(h) !== /lillehammer/i.test(a)) return { home: h, away: a };
    }
    return { home: line.slice(0, idxs[0]).trim(), away: line.slice(idxs[0] + 3).trim() };
  }
  return { home: line.trim(), away: '' };
}

function parseIcsDate_(v) {
  const m = String(v).match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return null;
  if (m[7] === 'Z') return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

// ---------------------------------------------------------------- REGNEARK -

/**
 * Finner terminlist-arket.
 *
 * Arket kan hete hva som helst. Står "Ark" i config, brukes det navnet. Ellers
 * letes det opp på innhold: første ark som ikke er config og som har en
 * "Turnering"-overskrift øverst. Å lete etter overskriften i stedet for å ta
 * det første arket gjør at en notatfane foran i rekka ikke velter synken.
 *
 * Har du kopier av terminlisten som sikkerhetskopi, ser de like ut som
 * originalen for denne letingen, og den første vinner. Da er det verdt å sette
 * "Ark" i config, så er det ingen tvil om hvilken fane som skrives til.
 */
function locateTable_(settings) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const named = (settings && settings.sheetName) || CONFIG.SHEET_NAME;

  let sheet = null;
  if (named) {
    sheet = ss.getSheetByName(named);
    if (!sheet) {
      throw new Error('Fant ikke arket "' + named + '". Sjekk "Ark" i arket "' +
                      CONFIG.CONFIG_SHEET + '". Faner som finnes: ' +
                      ss.getSheets().map(function (s) { return s.getName(); }).join(', '));
    }
  } else {
    const candidates = ss.getSheets().filter(function (sh) { return sh.getName() !== CONFIG.CONFIG_SHEET; });
    sheet = candidates.filter(hasFixtureHeader_)[0];
    if (!sheet) {
      throw new Error('Fant ingen fane med en "Turnering"-overskrift. Sett "Ark" i arket "' +
                      CONFIG.CONFIG_SHEET + '". Faner som finnes: ' +
                      candidates.map(function (s) { return s.getName(); }).join(', '));
    }
  }

  const range = sheet.getDataRange();
  const values = range.getValues();
  const formulas = range.getFormulas ? range.getFormulas()
                                     : values.map(function (r) { return r.map(function () { return ''; }); });

  let headerRow = -1;
  for (var i = 0; i < Math.min(values.length, 10); i++) {
    if (values[i].some(function (c) { return norm_(c) === 'turnering'; })) { headerRow = i; break; }
  }
  if (headerRow === -1) throw new Error('Fant ikke overskriftsraden (leter etter "Turnering" i de 10 øverste radene)');

  const header = values[headerRow].map(function (c) { return String(c).trim(); });
  const col = {};
  COLS.forEach(function (name) {
    const idx = header.findIndex(function (h) { return norm_(h) === norm_(name); });
    if (idx !== -1) col[name] = idx;
  });
  const missing = REQUIRED_COLS.filter(function (name) { return col[name] === undefined; });
  if (missing.length) {
    throw new Error('Arket "' + sheet.getName() + '" mangler kolonnen(e) ' +
                    missing.map(function (m) { return '"' + m + '"'; }).join(', ') +
                    '. Overskrifter funnet: ' + header.filter(Boolean).join(', '));
  }

  return { sheet: sheet, values: values, header: header, headerRow: headerRow, col: col,
           rows: values.slice(headerRow + 1), formulas: formulas.slice(headerRow + 1) };
}

function readTable_(sheetName) {
  const t = locateTable_({ sheetName: sheetName || '' });
  const rows = [];
  t.rows.forEach(function (r, i) {
    if (isBlank_(r)) return;
    const o = { row: t.headerRow + 2 + i };
    COLS.forEach(function (name) {
      if (t.col[name] !== undefined) o[name] = fmtCell_(r[t.col[name]], name);
    });
    rows.push(o);
  });
  return { sheetName: t.sheet.getName(), headerRow: t.headerRow + 1, columns: t.header, rows: rows };
}

function isBlank_(r) { return r.every(function (c) { return String(c).trim() === ''; }); }

function fmtCell_(v, colName) {
  if (v instanceof Date) {
    if (colName === 'Tid') return Utilities.formatDate(v, CONFIG.TIMEZONE, 'HH:mm');
    return Utilities.formatDate(v, CONFIG.TIMEZONE, 'dd.MM.yyyy');
  }
  return String(v).trim();
}

function writeCell_(sheet, row, colIdx, value, colName, existing) {
  const range = sheet.getRange(row, colIdx + 1);
  if (existing instanceof Date) {
    if (colName === 'Tid') {
      const p = value.split(':');
      const d = new Date(existing.getTime());
      d.setHours(+p[0], +p[1], 0, 0);
      range.setValue(d);
      return;
    }
    const p = value.split('.');
    range.setValue(new Date(+p[2], +p[1] - 1, +p[0]));
    return;
  }
  range.setValue(value);
}

// ------------------------------------------------------------- SYNKPLAN ----

function buildPlan_(profile) {
  const settings = profile || loadProfiles_()[0];
  const t = locateTable_(settings);
  const fixtures = fetchFixtures_(settings);

  const byKey = {};
  fixtures.forEach(function (f) { byKey[f.key] = f; });

  const updates = [], additions = [], missingFromFeed = [];
  const localMoves = [], resolved = [], conflicts = [], nameChanges = [];
  const taken = {};
  const today = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd');

  // Runde 1: match på turnering + lagnavn.
  const pending = [];
  t.rows.forEach(function (r, i) {
    if (isBlank_(r)) return;
    const row = { idx: i, rowNum: t.headerRow + 2 + i, cells: r };
    const cell = function (name) {
      return t.col[name] === undefined ? '' : fmtCell_(r[t.col[name]], name);
    };
    row.serie = cell('Turnering');
    row.home = cell('Hjemmelag');
    row.away = cell('Bortelag');
    row.dato = cell('Dato');
    row.nyDato = cell('Ny dato');        // tom når kolonnen ikke finnes
    row.label = (row.nyDato || row.dato) + ' ' + row.home + ' - ' + row.away + ' (' + row.serie + ')';
    row.key = matchKey_(row.serie, row.home, row.away);

    const f = byKey[row.key];
    if (f && !taken[f.key]) { taken[f.key] = true; row.fixture = f; }
    pending.push(row);
  });

  // Runde 2: rader uten navnetreff prøves på turnering + Dato. Fanger opp at
  // en klubb har byttet navn hos fotball.no siden forrige synk.
  pending.forEach(function (row) {
    if (row.fixture) return;
    const cands = fixtures.filter(function (f) {
      return !taken[f.key] && norm_(f.serie) === norm_(row.serie) && f.dato === row.dato;
    });
    if (cands.length === 1) { taken[cands[0].key] = true; row.fixture = cands[0]; row.matchedOnDate = true; }
  });

  pending.forEach(function (row) {
    const f = row.fixture;
    if (!f) {
      if (isoOf_(row.nyDato || row.dato) >= today) missingFromFeed.push({ row: row.rowNum, label: row.label });
      return;
    }

    const agreed = row.nyDato !== '' && row.nyDato !== row.dato;
    const want = {
      'Dato': f.dato, 'Tid': f.tid, 'Bane': f.bane,
      'Hjemmelag': f.homeLong, 'Bortelag': f.awayLong
    };
    if (!agreed) { want['Ny dato'] = f.dato; want['Dag'] = f.dag; }

    if (norm_(row.home) !== norm_(f.homeLong)) nameChanges.push({ row: row.rowNum, from: row.home, to: f.homeLong });
    if (norm_(row.away) !== norm_(f.awayLong)) nameChanges.push({ row: row.rowNum, from: row.away, to: f.awayLong });

    const changes = [];
    Object.keys(want).forEach(function (name) {
      if (t.col[name] === undefined) return;
      const nxt = want[name];
      if (nxt === '' || nxt === null || nxt === undefined) return;
      if (name === 'Ny dato' && t.formulas[row.idx] && t.formulas[row.idx][t.col[name]]) return;
      const cur = fmtCell_(row.cells[t.col[name]], name);
      if (norm_(cur) !== norm_(nxt)) changes.push({ column: name, from: cur, to: nxt });
    });
    if (changes.length) updates.push({ row: row.rowNum, key: f.key, label: row.label, changes: changes });

    if (agreed) {
      const entry = { row: row.rowNum, key: f.key, label: row.label, avtalt: row.nyDato, fotballno: f.dato };
      if (f.dato === row.nyDato) resolved.push(entry);
      else if (f.dato !== row.dato) conflicts.push(entry);
      else localMoves.push(entry);
    }
  });

  fixtures.forEach(function (f) {
    if (taken[f.key]) return;
    additions.push({
      key: f.key, serie: f.serie, dato: f.dato, dag: f.dag, tid: f.tid, bane: f.bane,
      home: f.homeLong, away: f.awayLong,
      label: f.dato + ' ' + f.tid + ' ' + f.homeLong + ' - ' + f.awayLong + ' (' + f.serie + ')'
    });
  });

  // Sikring mot å dublere hele terminlisten. Faren er ikke at det kommer mange
  // nye kamper — det gjør det når et ark fylles for første gang, eller når et
  // lag melder seg på en ny serie. Faren er at radene som ALLEREDE står der
  // ikke ble kjent igjen, for da legges de inn på nytt ved siden av seg selv.
  //
  // Derfor ser vi på hvor stor andel av de eksisterende radene som fant kampen
  // sin. Et tomt ark har ingen rader å miste og utløser aldri sperren.
  const existingRows = pending.length;
  const matchedRows = pending.filter(function (p) { return p.fixture; }).length;
  const ceiling = Math.max(3, Math.round(0.25 * fixtures.length));
  const suspect = additions.length > ceiling && existingRows > 0 && matchedRows * 2 < existingRows;

  return {
    generatedAt: Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'dd.MM.yyyy HH:mm'),
    sheetName: t.sheet.getName(),
    notifyEmail: settings.notifyEmail,
    feedCount: fixtures.length,
    teams: settings.teams,
    sortAfterSync: settings.sortAfterSync,
    updates: updates,
    additions: additions,
    nameChanges: nameChanges,
    missingFromFeed: missingFromFeed,
    localMoves: localMoves,
    resolved: resolved,
    conflicts: conflicts,
    suspect: suspect,
    existingRows: existingRows,
    matchedRows: matchedRows,
    suspectReason: suspect
      ? 'Bare ' + matchedRows + ' av ' + existingRows + ' rader som allerede står i arket ble kjent ' +
        'igjen i strømmen, samtidig som ' + additions.length + ' kamper vil legges til. Det ser ut som ' +
        'gjenkjenningen har sviktet — da ville radene blitt lagt inn på nytt ved siden av seg selv. ' +
        'Sjekk "Lag" i arket "' + CONFIG.CONFIG_SHEET + '" før du kjører videre.'
      : null
  };
}

function filterPlan_(plan, only, exclude) {
  const has = function (arr) { return Array.isArray(arr) && arr.length > 0; };
  if (!has(only) && !has(exclude)) { plan.skipped = []; return plan; }
  const keep = has(only)
    ? function (k) { return only.indexOf(k) !== -1; }
    : function (k) { return exclude.indexOf(k) === -1; };
  const skipped = [];
  const sift = function (list) {
    return list.filter(function (item) {
      if (keep(item.key)) return true;
      skipped.push({ key: item.key, label: item.label });
      return false;
    });
  };
  plan.updates = sift(plan.updates);
  plan.additions = sift(plan.additions);
  plan.skipped = skipped;
  return plan;
}

function applyPlan_(plan) {
  const t = locateTable_({ sheetName: plan.sheetName });
  const warnings = [];
  let cellsWritten = 0;

  plan.updates.forEach(function (u) {
    const rowVals = t.values[u.row - 1];
    u.changes.forEach(function (c) {
      const idx = t.col[c.column];
      if (idx === undefined) { warnings.push('Ukjent kolonne ' + c.column); return; }
      writeCell_(t.sheet, u.row, idx, c.to, c.column, rowVals[idx]);
      cellsWritten++;
    });
  });

  let rowsAdded = 0;
  const additionsHeld = plan.suspect && !plan.forceAdditions && plan.additions.length > 0;
  if (additionsHeld) {
    warnings.push(plan.suspectReason);
  } else if (plan.additions.length) {
    const width = t.header.length;
    const newRows = plan.additions.map(function (a) {
      const row = new Array(width).fill('');
      const put = function (name, val) { if (t.col[name] !== undefined) row[t.col[name]] = val; };
      put('Kommentar', 'NY');
      put('Dato', a.dato); put('Ny dato', a.dato); put('Dag', a.dag); put('Tid', a.tid);
      put('Hjemmelag', a.home); put('Bortelag', a.away);
      put('Bane', a.bane); put('Turnering', a.serie);
      return row;
    });
    t.sheet.getRange(t.sheet.getLastRow() + 1, 1, newRows.length, width).setValues(newRows);
    rowsAdded = newRows.length;
  }

  let sort = { sorted: false, reason: 'ikke bedt om' };
  if (plan.sortAfterSync && (cellsWritten || rowsAdded)) {
    // Ny tabellstruktur etter innsetting, så les den om igjen før sortering.
    sort = sortByDato_(locateTable_({ sheetName: plan.sheetName }));
    if (!sort.sorted && sort.reason) warnings.push('Sorterte ikke: ' + sort.reason);
  }

  return {
    cellsWritten: cellsWritten,
    rowsUpdated: plan.updates.length,
    rowsAdded: rowsAdded,
    additionsHeld: additionsHeld,
    missingFromFeed: plan.missingFromFeed,
    sort: sort,
    warnings: warnings
  };
}

/**
 * Sorterer terminlisten stigende på Dato.
 *
 * To veier, og valget er ikke kosmetisk. Er Dato-kolonnen ekte datoverdier,
 * sorterer arket selv — da følger formler, formatering og alt annet med.
 * Er de tekst ("03.09.2026"), ville arket sortert alfabetisk og lagt 13.10
 * foran 03.09, så da parser vi datoene og skriver radene tilbake i riktig
 * rekkefølge.
 *
 * Den andre veien flytter verdier, ikke formler. Finnes det formler i området,
 * står vi over og sier fra i stedet for å gjøre dem om til fastverdier.
 */
function sortByDato_(t) {
  const first = t.headerRow + 2;
  const rowCount = t.sheet.getLastRow() - first + 1;
  if (rowCount < 2) return { sorted: false, reason: 'for få rader til å sortere' };

  const width = t.sheet.getLastColumn();
  const range = t.sheet.getRange(first, 1, rowCount, width);
  const datoIdx = t.col['Dato'];

  const datoVals = t.sheet.getRange(first, datoIdx + 1, rowCount, 1).getValues();
  const filled = datoVals.filter(function (v) { return String(v[0]).trim() !== ''; });
  if (!filled.length) return { sorted: false, reason: 'ingen datoer å sortere på' };

  if (filled.every(function (v) { return v[0] instanceof Date; })) {
    range.sort({ column: datoIdx + 1, ascending: true });
    return { sorted: true, how: 'arkets egen sortering' };
  }

  if (range.getFormulas().some(function (r) { return r.some(function (c) { return c; }); })) {
    return { sorted: false, reason: 'Dato er tekst og det finnes formler i tabellen — sorterte ikke, for å ikke gjøre formlene om til fastverdier' };
  }

  const rows = range.getValues();
  const live = rows.filter(function (r) { return !isBlank_(r); });
  const blanks = rows.filter(isBlank_);
  live.sort(function (a, b) {
    const x = isoOf_(fmtCell_(a[datoIdx], 'Dato')), y = isoOf_(fmtCell_(b[datoIdx], 'Dato'));
    return x < y ? -1 : x > y ? 1 : 0;
  });
  range.setValues(live.concat(blanks));
  return { sorted: true, how: 'sortert av skriptet (Dato er tekst)' };
}

// ------------------------------------------------------------- FRAMSTILLING -

function renderPlan_(plan) {
  const L = ['TERMINLISTE: ' + plan.sheetName, ''];
  if (plan.suspect) {
    L.push('!! ADVARSEL');
    L.push('   ' + plan.suspectReason);
    L.push('   Nye rader holdes tilbake. Endringer på eksisterende rader skrives som vanlig.');
    L.push('');
  }
  if (plan.conflicts.length) {
    L.push('KOLLIDERER MED LOKAL AVTALE — må avklares');
    plan.conflicts.forEach(function (c) {
      L.push('  ' + c.label);
      L.push('     dere har avtalt ' + c.avtalt + ', fotball.no har flyttet til ' + c.fotballno);
    });
    L.push('');
  }
  if (plan.updates.length) {
    L.push('ENDRINGER (' + plan.updates.length + ')');
    plan.updates.forEach(function (u) {
      L.push('  rad ' + u.row + '  ' + u.label);
      u.changes.forEach(function (c) {
        if (c.column === 'Hjemmelag' || c.column === 'Bortelag') return;  // vises samlet nedenfor
        L.push('     ' + c.column + ': ' + c.from + '  ->  ' + c.to);
      });
    });
    L.push('');
  }
  if (plan.nameChanges.length) {
    L.push('LAGNAVN JUSTERT TIL FOTBALL.NO SIN SKRIVEMÅTE (' + plan.nameChanges.length + ')');
    plan.nameChanges.slice(0, 8).forEach(function (n) {
      L.push('  rad ' + n.row + '  ' + n.from + '  ->  ' + n.to);
    });
    if (plan.nameChanges.length > 8) L.push('  ... og ' + (plan.nameChanges.length - 8) + ' til');
    L.push('');
  }
  if (plan.additions.length) {
    L.push('NYE KAMPER (' + plan.additions.length + ')' + (plan.suspect ? ' — HOLDES TILBAKE' : ''));
    plan.additions.forEach(function (a) { L.push('  ' + a.label); });
    L.push('');
  }
  if (plan.resolved.length) {
    L.push('FOTBALL.NO HAR NÅ REGISTRERT AVTALEN');
    plan.resolved.forEach(function (c) { L.push('  ' + c.label + ' -> ' + c.avtalt); });
    L.push('');
  }
  if (plan.localMoves.length) {
    L.push('LOKALE AVTALER SOM STÅR (' + plan.localMoves.length + ') — ikke rørt');
    plan.localMoves.forEach(function (c) { L.push('  ' + c.label + '  (fotball.no: ' + c.fotballno + ')'); });
    L.push('');
  }
  if (plan.missingFromFeed.length) {
    L.push('IKKE I KALENDEREN (' + plan.missingFromFeed.length + ') — normalt for ferdigspilte kamper,');
    L.push('som faller ut av strømmen. Sjekk de som ligger fram i tid:');
    plan.missingFromFeed.forEach(function (m) { L.push('  rad ' + m.row + '  ' + m.label); });
    L.push('');
  }
  if (L.length === 2) L.push('Ingen endringer. Arket er i takt med fotball.no (' + plan.feedCount + ' kamper).');
  L.push('');
  L.push('Lag som følges (arket "' + CONFIG.CONFIG_SHEET + '"): ' + (plan.teams || []).join(', '));
  return L.join('\n');
}

// ------------------------------------------------------- NAVNENORMALISERING -

const CLUB_WORDS = ['il', 'if', 'sk', 'fk', 'bk', 'ik', 'fc', 'sf', 'tf', 'ail',
                    'fotballklubb', 'ballklubb', 'idrettslag', 'sportsklubb', 'idrettsforening'];

/**
 * Reduserer et lagnavn til det som faktisk identifiserer laget. Brukes bare til
 * sammenlikning — det som skrives i arket er fotball.no sin egen skrivemåte.
 */
function shortenName_(longName) {
  let s = String(longName).replace(/\s+/g, ' ').trim();
  let teamNo = null;
  const m = s.match(/\s+[GJ]\d+-(\d+)$/i);
  if (m) { teamNo = Number(m[1]); s = s.slice(0, m.index).trim(); }

  s = s.split('/').map(function (part) {
    return part.split(' ').filter(function (w) {
      return CLUB_WORDS.indexOf(w.replace(/\./g, '').toLowerCase()) === -1;
    }).join(' ').trim();
  }).filter(Boolean).join('/');

  if (teamNo && teamNo > 1) s += ' ' + teamNo;
  return s.replace(/\s+/g, ' ').trim();
}

function canonKey_(name) { return norm_(shortenName_(name)); }

// ------------------------------------------------------------- HJELPERE ----

function norm_(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
}

function isoOf_(ddmmyyyy) {
  const m = String(ddmmyyyy).match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return m ? m[3] + '-' + m[2] + '-' + m[1] : '0000-00-00';
}
