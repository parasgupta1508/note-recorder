# Tuner & Scale Trainer (note-recorder)

Installable offline PWA: a single `index.html` (inline CSS/JS), `sw.js`, `manifest.webmanifest` and icons. It is deployed with GitHub Pages from `main` at https://parasgupta1508.github.io/note-recorder/ (the repo is public for this reason). Pushing to `main` redeploys it within about a minute. It was also hosted earlier on Netlify, from the sibling `netlify-upload` folder.

## Automatic GitHub backup

Backup repo: https://github.com/parasgupta1508/note-recorder (public, branch `main`). The GitHub CLI is installed and signed in as `parasgupta1508`.

Whenever you change any file in this project, back it up to GitHub without being asked:

1. Run `git add -A`, then `git commit` with a short message describing the change, then `git push`, all from this folder.
2. Do this once at the end of each set of changes, not after every single edit.
3. End the commit message with the attribution line from the session's system reminder, if there is one.
4. Tell the user the backup is done, or say why it failed. If the push fails because the login expired, run `gh auth login --hostname github.com --git-protocol https --web` and ask the user to approve the code. Don't pipe that command's output.

## Other conventions

- When you change `index.html` or any other cached file, bump `CACHE` in `sw.js` (currently `tuner-v22`) so installed copies update.
- The `netlify-upload` folder is a copy of the deployable files. After changes, tell the user it needs re-uploading to Netlify, or sync it if asked.
