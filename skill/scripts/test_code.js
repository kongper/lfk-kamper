// Offline harness for Kode.gs. Stubs the Apps Script globals and runs the sync
// against the real sheet contents, with the two real-world deltas applied to a
// synthesised feed.
//
// The stale values in the KampID column are deliberate: fotball.no regenerates
// the iCal UIDs between sessions, so matching must not depend on them at all.

const fs = require('fs');
const vm = require('vm');

// Kommentar | Varsling | Dato | Ny dato | Dag | Tid | Hjemmelag | Bortelag | Bane | Turnering | KampID
const RAW = `||08.08.2026|08.08.2026|lørdag|14:00|Lillehammer|Nordstrand|Stampesletta|G16 Interkrets|
||15.08.2026|15.08.2026|lørdag|13:00|Hasle-Løren|Lillehammer|Løren kunstgress|G16 Interkrets|
|Kollisjon|18.08.2026|18.08.2026|tirsdag|18:00|Lillehammer|Stange|Stampesletta Søndre bane|G15 Elite Høst|f23d2560-1e21-49c4-9671-c87839f41720
|Kollisjon|18.08.2026|18.08.2026|tirsdag|20:15|HamKam|Lillehammer|Briskeby|G16 Interkrets|017ae9d3-18b2-4669-a91d-3c1ea72941f8
||19.08.2026|19.08.2026|onsdag|19:30|Nordre Land/Torpa 2|Lillehammer 2|Brovold kunstgress|G15 2. div avd 02 Høst|686d547f-cf99-4082-8ee5-c684f3edb87f
||20.08.2026|20.08.2026|torsdag|19:30|Brumunddal|Lillehammer 2|SH-banen, Kunstgress|G16 Elite Høst|1a0dfffc-7ea7-452e-938d-e41200e439fe
||23.08.2026|23.08.2026|søndag|13:00|Lillehammer 2|Øystre Slidre/Rogne/Vang|Stampesletta|G15 2. div avd 02 Høst|a04700f4-0a9e-4371-abd7-1c984a650e85
||26.08.2026|26.08.2026|onsdag|20:15|HSV|Lillehammer|Soon Arena|G16 Interkrets|b4ec6aec-220f-4114-a420-2b960ea3f405
|Kollisjon|27.08.2026|27.08.2026|torsdag|20:00|Lillehammer 2|HamKam 2|Stampesletta|G16 Elite Høst|7aa32ba4-6fbc-4ad8-a0bc-4c9ef3f49238
|Kollisjon|27.08.2026|27.08.2026|torsdag|20:00|Storhamar|Lillehammer|OBOSbana|G15 Elite Høst|c64ee150-c508-4793-bf0e-fafe63a3d715
||29.08.2026|29.08.2026|lørdag|14:00|Lillehammer|Grorud|Stampesletta|G16 Interkrets|37138ea7-df82-42ed-8489-110a559e7e5b
||02.09.2026|02.09.2026|onsdag|19:30|Faaberg|Lillehammer 2|Jorekstad Hovedbanen|G15 2. div avd 02 Høst|d65af54d-0096-48f6-beff-8f4f25a4e648
||03.09.2026|16.10.2026|fredag|19:30|Ottestad|Lillehammer 2|Ottestad Idrettspark 11er|G16 Elite Høst|7089a1d1-261a-4ca1-b9c0-484c08fb2881
||03.09.2026|03.09.2026|torsdag|19:30|Follebu Gausdal|Lillehammer|Follebu stadion kunstgress|G15 Elite Høst|0b795659-6ddc-4176-9990-c7297bd6e756
||05.09.2026|05.09.2026|lørdag|14:00|Tune|Lillehammer|Tunebanen KG Ny|G16 Interkrets|51449b1c-f08d-4c31-9e04-372ad721b903
||06.09.2026|06.09.2026|søndag|13:00|Lillehammer|Odal|Stampesletta|G15 Elite Høst|a88fb100-0e75-42de-a0e7-ecd94d66e05e
||07.09.2026|07.09.2026|mandag|18:00|Lillehammer 2|Gjøvik-Lyn|Stampesletta|G15 2. div avd 02 Høst|9df52766-f4df-4198-9765-be59980e5811
||08.09.2026|08.09.2026|tirsdag|19:30|Fagernes|Lillehammer 2|Brannkassebanen kunstgress 11-er|G16 Elite Høst|fe6dee3d-0990-46a8-a144-47e44dfa99bc
Påfølgende dager||13.09.2026|13.09.2026|søndag|13:00|Lillehammer 2|Gran|Stampesletta|G16 Elite Høst|e889361d-dafd-4c88-8791-f4517a6cbf3c
Påfølgende dager||14.09.2026|14.09.2026|mandag|18:00|Lillehammer|Moelven|Stampesletta|G15 Elite Høst|a92a77b4-66ad-461a-aedb-9bb23d1914ee
||15.09.2026|15.09.2026|tirsdag|20:15|Lillehammer|Hasle-Løren|Stampesletta|G16 Interkrets|95e2267a-ba32-4055-b576-00b3edf6474b
||16.09.2026|16.09.2026|onsdag|19:30|Reinsvoll/Eina/Bøverbru|Lillehammer 2|Reinsvoll ipk|G15 2. div avd 02 Høst|62c30c68-e1ae-4ac2-8e1b-29bdfddee3ba
||20.09.2026|20.09.2026|søndag|14:45|Lørenskog|Lillehammer|Rolvsrud kunstgress|G16 Interkrets|736af9c3-43b2-470d-bfd6-79761c653741
||21.09.2026|21.09.2026|mandag|20:00|Lillehammer|Elverum|Stampesletta Søndre bane|G15 Elite Høst|b003bfcd-f077-48ca-a5c2-a6783b70234f
||23.09.2026|23.09.2026|onsdag|18:00|Lillehammer 2|Nordre Land/Torpa 2|Stampesletta|G15 2. div avd 02 Høst|840eabb4-f76a-4308-a7cc-686debd4e04b
||24.09.2026|24.09.2026|torsdag|20:00|Elverum|Lillehammer 2|Elverum Stadion 11er|G16 Elite Høst|e90098ab-9920-4c36-9344-968f949e9678
|Kollisjon|26.09.2026|26.09.2026|lørdag|15:00|Øystre Slidre/Rogne/Vang|Lillehammer 2|Tveit stadion kunstgress|G15 2. div avd 02 Høst|bf2411fe-3bff-45df-9556-d9de8cc0e8b9
|Kollisjon|26.09.2026|26.09.2026|lørdag|17:00|Heming|Lillehammer|Heming kunstgress|G16 Interkrets|12210b44-4216-492a-b909-34a1164f8af7
Påfølgende dager||30.09.2026|30.09.2026|onsdag|19:30|Ottestad|Lillehammer|Ottestad Idrettspark 11er|G15 Elite Høst|bd4ae6cb-aea8-4aca-a946-ff7b777c423c
Påfølgende dager||01.10.2026|01.10.2026|torsdag|20:00|Lillehammer 2|Nordre Land/Torpa|Stampesletta Søndre bane|G16 Elite Høst|a31bb82d-1f5b-4abc-8809-0990a65677b7
||03.10.2026|03.10.2026|lørdag|14:00|Lillehammer|Løvenstad|Stampesletta|G16 Interkrets|247bd38b-c233-40c4-975e-476479bba3c5
||13.10.2026|13.10.2026|tirsdag|20:15|Sprint-Jeløy|Lillehammer|Bellevue KG|G16 Interkrets|96986dc6-2db9-475d-83ea-076c08ee0b82
||14.10.2026|14.10.2026|onsdag|18:00|Lillehammer 2|Faaberg|Stampesletta|G15 2. div avd 02 Høst|41b78932-1b59-48d1-a5f4-cb751c776f50
||18.10.2026|18.10.2026|søndag|16:00|Lillehammer|Gui|Stampesletta|G16 Interkrets|f54b7b69-768c-4e94-b9c2-d8d1ab39ac56
||19.10.2026|19.10.2026|mandag|19:30|Gjøvik-Lyn|Lillehammer 2|Gjøvik stadion kunstgress 11er|G15 2. div avd 02 Høst|92d1c9b7-96f4-42eb-8f20-9db823620043
||21.10.2026|21.10.2026|onsdag|19:30|Brumunddal|Lillehammer|OBOS-bana|G15 Elite Høst|99f3ee7b-5011-40e7-8a66-f617633ddb02
||22.10.2026|22.10.2026|torsdag|20:00|Vind IL|Lillehammer 2|Vind kunstgress KG11-1|G16 Elite Høst|24a1aca1-835c-4d4e-a205-b9e8eb64c3ef
||24.10.2026|24.10.2026|lørdag|14:00|Greåker|Lillehammer|Moa KG|G16 Interkrets|618a9eb9-2b17-4d95-afca-8ca6b687ab18
||26.10.2026|26.10.2026|mandag|18:00|Lillehammer 2|Reinsvoll/Eina/Bøverbru|Stampesletta|G15 2. div avd 02 Høst|3b9cedc4-4ae5-4fc9-b063-692bae065af8
Påfølgende dager||29.10.2026|29.10.2026|torsdag|20:00|Lillehammer 2|Gjøvik-Lyn|Stampesletta|G16 Elite Høst|0a81041b-e70f-449d-8963-bcce1379833c
Påfølgende dager||30.10.2026|30.10.2026|fredag|19:30|Otta|Lillehammer|Øya stadion øst 11er|G15 Elite Høst|97dfa440-d1dc-4142-99a9-fa3babfc3c36`;

// The sheet as it now stands: Varsling and KampID removed. RAW still carries
// them so the harness also proves those columns are simply ignored if present.
const RAW_HEADER = ['Kommentar', 'Varsling', 'Dato', 'Ny dato', 'Dag', 'Tid', 'Hjemmelag', 'Bortelag', 'Bane', 'Turnering', 'KampID'];
const DROP = ['Varsling', 'KampID', 'Ny dato'];
const HEADER = RAW_HEADER.filter(h => !DROP.includes(h));
const C = {}; HEADER.forEach((h, i) => C[h] = i);
const keepIdx = RAW_HEADER.map((h, i) => DROP.includes(h) ? -1 : i).filter(i => i >= 0);
const sheetRows = RAW.split('\n').map(l => { const p = l.split('|'); return keepIdx.map(i => p[i]); });
const sheetValues = [HEADER].concat(sheetRows);

// Long names as fotball.no writes them, so the feed is realistic.
const LONG = {
  'Nordstrand': 'Nordstrand', 'Hasle-Løren': 'Hasle-Løren', 'Stange': 'Stange ', 'HamKam': 'HamKam',
  'Nordre Land/Torpa': 'Nordre Land IL/Torpa IL', 'Brumunddal': 'Brumunddal ',
  'Øystre Slidre/Rogne/Vang': 'Øystre Slidre IL/Rogne IL/FK Vang', 'HSV': 'HSV ', 'Storhamar': 'Storhamar ',
  'Grorud': 'Grorud', 'Faaberg': 'Faaberg', 'Ottestad': 'Ottestad', 'Follebu Gausdal': 'Follebu Gausdal FK',
  'Tune': 'Tune', 'Odal': 'Odal', 'Gjøvik-Lyn': 'Gjøvik-Lyn ', 'Fagernes': 'Fagernes', 'Gran': 'Gran',
  'Moelven': 'Moelven', 'Reinsvoll/Eina/Bøverbru': 'Reinsvoll IF/Eina SK/Bøverbru IL',
  'Lørenskog': 'Lørenskog', 'Elverum': 'Elverum ', 'Heming': 'Heming', 'Løvenstad': 'Løvenstad',
  'Sprint-Jeløy': 'Sprint-Jeløy ', 'Gui': 'Gui', 'Vind IL': 'Vind IL', 'Greåker': 'Greåker',
  'Otta': 'Otta', 'Lillehammer': 'Lillehammer'
};
function longOf(short, serie) {
  const n = /(^| )2$/.test(short) ? 2 : 1;
  const base = LONG[short.replace(/ 2$/, '')] || LONG[short] || short.replace(/ 2$/, '');
  const grp = serie.startsWith('G16') ? 'G16' : 'G15';
  return (base + ' ' + grp + '-' + n).replace(/\s+/g, ' ').trim();
}

function makeFeed() {
  const out = [];
  sheetRows.forEach((r, i) => {
    if (i < 2) return;                                  // played, aged out of the feed
    const serie = r[C['Turnering']];
    let d = r[C['Dato']], t = r[C['Tid']], dg = r[C['Dag']];
    if (r[C['Hjemmelag']] === 'Ottestad' && serie === 'G16 Elite Høst') { d = '03.09.2026'; dg = 'torsdag'; }
    if (r[C['Hjemmelag']] === 'Lørenskog') { d = '19.09.2026'; t = '18:00'; dg = 'lørdag'; }
    out.push({
      serie, runde: null,
      homeLong: longOf(r[C['Hjemmelag']], serie), awayLong: longOf(r[C['Bortelag']], serie),
      bane: r[C['Bane']], dato: d, tid: t, dag: dg,
      iso: d.split('.').reverse().join('-') + 'T' + t
    });
  });
  return out;
}

function pad(n){return String(n).padStart(2,'0');}
function icsOf(fixtures) {
  const ev = fixtures.map((f, i) => {
    const [d, m, y] = f.dato.split('.');
    const [hh, mm] = f.tid.split(':');
    const desc = `${f.serie} (runde ${i + 1})\\n\\n${f.homeLong} - ${f.awayLong}\\n` +
                 `${f.bane} ${f.dag} ${f.dato} kl. ${f.tid}`;
    return ['BEGIN:VEVENT',
            `UID:uid-${i}-${Math.floor(i * 7919) % 1000}`,   // deliberately unstable-looking
            `DTSTART:${y}${m}${d}T${pad(hh)}${pad(mm)}00`,
            `LOCATION:${f.bane}`,
            `SUMMARY:${f.homeLong} - ${f.awayLong} -`,
            `DESCRIPTION:${desc}`,
            'END:VEVENT'].join('\r\n');
  }).join('\r\n');
  return 'BEGIN:VCALENDAR\r\n' + ev + '\r\nEND:VCALENDAR';
}

// A fixture for Lillehammer G16-3 — a real team in the club, in a series this
// sheet does not follow. It must stay out unless the config asks for it.
const G16_3 = {
  serie: 'G16 2.div avd 01 Høst', homeLong: 'Lillehammer G16-3', awayLong: 'Raufoss G16-1',
  bane: 'Stampesletta', dato: '12.09.2026', tid: '12:00', dag: 'lørdag'
};

let CONFIG_ROWS = [
  ['Nøkkel', 'Kamper'],
  ['Klubb-ID', '1683'],
  ['Lag', 'Lillehammer G15-1'],
  ['Lag', 'Lillehammer G15-2'],
  ['Lag', 'Lillehammer G16-1'],
  ['Lag', 'Lillehammer G16-2'],
  ['Varsle e-post', 'din@epost.no'],
  ['Sorter etter dato', 'ja']
];
const setFormatMode = m => {
  CONFIG_ROWS = CONFIG_ROWS.filter(r => r[0] !== 'Formater rader');
  if (m) CONFIG_ROWS.push(['Formater rader', m]);
};

// ---- Apps Script stubs -----------------------------------------------------
const written = [];
let appended = [];
const props = {};
const sandbox = {
  console, FORMULAS_ON: false,
  Logger: { log: () => {} },
  MailApp: { sendEmail: () => {} },
  HtmlService: { createHtmlOutput: () => ({ setWidth: () => ({ setHeight: () => ({}) }) }) },
  ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ atHour: () => ({ everyDays: () => ({ create: () => {} }) }) }) }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ setMimeType: () => s }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
  UrlFetchApp: {
    fetch: () => ({ getResponseCode: () => 200, getContentText: () => icsOf(sandbox.FEED) })
  },
  Utilities: {
    getUuid: () => 'x',
    formatDate: (d, tz, fmt) => {
      const p = n => String(n).padStart(2, '0');
      if (fmt === 'HH:mm') return p(d.getHours()) + ':' + p(d.getMinutes());
      if (fmt === 'dd.MM.yyyy') return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear();
      if (fmt === 'yyyy-MM-dd') return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
      return d.toISOString();
    }
  },
  SpreadsheetApp: {
    getUi: () => ({ createMenu: () => ({ addItem() { return this; }, addToUi() {} }) }),
    getActiveSpreadsheet: () => ({
      getNumSheets: () => 2,
      insertSheet: () => { throw new Error('config sheet already exists in this harness'); },
      getSheetByName: (n) => n === 'config'
        ? { getName: () => 'config',
            getDataRange: () => ({ getValues: () => CONFIG_ROWS }),
            getRange: (r, c) => {
              const f = CELL_FMT[r + ',' + c] || {};
              return {
                getBackground: () => f.bg || '#ffffff',
                getFontColor:  () => f.fg || '#000000',
                getFontWeight: () => f.weight || 'normal',
                getFontStyle:  () => f.style || 'normal',
                getFontLine:   () => f.line || 'none',
                getFontFamily: () => f.family || 'Arial',
                getFontSize:   () => f.size || 10,
                getHorizontalAlignment: () => f.align || 'left',
                copyFormatToRange: (sh, c1, c2, r1, r2) =>
                  COPIES.push({ c1: c1, c2: c2, r1: r1, r2: r2 })
              };
            } }
        : n === 'Kamper' ? MAIN
        : (sandbox.WITH_DECOY && n === 'Notater') ? DECOY
        : null,
      getSheets: () => (sandbox.WITH_DECOY ? [DECOY] : []).concat([MAIN]),
    })
  }
};

const MAIN = {
        getName: () => 'Kamper',
        getDataRange: () => ({
          getValues: () => sheetValues,
          getFormulas: () => sheetValues.map((row, ri) => row.map((_, ci) =>
            (sandbox.FORMULAS_ON && ri > 0 && ci === C['Tid']) ? '=X' + (ri + 1) : ''))
        }),
        getLastColumn: () => HEADER.length,
        getLastRow: () => sheetValues.length,
        getRange: (r, c, nr, nc) => ({
          setValue: v => written.push([r, c, v]),
          setValues: vs => { appended = appended.concat(vs); },
          getValues: () => sheetValues.slice(r - 1, r - 1 + (nr || 1)).map(row => row.slice(c - 1, c - 1 + (nc || 1))),
          getFormulas: () => Array.from({ length: nr || 1 }, () =>
            Array.from({ length: nc || 1 }, (_, ci) =>
              (sandbox.FORMULAS_ON && (c - 1 + ci) === C['Tid']) ? '=X2' : '')),
          sort: (spec) => { sandbox.SORTED = spec; },
          getBackgrounds: () => grid(nr, nc, '#ffffff'),
          getFontColors:  () => grid(nr, nc, '#000000'),
          getFontWeights: () => grid(nr, nc, 'normal'),
          getFontStyles:  () => grid(nr, nc, 'normal'),
          getFontLines:   () => grid(nr, nc, 'none'),
          getFontFamilies: () => grid(nr, nc, 'Arial'),
          getFontSizes:   () => grid(nr, nc, 10),
          getHorizontalAlignments: () => grid(nr, nc, 'left'),
          getNumberFormats: () => grid(nr, nc, 'dd.MM.yyyy'),
          setNumberFormats: v => { FMT.numberFormats = { col: c, width: nc, value: v }; },
          setBackgrounds: v => { FMT.restored = (FMT.restored || 0) + 1; FMT.lastRestoreCol = c; (FMT.restoreCols = FMT.restoreCols || []).push(c); },
          setFontColors:  () => {}, setFontWeights: () => {}, setFontStyles: () => {},
          setFontLines:   () => {}, setFontFamilies: () => {}, setFontSizes: () => {},
          setHorizontalAlignments: () => {}
        })
};

const grid = (r, c, v) => Array.from({ length: r || 1 }, () => Array.from({ length: c || 1 }, () => v));
const FMT = {};
// Format on the config sheet's Lag cells, keyed "row,col" (1-based).
let CELL_FMT = {};
let COPIES = [];

// A tab sitting in front of the fixture sheet with no Turnering header —
// notes, a chart, anything. It must not be mistaken for the fixture table.
const DECOY = {
  getName: () => 'Notater',
  getLastRow: () => 2,
  getLastColumn: () => 2,
  getDataRange: () => ({ getValues: () => [['Huskeliste', ''], ['ringe dommer', '']], getFormulas: () => [['', ''], ['', '']] }),
  getRange: () => ({ getValues: () => [['Huskeliste', ''], ['ringe dommer', '']] })
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(__dirname + '/../../src/Code.js', 'utf8'), sandbox);   // also a syntax check
sandbox.FEED = makeFeed();

// ---- assertions ------------------------------------------------------------
let failures = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : `\n        got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`));
};

console.log('--- shortenName_ ---');
[['Nordre Land IL/Torpa IL G15-2', 'Nordre Land/Torpa 2'],
 ['Lillehammer G16-1', 'Lillehammer'],
 ['Lillehammer G15-2', 'Lillehammer 2'],
 ['Øystre Slidre IL/Rogne IL/FK Vang G15-1', 'Øystre Slidre/Rogne/Vang'],
 ['Reinsvoll IF/Eina SK/Bøverbru IL G15-1', 'Reinsvoll/Eina/Bøverbru'],
 ['Follebu Gausdal FK G15-1', 'Follebu Gausdal'],
 ['Stange  G15-1', 'Stange']
].forEach(([inp, want]) => check(inp, sandbox.shortenName_(inp), want));

console.log('\n--- matchKey_ ---');
check('survives a date change (key ignores dates)',
  sandbox.matchKey_('G16 Interkrets', 'Lørenskog G16-1', 'Lillehammer G16-1'),
  sandbox.matchKey_('G16 Interkrets', 'Lørenskog', 'Lillehammer'));
check('home and away are not interchangeable',
  sandbox.matchKey_('X', 'A', 'B') === sandbox.matchKey_('X', 'B', 'A'), false);
const keys = sandbox.FEED.map(f => sandbox.matchKey_(f.serie, f.homeLong, f.awayLong));
check('all 39 feed fixtures have distinct keys', new Set(keys).size, keys.length);

console.log('\n--- buildPlan_: matching survives the short/long name switch ---');
const plan = sandbox.buildPlans_()[0];
check('no rows treated as new', plan.additions.length, 0);
check('not flagged as suspect', plan.suspect, false);
// The two played rows are absent from the feed, but they are in the past, so
// they are correctly left silent rather than nagged about every night.
check('played rows absent from the feed are not reported', plan.missingFromFeed.length, 0);

console.log('\n--- buildPlan_: the two real deltas ---');
check('Ottestad needs no date write — sheet and feed already agree',
  (plan.updates.find(u => /Ottestad G16-1/.test(u.label)) || { changes: [] })
    .changes.filter(c => c.column === 'Dato').length, 0);
const lor = plan.updates.find(u => /Lørenskog/.test(u.label));
check('Lørenskog: Dato, Dag and Tid all move',
  lor.changes.map(c => c.column).filter(c => c !== 'Hjemmelag' && c !== 'Bortelag').sort(),
  ['Dag', 'Dato', 'Tid']);
check('Lørenskog: Dato takes the feed value',
  lor.changes.find(c => c.column === 'Dato'), { column: 'Dato', from: '20.09.2026', to: '19.09.2026' });

console.log('\n--- formula protection ---');
sandbox.FORMULAS_ON = true;
const lorF = sandbox.buildPlans_()[0].updates.find(u => /Lørenskog/.test(u.label));
// The formula sits in Tid here — protection is now per cell, not per column.
check('a cell holding a formula is left alone, whatever the column',
  lorF.changes.map(c => c.column).filter(c => c !== 'Hjemmelag' && c !== 'Bortelag').sort(),
  ['Dag', 'Dato']);
sandbox.FORMULAS_ON = false;

console.log('\n--- team names follow fotball.no verbatim ---');
check('every row is proposed the feed spelling', plan.nameChanges.length, 78);
const nc = plan.nameChanges.find(n => n.from === 'Nordre Land/Torpa 2');
check('short sheet name -> full feed name', nc.to, 'Nordre Land IL/Torpa IL G15-2');
check('Vind IL is no longer a special case',
  (plan.nameChanges.find(n => n.from === 'Vind IL') || {}).to, 'Vind IL G16-1');
check('and the row still matched, so nothing was duplicated', plan.additions.length, 0);

// Second sync: the sheet now holds the long names, and must still match.
const longSheet = sheetValues.map(r => r.slice());
longSheet.slice(1).forEach(r => {
  const serie = r[C['Turnering']];
  if (!serie) return;
  r[C['Hjemmelag']] = longOf(r[C['Hjemmelag']], serie);
  r[C['Bortelag']] = longOf(r[C['Bortelag']], serie);
});
const original = sheetValues.splice(0, sheetValues.length, ...longSheet);
const plan2 = sandbox.buildPlans_()[0];
check('re-running against long names finds no new rows', plan2.additions.length, 0);
check('and proposes no further name churn', plan2.nameChanges.length, 0);
sheetValues.splice(0, sheetValues.length, ...original);

console.log('\n--- optional columns ---');
// Drop "Dag": a sheet that does not care which weekday it is.
const FULL_HEADER = HEADER.slice(), FULL_ROWS = sheetValues.slice(1).map(r => r.slice());
const dagIdx = C['Dag'];
HEADER.splice(dagIdx, 1);
Object.keys(C).forEach(k => delete C[k]);
HEADER.forEach((h, i2) => C[h] = i2);
sheetValues.splice(0, sheetValues.length,
  HEADER, ...FULL_ROWS.map(r => r.filter((_, i2) => i2 !== dagIdx)));

const planNoDag = sandbox.buildPlans_('Kamper')[0];
check('a sheet without "Dag" still builds a plan', typeof planNoDag.updates, 'object');
check('nothing is written to the missing column',
  planNoDag.updates.every(u => u.changes.every(c => c.column !== 'Dag')), true);
check('no cell is read as the literal string "undefined"',
  planNoDag.updates.every(u => u.changes.every(c => c.from !== 'undefined')), true);
check('rows still match, so nothing is duplicated', planNoDag.additions.length, 0);
check('Lørenskog still syncs its date',
  (planNoDag.updates.find(u => /Lørenskog/.test(u.label)) || { changes: [] })
    .changes.some(c => c.column === 'Dato' && c.to === '19.09.2026'), true);

const noTurnering = HEADER.filter(h => h !== 'Turnering');
sheetValues.splice(0, 1, noTurnering);
check('missing required columns fail with a list', (() => {
  try { sandbox.locateTable_({ sheetName: 'Kamper' }); return false; }
  catch (e) { return /Turnering/.test(e.message); }
})(), true);

Object.keys(C).forEach(k => delete C[k]);
FULL_HEADER.forEach((h, i2) => C[h] = i2);
HEADER.splice(0, HEADER.length, ...FULL_HEADER);
sheetValues.splice(0, sheetValues.length, FULL_HEADER, ...FULL_ROWS);

console.log('\n--- filling an empty sheet is not a duplication risk ---');
// A brand new fixture tab: header row only. Everything in the feed is new, and
// that is exactly right — there are no existing rows to fail to recognise.
const FULL = sheetValues.slice(1).map(r => r.slice());
sheetValues.splice(1, sheetValues.length - 1);
const planEmpty = sandbox.buildPlans_('Kamper')[0];
check('every fixture is queued for insertion', planEmpty.additions.length, sandbox.FEED.length);
check('and it is NOT flagged as suspect', planEmpty.suspect, false);
appended = [];
check('so the rows actually get written', sandbox.applyPlan_(planEmpty).rowsAdded, sandbox.FEED.length);
sheetValues.splice(1, sheetValues.length - 1, ...FULL);

console.log('\n--- safety rail against mass duplication ---');
// Simulate the failure that actually happened: nothing matches, so every
// fixture looks new. Renaming the teams alone is not enough — the date
// fallback still catches those — so this also drifts the series names, which
// is the realistic way total mismatch happens (CONFIG.SERIES going stale
// after an age-group change).
sandbox.FEED = makeFeed().map(f => ({ ...f, serie: f.serie + ' 2027', homeLong: 'Zzz ' + f.homeLong }));
const planBad = sandbox.buildPlans_()[0];
check('a whole-feed mismatch is flagged as suspect', planBad.suspect, true);
check('  ... and the reason counts unrecognised rows, not new ones',
  [planBad.matchedRows, planBad.existingRows], [0, 41]);
appended = [];
const resBad = sandbox.applyPlan_(planBad);
check('  ... and no rows are appended', [resBad.rowsAdded, appended.length], [0, 0]);
check('  ... and the reason is reported', typeof planBad.suspectReason === 'string', true);
check('  ... but it can be overridden deliberately', (() => {
  appended = []; planBad.forceAdditions = true;
  return sandbox.applyPlan_(planBad).rowsAdded > 0;
})(), true);
sandbox.FEED = makeFeed();

console.log('\n--- the header names the teams that were actually matched ---');
CONFIG_ROWS = CONFIG_ROWS.filter(r => r[0] !== 'Lag').concat([
  ['Lag', 'Lillehammer G15'],        // a prefix covering two real teams
  ['Lag', 'Lillehammer J17']         // a team with no fixtures at all
]);
const planPfx = sandbox.buildPlans_('Kamper')[0];
check('the prefix is expanded to the teams it hit',
  planPfx.teams, ['Lillehammer G15-1', 'Lillehammer G15-2']);
check('the raw filter is still available', planPfx.teamFilter.length, 2);
check('and a prefix that hit nothing is reported',
  planPfx.teamsWithoutMatch, ['Lillehammer J17']);
check('the header shows the resolved names',
  sandbox.renderPlan_(planPfx).split('\n')[0].indexOf('Lag: Lillehammer G15-1, Lillehammer G15-2') > 0, true);
CONFIG_ROWS = CONFIG_ROWS.filter(r => r[0] !== 'Lag').concat([
  ['Lag', 'Lillehammer G15-1'], ['Lag', 'Lillehammer G15-2'],
  ['Lag', 'Lillehammer G16-1'], ['Lag', 'Lillehammer G16-2']]);

console.log('\n--- team filter from the config sheet ---');
sandbox.FEED = makeFeed().concat([G16_3]);
const planTeams = sandbox.buildPlans_()[0];
check('G16-3 is not picked up by the four exact team names', planTeams.additions.length, 0);
check('the followed teams are reported back', planTeams.teams.length, 4);

CONFIG_ROWS = CONFIG_ROWS.filter(r => r[0] !== 'Lag')
  .concat([['Lag', 'Lillehammer G15'], ['Lag', 'Lillehammer G16']]);
const planBroad = sandbox.buildPlans_()[0];
check('broadening the prefix to "Lillehammer G16" pulls G16-3 in',
  planBroad.additions.map(a => a.home), ['Lillehammer G16-3']);
check('  ... and one new fixture is not mistaken for a mass insert', planBroad.suspect, false);
CONFIG_ROWS = CONFIG_ROWS.filter(r => r[0] !== 'Lag').concat([
  ['Lag', 'Lillehammer G15-1'], ['Lag', 'Lillehammer G15-2'],
  ['Lag', 'Lillehammer G16-1'], ['Lag', 'Lillehammer G16-2']]);
sandbox.FEED = makeFeed();

console.log('\n--- one config column per fixture sheet ---');
// A second column, headed with a sheet name, is a second terminliste.
const SAVED = CONFIG_ROWS.map(r => r.slice());
CONFIG_ROWS = [
  ['Nøkkel', 'Kamper', 'J13 2026'],
  ['Klubb-ID', '1683', '1683'],
  ['Lag', 'Lillehammer G15-1', 'Lillehammer J13-1'],
  ['Lag', 'Lillehammer G15-2', ''],
  ['Lag', 'Lillehammer G16-1', ''],
  ['Lag', 'Lillehammer G16-2', ''],
  ['Varsle e-post', 'en@epost.no', 'to@epost.no'],
  ['Sorter etter dato', 'ja', 'nei']
];
const profs = sandbox.loadProfiles_();
check('two columns give two profiles', profs.length, 2);
check('the column header names the sheet', profs.map(p => p.sheetName), ['Kamper', 'J13 2026']);
check('teams are read down each column, ragged lengths fine',
  profs.map(p => p.teams.length), [4, 1]);
check('each sheet keeps its own recipient',
  profs.map(p => p.notifyEmail), ['en@epost.no', 'to@epost.no']);
check('and its own sort setting', profs.map(p => p.sortAfterSync), [true, false]);
check('a named sheet filter selects one profile',
  sandbox.buildPlans_('Kamper').map(p => p.sheetName), ['Kamper']);
check('an unknown sheet name is an error, not silence', (() => {
  try { sandbox.buildPlans_('Finnes ikke'); return false; } catch (e) { return /Finnes ikke/.test(e.message); }
})(), true);
check('plans carry the sheet they belong to', sandbox.buildPlans_('Kamper')[0].sheetName, 'Kamper');

// The old single-column layout still has to load.
CONFIG_ROWS = [['Nøkkel', 'Verdi'], ['Klubb-ID', '1683'], ['Lag', 'Lillehammer G15-1']];
const legacy = sandbox.loadProfiles_();
check('the old "Verdi" column still loads', legacy.length, 1);
check('  ... and falls back to finding the sheet by content', legacy[0].sheetName, '');
CONFIG_ROWS = SAVED;

console.log('\n--- finding the fixture sheet ---');
sandbox.WITH_DECOY = true;
check('a tab without a Turnering header is skipped',
  sandbox.locateTable_({}).sheet.getName(), 'Kamper');
check('the fixture tab can be named anything',
  sandbox.locateTable_({}).col['Turnering'] !== undefined, true);
check('a wrong "Ark" name fails loudly and lists the tabs', (() => {
  try { sandbox.locateTable_({ sheetName: 'Finnes ikke' }); return 'no error'; }
  catch (e) { return /Finnes ikke/.test(e.message) && /Notater, Kamper/.test(e.message); }
})(), true);
sandbox.WITH_DECOY = false;

console.log('\n--- sorting by Dato ---');
// Shuffle the sheet so a sort has something to do, then sort it back.
const inOrder = sheetValues.slice(1).map(r => r.slice());
const shuffled = [inOrder[10], inOrder[0], inOrder[30], ...inOrder.filter((_, i) => ![0, 10, 30].includes(i))];
sheetValues.splice(1, sheetValues.length - 1, ...shuffled);

appended = [];
const sortRes = sandbox.sortByDato_(sandbox.locateTable_());
check('text dates are sorted by the script, not alphabetically', sortRes.sorted, true);
const outDates = appended.map(r => r[C['Dato']]).filter(Boolean);
const iso = d => d.split('.').reverse().join('-');
check('result is in ascending date order',
  outDates.every((d, i) => i === 0 || iso(outDates[i - 1]) <= iso(d)), true);
check('13.10 is not placed before 03.09 (the alphabetical trap)',
  outDates.indexOf('03.09.2026') < outDates.indexOf('13.10.2026'), true);
check('no rows lost or gained', appended.length, 41);

appended = [];
sandbox.FORMULAS_ON = true;
const sortF = sandbox.sortByDato_(sandbox.locateTable_());
check('refuses to sort text dates when formulas are present', sortF.sorted, false);
check('  ... and writes nothing', appended.length, 0);
check('  ... and explains why', /formler/.test(sortF.reason), true);
sandbox.FORMULAS_ON = false;
sheetValues.splice(1, sheetValues.length - 1, ...inOrder);

console.log('\n--- row formatting inherited from the Lag cell ---');
const lagRow = CONFIG_ROWS.findIndex(r => r[1] === 'Lillehammer G15-2') + 1;

// After a sync the sheet carries fotball.no's verbatim names, and that is what
// the Lag prefix is matched against. Put the harness in that state first.
const SHORT_ROWS = sheetValues.slice(1).map(r => r.slice());
sheetValues.slice(1).forEach(r => {
  const serie = r[C['Turnering']];
  if (!serie) return;
  r[C['Hjemmelag']] = longOf(r[C['Hjemmelag']], serie);
  r[C['Bortelag']] = longOf(r[C['Bortelag']], serie);
});

CELL_FMT = {}; COPIES = []; Object.keys(FMT).forEach(k => delete FMT[k]);

// Default is "alle": every Lag cell drives its rows, formatted-looking or not.
// This is the only mode where a border-only cell works, because borders cannot
// be read back and such a cell is indistinguishable from an empty one.
setFormatMode(null);
const resAll = sandbox.applyRowFormats_(sandbox.locateTable_({ sheetName: 'Kamper' }), sandbox.loadProfiles_()[0]);
check('default mode is "alle"', resAll.mode, 'alle');
check('  ... so a plain Lag cell still drives its rows', resAll.teams, 4);
check('  ... and every matched row is copied to', COPIES.length > 30, true);

setFormatMode('markerte');
COPIES = [];
check('mode "markerte" skips unmarked cells',
  sandbox.applyRowFormats_(sandbox.locateTable_({ sheetName: 'Kamper' }), sandbox.loadProfiles_()[0]),
  { formatted: 0, teams: 0, mode: 'markerte' });
check('  ... and copies nothing', COPIES.length, 0);

setFormatMode('nei');
COPIES = [];
check('mode "nei" turns formatting off entirely',
  sandbox.applyRowFormats_(sandbox.locateTable_({ sheetName: 'Kamper' }), sandbox.loadProfiles_()[0]).teams, 0);
check('  ... and copies nothing', COPIES.length, 0);
setFormatMode('markerte');

// Under "markerte", a cell with a visible marking is picked up.
CELL_FMT[lagRow + ',2'] = { bg: '#00008b', fg: '#ffffff', line: 'underline' };
COPIES = []; delete FMT.restoreCols;
const res = sandbox.applyRowFormats_(sandbox.locateTable_({ sheetName: 'Kamper' }), sandbox.loadProfiles_()[0]);
check('only the one formatted team is applied', res.teams, 1);
check('and it hits every row that team plays in', res.formatted, 10);
check('one whole-format copy per matched row', COPIES.length, 10);
check('the copy spans the full row, so the border wraps it',
  COPIES.every(c => c.c1 === 1 && c.c2 === HEADER.length && c.r1 === c.r2), true);

const matchedRows = sheetValues.slice(1)
  .map((r, i2) => (r[C['Hjemmelag']] === 'Lillehammer G15-2' || r[C['Bortelag']] === 'Lillehammer G15-2') ? i2 + 2 : null)
  .filter(Boolean);
check('and only those rows', COPIES.map(c => c.r1).sort((a, b) => a - b), matchedRows);
check('number formats are put back, so dates keep displaying as dates',
  FMT.numberFormats && FMT.numberFormats.width, HEADER.length);
check('the date and Kommentar columns get their own look restored afterwards',
  (FMT.restoreCols || []).slice().sort((a, b) => a - b),
  [C['Kommentar'] + 1, C['Dato'] + 1].sort((a, b) => a - b));

CELL_FMT = {}; COPIES = []; setFormatMode(null);
sheetValues.splice(1, sheetValues.length - 1, ...SHORT_ROWS);

console.log('\n--- the report ---');
const rp = sandbox.renderPlan_({
  sheetName: 'G15 - G16',
  teams: ['Lillehammer G15-1', 'Lillehammer G15-2'],
  feedCount: 39, suspect: false, additions: [], missingFromFeed: [],
  updates: [
    { row: 16, label: '07.09.2026 Lillehammer G15-2 - Gjøvik-Lyn G15- (G15 2. div avd 02 Høst)',
      changes: [{ column: 'Bortelag', from: 'Gjøvik-Lyn G15-', to: 'Gjøvik-Lyn G15-1' }] },
    { row: 24, label: '20.09.2026 Lørenskog G16-1 - Lillehammer G16-1 (G16 Interkrets)',
      changes: [{ column: 'Dato', from: '20.09.2026', to: '19.09.2026' },
                { column: 'Tid', from: '14:45', to: '18:00' }] }
  ]
}).split('\n');
check('the teams sit on the header line, not in a trailing block',
  rp[0], 'TERMINLISTE: G15 - G16 (Lag: Lillehammer G15-1, Lillehammer G15-2)');
check('a prefix that matched nothing is called out', sandbox.renderPlan_({
  sheetName: 'J17 - damer', teams: ['Lillehammer Kvinner 1', 'Lillehammer Kvinner 2'],
  teamsWithoutMatch: ['Lillehammer J17'], feedCount: 17, suspect: false,
  updates: [], additions: [], missingFromFeed: []
}).split('\n')[2], 'UTEN TREFF I KALENDEREN: Lillehammer J17');
check('a name-only change is one bare line, no match repeated',
  rp[3], 'rad 16 Gjøvik-Lyn G15- -> Gjøvik-Lyn G15-1');
check('a date/time change keeps the match, so the row means something',
  rp[4], 'rad 24 Lørenskog G16-1 - Lillehammer G16-1: 20.09.2026 -> 19.09.2026, 14:45 -> 18:00');
check('no separate LAGNAVN section any more', /LAGNAVN/.test(rp.join('\n')), false);
check('and no trailing "Lag som følges" block', /Lag som følges/.test(rp.join('\n')), false);
check('nothing to report is a single line',
  sandbox.renderPlan_({ sheetName: 'X', teams: ['A'], feedCount: 39, suspect: false,
    updates: [], additions: [], missingFromFeed: [] }).split('\n')[2],
  'Ingen endringer. I takt med fotball.no (39 kamper).');

console.log('\n--- filterPlan_ (selective apply) ---');
const mk = () => ({ updates: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }], additions: [{ key: 'c', label: 'C' }] });
const ex = sandbox.filterPlan_(mk(), null, ['a']);
check('exclude drops only the named key', [ex.updates.map(u => u.key), ex.additions.map(a => a.key)], [['b'], ['c']]);
check('exclude records what it skipped', ex.skipped.map(s => s.key), ['a']);
const on = sandbox.filterPlan_(mk(), ['a', 'c'], null);
check('only keeps just the named keys', [on.updates.map(u => u.key), on.additions.map(a => a.key)], [['a'], ['c']]);
check('no filter keeps everything', (() => { const p = sandbox.filterPlan_(mk(), null, null); return [p.updates.length, p.additions.length, p.skipped.length]; })(), [2, 1, 0]);

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'all checks passed'));
process.exit(failures ? 1 : 0);
