# Furnishings Board

A pan/zoom view of a 93-piece furnishings moodboard, exported from an Obsidian
Excalidraw drawing. Every piece links back to its Etsy / Pinterest / eBay listing.

Live: <https://harrison-f.github.io/furnishings-board/>

Click a piece and its URL pops out in a callout above it, the way the Obsidian
Excalidraw plugin does; the callout opens the listing in a new tab. Drag to pan,
scroll to move, ctrl+scroll or pinch to zoom. `Grid` switches to a contact sheet,
which is the better way to browse on a phone.

## Rebuilding after an edit in Obsidian

```sh
cd build && npm install     # once: lz-string, plus puppeteer-core for the tests
node build/build.mjs        # from the repo root
git commit -am "Refresh board" && git push
```

GitHub Pages redeploys in about a minute. The build is a snapshot — it does not
track the vault.

`build.mjs` reads `~/Desktop/Hermes/Excalidraw/Furnishings.excalidraw.md` by
default; pass a different path as the first argument. `--fragment` writes
`build/artifact.html` without the `<!doctype>`/`<head>` wrapper, which is the form
claude.ai artifacts want (they supply their own skeleton). It also needs
ImageMagick (`convert`) on PATH.

## How the export works

Two things about the source file are easy to trip over:

- The drawing is **lz-string-compressed JSON** inside a ```` ```compressed-json ````
  fence, not plain JSON. (`build.mjs` also accepts a plain `json` fence, which is
  what Obsidian's "Decompress current Excalidraw file" command leaves behind.)
- The images are **not embedded**. `## Embedded Files` maps each 40-character
  fileId to a `[[Pasted Image ….png]]` wikilink, and the PNGs live elsewhere in
  the vault — 55 MB of them for this board.

So the build resolves each fileId to a file on disk and renders two tiers:
1400px WebP in `img/`, served lazily and swapped in once a piece is zoomed past
roughly 400px wide, and 440px WebP inlined into the page as data URIs so the whole
board paints in one go. Renditions are only rebuilt when the source PNG is newer.

## Tests

```sh
node build/test.mjs
```

Drives the built page with **real input events** over CDP. This matters: synthetic
`dispatchEvent(new MouseEvent('click'))` calls skip the pointer pipeline, and once
hid two genuine bugs — `setPointerCapture` retargeting the `click` event away from
the image, and an unfiltered `pointerdown` letting right-click start a pan that the
context menu then left stuck. Don't verify this page with synthetic events.
