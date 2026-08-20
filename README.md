# lfk-kamper

Keeps a Google Sheet of football fixtures in step with the official schedule on
[fotball.no](https://www.fotball.no), without trampling the notes and agreed
dates the coaches keep in the same sheet.

Built for one Lillehammer FK age group, but the only club-specific things are in
a `config` tab in the spreadsheet, so it will work for any Norwegian club.

## What it does

A Google Apps Script bound to the sheet reads the club's public iCal feed,
filters it down to the teams you follow, and writes back what changed — dates,
kickoff times, pitches, new fixtures. It runs nightly on its own and mails you
only when something actually moved. There is also a menu in the sheet, and an
optional web app so an agent can run a sync and explain the result.

Only four columns are required — `Dato`, `Hjemmelag`, `Bortelag`, `Turnering`.
The last three identify the row; `Dato` anchors it in time. Everything else is
optional, and a column that isn't there is neither read nor written.

| Column | Required | Written by the sync |
|---|---|---|
| `Dato`, `Hjemmelag`, `Bortelag`, `Turnering` | yes | always, from fotball.no |
| `Dag`, `Tid`, `Bane` | no | always, from fotball.no |
| `Kommentar` | no | never — yours, for agreed moves and anything else |

A cell containing a formula is never overwritten, whatever column it is in.

## Row formatting

Format a `Lag` cell in `config` — background, text colour, bold, italic,
underline, borders, font, alignment — and every fixture row for that team ends
up looking like that cell. The border wraps the whole row.

The copy goes through Sheets' own paste-format-only, which is the only route
that carries borders: Apps Script can set them but has no way to read them.
That also brings the number format along, which would turn dates and times into
raw numbers — so number formats are snapshotted and put back afterwards, and
the date columns and `Kommentar` get their own colours and fonts restored while
keeping the new border — those three are yours, so the team's colours stay off
them.

`Formater rader` in `config` controls how far this goes:

| Verdi | Effect |
|---|---|
| `alle` *(default)* | Every `Lag` cell drives its rows, formatted-looking or not. The only mode where a border-only cell works — since borders can't be read back, such a cell is indistinguishable from an empty one. The trade: `config` owns row appearance, so styling applied directly to rows is overwritten on the next sync. |
| `markerte` | Only cells with a visible marking — colour, bold, italic, underline, font, alignment. Rows for teams with a plain cell are left alone. Safe if you colour rows by hand, but border-only won't work. |
| `nei` | No formatting at all. |

Formatting runs at the end of any sync that wrote something, and on demand from
**LFK kamper → Formater rader etter lag**. Matching is on the team name as
written in the sheet, which after a sync is fotball.no's spelling — so run one
sync before expecting a hand-written sheet to pick up colours.

## Three things that were not obvious

**fotball.no regenerates the iCal UIDs.** The feed gives every fixture a `UID`,
which looks like the obvious join key. It is not stable: the same match carried
three different UIDs over a single day. An early version stored them, and on the
next run nothing matched, every fixture looked new, and the sheet got a complete
duplicate of itself. Rows are now matched on *content* — series plus both team
names, normalised — so there is no stored identifier that can go stale.

**Normalisation has to be loose enough to survive renaming.** The key strips
club words (`IL`, `FK`, `SK`) and the trailing team registration, so
`Nordre Land/Torpa 2` and `Nordre Land IL/Torpa IL G15-2` produce the same key.
That is what let the sheet switch from short names to fotball.no's full spelling
without losing a single row.

**Appending is the dangerous direction.** A wrong update is one visible cell; a
wrong append is 39 duplicate rows and a manual cleanup. The guard against that
does not count *new* rows — a fresh sheet is all-new, and so is a team entering
a new series. It counts how many rows *already in the sheet* failed to be
recognised. When most of them go unmatched while a pile of insertions is queued,
the sync writes the updates, refuses the insertions, and says so. That pattern
means matching broke, usually a stale `Lag` list after an age-group change.

## Layout

```
src/
  Code.js            the whole Apps Script; clasp uploads it as Code.gs
  appsscript.json    manifest, incl. the web-app access setting
skill/
  SKILL.md           agent instructions
  references/        setup guide
  scripts/lfk.py         HTTP client for the web app
  scripts/test_code.js   regression suite (41 checks, plain node)
tools/
  package-skill.sh   builds dist/lfk-kamper.skill
```

`src/Code.js` is the single source of truth for the script. The packaging step
copies it into the skill bundle rather than a second copy being committed, since
two copies drift the moment someone edits one of them.

## Getting started

```bash
npm install -g @google/clasp
clasp login

cp .clasp.json.example .clasp.json     # then paste your own scriptId
clasp push
```

Then, once, from the Apps Script editor:

- Run **`setup()`**. It creates the `config` tab, installs the nightly trigger,
  and prints an API token to the execution log.
- Reload the spreadsheet. An **LFK kamper** menu appears with *Forhåndsvis synk* and
  *Kjør synk*.

To find your `scriptId`: open the sheet, **Extensions → Apps Script**, then
**⚙ Project Settings**.

Set the Apps Script project timezone to your own. The feed carries local kickoff
times, so a wrong timezone shifts every match by an hour.

## Configuration

Everything club-specific lives in the `config` tab, which holds **one column per
fixture sheet**. The column header is the name of the tab it drives, so a single
spreadsheet can track several squads independently.

| Nøkkel | kampoppsett_2026 | J13 2026 |
|---|---|---|
| Klubb-ID | 1683 | 1683 |
| Lag | Lillehammer G15-1 | Lillehammer J13-1 |
| Lag | Lillehammer G15-2 | |
| Lag | Lillehammer G16-1 | |
| Lag | Lillehammer G16-2 | |
| Varsle e-post | din@epost.no | annen@epost.no |
| Sorter etter dato | ja | ja |
| Formater rader | alle | nei |

A key may repeat down the rows — that is how `Lag` becomes a list — and blank
cells simply mean that column does not use that row. Each column gets its own
nightly mail, so different squads can go to different people.

`Klubb-ID` is the `fiksId` in your club's fotball.no URL:
`fotball.no/fotballdata/klubb/hjem/?fiksId=1683`.

Fixture tabs can be called anything — the column header is what points at them.
A header naming a tab that does not exist fails immediately and lists the tabs
that do, rather than writing somewhere unexpected.

The older single-column layout (header `Verdi`) still loads, and finds its tab
by content: the first tab that isn't `config` and has a `Turnering` header.

`Lag` is matched as a **prefix**, so `Lillehammer G16` catches `G16-1`, `G16-2`
*and* `G16-3`. Be as specific as the teams you actually want.

Reports name the teams a prefix actually matched rather than the prefix itself,
and call out any prefix that matched nothing — usually a team with no fixtures
left, or one renamed after moving up an age group.

Selecting by team rather than by series is deliberate: a team keeps its name for
a season, while series names change every time the squad moves up an age group.
New series and cup matches for the same teams appear on their own.

## The optional web app

Only needed if you want an agent to run syncs conversationally. Deploy as a
**Web app** — not a Library, which serves no HTTP at all — with *Execute as: Me*
and *Who has access: **Anyone***. "Anyone with a Google account" is a different
setting that still demands a signed-in caller, and is the usual cause of a `401`
from a server-side client. `appsscript.json` sets this declaratively:

```json
"webapp": { "executeAs": "USER_DEPLOYING", "access": "ANYONE_ANONYMOUS" }
```

`clasp push` uploads the manifest but does not deploy it — run `clasp deploy` or
bump the version in the editor afterwards.

The endpoint rejects every request without the token from `setup()`. Store the
URL and token in `~/.lfk-kamper.json`:

```json
{ "url": "https://script.google.com/macros/s/…/exec", "token": "…" }
```

```bash
python3 skill/scripts/lfk.py preview                  # read-only diff, all sheets
python3 skill/scripts/lfk.py preview --sheet "J13 2026"
python3 skill/scripts/lfk.py apply                    # write it
```

## Tests

```bash
npm test
```

No dependencies. The suite stubs the Apps Script globals and a synthetic iCal
feed, then runs the real code against a realistic sheet — covering the two-date
write rules, formula protection, name normalisation, the team filter, sorting,
the mass-insert guard, and selective apply.

## Licence

MIT — see [LICENSE](LICENSE).
