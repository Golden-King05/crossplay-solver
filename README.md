# Crossplay Solver

An unofficial, fully client-side word finder for **NYT Crossplay**, the
15×15 tile-laying word game from The New York Times. Enter the tiles
currently on the board and your 7-tile rack, and it finds every legal
play, scored highest first.

Not affiliated with or endorsed by The New York Times.

## Try it

Open `index.html` through a local web server (not `file://` — see
[Running locally](#running-locally)), or enable GitHub Pages for this repo
(**Settings → Pages → Source: GitHub Actions** — the included workflow at
`.github/workflows/pages.yml` deploys the site automatically on every push
to `main`).

## How to use it

**Manual entry:**

1. Click any board square to record a tile that's already in play.
   Type an **uppercase** letter for a normal tile, or a **lowercase**
   letter for a tile that was played from a blank (it scores 0 points).
2. Type your rack (up to 7 tiles) into the rack box. Use `?` for a blank.
3. Click **Find best plays**. Results are sorted by score, highest first.
4. Click a result to preview it on the board, or **Apply** to commit it
   and keep playing out the rest of the game turn by turn.

**Scan from a photo (instead of typing everything in):**

1. Click **Scan board photo** or **Scan rack photo** and pick a
   screenshot or photo (on a phone, this opens the camera).
2. On the photo, click the center of the **top-left** and **bottom-right**
   playing squares (for the board) or the center of your **first** and
   **last** tile (for the rack, after setting the tile count).
3. Click **Scan tiles**. OCR runs locally in your browser and fills in the
   board/rack for you — no photo is uploaded anywhere.
4. Double-check the result: OCR isn't perfect, especially for thin
   letters like I, and it can't tell a blank tile from a normal one, so
   review before solving.

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

### Scanning a photo

`js/scan.js` turns a photo of the board or rack into letters:

1. You click two reference points on the photo (opposite corners of the
   board, or the first/last rack tile), which gives the tool the grid's
   pixel geometry (assuming an unrotated, reasonably straight-on shot).
2. Each cell is cropped out and checked for a tile: an empty square is a
   near-uniform color, while a printed letter creates real contrast, so a
   simple standard-deviation threshold tells them apart.
3. Filled cells are handed to [Tesseract.js](https://tesseract.projectnaptha.com/)
   (an OCR engine compiled to WebAssembly) restricted to A-Z, and the
   recognized letters are dropped straight into the board/rack for you to
   review.

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
