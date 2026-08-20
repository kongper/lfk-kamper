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
 * Excel-kalenderen klubbsiden lenker til — det eneste sporet igjen når
 * skraping er utelukket.
 *
 * Prøver tre parameterformer, og på første treff pakkes xlsx-en opp I MINNET
 * med Utilities.unzip og leses av. Ingen midlertidig fil i Drive, ingenting
 * lagres noe sted — en xlsx er bare en zip, og Apps Script kan åpne den rett
 * fra svaret. (Det var derfor jeg nevnte Drive sist; det viste seg unødvendig.)
 *
 * Det vi er ute etter er én ting: har regnearket en resultatkolonne?
 */
function probeExcel() {
  const urls = [
    'https://www.fotball.no/footballapi/Calendar/DownloadClubExcelCalendar?clubId=' + PROBE.clubId,
    'https://www.fotball.no/footballapi/Calendar/DownloadClubExcelCalendar?fiksId=' + PROBE.clubId,
    'https://www.fotball.no/footballapi/Calendar/DownloadClubExcelCalendar'
  ];

  Logger.log('=== EXCEL-KALENDER ===\n');

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    let res;
    try {
      res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    } catch (e) {
      Logger.log('  FEIL  ' + shortUrl_(url) + '  ' + e);
      continue;
    }

    const h = res.getHeaders();
    const type = (h['Content-Type'] || h['content-type'] || '?').split(';')[0];
    const navn = h['Content-Disposition'] || h['content-disposition'] || '';
    const bytes = res.getContent();
    const erZip = bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4B;

    Logger.log(pad_(String(res.getResponseCode()), 4) + ' ' + pad_(type, 28) +
               pad_(String(bytes.length) + ' B', 12) + shortUrl_(url));
    if (navn) Logger.log('     ' + navn);
    Logger.log('     ' + (erZip ? 'PK — ekte zip/xlsx' : 'ikke xlsx'));

    if (res.getResponseCode() !== 200) {
      Logger.log('     ' + oneLine_(res.getContentText(), 200) + '\n');
      Utilities.sleep(PROBE.pauseMs);
      continue;
    }
    if (!erZip) {
      Logger.log('     (svarte 200, men innholdet er ikke et regneark — antakelig en feilside)');
      Logger.log('     ' + oneLine_(res.getContentText(), 200) + '\n');
      Utilities.sleep(PROBE.pauseMs);
      continue;
    }

    Logger.log('\n>>> TREFF. Pakker opp i minnet.\n');
    lesXlsx_(res.getBlob());
    return;
  }

  Logger.log('\nIngen av de tre formene ga et regneark. Da trenger jeg den ekte adressen: ' +
             'åpne klubbsiden i nettleseren, trykk på Excel-nedlastingen, og send meg ' +
             'lenken fra nedlastingslista (Ctrl+J) — så kjører vi probeUrl() på den.');
}

/**
 * Leser en xlsx-blob uten å lagre den. En xlsx er en zip med XML inni:
 * xl/sharedStrings.xml har all tekst, xl/worksheets/sheet1.xml har cellene.
 * Overskriftsraden ligger nesten alltid først i sharedStrings, så den alene
 * svarer på om resultat er med.
 */
function lesXlsx_(blob) {
  let filer;
  try {
    filer = Utilities.unzip(blob.setContentType('application/zip'));
  } catch (e) {
    Logger.log('  Klarte ikke pakke opp: ' + e);
    return;
  }

  Logger.log('--- innhold i arkivet (' + filer.length + ') ---');
  filer.forEach(function (f) {
    Logger.log('  ' + pad_(f.getName(), 42) + f.getBytes().length + ' B');
  });
  Logger.log('');

  const finn = function (frag) {
    return filer.filter(function (f) { return f.getName().indexOf(frag) !== -1; })[0];
  };

  // Tekst kan ligge to steder: i sharedStrings.xml, eller inline i cellene.
  // Begge deler må håndteres — leser vi bare sharedStrings og arket er inline,
  // ser det ut som om arket er tomt, og det ville vært feil svar på et viktig
  // spørsmål.
  const ss = finn('sharedStrings.xml');
  const delte = ss
    ? (ss.getDataAsString('UTF-8').match(/<si>[\s\S]*?<\/si>/g) || []).map(function (si) {
        return (si.match(/<t[^>]*>[\s\S]*?<\/t>/g) || []).map(avkod_).join('');
      })
    : [];
  Logger.log(ss ? '--- sharedStrings: ' + delte.length + ' tekster\n'
                : '--- ingen sharedStrings.xml — cellene er inline\n');

  const ark = finn('sheet1.xml') || filer.filter(function (f) {
    return /worksheets\/.*\.xml$/.test(f.getName());
  })[0];
  if (!ark) {
    Logger.log('  Fant ikke noe regneark i arkivet.');
    return;
  }

  const rader = ark.getDataAsString('UTF-8').match(/<row[\s\S]*?<\/row>/g) || [];
  Logger.log('--- arket har ' + rader.length + ' rader ---\n');
  if (!rader.length) return;

  const overskrift = radCeller_(rader[0], delte);
  Logger.log('--- KOLONNER ---');
  overskrift.forEach(function (h, i) { Logger.log('  ' + pad_(String(i), 4) + h); });
  Logger.log('');

  // Første datarad ved siden av overskriften — en kolonne kan finnes og likevel
  // stå tom, og da er den verdiløs for oss.
  if (rader.length > 1) {
    const d = radCeller_(rader[1], delte);
    Logger.log('--- FØRSTE DATARAD ---');
    overskrift.forEach(function (h, i) {
      Logger.log('  ' + pad_(h, 24) + (d[i] === undefined || d[i] === '' ? '(tom)' : d[i]));
    });
    Logger.log('');
  }

  // Det egentlige spørsmålet.
  const jakt = /(resultat|score|m[åa]l|hjemmem|bortem|kampnr|kampnummer|spilt|status|dommer)/i;
  const treff = overskrift.filter(function (t) { return jakt.test(t); });
  Logger.log('--- kolonner som kan bære resultat ---');
  Logger.log('  ' + (treff.join('  |  ') || 'INGEN — arket er trolig bare terminliste, uten resultater'));
  Logger.log('');

  Logger.log('Lim hele denne loggen tilbake, så leser jeg av om sporet holder.');
}

// ------------------------------------------------------ 2b. ER 1000 EN TAK? -

const EXCEL_URL = 'https://www.fotball.no/footballapi/Calendar/DownloadClubExcelCalendar?clubId=';

// Bekreftet 20.08.2026: dette er adressen som virker, og parameteren MÅ hete
// teamId. Med ?fiksId= svarer den 200 med et tomt ark — ingen feilmelding, bare
// null rader. Den fella må enhver bruk av dette endepunktet vokte seg for.
const LAG_EXCEL = 'https://www.fotball.no/footballapi/Calendar/DownloadTeamExcelCalendar?teamId=';

/**
 * Kolonnene stemte. Det som gjenstår før dette kan bli en datakilde er om
 * de 1000 radene er hele sannheten eller bare de 1000 første — 1000 er et
 * mistenkelig rundt tall, og et stille tak ville betydd at kamper forsvant
 * uten at noen merket det.
 *
 * Leser hele arket og rapporterer datospenn, hvor mange som har resultat,
 * om Kampnummer er unikt, og hva som ligger i hver ende av fila.
 */
function probeExcelAnalyse() {
  const t = hentExcelTabell_(EXCEL_URL + PROBE.clubId);
  if (!t) return;

  const rader = t.rader, H = t.overskrift;
  const kol = function (navn) { return H.indexOf(navn); };
  const iDato = kol('Dato'), iRes = kol('Resultat'), iKnr = kol('Kampnummer'),
        iHj = kol('Hjemmelag'), iBo = kol('Bortelag'), iTur = kol('Turnering');

  Logger.log('=== ' + rader.length + ' datarader ===');
  if (rader.length === 1000) {
    Logger.log('>>> NØYAKTIG 1000. Det er nesten helt sikkert et tak, ikke en tilfeldighet.');
  }
  Logger.log('');

  // Datospenn — og om fila i det hele tatt er sortert.
  const serier = rader.map(function (r) { return Number(r[iDato]); })
                      .filter(function (n) { return !isNaN(n) && n > 0; });
  const min = Math.min.apply(null, serier), maks = Math.max.apply(null, serier);
  Logger.log('--- datospenn ---');
  Logger.log('  tidligste : ' + serieDato_(min));
  Logger.log('  seneste   : ' + serieDato_(maks));
  Logger.log('  i dag     : ' + serieDato_(idagSerie_()));
  Logger.log('');

  const sortert = serier.every(function (n, i) { return i === 0 || serier[i - 1] <= n; });
  Logger.log('  fila er ' + (sortert ? 'sortert stigende på dato' : 'IKKE sortert på dato'));
  Logger.log('  første rad i fila : ' + radTekst_(rader[0], iDato, iHj, iRes, iBo, iTur));
  Logger.log('  siste rad i fila  : ' + radTekst_(rader[rader.length - 1], iDato, iHj, iRes, iBo, iTur));
  Logger.log('');

  // Har de spilte kampene faktisk resultat?
  // Rettet etter første kjøring: ukjente kamper har "-" i Resultat, ikke tom
  // celle, så "ikke tom" talte alle 1000 og sa ingenting. Nå kreves sifre.
  const medRes = rader.filter(function (r) { return erResultat_(r[iRes]); });
  const spilte = rader.filter(function (r) { return Number(r[iDato]) < idagSerie_(); });
  Logger.log('--- resultater ---');
  Logger.log('  rader med ekte sifferresultat : ' + medRes.length);
  Logger.log('  rader med dato i fortid       : ' + spilte.length);
  const spilteUten = spilte.filter(function (r) { return !erResultat_(r[iRes]); });
  Logger.log('  spilte uten resultat          : ' + spilteUten.length +
             (spilteUten.length ? '  (f.eks. ' + radTekst_(spilteUten[0], iDato, iHj, iRes, iBo, iTur) + ')' : ''));
  Logger.log('');

  // Kampnummer som nøkkel — det iCal-UID-en aldri klarte å være.
  const knr = rader.map(function (r) { return String(r[iKnr] || '').trim(); }).filter(String);
  Logger.log('--- Kampnummer ---');
  Logger.log('  utfylt: ' + knr.length + ' av ' + rader.length + ', unike: ' + uniq_(knr).length);
  Logger.log('  eksempel: ' + knr.slice(0, 3).join('  '));
  Logger.log('');

  // Våre serier.
  Logger.log('--- turneringer med "G15" eller "G16" i navnet ---');
  const teller = {};
  rader.forEach(function (r) {
    const tur = String(r[iTur] || '');
    if (!/G1[56]/.test(tur)) return;
    teller[tur] = (teller[tur] || 0) + 1;
  });
  Object.keys(teller).sort().forEach(function (k) {
    Logger.log('  ' + pad_(String(teller[k]), 5) + k);
  });
  Logger.log('');

  Logger.log('--- våre spilte kamper med resultat (inntil 12) ---');
  const vare = rader.filter(function (r) {
    return /G1[56]/.test(String(r[iTur] || '')) &&
           /lillehammer/i.test(String(r[iHj]) + ' ' + String(r[iBo])) &&
           erResultat_(r[iRes]);
  });
  Logger.log('  totalt ' + vare.length);
  vare.slice(0, 12).forEach(function (r) {
    Logger.log('    ' + radTekst_(r, iDato, iHj, iRes, iBo, iTur));
  });
  Logger.log('');
}

/**
 * Tester om nedlastingen tar imot parametere som flytter eller utvider vinduet.
 * Sammenlikner bare radantall mot grunnlinjen — svarer et kall med flere enn
 * 1000 rader, er taket ikke absolutt.
 */
function probeExcelGrense() {
  const c = PROBE.clubId;
  const varianter = [
    ['grunnlinje',        EXCEL_URL + c],
    ['fromDate/toDate',   EXCEL_URL + c + '&fromDate=01.01.2025&toDate=31.12.2026'],
    ['from/to ISO',       EXCEL_URL + c + '&from=2025-01-01&to=2026-12-31'],
    ['seasonId',          EXCEL_URL + c + '&seasonId=2025'],
    ['year',              EXCEL_URL + c + '&year=2025'],
    ['take',              EXCEL_URL + c + '&take=5000'],
    ['pageSize',          EXCEL_URL + c + '&pageSize=5000'],
    ['page 2',            EXCEL_URL + c + '&page=2']
  ];

  Logger.log('=== RADANTALL PER VARIANT ===\n');
  varianter.forEach(function (v) {
    const t = hentExcelTabell_(v[1], true);
    Logger.log(pad_(v[0], 18) + (t ? t.rader.length + ' rader' : 'ingen tabell') +
               '   ' + shortUrl_(v[1]));
    Utilities.sleep(PROBE.pauseMs);
  });
  Logger.log('\nAvviker et tall fra grunnlinjen, tar endepunktet imot parameteren — ' +
             'og da kan vi hente fortiden i biter i stedet for å miste den.');
}

/**
 * Klubb-eksporten er hele klubben — 40 lag, og den treffer taket på 1000 rader
 * lenge før sesongen er over. Et lag alene har rundt 30 kamper. Finnes samme
 * eksport på lagnivå, forsvinner takproblemet helt.
 *
 * Leter først i lagsidens markup etter en Excel-lenke — det var slik vi fant
 * klubb-varianten — og faller tilbake på gjetting bare hvis siden ikke røper
 * noe.
 */
function probeTeamExcel(fiksId) {
  if (!fiksId) throw new Error('probeTeamExcel trenger lagets fiksId, f.eks. probeTeamExcel(136204)');

  Logger.log('=== EXCEL PÅ LAGNIVÅ, fiksId ' + fiksId + ' ===\n');

  const side = probeFetch_('https://www.fotball.no/fotballdata/lag/hjem/?fiksId=' + fiksId);
  Logger.log('lagsiden svarte ' + side.code + ', ' + side.len + ' tegn');

  const funnet = side.code === 200
    ? uniq_(side.body.match(/\/footballapi\/[A-Za-z0-9_\/]*Excel[A-Za-z0-9_\/]*/gi) || [])
    : [];
  Logger.log('Excel-lenker i markupen: ' + (funnet.join('  ') || 'ingen'));
  Logger.log('');

  const gjett = [
    '/footballapi/Calendar/DownloadTeamExcelCalendar?teamId=' + fiksId,
    '/footballapi/Calendar/DownloadTeamExcelCalendar?fiksId=' + fiksId,
    '/footballapi/Calendar/DownloadExcelCalendarForTeam?teamId=' + fiksId,
    '/footballapi/Calendar/DownloadClubExcelCalendar?teamId=' + fiksId
  ];
  const alle = uniq_(funnet.map(function (p) { return p + '?teamId=' + fiksId; }).concat(gjett));

  alle.forEach(function (sti) {
    const url = 'https://www.fotball.no' + sti;
    const t = hentExcelTabell_(url, true);
    if (!t) {
      Logger.log('  —      ' + sti);
      Utilities.sleep(PROBE.pauseMs);
      return;
    }

    const iDato = t.overskrift.indexOf('Dato'), iRes = t.overskrift.indexOf('Resultat');
    const datoer = t.rader.map(function (r) { return Number(r[iDato]); })
                          .filter(function (n) { return !isNaN(n) && n > 0; });
    const seneste = datoer.length ? Math.max.apply(null, datoer) : 0;

    Logger.log('  TREFF  ' + sti);
    Logger.log('         ' + t.rader.length + ' rader, ' +
               t.rader.filter(function (r) { return erResultat_(r[iRes]); }).length + ' med resultat');
    Logger.log('         ' + (datoer.length ? serieDato_(Math.min.apply(null, datoer)) +
               '  →  ' + serieDato_(seneste) : 'ingen datoer'));
    Logger.log('         kolonner: ' + t.overskrift.join(' | '));
    // Klubbfila stoppet 24.09.2026 = serienummer 46289. Kommer denne lenger,
    // er taket omgått.
    Logger.log('         ' + (seneste > 46289 ? '>>> GÅR FORBI 24.09 — taket er omgått'
                                              : 'stopper innenfor samme vindu som klubbfila'));
    Utilities.sleep(PROBE.pauseMs);
  });

  Logger.log('\nIngen treff? Da åpner du lagsiden i nettleseren, trykker på Excel-ikonet, ' +
             'og henter adressen fra nedlastingslista (Ctrl+J).');
}

/**
 * Alle kampene til ett lag, som de står i lag-eksporten. Dette er fasiten vi
 * må holde mot arket: stemmer disse radene med det vi allerede har, er
 * kilden god.
 */
function probeTeamKamper(fiksId) {
  if (!fiksId) throw new Error('probeTeamKamper trenger lagets fiksId');

  const t = hentExcelTabell_(LAG_EXCEL + fiksId);
  if (!t) { Logger.log('Ingen tabell for ' + fiksId); return; }

  const H = t.overskrift;
  const i = function (n) { return H.indexOf(n); };

  Logger.log('=== fiksId ' + fiksId + ': ' + t.rader.length + ' kamper ===\n');
  if (!t.rader.length) {
    Logger.log('Tomt ark. Merk: feil parameternavn gir 0 rader og ikke en feilmelding — ' +
               'det må vi vokte oss for.');
    return;
  }

  const turneringer = {};
  t.rader.forEach(function (r) {
    const tur = String(r[i('Turnering')] || '');
    turneringer[tur] = (turneringer[tur] || 0) + 1;
    Logger.log('  ' + serieDato_(r[i('Dato')]) +
               '  ' + pad_(String(r[i('Hjemmelag')] || ''), 28) +
               pad_(erResultat_(r[i('Resultat')]) ? String(r[i('Resultat')]) : '·', 8) +
               pad_(String(r[i('Bortelag')] || ''), 28) +
               pad_(String(r[i('Kampnummer')] || ''), 14) + tur);
  });

  Logger.log('\n--- turneringer i denne fila ---');
  Object.keys(turneringer).forEach(function (k) {
    Logger.log('  ' + pad_(String(turneringer[k]), 5) + k);
  });
  Logger.log('');
}

/**
 * Alle lag i klubben som matcher et mønster, med fiksId. Uten tak denne gangen
 * — forrige liste stoppet på 60 av 354 lenker, og G16-lagene lå lenger ned.
 * Standardmønster er G15/G16; send inn noe annet for å lete bredere.
 */
function probeLagListe(monster) {
  const rx = monster ? new RegExp(monster, 'i') : /G1[56]/i;

  const res = probeFetch_(PROBE.clubPage);
  if (res.code !== 200) { Logger.log('Klubbsiden svarte ' + res.code); return; }

  const lenkeRx = /<a[^>]+href="([^"]*lag\/hjem\/\?fiksId=(\d+)[^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  const sett = {}, treff = [];
  let m;
  while ((m = lenkeRx.exec(res.body)) !== null) {
    const id = m[2];
    const navn = avkod_(m[3]).replace(/\s+/g, ' ');
    const nokkel = id + navn;
    if (sett[nokkel] || !navn) continue;
    sett[nokkel] = true;
    if (rx.test(navn)) treff.push({ id: id, navn: navn });
  }

  Logger.log('=== lag som matcher ' + rx + ' (' + treff.length + ') ===\n');
  treff.forEach(function (t) { Logger.log('  ' + pad_(t.navn, 30) + t.id); });
  Logger.log('\nEt lag kan stå to ganger med ulik fiksId — én registrering per ' +
             'sesong eller serie. Da trengs begge for å få alle kampene.');
}

/** Henter, pakker opp og parser hele arket. Returnerer {overskrift, rader}. */
function hentExcelTabell_(url, stille) {
  let res;
  try {
    res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  } catch (e) {
    Logger.log('  FEIL: ' + e);
    return null;
  }
  if (res.getResponseCode() !== 200) {
    if (!stille) Logger.log('  status ' + res.getResponseCode());
    return null;
  }

  let filer;
  try {
    filer = Utilities.unzip(res.getBlob().setContentType('application/zip'));
  } catch (e) {
    if (!stille) Logger.log('  ikke et regneark: ' + e);
    return null;
  }

  const finn = function (frag) {
    return filer.filter(function (f) { return f.getName().indexOf(frag) !== -1; })[0];
  };
  const ss = finn('sharedStrings.xml');
  const delte = ss
    ? (ss.getDataAsString('UTF-8').match(/<si>[\s\S]*?<\/si>/g) || []).map(function (si) {
        return (si.match(/<t[^>]*>[\s\S]*?<\/t>/g) || []).map(avkod_).join('');
      })
    : [];

  const ark = finn('sheet1.xml') || filer.filter(function (f) {
    return /worksheets\/.*\.xml$/.test(f.getName());
  })[0];
  if (!ark) return null;

  const rader = (ark.getDataAsString('UTF-8').match(/<row[\s\S]*?<\/row>/g) || [])
    .map(function (r) { return radCeller_(r, delte); });
  if (!rader.length) return null;

  return { overskrift: rader[0], rader: rader.slice(1) };
}

/**
 * Et ekte resultat er sifre med bindestrek mellom. Ikke spilt gir "-", som er
 * en utfylt celle og ville telt med om vi bare sjekket at det står noe der.
 */
function erResultat_(v) {
  return /^\s*\d{1,2}\s*[-–]\s*\d{1,2}\s*$/.test(String(v || ''));
}

/** Excel-serienummer til lesbar dato. Epoke 30.12.1899, regnet i UTC. */
function serieDato_(n) {
  if (!n || isNaN(n)) return '(ingen dato)';
  const ms = Date.UTC(1899, 11, 30) + Math.round(Number(n) * 86400000);
  return Utilities.formatDate(new Date(ms), 'UTC', 'dd.MM.yyyy HH:mm');
}

function idagSerie_() {
  return (new Date().getTime() - Date.UTC(1899, 11, 30)) / 86400000;
}

function radTekst_(r, iDato, iHj, iRes, iBo, iTur) {
  if (!r) return '(ingen)';
  return serieDato_(r[iDato]) + '  ' + pad_(String(r[iHj] || ''), 26) +
         pad_(String(r[iRes] || '–'), 9) + pad_(String(r[iBo] || ''), 26) +
         String(r[iTur] || '');
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

/** XML-tekst til lesbar streng. */
function avkod_(t) {
  return String(t)
    .replace(/<[^>]*>/g, '')
    .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(Number(d)); })
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

/**
 * Cellene i én <row>, som lesbare verdier. Håndterer de tre formene xlsx
 * bruker: t="s" (peker inn i sharedStrings), t="inlineStr" (tekst i cella),
 * og tall uten t.
 */
function radCeller_(radXml, delte) {
  const ut = [];
  const rx = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let m;
  while ((m = rx.exec(radXml)) !== null) {
    const attr = m[1] || '';
    const innhold = m[2] || '';
    const type = (attr.match(/\bt="([^"]+)"/) || [])[1] || 'n';

    let verdi;
    if (type === 's') {
      const i = Number(avkod_((innhold.match(/<v>([\s\S]*?)<\/v>/) || [])[0] || ''));
      verdi = delte[i] !== undefined ? delte[i] : '#' + i;
    } else if (type === 'inlineStr') {
      verdi = (innhold.match(/<t[^>]*>[\s\S]*?<\/t>/g) || []).map(avkod_).join('');
    } else {
      verdi = avkod_((innhold.match(/<v>([\s\S]*?)<\/v>/) || [])[0] || '');
    }

    // Tomme celler kan være utelatt helt, ikke bare tomme. Uten å lese
    // kolonnebokstaven i r="C2" ville resten av raden forskjøvet seg, og
    // datarad og overskrift ville ikke lenger stå under hverandre.
    const ref = (attr.match(/\br="([A-Z]+)\d+"/) || [])[1];
    const idx = ref ? kolIndeks_(ref) : ut.length;
    while (ut.length < idx) ut.push('');
    ut[idx] = verdi;
  }
  return ut;
}

/** "A" -> 0, "B" -> 1, ... "AA" -> 26 */
function kolIndeks_(bokstaver) {
  let n = 0;
  for (let i = 0; i < bokstaver.length; i++) {
    n = n * 26 + (bokstaver.charCodeAt(i) - 64);
  }
  return n - 1;
}

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
