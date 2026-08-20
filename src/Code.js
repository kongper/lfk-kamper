/**
 * LFK kamper — fixture sync fra fotball.no
 * ------------------------------------------
 * Henter Lillehammer FK sin offisielle kalenderstrøm (iCal) fra fotball.no,
 * filtrerer ned til lagene du følger, og oppdaterer regnearket.
 *
 * KOLONNER
 *
 * Påkrevd: Dato, Hjemmelag, Bortelag, Turnering — de tre siste kjenner igjen
 * raden, Dato fester kampen i tid. Dag, Tid, Bane og Kommentar er valgfrie, og
 * en kolonne som ikke finnes blir hverken lest eller skrevet.
 *
 *   Dato, Dag, Tid, Bane   følger alltid fotball.no.
 *   Hjemmelag, Bortelag    skrives med fotball.no sin egen skrivemåte, ordrett
 *                          ("Nordre Land IL/Torpa IL G15-2").
 *   Kommentar              røres aldri. Dette er din kolonne — her fører du
 *                          avtalte flyttinger og alt annet synken ikke skal
 *                          bry seg med.
 *
 * En celle som inneholder en formel blir aldri overskrevet, uansett kolonne.
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
    'Sorter etter dato': ['ja'],
    'Formater rader': ['alle']
  }
};

function feedUrl_(clubId) {
  return 'https://www.fotball.no/footballapi/Calendar/GetCalendarForClub?clubId=' + clubId;
}

const COLS = ['Kommentar', 'Dato', 'Dag', 'Tid', 'Hjemmelag', 'Bortelag', 'Bane', 'Turnering'];
// Bare det som trengs for å kjenne igjen en rad og feste en dato på den.
// Alt annet — Dag, Tid, Bane, Kommentar — er valgfritt, og en kolonne som ikke
// finnes blir hverken lest eller skrevet.
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
    const prof = buildProfile_(norm_(header[c]) === 'verdi' ? '' : header[c], raw);
    // Hvor Lag-cellene står, så formatet deres kan leses senere.
    prof.teamCells = [];
    for (var r2 = 1; r2 < values.length; r2++) {
      if (norm_(values[r2][0]) !== 'lag') continue;
      const v = String(values[r2][c]).trim();
      if (v) prof.teamCells.push({ team: v, row: r2 + 1, col: c + 1 });
    }
    profiles.push(prof);
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
    sortAfterSync: /^(ja|yes|true|1)$/i.test((pick('Sorter etter dato') || ['ja'])[0]),
    formatMode: norm_((pick('Formater rader') || ['alle'])[0])
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

// ------------------------------------------------------------- MENY I ARKET -
// Menyfunksjoner kan ikke ha understrek til slutt — Apps Script regner slike
// navn som private og nekter å kalle dem fra en meny.

function onOpen() {
  // Ingen egen forhåndsvisning: "Kjør synk" viser planen og spør først, så et
  // eget menyvalg ville vært samme handling med "nei" som svar.
  SpreadsheetApp.getUi().createMenu('LFK kamper')
    .addItem('Kjør synk', 'menuApply')
    .addItem('Oppdater formatering', 'menuFormat')
    .addToUi();
}

function menuApply() {
  const plans = buildPlans_();
  const pending = plans.filter(function (p) { return p.updates.length + p.additions.length; });
  const body = plans.map(renderPlan_).join('\n\n' + '='.repeat(60) + '\n\n');

  // Ingen kampendringer: vis rapporten og oppdater formateringen likevel, for
  // det er ofte nettopp den man er ute etter når man kjører synken på nytt.
  if (!pending.length) {
    const fmt = loadProfiles_().map(function (prof) {
      const res = applyRowFormats_(locateTable_(prof), prof);
      return prof.sheetName + ': ' + res.formatted + ' rader formatert';
    });
    showText_('Synk', body + '\n\n---\nIngen kampendringer. Formatering oppdatert:\n' + fmt.join('\n'));
    return;
  }

  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Kjør synk?', body + '\n\nSkrive dette til arkene?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  const lines = pending.map(function (plan) {
    const res = applyPlan_(plan);
    return [plan.sheetName + ':',
            '  Rader oppdatert: ' + res.rowsUpdated + ', lagt til: ' + res.rowsAdded,
            res.sort && res.sort.sorted ? '  Sortert på Dato (' + res.sort.how + ')' : '',
            res.format && res.format.formatted ? '  Formatert: ' + res.format.formatted + ' rader' : '',
            res.additionsHeld ? '  NYE RADER HOLDT TILBAKE — se advarselen i forhåndsvisningen.' : '',
            res.warnings.length ? '  Advarsler:\n   - ' + res.warnings.join('\n   - ') : ''
           ].filter(Boolean).join('\n');
  });
  showText_('Synk fullført', lines.join('\n\n'));
}

function menuFormat() {
  const lines = loadProfiles_().map(function (prof) {
    const res = applyRowFormats_(locateTable_(prof), prof);
    return prof.sheetName + ': ' + (res.teams
      ? res.formatted + ' rader formatert etter ' + res.teams + ' lag (' + res.mode + ')'
      : res.mode === 'markerte'
        ? 'ingen Lag-celler er markert — sett "Formater rader" til "alle" hvis du bare har ramme'
        : 'formatering er slått av ("Formater rader" = nei)');
  });
  showText_('Oppdater formatering', lines.join('\n') + '\n\n' +
    'Formatet hentes fra Lag-cellene i arket "' + CONFIG.CONFIG_SHEET + '".\n' +
    'Gi cellen bakgrunn, tekstfarge, ramme, fet, kursiv eller understrek — så\n' +
    'følger radene til det laget etter. Datokolonnene beholder sine egne farger\n' +
    'og tallformat, men får rammen.');
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
      case 'format': return json_({ ok: true, action: 'format', results: loadProfiles_()
        .filter(function (p) { return !body.sheet || norm_(p.sheetName) === norm_(body.sheet); })
        .map(function (p) { return { sheet: p.sheetName, result: applyRowFormats_(locateTable_(p), p) }; }) });
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
    const notable = plan.updates.length + plan.additions.length + plan.missingFromFeed.length;
    if (notable === 0) {
      // Rolig natt for kampene, men config kan ha fått en ny farge.
      const prof = loadProfiles_().filter(function (p) { return norm_(p.sheetName) === norm_(plan.sheetName); })[0];
      if (prof) applyRowFormats_(locateTable_(prof), prof);
      return;
    }

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

// ------------------------------------------------------------ FORMATERING --

// Egenskapene som leses for å avgjøre om en Lag-celle er markert, og som
// datokolonnene får tilbake etterpå. Rammer står ikke på lista: Apps Script
// kan sette dem, men ikke lese dem, så en celle som BARE har ramme og ingen
// annen markering blir ikke oppdaget. Gi cellen en farge også.
const CELL_PROPS = [
  { one: 'getBackground',          many: 'getBackgrounds',          set: 'setBackgrounds',          blank: '#ffffff' },
  { one: 'getFontColor',           many: 'getFontColors',           set: 'setFontColors',           blank: '#000000' },
  { one: 'getFontWeight',          many: 'getFontWeights',          set: 'setFontWeights',          blank: 'normal' },
  { one: 'getFontStyle',           many: 'getFontStyles',           set: 'setFontStyles',           blank: 'normal' },
  { one: 'getFontLine',            many: 'getFontLines',            set: 'setFontLines',            blank: 'none' },
  { one: 'getFontFamily',          many: 'getFontFamilies',         set: 'setFontFamilies',         blank: null },
  { one: 'getFontSize',            many: 'getFontSizes',            set: 'setFontSizes',            blank: null },
  { one: 'getHorizontalAlignment', many: 'getHorizontalAlignments', set: 'setHorizontalAlignments', blank: null }
];

/**
 * Finner Lag-cellene som skal styre utseendet på radene.
 *
 * "Formater rader" i config avgjør hvilke som teller:
 *
 *   alle      (standard) — hver Lag-celle styrer radene sine, også de som ser
 *               umarkerte ut. Dette er den eneste innstillingen der en ramme
 *               alltid følger med, siden Apps Script ikke kan lese rammer og
 *               en celle med bare ramme ellers ville sett tom ut. Prisen er at
 *               config bestemmer alt: formatering du har gjort direkte i
 *               radene blir overskrevet ved neste synk.
 *   markerte  — bare celler som har en synlig markering (farge, fet, kursiv,
 *               understrek, skrift eller justering). Rader for lag med en
 *               umarkert celle får stå som de er. Trygt hvis du farger rader
 *               for hånd, men da virker ikke ramme-alene.
 *   nei       — ingen formatering i det hele tatt.
 */
function loadTeamFormats_(profile) {
  const mode = profile.formatMode || 'alle';
  if (mode === 'nei' || mode === 'no' || mode === 'av') return [];

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.CONFIG_SHEET);
  if (!sheet || !profile.teamCells || !profile.teamCells.length) return [];

  const base = {};
  CELL_PROPS.forEach(function (p) { if (p.blank !== null) base[p.one] = p.blank; });

  return profile.teamCells.map(function (tc) {
    const cell = sheet.getRange(tc.row, tc.col);
    const marked = Object.keys(base).some(function (getter) {
      return norm_(cell[getter]()) !== norm_(base[getter]);
    });
    return { team: tc.team, prefix: norm_(tc.team), cell: cell, marked: marked };
  }).filter(function (x) { return mode === 'markerte' ? x.marked : true; });
}

/**
 * Gir hver rad formatet til laget sitt, ramme inkludert.
 *
 * Kopieringen går via arkets egen "lim inn bare format", som er den eneste
 * veien som tar med rammer — Apps Script har ingen leser for dem. Den tar
 * samtidig med seg tallformat, og det ville gjort datoer og klokkeslett om til
 * tall. Derfor tas et bilde av tallformatene først og legges tilbake etterpå.
 *
 * Rammen skal gå rundt hele raden, så kopien treffer alle kolonner. Deretter
 * får datokolonnene og Kommentar tilbake sitt eget utseende — farger, skrift og
 * justering — mens rammen blir stående.
 *
 * Rader som ikke treffer noe lag røres ikke i det hele tatt.
 */
function applyRowFormats_(t, profile) {
  const formats = loadTeamFormats_(profile);
  if (!formats.length) return { formatted: 0, teams: 0, mode: profile.formatMode || 'alle' };

  const first = t.headerRow + 2;
  const rowCount = t.sheet.getLastRow() - first + 1;

  // Bredden er tabellens, ikke arkets. getLastColumn() strekker seg til siste
  // celle med innhold hvor som helst i arket, så en løsrevet notat-kolonne ute
  // til høyre ville fått lagets farger den også. Overskriftsraden definerer
  // tabellen — siste utfylte overskrift er siste kolonne.
  const width = t.header.reduce(function (n, h, i) {
    return String(h).trim() ? i + 1 : n;
  }, 0);
  if (rowCount < 1 || width < 1) return { formatted: 0, teams: formats.length, mode: profile.formatMode || 'alle' };

  // Datoene har sitt eget tallformat, og Kommentar er din kolonne — begge
  // beholder sitt utseende. De får rammen, men ikke lagets farger.
  const keepCols = ['Dato', 'Ny dato', 'Kommentar']
    .map(function (n) { return t.col[n]; })
    .filter(function (c) { return c !== undefined; });

  const whole = t.sheet.getRange(first, 1, rowCount, width);
  const numberFormats = whole.getNumberFormats();
  const keepSnaps = keepCols.map(function (c) {
    const r = t.sheet.getRange(first, c + 1, rowCount, 1);
    return { col: c, range: r, props: CELL_PROPS.map(function (p) { return r[p.many](); }) };
  });

  let touched = 0;
  for (var i = 0; i < rowCount; i++) {
    const r = t.values[first - 1 + i];
    if (!r || isBlank_(r)) continue;
    const home = norm_(t.col['Hjemmelag'] !== undefined ? r[t.col['Hjemmelag']] : '');
    const away = norm_(t.col['Bortelag'] !== undefined ? r[t.col['Bortelag']] : '');
    const hit = formats.find(function (f) {
      return home.indexOf(f.prefix) === 0 || away.indexOf(f.prefix) === 0;
    });
    if (!hit) continue;
    hit.cell.copyFormatToRange(t.sheet, 1, width, first + i, first + i);
    touched++;
  }

  if (touched) {
    whole.setNumberFormats(numberFormats);
    keepSnaps.forEach(function (snap) {
      CELL_PROPS.forEach(function (p, pi) { snap.range[p.set](snap.props[pi]); });
    });
  }
  return { formatted: touched, teams: formats.length, mode: profile.formatMode || 'alle' };
}

// ------------------------------------------------------------- SYNKPLAN ----

function buildPlan_(profile) {
  const settings = profile || loadProfiles_()[0];
  const t = locateTable_(settings);
  const fixtures = fetchFixtures_(settings);

  const byKey = {};
  fixtures.forEach(function (f) { byKey[f.key] = f; });

  // "Lag" i config er prefikser. Rapporten skal vise lagene de faktisk traff —
  // "Lillehammer Kv" sier lite, "Lillehammer Kvinner 1, Lillehammer Kvinner 2"
  // sier hva synken jobber med. Et prefiks uten treff nevnes for seg: det er
  // nesten alltid et lag som har byttet navn eller ikke har kamper igjen.
  const resolved = {}, hitPrefix = {};
  fixtures.forEach(function (f) {
    [f.homeLong, f.awayLong].forEach(function (n) {
      const nn = norm_(n);
      settings.teams.forEach(function (pfx) {
        if (nn.indexOf(norm_(pfx)) !== 0) return;
        resolved[n] = true;
        hitPrefix[pfx] = true;
      });
    });
  });
  const teamsResolved = Object.keys(resolved).sort();
  const teamsWithoutMatch = settings.teams.filter(function (pfx) { return !hitPrefix[pfx]; });

  const updates = [], additions = [], missingFromFeed = [], nameChanges = [];
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
    row.label = row.dato + ' ' + row.home + ' - ' + row.away + ' (' + row.serie + ')';
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
      if (isoOf_(row.dato) >= today) missingFromFeed.push({ row: row.rowNum, label: row.label });
      return;
    }

    const want = {
      'Dato': f.dato, 'Dag': f.dag, 'Tid': f.tid, 'Bane': f.bane,
      'Hjemmelag': f.homeLong, 'Bortelag': f.awayLong
    };

    if (norm_(row.home) !== norm_(f.homeLong)) nameChanges.push({ row: row.rowNum, from: row.home, to: f.homeLong });
    if (norm_(row.away) !== norm_(f.awayLong)) nameChanges.push({ row: row.rowNum, from: row.away, to: f.awayLong });

    const changes = [];
    Object.keys(want).forEach(function (name) {
      if (t.col[name] === undefined) return;
      const nxt = want[name];
      if (nxt === '' || nxt === null || nxt === undefined) return;
      // En formel er alltid noens bevisste valg — la den stå.
      if (t.formulas[row.idx] && t.formulas[row.idx][t.col[name]]) return;
      const cur = fmtCell_(row.cells[t.col[name]], name);
      if (norm_(cur) !== norm_(nxt)) changes.push({ column: name, from: cur, to: nxt });
    });
    if (changes.length) updates.push({ row: row.rowNum, key: f.key, label: row.label, changes: changes });
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
    teams: teamsResolved.length ? teamsResolved : settings.teams,
    teamFilter: settings.teams,
    teamsWithoutMatch: teamsWithoutMatch,
    sortAfterSync: settings.sortAfterSync,
    updates: updates,
    additions: additions,
    nameChanges: nameChanges,
    missingFromFeed: missingFromFeed,
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
      put('Dato', a.dato); put('Dag', a.dag); put('Tid', a.tid);
      put('Hjemmelag', a.home); put('Bortelag', a.away);
      put('Bane', a.bane); put('Turnering', a.serie);
      return row;
    });
    t.sheet.getRange(t.sheet.getLastRow() + 1, 1, newRows.length, width).setValues(newRows);
    rowsAdded = newRows.length;
  }

  // Sortering har bare noe å gjøre når noe er skrevet.
  let sort = { sorted: false, reason: 'ingenting skrevet' };
  if ((cellsWritten || rowsAdded) && plan.sortAfterSync) {
    // Ny tabellstruktur etter innsetting, så les den om igjen før sortering.
    sort = sortByDato_(locateTable_({ sheetName: plan.sheetName }));
    if (!sort.sorted && sort.reason) warnings.push('Sorterte ikke: ' + sort.reason);
  }

  // Formateringen kjøres uansett. Den henger ikke på om en dato har flyttet
  // seg — du kan ha endret en farge i config, og da skal radene følge etter.
  // Etter sortering, siden radene kan ha byttet plass.
  const prof = loadProfiles_().filter(function (p) { return norm_(p.sheetName) === norm_(plan.sheetName); })[0];
  const format = prof ? applyRowFormats_(locateTable_({ sheetName: plan.sheetName }), prof)
                      : { formatted: 0, teams: 0 };

  return {
    cellsWritten: cellsWritten,
    rowsUpdated: plan.updates.length,
    rowsAdded: rowsAdded,
    additionsHeld: additionsHeld,
    missingFromFeed: plan.missingFromFeed,
    sort: sort,
    format: format,
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

/**
 * Rapporten. Én linje per rad som endrer seg.
 *
 * Lagnavn står ikke i sin egen bolk lenger — en rad der bare navnet er rettet
 * ble to oppslag om samme sak. Når alle endringene på raden er navn, er
 * "fra -> til" hele historien og kampen nevnes ikke, for da ville det nye
 * navnet stått to ganger. Ellers navngis kampen, fordi et radnummer alene ikke
 * sier hvilken kamp som har flyttet seg.
 */
function renderPlan_(plan) {
  const L = ['TERMINLISTE: ' + plan.sheetName +
             ' (Lag: ' + (plan.teams || []).join(', ') + ')', ''];

  if ((plan.teamsWithoutMatch || []).length) {
    L.push('UTEN TREFF I KALENDEREN: ' + plan.teamsWithoutMatch.join(', '));
    L.push('');
  }

  if (plan.suspect) {
    L.push('!! ' + plan.suspectReason);
    L.push('   Nye rader holdes tilbake. Endringer på eksisterende rader skrives som vanlig.');
    L.push('');
  }

  if (plan.updates.length) {
    L.push('ENDRINGER (' + plan.updates.length + ')');
    plan.updates.forEach(function (u) {
      const bits = u.changes.map(function (c) { return c.from + ' -> ' + c.to; }).join(', ');
      const onlyNames = u.changes.every(function (c) {
        return c.column === 'Hjemmelag' || c.column === 'Bortelag';
      });
      if (onlyNames) {
        L.push('rad ' + u.row + ' ' + bits);
      } else {
        const home = pick_(u.changes, 'Hjemmelag') || pick0_(u.label, 0);
        const away = pick_(u.changes, 'Bortelag') || pick0_(u.label, 1);
        L.push('rad ' + u.row + ' ' + home + ' - ' + away + ': ' + bits);
      }
    });
    L.push('');
  }

  if (plan.additions.length) {
    L.push('NYE KAMPER (' + plan.additions.length + ')' + (plan.suspect ? ' — HOLDES TILBAKE' : ''));
    plan.additions.forEach(function (a) { L.push(a.label); });
    L.push('');
  }

  if (plan.missingFromFeed.length) {
    L.push('IKKE I KALENDEREN (' + plan.missingFromFeed.length + ') — sjekk de som ligger fram i tid');
    plan.missingFromFeed.forEach(function (m) { L.push('rad ' + m.row + ' ' + m.label); });
    L.push('');
  }

  if (!plan.updates.length && !plan.additions.length && !plan.missingFromFeed.length && !plan.suspect) {
    L.push('Ingen endringer. I takt med fotball.no (' + plan.feedCount + ' kamper).');
  }
  return L.join('\n').replace(/\n+$/, '');
}

/** Den nye verdien for en kolonne, hvis den er blant endringene. */
function pick_(changes, column) {
  const hit = changes.find(function (c) { return c.column === column; });
  return hit ? hit.to : null;
}

/** Lagnavnene slik de står i etiketten "dd.MM.yyyy Hjemme - Borte (Serie)". */
function pick0_(label, which) {
  const m = String(label).match(/^\S+\s+(.*?)\s+\((?:[^()]*)\)\s*$/);
  const teams = m ? m[1].split(' - ') : [];
  return (teams[which] || '').trim();
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
