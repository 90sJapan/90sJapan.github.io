# CRMSN site

Static homepage for CRMSN. Three files, no build step: `index.html`, `styles.css`, `script.js`.
The music section embeds your SoundCloud profile directly, so new uploads to
soundcloud.com/officialcrmsn show up on the site automatically — no code changes needed.

## Publish it on GitHub Pages (free)

GitHub's free plan only serves Pages sites from a **public** repository, so this repo
should be public. That's fine — it only contains site code (HTML/CSS/JS), nothing private.

1. Create a new repo on GitHub named exactly `yourusername.github.io` (replace
   `yourusername` with your actual GitHub username — this exact naming is what makes it
   your personal site instead of a project subpage).
2. Push these three files to the root of that repo's `main` branch.
3. In the repo, go to **Settings → Pages** and confirm the source is the `main` branch, root folder.
4. Your site goes live at `https://yourusername.github.io` within a minute or two.

## Keeping your discography private

GitHub Pages needs a public repo to publish from, so anything in *this* repo is visible
to anyone. For your actual working files — unreleased tracks, stems, masters, older
projects — don't put them here. Instead:

1. Create a **second, separate repository** and set its visibility to **Private**
   (e.g. `crmsn-discography`). Private repos are free and unlimited on GitHub's free plan.
2. Upload/push your audio files and project folders there. It's just your personal
   archive with version history — it's never linked from the public site, so visitors
   never see it exists.
3. If you're storing a lot of large lossless files (wav masters, big sample packs),
   plain git handles individual files up to 100MB but isn't great at scale for large
   binaries — look into [Git LFS](https://git-lfs.github.com/) for that repo if it grows large.

Public site repo and private discography repo are completely independent — you can
update your archive as often as you want without touching the live site at all.
