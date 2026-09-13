#!/usr/bin/env python3
"""
discog.py — build and publish the discography for the site.

  python3 discog.py match [--token TOKEN]   scan music/, pull titles from SoundCloud, update tracks.json
  python3 discog.py upload [--push]         upload new files to the GitHub Release, fill in URLs
  python3 discog.py status                  show what's matched / unmatched / uploaded

Folder layout (music/ is git-ignored, files never enter the repo):
  music/<alias>/**/song.wav      <alias> = top-level folder, mapped to a SoundCloud profile in
                                  tracks.json -> "sources": {"crmsn": "https://soundcloud.com/officialcrmsn"}

Matching: each local file's duration (via macOS `afinfo`) is compared to every track on that
profile; a unique hit within ±TOLERANCE seconds wins. Ties are broken by filename/title
similarity and by a "private"/"public" hint in the sub-folder name. Anything still ambiguous is
left with the filename as its title and flagged "needs_review" so you can fix it by hand.
Hand-edited titles are never overwritten — delete the "soundcloud" key on an entry to re-match.

Private tracks need your SoundCloud OAuth token (they are invisible to the public API):
  soundcloud.com -> DevTools -> Application -> Cookies -> soundcloud.com -> "oauth_token"
Pass it with --token, env SC_OAUTH_TOKEN, or put it in ./.sc_token (git-ignored).
"""
import argparse, hashlib, json, os, re, subprocess, sys, tempfile, unicodedata
from difflib import SequenceMatcher
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MUSIC = ROOT / "music"
TRACKS = ROOT / "tracks.json"
CACHE = ROOT / ".soundcloud-cache"     # raw API responses, git-ignored
AUDIO_EXT = {".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg", ".opus", ".aif", ".aiff"}
TOLERANCE = 1.5  # seconds

# ---------------------------------------------------------------- helpers
def die(msg): print("error:", msg, file=sys.stderr); sys.exit(1)

def load_tracks():
    data = json.loads(TRACKS.read_text()) if TRACKS.exists() else {}
    data.setdefault("release", "discography")
    data.setdefault("sources", {})
    data.setdefault("tracks", [])
    return data

def save_tracks(data):
    TRACKS.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")

def slug(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-") or "track"

def norm(s):
    """loose form for similarity: lowercase alnum words only"""
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return " ".join(re.findall(r"[a-z0-9]+", s))

def similarity(a, b): return SequenceMatcher(None, norm(a), norm(b)).ratio()

def clean_title(stem): return re.sub(r"[_\-]+", " ", stem).strip()

def local_duration(path):
    out = subprocess.run(["afinfo", str(path)], capture_output=True, text=True).stdout
    m = re.search(r"estimated duration:\s*([\d.]+)", out)
    return float(m.group(1)) if m else None

def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""): h.update(chunk)
    return h.hexdigest()

def scan_music():
    """yield (alias, relpath, Path) for every audio file under music/<alias>/"""
    if not MUSIC.is_dir(): die("music/ folder not found")
    # "public" folders first so, when a file exists in both, the public copy is the one kept
    for p in sorted(MUSIC.rglob("*"), key=lambda p: (p.relative_to(MUSIC).parts[0], hint_of(str(p)) != "public", str(p))):
        if p.is_file() and p.suffix.lower() in AUDIO_EXT and not p.name.startswith("."):
            rel = p.relative_to(MUSIC)
            if len(rel.parts) < 2:
                print(f"  ! {rel}: files must sit inside an artist folder (music/<alias>/...) — skipped")
                continue
            yield rel.parts[0], str(rel), p

# ---------------------------------------------------------------- soundcloud
def curl(url, token=None):
    cmd = ["curl", "-sfL", "-A", "Mozilla/5.0", url]
    if token: cmd += ["-H", f"Authorization: OAuth {token}"]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode: raise RuntimeError(f"request failed ({r.returncode}): {url[:90]}")
    return r.stdout.decode(errors="ignore")

def sc_client_id():
    html = curl("https://soundcloud.com/")
    for s in reversed(re.findall(r'<script crossorigin src="(https://a-v2\.sndcdn\.com/assets/[^"]+\.js)"', html)):
        m = re.search(r'client_id\s*[:=]\s*"([A-Za-z0-9]{32})"', curl(s))
        if m: return m.group(1)
    die("could not find a SoundCloud client_id (site markup changed?)")

def sc_tracks(profile_url, client_id, token):
    """all tracks on a profile — private ones included when token belongs to the owner"""
    user = json.loads(curl(f"https://api-v2.soundcloud.com/resolve?url={profile_url}&client_id={client_id}", token))
    url = f"https://api-v2.soundcloud.com/users/{user['id']}/tracks?client_id={client_id}&limit=200&linked_partitioning=1"
    out = []
    while url:
        page = json.loads(curl(url, token))
        out += page.get("collection", [])
        url = page.get("next_href")
        if url and "client_id=" not in url: url += f"&client_id={client_id}"
    return user, [{
        "id": t["id"], "title": t["title"].strip(), "permalink": t["permalink_url"],
        "duration": (t.get("full_duration") or t.get("duration") or 0) / 1000,
        "sharing": t.get("sharing", "public"), "created_at": t.get("created_at", ""),
    } for t in out if t.get("kind") == "track"]

# ---------------------------------------------------------------- match
def hint_of(rel):
    r = rel.lower()
    return "private" if "private" in r else "public" if "public" in r else None

def score(rel, t, d):
    """how well a local file fits a SoundCloud track (higher = better)"""
    stem = Path(rel).stem
    s = similarity(stem, t["title"]) + 0.5 * similarity(stem, t["permalink"].rsplit("/", 1)[-1])
    s -= abs(t["duration"] - d) / TOLERANCE * 0.1          # closer length nudges ahead
    h = hint_of(rel)
    if h: s += 0.4 if t["sharing"] == h else -0.4
    return s

def assign(pending, catalog, claimed):
    """
    pending: {rel: entry}. Greedy global assignment: best-scoring (file, track) pairs win first,
    every SoundCloud track is claimed at most once. Returns {rel: (track, confident, cands)}.
    """
    pairs, cands = [], {}
    for rel, e in pending.items():
        d = e["duration"]
        cs = [t for t in catalog[e["artist"]] if abs(t["duration"] - d) <= TOLERANCE and t["permalink"] not in claimed]
        cands[rel] = sorted(cs, key=lambda t: score(rel, t, d), reverse=True)
        pairs += [(score(rel, t, d), rel, t) for t in cs]
    taken, out = set(), {}
    for sc, rel, t in sorted(pairs, key=lambda x: x[0], reverse=True):
        if rel in out or t["permalink"] in taken: continue
        cs = cands[rel]
        margin = sc - score(rel, cs[1], pending[rel]["duration"]) if len(cs) > 1 else 9
        h = hint_of(rel)
        exact = norm(Path(rel).stem) in (norm(t["title"]), norm(t["permalink"].rsplit("/", 1)[-1]))
        confident = (exact or margin >= 0.35) and (h is None or t["sharing"] == h)
        out[rel] = (t, confident, cs); taken.add(t["permalink"])
    for rel in pending:
        if rel not in out: out[rel] = (None, False, cands[rel])
    return out

def cmd_match(args):
    data = load_tracks()
    token = args.token or os.environ.get("SC_OAUTH_TOKEN") or ((ROOT / ".sc_token").read_text().strip() if (ROOT / ".sc_token").exists() else None)
    if not token: print("note: no OAuth token — private SoundCloud tracks won't be visible (see --help)\n")
    by_source = {t["source"]: t for t in data["tracks"] if "source" in t}
    client_id = None
    catalog = {}       # alias -> list of sc tracks
    seen_hash = {}     # sha256 -> source (dedupe identical files)
    report = {"matched": 0, "kept": 0, "review": [], "unmatched": [], "dupes": [], "unmapped": set()}
    pending = {}       # rel -> entry still needing a SoundCloud match

    files = list(scan_music())
    print(f"scanning {len(files)} files in music/ ...")
    for alias, rel, path in files:
        entry = by_source.get(rel)
        if entry is None:
            entry = {"title": clean_title(path.stem), "artist": alias, "source": rel}
            data["tracks"].append(entry); by_source[rel] = entry
        entry.setdefault("artist", alias)
        entry["file"] = f"{slug(alias)}--{slug(path.stem)}{path.suffix.lower()}"
        entry["bytes"] = path.stat().st_size
        if "duration" not in entry: entry["duration"] = local_duration(path)

        # identical bytes elsewhere (e.g. same file in a private and a public folder) -> keep one
        key = (entry["bytes"], round(entry["duration"] or 0, 2))
        digest = entry.get("sha256") or sha256(path); entry["sha256"] = digest
        if digest in seen_hash and seen_hash[digest] != rel:
            entry["duplicate_of"] = seen_hash[digest]; report["dupes"].append((rel, seen_hash[digest])); continue
        seen_hash[digest] = rel
        entry.pop("duplicate_of", None)

        if entry.get("soundcloud") and not entry.get("needs_review"):
            report["kept"] += 1; continue           # already matched or hand-edited: leave alone

        profile = data["sources"].get(alias)
        if not profile: report["unmapped"].add(alias); continue
        if alias not in catalog:
            client_id = client_id or sc_client_id()
            try:
                user, tracks = sc_tracks(profile, client_id, token)
            except Exception as e:
                die(f"SoundCloud lookup failed for {alias} ({profile}): {e}")
            CACHE.mkdir(exist_ok=True); (CACHE / f"{slug(alias)}.json").write_text(json.dumps(tracks, indent=2))
            priv = sum(t["sharing"] != "public" for t in tracks)
            print(f"  {alias}: {len(tracks)} tracks on {profile} ({priv} private)")
            catalog[alias] = tracks

        pending[rel] = entry

    claimed = {t["soundcloud"] for t in data["tracks"] if t.get("soundcloud") and t["source"] not in pending and not t.get("duplicate_of")}
    for rel, (best, confident, cands) in assign(pending, catalog, claimed).items():
        entry = by_source[rel]
        if best is None:
            for k in ("soundcloud", "sharing", "created_at", "needs_review"): entry.pop(k, None)
            entry["title"] = clean_title(Path(rel).stem)
            if cands: entry["needs_review"] = [f'{t["title"]}  ({t["permalink"]})' for t in cands]; report["review"].append((rel, entry["title"], len(cands)))
            else: report["unmatched"].append(rel)
            continue
        entry.update({"title": best["title"], "soundcloud": best["permalink"], "sharing": best["sharing"], "created_at": best["created_at"]})
        if confident:
            entry.pop("needs_review", None); report["matched"] += 1
        else:
            entry["needs_review"] = [f'{t["title"]}  ({t["permalink"]})' for t in cands]
            report["review"].append((rel, entry["title"], len(cands)))

    # artists in folder order, newest SoundCloud upload first within each artist
    order = {a: i for i, a in enumerate(dict.fromkeys(a for a, _, _ in files))}
    data["tracks"].sort(key=lambda t: (order.get(t.get("artist"), 99), t.get("created_at") or "0000", t["source"]))
    data["tracks"] = sorted(data["tracks"], key=lambda t: order.get(t.get("artist"), 99))  # stable
    grouped = []
    for a in list(order) + sorted({t.get("artist") for t in data["tracks"]} - set(order)):
        grp = [t for t in data["tracks"] if t.get("artist") == a]
        grouped += sorted(grp, key=lambda t: t.get("created_at") or "", reverse=True)
    data["tracks"] = grouped
    save_tracks(data)

    print(f"\nmatched {report['matched']} new, kept {report['kept']} existing")
    if report["dupes"]:
        print(f"\n{len(report['dupes'])} identical duplicate(s) skipped (same bytes as another file):")
        for a, b in report["dupes"]: print(f"  {a}  ==  {b}")
    if report["review"]:
        print(f"\n{len(report['review'])} need review (ambiguous length match, or a 'private' folder file only matched a public track — check 'needs_review' in tracks.json):")
        for rel, title, n in report["review"]: print(f"  {rel}  ->  \"{title}\"  [{n} candidates]")
    if report["unmatched"]:
        print(f"\n{len(report['unmatched'])} unmatched (no SoundCloud track within ±{TOLERANCE}s — title falls back to the filename):")
        for rel in report["unmatched"]: print(f"  {rel}")
    if report["unmapped"]:
        print(f"\nno SoundCloud profile for folder(s): {', '.join(sorted(report['unmapped']))}")
        print('  add them under "sources" in tracks.json, e.g. "hush witch": "https://soundcloud.com/…", then re-run')

# ---------------------------------------------------------------- upload
def gh(*a, **kw): return subprocess.run(["gh", *a], capture_output=True, text=True, check=True, **kw).stdout

def cmd_upload(args):
    data = load_tracks()
    tag = data["release"]
    repo = gh("repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner").strip()
    base = f"https://github.com/{repo}/releases/download/{tag}"
    if subprocess.run(["gh", "release", "view", tag], capture_output=True).returncode:
        print(f"creating release '{tag}' ...")
        gh("release", "create", tag, "--title", "Discography", "--latest=false", "--notes",
           f"Full-quality audio served by the site. Managed by discog.py — not the source of truth.")
    existing = set(gh("release", "view", tag, "--json", "assets", "--jq", ".assets[].name").split())
    todo = [t for t in data["tracks"] if "source" in t and not t.get("duplicate_of")]
    n_up = 0
    with tempfile.TemporaryDirectory() as tmp:
        for t in todo:
            src = MUSIC / t["source"]
            if not src.exists(): print(f"  ! missing on disk: {t['source']}"); continue
            if t["file"] in existing:
                t["url"] = f"{base}/{t['file']}"; continue
            print(f"  upload  {t['source']}  ->  {t['file']}  ({t['bytes'] / 1048576:.1f} MB)")
            staged = Path(tmp) / t["file"]
            os.symlink(src, staged)
            gh("release", "upload", tag, str(staged))
            existing.add(t["file"]); t["url"] = f"{base}/{t['file']}"; n_up += 1
            save_tracks(data)   # checkpoint so an interrupted run resumes cleanly
    save_tracks(data)
    ready = sum(1 for t in data["tracks"] if t.get("url") and not t.get("duplicate_of"))
    print(f"\nuploaded {n_up} new file(s); {ready} track(s) have URLs")
    if args.push:
        subprocess.run(["git", "add", "tracks.json"], check=True)
        if subprocess.run(["git", "diff", "--cached", "--quiet"]).returncode == 0:
            print("nothing new to commit")
        else:
            subprocess.run(["git", "commit", "-q", "-m", "Update discography"], check=True)
            subprocess.run(["git", "push", "-q", "origin", "main"], check=True)
            print("pushed — live site updates in about a minute")
    else:
        print("run `python3 discog.py upload --push` (or commit tracks.json) to update the live site")

# ---------------------------------------------------------------- status
def cmd_status(args):
    data = load_tracks()
    for t in data["tracks"]:
        flag = "dupe " if t.get("duplicate_of") else "REVIEW" if t.get("needs_review") else "  ok " if t.get("soundcloud") else "  -- "
        up = "up" if t.get("url") else "  "
        print(f"[{flag}] [{up}] {t.get('artist','?'):<11} {t['title'][:40]:<40}  {t['source']}")
    print(f"\n{len(data['tracks'])} entries; ok=matched to SoundCloud, --=filename title, REVIEW=ambiguous, dupe=identical file skipped")

# ---------------------------------------------------------------- main
if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("match"); m.add_argument("--token")
    u = sub.add_parser("upload"); u.add_argument("--push", action="store_true")
    sub.add_parser("status")
    a = ap.parse_args()
    os.chdir(ROOT)
    {"match": cmd_match, "upload": cmd_upload, "status": cmd_status}[a.cmd](a)
