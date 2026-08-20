/**
 * Probe.js — finn ut hvor fotball.no gjemmer spilte kamper og resultater.
 *
 * DETTE SKRIPTET RØRER IKKE ARKET. Det finnes ikke ett eneste
 * SpreadsheetApp-kall i fila. Alt det gjør er å hente sider fra fotball.no
 * og skrive det den finner til utførelsesloggen (Vis > Logger / Kjøringer).
 *
 * Ligger i src/ ved siden av Code.js og følger med `clasp push` opp i
 * Apps Script-prosjektet som Probe.gs. Ingenting i Code.js endres, og ingen
 * funksjonsnavn kolliderer med den (sjekket mot alle globaler der). Fila er
 * ikke med i skill-pakken — tools/package-skill.sh kopierer bare Code.js.
 * Slett fila og push på nytt, så er sporet borte.
 *
 * Kjør i denne rekkefølgen fra rullegardinmenyen i skripteditoren:
 *
 *   1) probeDiscover()    — leser klubbsiden og lister opp hvilke
 *                           /footballapi/-adresser og lagsider den peker på.
 *                           Dette er den viktigste: den gjetter ingenting,
 *                           den leser hva fotball.no sin egen side kaller på.
 *   2) probeTeam(fiksId)  — lagsiden og alle undersidene den lenker til.
 *                           fiksId får du fra listen probeDiscover() skrev ut.
 *   3) probeExcel()       — Excel-kalenderen klubbsiden lenker til.
 *   4) probeCandidates()  — blindtest av noen sannsynlige API-adresser.
 *                           Bare for å se hvilke som svarer 200.
 *   5) probeUrl('...')    — full dump av én adresse. Bruk denne på det du
 *                           eventuelt finner i DevTools > Network selv.
 *
 * Kopier loggen tilbake til meg, så leser jeg formatet og sier hva som
 * faktisk lar seg bruke.
 */

const PROBE = {
  // Hardkodet med vilje: proben leser ikke config-arket, den rører ikke
  // regnearket i det hele tatt. Er klubben en annen, endrer du her.
  clubId: 1683,

  // Siden vi vet finnes — klubbens lagoversikt.
  clubPage: 'https://www.fotball.no/fotballdata/klubb/hjem/?fiksId=1683&underside=lag',

  headChars: 1500,   // hvor mye av svaret som logges
  pauseMs: 1200      // pause mellom hvert kall — vi maser ikke på serveren
};

// ------------------------------------------------------------------ 1. FUNN -

/**
 * Henter klubbsiden og lister opp alt den peker på som kan tenkes å gi
 * resultater: /footballapi/-kall i markup og skript, lagsider, turneringer.
 */
function probeDiscover() {
  const res = probeFetch_(PROBE.clubPage);
  logResponse_('KLUBBSIDE', PROBE.clubPage, res);
  if (res.code !== 200) return;

  logApiRefs_(res.body);
  logDataLinks_(res.body);

  Logger.log('\nNeste steg: velg en fiksId fra listen over og kjør probeTeam(<fiksId>).');
}

/**
 * Én lagside. fiksId er lagets, ikke klubbens — hentet fra listen
 * probeDiscover() skrev ut.
 *
 * Rettet etter første kjøring: lagsidene ligger på /fotballdata/lag/hjem/,
 * og undersider velges med &underside=… slik klubbsiden gjorde
 * (?fiksId=1683&underside=lag). Vi prøver hovedsiden først og lar den fortelle
 * oss hvilke undersider som finnes, i stedet for å gjette videre.
 */
function probeTeam(fiksId) {
  if (!fiksId) throw new Error('probeTeam trenger en fiksId, f.eks. probeTeam(136204)');

  const base = 'https://www.fotball.no/fotballdata/lag/hjem/?fiksId=' + fiksId;

  const first = probeFetch_(base);
  logResponse_('LAGSIDE', base, first);
  if (first.code !== 200) return;

  logApiRefs_(first.body);
  const sider = logUndersider_(first.body);
  logScoreHints_(first.body);

  // Prøv de undersidene siden selv lenker til, pluss de vi uansett er ute etter.
  const vil = uniq_(sider.concat(['kamper', 'terminliste', 'resultater', 'tabell']));
  Logger.log('=== PRØVER ' + vil.length + ' UNDERSIDER ===\n');

  vil.forEach(function (u) {
    Utilities.sleep(PROBE.pauseMs);
    const url = base + '&underside=' + u;
    const res = probeFetch_(url);
    Logger.log('--- underside=' + u + '  status ' + res.code + '  ' + res.len + ' tegn');
    if (res.code !== 200) return;
    logScoreHints_(res.body);
  });
}

/**
 * Turneringsside — terminlisten for én serie viser spilte kamper med resultat.
 * fiksId er turneringens. Samme underside-mønster som lagsiden.
 */
function probeTournament(fiksId) {
  if (!fiksId) throw new Error('probeTournament trenger turneringens fiksId');

  const base = 'https://www.fotball.no/fotballdata/turnering/hjem/?fiksId=' + fiksId;

  const first = probeFetch_(base);
  logResponse_('TURNERING', base, first);
  if (first.code !== 200) return;

  logApiRefs_(first.body);
  const sider = logUndersider_(first.body);
  logScoreHints_(first.body);

  uniq_(sider.concat(['terminliste', 'tabell'])).forEach(function (u) {
    Utilities.sleep(PROBE.pauseMs);
    const url = base + '&underside=' + u;
    const res = probeFetch_(url);
    Logger.log('--- underside=' + u + '  status ' + res.code + '  ' + res.len + ' tegn');
    if (res.code === 200) logScoreHints_(res.body);
  });
}

/**
 * Excel-kalenderen klubbsiden lenker til. Denne visste jeg ikke om, og den er
 * verdt et forsøk: et regneark kan bære kolonner som iCal ikke har plass til,
 * resultat inkludert.
 *
 * Svaret er binært (xlsx), så her logger vi bare type, størrelse, filnavn og
 * magiske byte — ingenting lagres noe sted.
 */
function probeExcel() {
  const urls = [
    'https://www.fotball.no/footballapi/Calendar/DownloadClubExcelCalendar?clubId=' + PROBE.clubId,
    'https://www.fotball.no/footballapi/Calendar/DownloadClubExcelCalendar?fiksId=' + PROBE.clubId,
    'https://www.fotball.no/footballapi/Calendar/DownloadClubExcelCalendar'
  ];

  Logger.log('=== EXCEL-KALENDER ===\n');
  urls.forEach(function (url) {
    let res;
    try {
      res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    } catch (e) {
      Logger.log('  FEIL  ' + shortUrl_(url) + '  ' + e);
      return;
    }

    const h = res.getHeaders();
    const type = (h['Content-Type'] || h['content-type'] || '?').split(';')[0];
    const navn = h['Content-Disposition'] || h['content-disposition'] || '';
    const bytes = res.getContent();
    const magi = bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4B
      ? 'PK — ekte zip/xlsx'
      : 'ikke xlsx';

    Logger.log(pad_(String(res.getResponseCode()), 4) + ' ' + pad_(type, 28) +
               pad_(String(bytes.length) + ' B', 12) + shortUrl_(url));
    if (navn) Logger.log('     ' + navn);
    Logger.log('     ' + magi);
    if (res.getResponseCode() !== 200) Logger.log('     ' + oneLine_(res.getContentText(), 200));
    Utilities.sleep(PROBE.pauseMs);
  });

  Logger.log('\nSvarer en av disse 200 med PK, sier du fra — da må fila åpnes for å se ' +
             'om den har en resultatkolonne, og det krever at vi lagrer den midlertidig ' +
             'i Drive. Det gjør jeg ikke uten at du sier ja.');
}

// ------------------------------------------------------------- 2. BLINDTEST -

/**
 * Gjettede API-adresser. Disse er IKKE dokumentert noe sted — de er formet
 * etter mønsteret til kalenderstrømmen vi allerede bruker. Forvent at de
 * fleste svarer 404. Vi ser bare etter hvilke som svarer 200 med JSON.
 */
function probeCandidates() {
  const c = PROBE.clubId;
  const candidates = [
    // den vi vet virker — referanse, så vi ser at nettet er åpent i det hele tatt
    'https://www.fotball.no/footballapi/Calendar/GetCalendarForClub?clubId=' + c,

    'https://www.fotball.no/footballapi/Calendar/GetCalendarForTeam?teamId=' + c,
    'https://www.fotball.no/footballapi/Club/GetMatches?clubId=' + c,
    'https://www.fotball.no/footballapi/Club/GetResults?clubId=' + c,
    'https://www.fotball.no/footballapi/Match/GetMatchesForClub?clubId=' + c,
    'https://www.fotball.no/footballapi/Team/GetMatches?teamId=' + c,
    'https://www.fotball.no/footballapi/Tournament/GetMatches?tournamentId=' + c,
    'https://www.fotball.no/footballapi/Tournament/GetTable?tournamentId=' + c
  ];

  Logger.log('=== BLINDTEST AV ' + candidates.length + ' ADRESSER ===\n');
  candidates.forEach(function (url) {
    const res = probeFetch_(url);
    const flag = res.code === 200 ? '  <-- SVARER' : '';
    Logger.log(pad_(String(res.code), 4) + ' ' + pad_(res.type, 28) +
               pad_(String(res.len), 8) + ' ' + shortUrl_(url) + flag);
    if (res.code === 200 && res.len > 0) Logger.log('       ' + oneLine_(res.body, 200));
    Utilities.sleep(PROBE.pauseMs);
  });
}

// -------------------------------------------------------------- 3. ÉN URL -

/**
 * Full dump av én adresse. Bruk denne på det du plukker opp i
 * DevTools > Network når du åpner en lagside i nettleseren.
 */
function probeUrl(url) {
  if (!url) throw new Error("probeUrl trenger en adresse, f.eks. probeUrl('https://...')");

  const res = probeFetch_(url);
  logResponse_('URL', url, res);
  if (res.code !== 200) return;

  if (looksJson_(res)) {
    logJsonShape_(res.body);
  } else {
    logApiRefs_(res.body);
    logScoreHints_(res.body);
  }

  Logger.log('\n--- første ' + PROBE.headChars + ' tegn ---\n' + res.body.slice(0, PROBE.headChars));
}

// ------------------------------------------------------------------ MOTOR -

function probeFetch_(url) {
  let res;
  try {
    res = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
      // Apps Script sender sin egen User-Agent uansett; vi later ikke som noe.
      headers: { 'Accept': 'application/json, text/html;q=0.9, */*;q=0.8' }
    });
  } catch (e) {
    return { code: -1, type: 'FEIL', len: 0, body: String(e) };
  }

  const body = res.getContentText('UTF-8');
  return {
    code: res.getResponseCode(),
    type: (res.getHeaders()['Content-Type'] || res.getHeaders()['content-type'] || '?').split(';')[0],
    len: body.length,
    body: body
  };
}

function logResponse_(label, url, res) {
  Logger.log('=== ' + label + ' ===');
  Logger.log(url);
  Logger.log('  status ' + res.code + '   type ' + res.type + '   ' + res.len + ' tegn');
  if (res.code === 403 || res.code === 429) {
    Logger.log('  >> fotball.no avviser kallet. Da er ikke dette veien.');
  }
  if (res.code !== 200) Logger.log('  ' + oneLine_(res.body, 300));
  Logger.log('');
}

/** Alle /footballapi/-referanser i markup og innebygde skript. */
function logApiRefs_(html) {
  const hits = uniq_(html.match(/\/footballapi\/[A-Za-z0-9_\/]+(\?[A-Za-z0-9_=&%\.\-]*)?/g) || []);
  Logger.log('--- footballapi-referanser (' + hits.length + ') ---');
  if (!hits.length) Logger.log('  ingen — siden rendres antakelig ferdig på serveren, og da må vi lese HTML.');
  hits.slice(0, 40).forEach(function (h) { Logger.log('  https://www.fotball.no' + h); });
  Logger.log('');
}

/** Lenker videre inn i fotballdata — lag, turneringer, kamper. */
function logDataLinks_(html) {
  const rx = /<a[^>]+href="([^"]*fiksId=\d+[^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  const seen = {}, rows = [];
  let m;
  while ((m = rx.exec(html)) !== null) {
    const href = m[1].replace(/&amp;/g, '&');
    const text = m[2].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    if (seen[href]) continue;
    seen[href] = true;
    rows.push(pad_(text.slice(0, 38), 40) + href);
  }
  Logger.log('--- lenker med fiksId (' + rows.length + ') ---');
  rows.slice(0, 60).forEach(function (r) { Logger.log('  ' + r); });
  Logger.log('');
}

/** Hvilke undersider lenker siden til? (?fiksId=…&underside=X) */
function logUndersider_(html) {
  const hits = uniq_((html.match(/underside=([a-zA-Z0-9\-]+)/g) || [])
    .map(function (s) { return s.split('=')[1].toLowerCase(); }));
  Logger.log('--- undersider siden lenker til (' + hits.length + ') ---');
  Logger.log('  ' + (hits.join('  ') || 'ingen'));
  Logger.log('');
  return hits;
}

/**
 * Ser etter noe som ligner et resultat i HTML-en: "3 - 1", "2-0" osv.
 * Logger konteksten rundt hvert treff — uten den er et resultat umulig å
 * skille fra et klokkeslett eller et rundenummer.
 */
function logScoreHints_(html) {
  const text = html.replace(/<script[\s\S]*?<\/script>/g, ' ')
                   .replace(/<style[\s\S]*?<\/style>/g, ' ')
                   .replace(/<[^>]*>/g, ' ')
                   .replace(/&nbsp;/g, ' ')
                   .replace(/\s+/g, ' ');

  const rx = /\b\d{1,2}\s?[-–]\s?\d{1,2}\b/g;
  const rader = [];
  let m;
  while ((m = rx.exec(text)) !== null && rader.length < 12) {
    const fra = Math.max(0, m.index - 55);
    rader.push(pad_(m[0], 8) + '… ' + text.slice(fra, m.index + m[0].length + 55).trim() + ' …');
  }

  Logger.log('  mulige resultater (' + rader.length + ' første med kontekst):');
  if (!rader.length) Logger.log('    ingen funnet');
  rader.forEach(function (r) { Logger.log('    ' + r); });
  Logger.log('');
}

/** Grov kartlegging av en JSON-struktur uten å dumpe alt. */
function logJsonShape_(body) {
  let data;
  try {
    data = JSON.parse(body);
  } catch (e) {
    Logger.log('--- ser ut som JSON, men lot seg ikke parse: ' + e + '\n');
    return;
  }
  Logger.log('--- JSON-form ---');
  if (Array.isArray(data)) {
    Logger.log('  liste med ' + data.length + ' elementer');
    if (data.length) Logger.log('  felter i første element: ' + Object.keys(data[0]).join(', '));
    if (data.length) Logger.log('  første element: ' + oneLine_(JSON.stringify(data[0]), 600));
  } else if (data && typeof data === 'object') {
    Logger.log('  objekt med felter: ' + Object.keys(data).join(', '));
    Object.keys(data).forEach(function (k) {
      const v = data[k];
      if (Array.isArray(v) && v.length && typeof v[0] === 'object') {
        Logger.log('  ' + k + '[] (' + v.length + ') felter: ' + Object.keys(v[0]).join(', '));
        Logger.log('     ' + oneLine_(JSON.stringify(v[0]), 600));
      }
    });
  }
  Logger.log('');
}

// ---------------------------------------------------------------- SMÅTTERI -

function looksJson_(res) {
  return res.type.indexOf('json') !== -1 || /^\s*[\[{]/.test(res.body);
}

function uniq_(arr) {
  const seen = {}, out = [];
  arr.forEach(function (x) { if (!seen[x]) { seen[x] = true; out.push(x); } });
  return out;
}

function oneLine_(s, n) {
  return String(s).replace(/\s+/g, ' ').slice(0, n);
}

function pad_(s, n) {
  s = String(s);
  while (s.length < n) s += ' ';
  return s;
}

function shortUrl_(url) {
  return url.replace('https://www.fotball.no', '');
}
