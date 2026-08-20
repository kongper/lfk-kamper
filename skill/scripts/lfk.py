#!/usr/bin/env python3
"""
Klient mot LFK kamper-synken (Apps Script web app).

Bruk:
    python3 lfk.py ping
    python3 lfk.py read
    python3 lfk.py feed
    python3 lfk.py config
    python3 lfk.py format
    python3 lfk.py preview
    python3 lfk.py apply
    python3 lfk.py apply --exclude "<kampnokkel>"   # alt unntatt én omstridt kamp
    python3 lfk.py apply --only "<kampnokkel>"      # bare denne
    python3 lfk.py apply --force                    # overstyr sperren mot masseinnlegging
    python3 lfk.py preview --sheet "J13 2026"       # bare én terminliste

Legitimasjon leses i denne rekkefølgen:
    1. Miljøvariablene LFK_URL og LFK_TOKEN
    2. Filen som LFK_CONFIG peker på
    3. ~/.lfk-kamper.json      -> {"url": "...", "token": "..."}

Hvorfor dette skriptet finnes i det hele tatt: Apps Script svarer 302 på
POST-en og flytter deg til script.googleusercontent.com. Skriptet har
allerede kjørt på /exec — omdirigeringen henter bare svaret, og må følges
med GET. urllib gjør ikke dette riktig av seg selv, og en POST videre til
googleusercontent gir 405. Feilmeldingene fra Apps Script kommer dessuten
som HTML med status 200, så de tolkes her i stedet for å velte som en
JSON-parsefeil.
"""

import html
import json
import os
import re
import sys
import urllib.error
import urllib.request

ACTIONS = ["ping", "read", "feed", "config", "preview", "apply", "format"]
MAX_REDIRECTS = 5


def load_config():
    url = os.environ.get("LFK_URL")
    token = os.environ.get("LFK_TOKEN")
    if url and token:
        return url, token

    path = os.environ.get("LFK_CONFIG") or os.path.expanduser("~/.lfk-kamper.json")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            cfg = json.load(fh)
        return cfg["url"], cfg["token"]

    sys.exit(
        "Fant ingen legitimasjon. Sett LFK_URL og LFK_TOKEN, eller lag "
        "~/.lfk-kamper.json med {\"url\": \"...\", \"token\": \"...\"}."
    )


def call(action, url, token, only=None, exclude=None, force=False, sheet=None, timeout=120):
    req_body = {"token": token, "action": action}
    if sheet:
        req_body["sheet"] = sheet
    if force:
        req_body["forceAdditions"] = True
    if only:
        req_body["only"] = only
    if exclude:
        req_body["exclude"] = exclude
    body = json.dumps(req_body).encode("utf-8")
    target = url
    first = True

    for _ in range(MAX_REDIRECTS):
        # Første kall er POST-en med kroppen. Omdirigeringen etterpå følges med
        # GET og uten kropp: Apps Script har allerede kjørt skriptet på /exec,
        # og script.googleusercontent.com serverer bare resultatet. Sender du
        # POST dit også, svarer den 405.
        req = (urllib.request.Request(target, data=body,
                                      headers={"Content-Type": "application/json"},
                                      method="POST")
               if first else
               urllib.request.Request(target, method="GET"))
        opener = urllib.request.build_opener(NoRedirect)
        try:
            resp = opener.open(req, timeout=timeout)
        except urllib.error.HTTPError as err:
            if err.code in (301, 302, 303, 307, 308) and err.headers.get("Location"):
                target = err.headers["Location"]
                first = False
                continue
            if err.code in (401, 403):
                sys.exit(diagnose_401(url, err.code))
            raise
        raw = resp.read().decode("utf-8", "replace")
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            # A script that fails to compile or throws still answers 200, with
            # Google's HTML error page instead of our JSON. The message in it
            # is the actual diagnosis, so dig it out rather than reporting a
            # parse error against 5 KB of markup.
            sys.exit(explain_html(raw))

    raise RuntimeError("For mange omdirigeringer")


def explain_html(raw):
    text = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", raw)
    text = html.unescape(re.sub(r"(?s)<[^>]+>", " ", text))
    text = re.sub(r"\s+", " ", text).strip()

    hint = ""
    if "has already been declared" in text:
        hint = (
            "\n\nTo filer i Apps Script-prosjektet inneholder den samme koden, så alt "
            "er deklarert dobbelt.\nÅpne editoren og slett den av dem som ikke heter "
            "Code — `clasp push` la til en ny fil\nved siden av den gamle i stedet for "
            "å erstatte den.\n\nHusk å distribuere en ny versjon etterpå: en "
            "distribusjon er låst til versjonen\nden ble laget fra, så en rettelse i "
            "koden slår ikke gjennom av seg selv."
        )
    return "Apps Script svarte med en feilside i stedet for JSON:\n\n  " + text[:400] + hint


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def diagnose_401(url, code):
    """
    Google rejects these before the script ever runs, so the token is never the
    cause. The two ways to get here look identical from a POST, so probe with a
    GET: a deployment that wants a signed-in user redirects to the Google login
    page, while one that is not a web app at all does not.
    """
    lead = "Google avviste forespørselen med HTTP %d, før skriptet kjørte.\n" % code
    try:
        opener = urllib.request.build_opener(NoRedirect)
        opener.open(urllib.request.Request(url, method="GET"), timeout=20)
        location = ""
    except urllib.error.HTTPError as probe:
        location = probe.headers.get("Location", "") or ""
    except Exception:
        location = ""

    if "accounts.google.com" in location:
        return lead + (
            "Distribusjonen krever at den som kaller er innlogget i Google.\n"
            'Sett "Hvem har tilgang" til ALLE — ikke "Alle med Google-konto",\n'
            "som ser likt ut i menyen, men fortsatt krever innlogging:\n"
            "  Distribuer > Behandle distribusjoner > blyanten\n"
            "  Kjør som: Meg      Hvem har tilgang: Alle\n"
            "URLen holder seg lik når du redigerer en eksisterende distribusjon.\n\n"
            'Finnes ikke valget "Alle", er det sperret av Google Workspace-\n'
            "policyen til domenet. Da er web-appen utelukket, og synken kjøres\n"
            "fra LFK kamper-menyen i arket i stedet."
        )
    return lead + (
        "Distribusjonen svarer ikke som en nettapp. Er den publisert som\n"
        "BIBLIOTEK, serverer den ikke HTTP i det hele tatt, og /exec svarer 401\n"
        "uansett tilgangsnivå. Lag en ny distribusjon og velg type Nettapp:\n"
        "  Distribuer > Ny distribusjon > tannhjul > Nettapp\n"
        "  Kjør som: Meg      Hvem har tilgang: Alle"
    )


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ACTIONS:
        sys.exit("Bruk: lfk.py {%s} [--sheet NAVN] [--only NOKKEL] [--exclude NOKKEL] [--force]" % "|".join(ACTIONS))

    action = sys.argv[1]
    only = exclude = sheet = None
    force = False
    args = sys.argv[2:]
    while args:
        flag = args.pop(0)
        if flag == "--force":
            force = True
        elif flag == "--sheet" and args:
            sheet = args.pop(0)
        elif flag in ("--only", "--exclude") and args:
            ids = [x.strip() for x in args.pop(0).split(",") if x.strip()]
            if flag == "--only":
                only = ids
            else:
                exclude = ids
        else:
            sys.exit("Ukjent argument: " + flag)
    if only and exclude:
        sys.exit("Bruk enten --only eller --exclude, ikke begge.")

    url, token = load_config()
    result = call(action, url, token, only=only, exclude=exclude, force=force, sheet=sheet)

    print(json.dumps(result, ensure_ascii=False, indent=2))
    if not result.get("ok"):
        sys.exit(1)


if __name__ == "__main__":
    main()
