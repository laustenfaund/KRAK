# KRAK!

A storyboarding app for comics: catch ideas, plan beats, sketch panels and lay out pages. It runs in the browser, installs like an app, and works offline. For now it's used on one Chromebook only; syncing between devices is set aside.

## Status

| Phase | What | State |
|---|---|---|
| 1 | App shell, projects, capture, Inbox | **Done** |
| 2 | Google Drive sync | Set aside — one Chromebook for now |
| 3 | Drawing engine: layers, perspective guides, snap | |
| 4 | Beats and Panels views, sorting the Inbox | |
| 5 | Pages: preset grids and freeform panels | |
| 6 | Lettering (5 comic fonts) and comic filters | |
| 7 | Export pages or a whole series as PDF / PNG | |

## Put it online (GitHub Pages)

1. In this repo, go to **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**, pick the branch that holds the app, folder **/ (root)**, and click **Save**.
3. After a minute or two the app is live at `https://laustenfaund.github.io/KRAK/`.

## Install it

- **Chromebook:** open the address in Chrome, then click the install icon at the right end of the address bar.

## What's in Phase 1

- **Capture**: a sketch sheet that fills the screen. Pens (fine, medium, bold), eraser, three inks (ink, blue pencil, red), undo and redo. Stylus pressure is used when available, and the palm is ignored once a stylus has touched the screen. Scroll down for a note, a photo (shown behind the sketch), and **Save to Inbox**. Unsaved work is kept if the app closes.
- **Inbox**: every saved idea, newest first. Open one to view it, edit it, or delete it.
- **Projects**: create, rename and delete comics. Each project has its own page size: US comic, Manga, Webtoon (vertical strip), Square, or Custom. On a wide screen the Inbox sits beside the project list.

- **Backup** (top right on every screen): **Export** saves your projects and Inbox ideas, with photos, to one file (`krak-backup-<date>.json`). **Import** adds the items from a backup file that aren't on the device yet; nothing already there is replaced or deleted. Unsaved Capture work isn't included.
- If the browser won't let KRAK! save (for example a private window), a red notice says so at the top and saves only last until the tab closes.

Everything is stored in Chrome on this Chromebook. Export a backup now and then.

## Notes for development

- No build step. Plain `index.html`, `app.js`, `sw.js`.
- All apps on `laustenfaund.github.io` share one storage area in the browser, so KRAK!'s IndexedDB database and caches are all named `krak-…`.
- Bump `VERSION` in `sw.js` when shipping changes.
