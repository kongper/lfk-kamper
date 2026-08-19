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

The sheet keeps two date columns, and the split is the heart of the design:

| Column | Owner | Written by the sync |
|---|---|---|
| `Dato` | fotball.no | always |
| `Ny dato` | the coaches | only when it is mirroring `Dato` |
| `Dag` | follows the date actually played | only when no local agreement exists |
| `Tid`, `Bane`, `Hjemmelag`, `Bortelag` | fotball.no | always |
| `Kommentar` | the coaches | never |

Youth fixtures get moved by agreement between clubs long before FIKS knows about
it. `Ny dato` is where that agreement lives, so the sync must never overwrite it
— and a row where the two dates differ is reported, not "corrected".

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
wrong append is 39 duplicate rows and a manual cleanup. So if more than a
quarter of the feed would be appended as new, the sync writes the updates,
refuses the insertions, and says why. That is nearly always a matching failure —
usually the team list in `config` having gone stale after an age-group change.

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

Everything club-specific lives in the `config` tab, as key/value rows. A key may
repeat, which is how `Lag` becomes a list.

| Nøkkel | Verdi |
|---|---|
| Klubb-ID | 1683 |
| Lag | Lillehammer G15-1 |
| Lag | Lillehammer G15-2 |
| Varsle e-post | din@epost.no |
| Sorter etter dato | ja |

`Klubb-ID` is the `fiksId` in your club's fotball.no URL:
`fotball.no/fotballdata/klubb/hjem/?fiksId=1683`.

`Lag` is matched as a **prefix**, so `Lillehammer G16` catches `G16-1`, `G16-2`
*and* `G16-3`. Be as specific as the teams you actually want.

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
python3 skill/scripts/lfk.py preview   # read-only diff
python3 skill/scripts/lfk.py apply     # write it
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
