---
name: lfk-kamper
description: Sync the "LFK kamper" Google Sheet with Lillehammer FK's official fixture list from fotball.no, protecting the locally agreed dates in the Ny dato column, and report what moved. Use this whenever the user mentions the LFK kamper sheet (also called G2011), terminlisten, kampoppsettet, fixtures, kamper, or asks whether any matches have been rescheduled, moved, or added — and also when they ask about collisions (kollisjon), back-to-back match days (påfølgende dager), or which matches are coming up for Lillehammer G15/G16. Trigger on phrases like "sync the sheet", "sjekk terminlisten", "har noen kamper blitt flyttet", "oppdater kampene", "what's changed in the schedule", even when fotball.no is not named explicitly.
---

# LFK kamper — fixture sync

The user manages the fixture list for Lillehammer FK's 2011-born squad. The
squad plays as two teams across four series, and the authoritative schedule
lives on fotball.no, where matches get moved without notice. The sheet is the
working copy the coaches actually use — it carries their own annotations, which
fotball.no knows nothing about.

So this is a **one-way sync with a protected annotation layer**. fotball.no wins
on *when and where*. The user wins on *everything else*. Getting that boundary
right matters more than anything else in this skill: a sync that silently
overwrites a coach's note has done more damage than one that misses a
reschedule.

## The pieces

An Apps Script web app, bound to the sheet, does the actual work. It fetches
fotball.no's iCal feed from Google's servers and reads/writes the sheet
directly. You talk to it over HTTP.

The reason for that indirection is worth knowing, because it will otherwise
look like pointless complexity: **fotball.no is unreachable from this
sandbox** — the whole domain is disallowed to automated fetchers. Do not try to
`curl` or `WebFetch` it, and do not treat a workaround as clever. Apps Script
runs as the user's own Google account subscribing to a public calendar feed,
which is the sanctioned route. It also means the nightly sync keeps working
when nobody is in a session.

```
fotball.no  --iCal-->  Apps Script  <-->  LFK kamper sheet
                            ^
                            |  HTTPS + token
                        scripts/lfk.py
```

## Commands

Run from the skill directory. Credentials come from `~/.lfk-kamper.json` or the
`LFK_URL` / `LFK_TOKEN` environment variables.

| Command | What it does |
|---|---|
| `ping` | Confirms the endpoint answers and names the sheet |
| `read` | Current sheet contents as JSON |
| `feed` | Current fotball.no fixtures for the followed teams |
| `config` | The settings the script is running on |
| `preview` | The diff — **read-only, always start here** |
| `apply` | Writes the diff to the sheet |
| `apply --exclude KEY` | Writes everything except those match keys |
| `apply --only KEY` | Writes only those match keys |
| `apply --force` | Overrides the mass-insert guard (see below) |

There is also a **LFK kamper menu inside the sheet** with Forhåndsvis synk and Kjør
synk. The user can run the whole thing without you, and the nightly trigger
runs without either of you. If the web app is unreachable, say so and point at
the menu rather than treating the sync as broken.

```bash
python3 scripts/lfk.py preview
```

If `ping` fails or the credentials file is missing, the script has not been
installed yet — go to `references/setup.md` and walk the user through it.

## The normal run

Someone asks whether anything has moved. Do this:

1. `preview`.
2. Show the user what changed, in Norwegian, as prose or a short table — not
   raw JSON. Lead with the reschedules; they are the reason anyone asks.
3. Ask before writing. Then `apply`.

Skip step 3 only when the user has already said to go ahead ("sync it",
"oppdater arket"). A preview they did not ask for is a small waste of their
time; a write they did not ask for is a broken trust.

If `preview` comes back with nothing in `updates` or `additions`, say so in one
line. Do not manufacture a report out of an empty diff.

### What a change looks like

```json
{"row": 24, "label": "20.09.2026 Lørenskog - Lillehammer (G16 Interkrets)",
 "changes": [{"column": "Dato", "from": "20.09.2026", "to": "19.09.2026"},
             {"column": "Ny dato", "from": "20.09.2026", "to": "19.09.2026"},
             {"column": "Dag", "from": "søndag", "to": "lørdag"},
             {"column": "Tid", "from": "14:45", "to": "18:00"}]}
```

Rendered for the user, that is roughly:

> **Lørenskog – Lillehammer** (G16 Interkrets) er flyttet fra søndag
> 20. september kl. 14:45 til lørdag 19. september kl. 18:00.

Note that `Ny dato` moved here only because it was mirroring `Dato`. Do not
present that as two separate changes — it is one reschedule.

Group several changes by date. Name the teams and the series every time — the
user is tracking two teams across four series and a bare row number tells them
nothing.

## Reading the sheet's own logic

The two date columns divide the work between fotball.no and the coaches:

- **`Dato` is what fotball.no says.** The sync always writes it.
- **`Ny dato` is what the coaches have agreed**, which is often not registered
  in FIKS yet. This is the human's column.

A row where the two differ has a local agreement on it, and that agreement is
the whole point of the column — the sync must not be able to tear it away. So:

| Column | Written when |
|---|---|
| `Dato` | always, from the feed |
| `Ny dato` | only when it currently mirrors `Dato` — i.e. there is no agreement there to destroy |
| `Dag` | only on rows with no local agreement (it describes the date actually being played, so on moved rows it belongs to `Ny dato`) |
| `Tid`, `Bane` | always — kickoff and pitch are practical facts, not part of the agreement |
| `Hjemmelag`, `Bortelag` | always, in fotball.no's own spelling, verbatim (`Nordre Land IL/Torpa IL G15-2`) |
| `Kommentar` | never, except `NY` on rows the sync appends |

A formula in `Ny dato` is also left alone, so a sheet that computes that column
keeps computing it.

`Kommentar` is the user's column. The script never writes to it except to stamp
`NY` on rows it appends. The values there are the coaches' own shorthand:

| | |
|---|---|
| `Kollisjon` | Both teams playing at the same time — a squad-splitting problem |
| `Påfølgende dager` | Matches on consecutive days, a load concern |
| `IF` | Innstilt/flyttet — this fixture has been rescheduled |
| `Stjerne-cup` | Clashes with a cup weekend |

These are judgements about *this squad*, not facts from fotball.no. Never
overwrite one, never invent one, and do not "correct" a flag because the
underlying date changed. If a sync makes a flag obsolete or creates a new
conflict, **say so and let the user decide** — see below.

### Flagging consequences

A reschedule often creates a new problem. After showing the diff, check the
resulting schedule and mention it if you see:

- Two fixtures on the same date and time involving `Lillehammer` and
  `Lillehammer 2` — a new `Kollisjon`.
- Fixtures on consecutive calendar days — a new `Påfølgende dager`.
- A row whose `Kommentar` flag no longer applies because the clash it described
  has been resolved by the move.

Offer to update the `Kommentar` cells; do not do it unprompted. This is the
most useful thing the skill does beyond mechanical syncing, because it is the
work the user was doing by hand.

## Configuration lives in the sheet

The `config` tab holds **one column per fixture sheet**, and the column header
is the name of the tab it drives. One spreadsheet can therefore carry several
squads, each with its own teams, recipient and sort setting.

| Nøkkel | kampoppsett_2026 | J13 2026 |
|---|---|---|
| Klubb-ID | 1683 | 1683 |
| Lag | Lillehammer G15-1 | Lillehammer J13-1 |
| Lag | Lillehammer G15-2 | |
| Lag | Lillehammer G16-1 | |
| Lag | Lillehammer G16-2 | |
| Varsle e-post | din@epost.no | annen@epost.no |
| Sorter etter dato | ja | ja |

A key may repeat down the rows — that is how `Lag` becomes a list — and blank
cells just mean that column does not use that row, so columns need not be the
same length.

Every command works across all sheets. `preview` returns `plans`, one per
column; `apply` returns `results`. Pass `--sheet "<name>"` to work on one.
Report each sheet under its own heading — the user is looking at several
squads, and an undifferentiated list of changes is unreadable.

**`Lag` is a prefix, and the scope is deliberately narrow.** The club also has a
`Lillehammer G16-3`, playing a series this sheet does not track, so a prefix of
`Lillehammer G16` would quietly pull in nine fixtures the user does not want.
The four exact names are the safe setting. If the user asks why some fixture is
missing, check this list before suspecting the sync.

Selecting by *team* rather than by series is what makes new fixtures appear
automatically: a team keeps its name all season, while series names change every
time the squad moves up an age group. A cup match or a new series for one of
these four teams now arrives on its own.

`setup()` creates the tab with defaults if it is absent, placed last so it never
displaces the fixture sheet. `config` shows what the script actually loaded.

## Sorting

With `Sorter etter dato = ja`, the fixture table is re-sorted ascending by
`Dato` after any write. Two paths, and the difference matters: if the `Dato`
cells are real dates, the sheet sorts itself and formulas and formatting travel
with the rows. If they are text, the script parses and reorders them, because an
alphabetical sort would put `13.10` before `03.09`.

The text path moves values, not formulas — so if there are formulas anywhere in
the table it refuses to sort and says so rather than flattening them. If the
user wants both sorting and formulas, the fix is to make `Dato` hold real dates.

## How rows are matched, and the guard around it

Rows are matched to fixtures on **content**: series plus both team names,
normalised. Nothing is stored and kept in step, so nothing can go stale.

This matters because the obvious design fails. The iCal feed carries a UID per
fixture, but **fotball.no regenerates it between sessions** — the same match
had three different UIDs over a single day. An earlier version of this skill
stored those UIDs, and on the next sync every fixture matched nothing, looked
new, and got appended. The user had to undo a full duplicate of their fixture
list. Do not reintroduce a stored identifier.

Normalisation strips club words (`IL`, `FK`, `SK`) and the trailing team
registration, so `Nordre Land/Torpa 2` and `Nordre Land IL/Torpa IL G15-2` are
the same key. That is what lets the sheet's spelling change without the sync
losing track of its own rows.

If a club is renamed outright, the name key misses, so there is a second pass
on series + `Dato`. Rows recovered that way are re-labelled from the feed and
reported under `nameChanges`.

**The mass-insert guard.** It fires when a large batch of insertions coincides
with *existing rows failing to match* — `matchedRows` well under `existingRows`
in the plan. Filling an empty sheet for the first time is all insertions and no
unmatched rows, so it passes straight through, as it should. When the guard does
fire, `preview` sets `suspect` with a `suspectReason`, and `apply` writes the
updates but holds the additions. Treat it as a matching failure: the usual cause
is the `Lag` list in `config` having gone stale after an age-group change.
Diagnose it before reaching for `--force`, and never use `--force` without
saying plainly what it will insert.

## Rows carrying a local agreement

`preview` sorts rows with a live `Ny dato` into three buckets. None of them
cause a bad write — that part is handled — but they are the part of a sync the
user actually cares about, so report them.

- **`localMoves`** — the agreement stands, fotball.no has not moved. Routine.
  A line, no more.
- **`resolved`** — fotball.no has now registered the agreed date, so `Dato` and
  `Ny dato` have converged. Say it plainly: the move is official, the row no
  longer needs watching.
- **`conflicts`** — fotball.no has moved the fixture to a *third* date, neither
  the old one nor the agreed one. **Lead with these.** Someone has rescheduled
  around an agreement the district does not know about, and only the user can
  untangle it.

> **Ottestad – Lillehammer 2** (G16 Elite Høst): dere har avtalt 16.10, men
> fotball.no har nå flyttet kampen til 22.10. Avtalen står urørt i arket —
> hvilken dato gjelder?

**Do not let one contested row hold up the rest.** A sync often mixes one
questionable change in with several obvious ones, and the obvious ones are
worth having now. Apply the uncontested part and carry the question:

```bash
python3 scripts/lfk.py apply --exclude "<key from the preview>"
```

Each update and addition carries the `key` you pass here. Tell the user plainly
what you wrote and what you held back, so nothing is left silently pending.

## Things that will bite

**Rows are never deleted.** A fixture that vanishes from the feed shows up in
`missingFromFeed`, not in a deletion. It usually means the match was played and
aged out, but for a future date it can mean a cancellation — surface those.

**The nightly run emails the user only when something changed.** If they say
"I got a mail from the sheet", that is this. `preview` will usually be empty
because the nightly run already applied it; read the mail's contents rather
than re-deriving them.

**Zero changes plus fixtures still in the future** usually means the `Lag` list
in the `config` tab has gone stale — most often after the squad moved up an age
group and the team names changed. Run `config` to see what is loaded.

**Times are local.** If every kickoff looks an hour off, the Apps Script
project timezone is wrong, not the feed.

**A fixture tab is addressed by its config column header.** If a column is
headed with a name no tab matches, that sheet fails loudly and lists the tabs it
did find. The legacy single-column layout (header `Verdi`) still loads and falls
back to finding the tab by content — the first tab that is not `config` and has
a `Turnering` header.

**Team names are rewritten to fotball.no's spelling on every sync.** The first
run after a sheet has been kept in short names therefore proposes a name change
on nearly every row. That is expected and is not a matching failure — summarise
it as one line ("lagnavn justert til fotball.no sin skrivemåte") rather than
listing every row. `preview` caps the listing at eight for the same reason.

**`Varsling` and `KampID` are gone.** The script neither reads nor writes them.
`ryddKolonner()`, run from the Apps Script editor, deletes them if they are
still present; it is deliberately not on the menu because it destroys data.

## Output language

The sheet, the series names and the flags are Norwegian, and so is the user.
Write summaries of fixture changes in Norwegian, with Norwegian date
conventions (`16.10.2026`, `fredag`). Keep team, venue and series names exactly
as they appear — `Stampesletta Søndre bane`, not a translation or a tidy-up.
