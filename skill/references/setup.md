# One-time setup

Walk the user through this the first time. It takes about five minutes and only
has to be done once. Everything after that is automatic.

## 1. Install the script

1. Open the **LFK kamper** sheet.
2. **Extensions → Apps Script**. A new tab opens with an empty `Code.gs`.
3. Delete whatever is in the editor and paste the entire contents of
   `assets/Kode.gs` from this skill.
4. Click the **⚙ Project Settings** (gear) in the left sidebar and confirm the
   timezone is **(GMT+01:00) Oslo**. The script writes local match times, so a
   wrong timezone here shifts every kickoff by an hour.
5. Save (**Ctrl/Cmd + S**).

## 2. Run `setup()`

1. In the function dropdown at the top, pick **setup**, then click **Run**.
2. Google asks for authorisation the first time. The script needs to read and
   write this spreadsheet, fetch `fotball.no`, and send mail — approve it.
   Google will show an "unverified app" warning because this is a private
   script the user wrote themselves; **Advanced → Go to … (unsafe)** is the
   normal path through it.
3. Open **Execution log**. It prints the `API_TOKEN`. Ask the user to copy it.

`setup()` installs the nightly trigger and is safe to re-run — it will not
create duplicate triggers or a second token.

If the sheet still has the old `Varsling` or `KampID` columns, run
`ryddKolonner()` once from the same dropdown to remove them. It only deletes
columns with exactly those headers, and logs what it did.

## 3. Deploy as a web app

1. **Deploy → New deployment**. Click the **gear next to "Select type"** and
   pick **Web app** — *not* Library. A Library deployment does not serve HTTP
   at all, and its `/exec` URL answers 401 no matter how access is set.
2. Execute as: **Me**. Who has access: **Anyone**.
3. **Deploy**, then copy the web app URL (it looks like
   `https://script.google.com/macros/s/AKfy…/exec`).

"Anyone" sounds alarming but the endpoint rejects every request that does not
carry the token — that is what the token is for. Say this plainly if the user
hesitates; it is a fair thing to hesitate about.

## 4. Store the credentials

Write them where `scripts/lfk.py` will find them:

```bash
cat > ~/.lfk-kamper.json <<'EOF'
{"url": "PASTE_WEB_APP_URL", "token": "PASTE_TOKEN"}
EOF
chmod 600 ~/.lfk-kamper.json
```

This sandbox is discarded when the session ends, so the file will not be there
next time. Save the URL and token to the Claude project as well
(`project_write`) so a future session can restore it in one step — but ask
first, because it means the token is stored in the project.

## 5. Verify

```bash
python3 scripts/lfk.py ping      # should report the sheet name
python3 scripts/lfk.py preview   # read-only
```

Check that the sheet name `ping` reports is the tab the user actually works in.
If it is a backup copy, set `CONFIG.SHEET_NAME` in the script.

There is no linking or backfill step. Rows are matched on series + team names
every time, so a fresh sheet and a long-running one behave identically.

Expect the first `preview` to propose a team-name change on nearly every row:
names are written in fotball.no's full spelling, and a sheet kept in short names
will differ everywhere. It settles after one sync.

## The web app is optional

Everything above the deployment step is enough on its own: the sheet gets a
**LFK kamper** menu (Forhåndsvis synk / Kjør synk) and the nightly trigger mails the
user when something moves. The web app only exists so Claude can run and
interpret a sync inside a conversation. If deploying it turns into a fight,
skip it — the sync still works.

## Changing teams between seasons

The `config` tab lists the teams to follow under `Lag`, matched as a prefix.
When the squad moves up an age group the team names change — `Lillehammer G15-1`
becomes `Lillehammer G16-1` and so on — and the sync stops recognising anything
until that list is updated.

To find the current names, open
`https://www.fotball.no/fotballdata/klubb/hjem/?fiksId=1683&underside=lag`
and read the Ungdom section, or ask the user.

Two symptoms point here. Zero updates *and* zero additions while the sheet has
future fixtures means the team filter matched nothing. A sync proposing to
append most of the fixture list means the same thing from the other side — the
mass-insert guard will catch that one and refuse to write.

Keep the names as specific as the teams you actually want. `Lillehammer G16`
matches `Lillehammer G16-3` too, which plays a series this sheet does not track.
