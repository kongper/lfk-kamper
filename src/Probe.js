/**
 * Probe.js — hvor står motstanderlagenes fiksId?
 *
 * Vi kjenner ID-en til våre egne lag, fordi klubbsiden vår lister dem med
 * lenke. Motstanderne hører til andre klubber og står ikke der. Skal
 * "HamKam G16-2" kunne lenkes til kontaktpersonene sine, må ID-en hentes et
 * sted — og denne fila leter etter det stedet.
 *
 * RØRER IKKE ARKET. Ingen SpreadsheetApp-kall i fila. Alt går til
 * utførelsesloggen.
 *
 * Kjør:  probeMotstandere(136204)     (G15-1, eller et annet av våre lag)
 *
 * To ruter prøves, i rekkefølge etter hvor lite arbeid de koster oss senere:
 *
 *   1) Undersidene til vårt eget lag. Står motstanderne lenket i terminlisten
 *      vår, holder det med ett kall per lag vi allerede henter.
 *   2) Turneringen. Serien må ha en lagoversikt, og der står alle lagene —
 *      ett kall per serie i stedet for ett per motstander.
 *
 * Lim loggen tilbake, så velger jeg rute etter hva som faktisk finnes.
 */

const P = {
  base: 'https://www.fotball.no',
  pause: 1200,
  maxVis: 12
};

function probeMotstandere(fiksId) {
  fiksId = String(fiksId || 136204);
  const base = P.base + '/fotballdata/lag/hjem/?fiksId=' + fiksId;

  Logger.log('=== VÅRT LAG ' + fiksId + ' ===\n');
  const hjem = hent_(base);
  Logger.log('lag/hjem svarte ' + hjem.code + ', ' + hjem.len + ' tegn\n');
  if (hjem.code !== 200) return;

  const sider = undersider_(hjem.body);
  Logger.log('undersider: ' + (sider.join('  ') || 'ingen') + '\n');

  vis_('lag-lenker på hovedsiden', lagLenker_(hjem.body, fiksId));
  const turneringer = turneringLenker_(hjem.body);
  vis_('turneringer lenket fra lagsiden', turneringer);

  // --- Rute 1: undersidene til vårt eget lag --------------------------------
  Logger.log('=== RUTE 1: UNDERSIDER AV LAGSIDEN ===\n');
  uniq_(sider.concat(['kamper', 'terminliste', 'resultater'])).forEach(function (u) {
    Utilities.sleep(P.pause);
    const res = hent_(base + '&underside=' + u);
    if (res.code !== 200) { Logger.log('  ' + pad_(u, 22) + 'status ' + res.code); return; }
    const lag = lagLenker_(res.body, fiksId);
    Logger.log('  ' + pad_(u, 22) + pad_(res.len + ' tegn', 12) + lag.length + ' andre lag lenket');
    lag.slice(0, 6).forEach(function (l) { Logger.log('        ' + pad_(l.navn, 34) + l.id); });
  });
  Logger.log('');

  // --- Rute 2: turneringen -------------------------------------------------
  Logger.log('=== RUTE 2: TURNERINGEN ===\n');
  if (!turneringer.length) {
    Logger.log('  Lagsiden lenker ikke til noen turnering, så denne ruten faller bort.\n');
    return;
  }

  const t = turneringer[0];
  Logger.log('  Prøver "' + t.navn + '" (' + t.id + ')\n');
  const tBase = P.base + '/fotballdata/turnering/hjem/?fiksId=' + t.id;

  const tHjem = hent_(tBase);
  Logger.log('  turnering/hjem: status ' + tHjem.code + ', ' + tHjem.len + ' tegn');
  if (tHjem.code !== 200) return;

  Logger.log('  undersider: ' + (undersider_(tHjem.body).join('  ') || 'ingen'));
  vis_('  lag i turneringen (hovedsiden)', lagLenker_(tHjem.body, fiksId));

  uniq_(undersider_(tHjem.body).concat(['lagoversikt', 'lag', 'tabell', 'terminliste']))
    .forEach(function (u) {
      Utilities.sleep(P.pause);
      const res = hent_(tBase + '&underside=' + u);
      if (res.code !== 200) { Logger.log('    ' + pad_(u, 22) + 'status ' + res.code); return; }
      const lag = lagLenker_(res.body, fiksId);
      Logger.log('    ' + pad_(u, 22) + pad_(res.len + ' tegn', 12) + lag.length + ' lag lenket');
      lag.slice(0, P.maxVis).forEach(function (l) { Logger.log('          ' + pad_(l.navn, 34) + l.id); });
    });

  Logger.log('\nFerdig. Ruten vi trenger er den som gir motstanderne med både navn og ID.');
}

/** Én adresse, hvis du finner noe selv i DevTools. */
function probeUrl(url) {
  const res = hent_(url);
  Logger.log(url + '\n  status ' + res.code + ', ' + res.len + ' tegn\n');
  if (res.code !== 200) return;
  Logger.log('undersider: ' + undersider_(res.body).join('  ') + '\n');
  vis_('lag-lenker', lagLenker_(res.body, ''));
  vis_('turneringslenker', turneringLenker_(res.body));
}

// ------------------------------------------------------------------ MOTOR -

function hent_(url) {
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    const body = res.getContentText('UTF-8');
    return { code: res.getResponseCode(), len: body.length, body: body };
  } catch (e) {
    return { code: -1, len: 0, body: String(e) };
  }
}

/** Alle lenker til en lagside, som {navn, id}. Vårt eget lag utelates. */
function lagLenker_(html, egenId) {
  const rx = /<a[^>]+href="[^"]*lag\/hjem\/\?fiksId=(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  const ut = [], sett = {};
  let m;
  while ((m = rx.exec(html)) !== null) {
    if (m[1] === String(egenId)) continue;
    const navn = tekst_(m[2]);
    if (!navn) continue;
    const n = m[1] + '|' + navn.toLowerCase();
    if (sett[n]) continue;
    sett[n] = true;
    ut.push({ navn: navn, id: m[1] });
  }
  return ut;
}

function turneringLenker_(html) {
  const rx = /<a[^>]+href="[^"]*turnering\/[a-zæøå]+\/\?fiksId=(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  const ut = [], sett = {};
  let m;
  while ((m = rx.exec(html)) !== null) {
    const navn = tekst_(m[2]);
    if (sett[m[1]] || !navn) continue;
    sett[m[1]] = true;
    ut.push({ navn: navn, id: m[1] });
  }
  return ut;
}

function undersider_(html) {
  return uniq_((html.match(/underside=([a-zA-ZæøåÆØÅ0-9\-]+)/g) || [])
    .map(function (s) { return s.split('=')[1].toLowerCase(); }));
}

function tekst_(s) {
  return String(s)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x([0-9a-fA-F]+);/g, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
    .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(Number(d)); })
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function vis_(tittel, liste) {
  Logger.log('--- ' + tittel + ' (' + liste.length + ') ---');
  liste.slice(0, P.maxVis).forEach(function (l) { Logger.log('    ' + pad_(l.navn, 34) + l.id); });
  if (liste.length > P.maxVis) Logger.log('    ... og ' + (liste.length - P.maxVis) + ' til');
  Logger.log('');
}

function uniq_(a) {
  const s = {}, u = [];
  a.forEach(function (x) { if (!s[x]) { s[x] = true; u.push(x); } });
  return u;
}

function pad_(s, n) {
  s = String(s);
  while (s.length < n) s += ' ';
  return s;
}
