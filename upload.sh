#!/usr/bin/env bash
# Publish song files from ./music/ as GitHub Release assets and update tracks.json.
#
#   ./upload.sh            # upload every new/changed file in music/
#   ./upload.sh --push     # ...and commit + push tracks.json so the live site updates
#
# The music/ folder is git-ignored: the audio never enters the public repo's history.
# Files are served from the "discography" release of this repo, which is free,
# allows up to 2 GB per file, and can be played directly by the site's player.
#
# Track titles come from the filename (minus extension, "_" and "-" become spaces).
# You can hand-edit titles in tracks.json afterwards — re-running this script keeps them.
# Delete a file from music/ AND run `gh release delete-asset discography <asset>` to remove it.

set -euo pipefail
cd "$(dirname "$0")"

REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
TAG="$(python3 -c 'import json;print(json.load(open("tracks.json"))["release"])')"
BASE="https://github.com/$REPO/releases/download/$TAG"

shopt -s nullglob nocaseglob
FILES=(music/*.mp3 music/*.wav music/*.flac music/*.m4a music/*.aac music/*.ogg music/*.opus)
shopt -u nocaseglob
if [ ${#FILES[@]} -eq 0 ]; then
  echo "No audio files found in music/ (mp3, wav, flac, m4a, aac, ogg, opus)."; exit 1
fi

# create the release once (it's just a container for the files)
if ! gh release view "$TAG" >/dev/null 2>&1; then
  echo "Creating release '$TAG'..."
  gh release create "$TAG" --title "Discography" --latest=false \
    --notes "Full-quality audio served by https://${REPO%%/*}.github.io — uploaded with upload.sh. Not the source of truth; edits happen locally." >/dev/null
fi

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
existing="$(gh release view "$TAG" --json assets --jq '.assets[].name')"

for f in "${FILES[@]}"; do
  name="$(basename "$f")"
  ext="${name##*.}"; stem="${name%.*}"
  # release asset names must be URL-safe: lowercase, spaces/punctuation -> "-"
  slug="$(printf '%s' "$stem" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g')"
  asset="$slug.$(printf '%s' "$ext" | tr '[:upper:]' '[:lower:]')"
  cp "$f" "$TMP/$asset"
  if printf '%s\n' "$existing" | grep -qx "$asset"; then
    echo "skip   $name  (already on release; delete the asset first to replace it)"
  else
    echo "upload $name  ->  $asset"
    gh release upload "$TAG" "$TMP/$asset" >/dev/null
  fi
  python3 - "$asset" "$stem" "$BASE/$asset" "$(stat -f %z "$f")" <<'PY'
import json, re, sys
asset, stem, url, size = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
data = json.load(open("tracks.json"))
tracks = data.setdefault("tracks", [])
if not any(t.get("file") == asset for t in tracks):
    title = re.sub(r"[_\-]+", " ", stem).strip()
    tracks.append({"title": title, "file": asset, "url": url, "bytes": size})
    json.dump(data, open("tracks.json", "w"), indent=2, ensure_ascii=False); open("tracks.json", "a").write("\n")
PY
done

echo; echo "tracks.json now lists $(python3 -c 'import json;print(len(json.load(open("tracks.json"))["tracks"]))') track(s)."
if [ "${1:-}" = "--push" ]; then
  git add tracks.json
  git diff --cached --quiet && echo "Nothing new to commit." || { git commit -q -m "Update discography"; git push -q origin main; echo "Pushed — live site updates in about a minute."; }
else
  echo "Run './upload.sh --push' (or commit tracks.json yourself) to update the live site."
fi
