# Crossplay Solver

An unofficial, fully client-side word finder for **NYT Crossplay**, the
15×15 tile-laying word game from The New York Times. Upload a screenshot
of the board and rack (or enter tiles manually) and it finds the best
legal plays — accounting for every letter/word bonus square and any
crossing ("layering") words a placement completes — ranked by score.

Not affiliated with or endorsed by The New York Times.

## Try it

Open `index.html` through a local web server (not `file://` — see
[Running locally](#running-locally)), or enable GitHub Pages for this repo
(**Settings → Pages → Source: GitHub Actions** — the included workflow at
`.github/workflows/pages.yml` deploys the site automatically on every push
to `main`).

## How to use it

**Scan a screenshot (fastest):**

1. Click **Scan a screenshot** and pick one screenshot that shows both
   the board and your rack (like the normal in-game view).
2. The board and rack region are found automatically, OCR reads every
   tile, and — as soon as a rack is found — the solver runs on its own
   and shows the top 20 plays. No tapping or cropping needed.
3. Review the result: OCR isn't perfect (see below), so double-check the
   board and rack before trusting a play. Blank tiles already played on
   the board are detected automatically (from the "0" point value a
   blank always shows, whatever letter it was played as); a rack tile
   OCR couldn't read at all shows as "?", which the solver treats as an
   unplayed blank (any letter, 0 points) — check whether it's really a
   blank or just a misread letter.

If auto-detection can't find the board or rack in your screenshot (an
unusual crop, a heavily cropped image, or a very different color theme),
open **"Auto-detect didn't work? Scan board/rack separately"** and scan
each one with two tap-to-calibrate points instead —
click the center of the **top-left** and **bottom-right** playing squares
(for the board) or your **first** and **last** tile (for the rack, after
setting the tile count), then **Scan tiles**.

**Manual entry:**

1. Click any board square to record a tile that's already in play.
   Type an **uppercase** letter for a normal tile, or a **lowercase**
   letter for a tile that was played from a blank (it scores 0 points).
2. Type your rack (up to 7 tiles) into the rack box. Use `?` for a blank.
3. Click **Find best plays**. Results are sorted by score, highest first
   (top 20 shown).
4. Click a result to preview it on the board, or **Apply** to commit it
   and keep playing out the rest of the game turn by turn.

## How it works

The solver uses the standard anchor-based Scrabble move-generation
algorithm (Appel & Jacobson, *"The World's Fastest Scrabble Program"`):

- **Dictionary**: the [ENABLE word list](https://en.wikipedia.org/wiki/ENABLE_(word_list))
  (~172,000 words, public domain), loaded into a trie (`js/trie.js`) at
  page load. This is a strong general-purpose Scrabble-style word list,
  but it may not be an exact match for Crossplay's official dictionary.
- **Anchors**: every empty square adjacent to a placed tile (or the
  center square on an empty board) is a candidate square that a new word
  must cover.
- **Cross-checks**: for every empty square, the set of letters that would
  form a valid perpendicular word (given the tiles already adjacent to
  it) is precomputed, so the search never wastes time on a placement that
  would create an invalid crossing word.
- **Move generation**: for each anchor, the solver extends left using
  rack tiles (validating the growing prefix against the dictionary) and
  then right (validating both the main word and any newly formed cross
  words), for both horizontal and vertical orientations.
- **Scoring**: letter and word multipliers apply only to tiles placed
  this turn (matching real Scrabble/Crossplay rules); a played tile can
  score for both its main word and any cross word it completes; playing
  all 7 rack tiles in one turn adds Crossplay's 40-point bonus.

All of this runs in the browser — no server, no build step, no
dependencies.

### Scanning a screenshot

`js/scan.js` turns a screenshot into letters, in three stages:

1. **Finding the board and rack automatically.** A tile grid is a large
   region that differs from the page's flat background on almost every
   row and column it spans, while surrounding UI (score header, status
   text) is sparser and much shorter — so the tool profiles how much of
   each row/column differs from the background color, and looks for the
   tallest such band (the board) and the next one below it (the rack),
   then splits the rack's span into individual tiles by finding the gaps
   between them. This needs the two calibration points only as a manual
   fallback when auto-detection isn't confident.
2. **Deciding which squares hold a tile.** This can't rely on "has
   contrast": this game (like several others) prints a "2L"/"3W"-style
   label on every empty bonus square, so an empty square has letter-shaped
   contrast too. What actually separates them is color, so each cell is
   compared only against other cells of the *same* bonus type (known from
   the board layout) — since most squares of a given type are still empty
   at any point in a game, a cell whose brightness is way off its type's
   median is a tile, regardless of whether tiles run lighter or darker
   than the board.
3. **OCR.** Each tile crop is normalized (grayscale, inverted if it's
   light-on-dark, binarized with Otsu's method to drop shading/shadows
   down to clean black-on-white) and handed to
   [Tesseract.js](https://tesseract.projectnaptha.com/) (an OCR engine
   compiled to WebAssembly) restricted to A–Z, and the recognized letters
   are dropped straight into the board/rack for you to review. For a
   board tile, its point-value badge (top-right corner) is separately
   OCR'd with a digit-only pass — a "0" there means the tile was played
   from a blank (any letter, but worth nothing), whatever letter shows.

Tesseract's runtime (worker script, WASM OCR core, English language data)
is vendored under `vendor/tesseract/` rather than pulled from a CDN at
run time, so scanning keeps working even if a third-party CDN is down —
and nothing about your photo ever leaves your browser.

## Board and tile data

The 15×15 bonus-square layout (`js/board.js`) and letter values were
transcribed from the official Crossplay board. Letter values and the
100-tile bag distribution match standard Scrabble values.

## Project structure

```
index.html              Page markup
style.css               Styling and board rendering
js/board.js             Board geometry, bonus squares, tile values
js/trie.js              Trie (dictionary) implementation
js/solver.js            Move generator + scorer
js/scan.js              Photo scanning: image slicing, fill detection, OCR
js/app.js               UI wiring
words/enable1.txt       Dictionary word list
vendor/tesseract/       Vendored Tesseract.js OCR runtime (worker, WASM core, eng data)
```

## Running locally

Browsers block `fetch()` of local files under `file://`, so serve the
folder over HTTP:

```
python3 -m http.server 8000
```

Then open <http://localhost:8000/>.

## Running the solver's core logic tests

`js/board.js`, `js/trie.js`, and `js/solver.js` also work under Node
(they export via `module.exports` when available), so you can exercise
the move generator directly:

```js
const { Board } = require('./js/board.js');
const { Trie } = require('./js/trie.js');
const { generateMoves } = require('./js/solver.js');

const trie = Trie.fromWordList(require('fs').readFileSync('./words/enable1.txt', 'utf8'));
const board = new Board();
console.log(generateMoves(board, trie, ['C', 'A', 'T']).slice(0, 5));
```
