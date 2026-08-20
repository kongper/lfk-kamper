---
name: lfk-kamper
description: Sync the "LFK kamper" Google Sheet with Lillehammer FK's official fixture list from fotball.no, keeping team rows formatted, and report what moved. Use this whenever the user mentions the LFK kamper sheet (also called G2011), terminlisten, kampoppsettet, fixtures, kamper, or asks whether any matches have been rescheduled, moved, or added — and also when they ask about collisions (kollisjon), back-to-back match days (påfølgende dager), or which matches are coming up for Lillehammer G15/G16. Trigger on phrases like "sync the sheet", "sjekk terminlisten", "har noen kamper blitt flyttet", "oppdater kampene", "what's changed in the schedule", even when fotball.no is not named explicitly.
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

There is also a **LFK kamper menu inside the sheet** with *Kjør synk* and
*Oppdater formatering*. `Kjør synk` shows the whole report and asks before
writing, so it doubles as the preview. The user can run everything without you,
and the nightly trigger runs without either of you — if the web app is
unreachable, say so and point at the menu rather than treating the sync as
broken.

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

### What the report looks like

One line per changed row. A row whose only change is a team name is printed
bare, because the `from -> to` is the whole story and naming the match would
repeat the new name. Anything else names the match, since a row number alone
does not say which fixture moved.

```
TERMINLISTE: J17 - damer (Lag: Lillehammer Kvinner 1, Lillehammer Kvinner 2)

UTEN TREFF I KALENDEREN: Lillehammer J17

ENDRINGER (2)
rad 16 Gjøvik-Lyn G15- -> Gjøvik-Lyn G15-1
rad 24 Lørenskog G16-1 - Lillehammer G16-1: 20.09.2026 -> 19.09.2026, 14:45 -> 18:00
```

The header lists the teams the prefixes actually **matched**, not the prefixes
themselves — `Lillehammer Kv` is not something the user can act on. `plan.teams`
holds the resolved names, `plan.teamFilter` the raw config values.

`UTEN TREFF I KALENDEREN` names any configured prefix that matched no fixture.
That is usually a team with no matches left this season, or one renamed after an
age-group change. Mention it once; it is informative, not an error.

When relaying this to the user, keep that density — do not expand it back into
a section per change type. Add interpretation only where it earns its place:
a clash created by a move, or a fixture that has vanished from the feed.

### The raw shape of a change

```json
{"row": 24, "label": "20.09.2026 Lørenskog G16-1 - Lillehammer G16-1 (G16 Interkrets)",
 "changes": [{"column": "Dato", "from": "20.09.2026", "to": "19.09.2026"},
             {"column": "Dag", "from": "søndag", "to": "lørdag"},
             {"column": "Tid", "from": "14:45", "to": "18:00"}]}
```

Rendered for the user, that is roughly:

> **Lørenskog – Lillehammer** (G16 Interkrets) er flyttet fra søndag
> 20. september kl. 14:45 til lørdag 19. september kl. 18:00.

Group several changes by date. Name the teams and the series every time — the
user is tracking two teams across four series and a bare row number tells them
nothing.

## Reading the sheet's own logic

Required: `Dato`, `Hjemmelag`, `Bortelag`, `Turnering`. Optional: `Dag`, `Tid`,
`Bane`, `Kommentar`. A column that is not there is neither read nor written, so
absence is a valid choice — do not report it as a problem.

| Column | Written when |
|---|---|
| `Dato`, `Dag`, `Tid`, `Bane` | always, from the feed |
| `Hjemmelag`, `Bortelag` | always, in fotball.no's verbatim spelling |
| `Kommentar` | never |

`Kommentar` is the user's column and the sync never touches it. Agreed
reschedules live there now as free text, so **do not try to parse it, act on it,
or reconcile it against the feed**. If a comment says a match was moved and
fotball.no disagrees, mention it and let the user decide.

A cell containing a formula is never overwritten, whatever column it is in.

### Row formatting

Formatting a `Lag` cell in `config` makes every fixture row for that team look
like that cell — colours, font, alignment and borders, with the border wrapping
the whole row. The date columns and `Kommentar` keep their own colours and
number format but do take the border; they belong to the user, not the team.

`Formater rader` in `config` sets the scope: `alle` (default — every `Lag` cell
drives its rows), `markerte` (only cells with a visible marking), or `nei`.

The reason `alle` is the default is that **Apps Script cannot read borders**. A
cell carrying only a border is indistinguishable from an empty one, so under
`markerte` such a team would silently never format. Under `alle` it works,
at the cost of `config` owning row appearance outright — anything styled
directly on a row is overwritten next sync. If a user wants to hand-colour
individual rows, `markerte` is the mode for them.

It runs at the end of **every** sync, changed fixtures or not, since a colour
edited in `config` should reach the rows without waiting for a reschedule. Also
available on its own via the `format` action or *Oppdater formatering*. Matching
uses the team name as written in the sheet, which after a sync is fotball.no's
spelling.

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

**`Ny dato`, `Varsling` and `KampID` no longer exist.** Earlier versions had
them; the script neither reads nor writes any of them now. If a sheet still has
one, it simply sits there untouched. Agreed reschedules are free text in
`Kommentar`.

## Output language

The sheet, the series names and the flags are Norwegian, and so is the user.
Write summaries of fixture changes in Norwegian, with Norwegian date
conventions (`16.10.2026`, `fredag`). Keep team, venue and series names exactly
as they appear — `Stampesletta Søndre bane`, not a translation or a tidy-up.
