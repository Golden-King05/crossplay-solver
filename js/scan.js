// Client-side image transcription: turns a photo/screenshot of the board
// or rack into letters, using Tesseract.js for OCR. Tesseract's own
// runtime files (worker script, WASM OCR core, English language data)
// are vendored under vendor/tesseract/ rather than pulled from a CDN, so
// the whole tool works offline after the first page load and doesn't
// depend on a third party staying up. Pure image-processing helpers live
// here; js/app.js owns the UI (file pickers, corner-click calibration)
// and feeds this module images plus the two calibration points it
// collected.

(function (global) {
  const VENDOR_BASE = 'vendor/tesseract/';
  let tesseractLoadPromise = null;
  let worker = null;

  function loadTesseractScript() {
    if (global.Tesseract) return Promise.resolve();
    if (tesseractLoadPromise) return tesseractLoadPromise;
    tesseractLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${VENDOR_BASE}tesseract.min.js`;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Could not load the OCR engine files.'));
      document.head.appendChild(script);
    });
    return tesseractLoadPromise;
  }

  async function getWorker(onProgress) {
    await loadTesseractScript();
    if (worker) return worker;
    worker = await global.Tesseract.createWorker('eng', 1, {
      workerPath: `${VENDOR_BASE}worker.min.js`,
      corePath: `${VENDOR_BASE}tesseract-core-simd-lstm.wasm.js`,
      langPath: VENDOR_BASE,
      logger: onProgress || (() => {}),
    });
    // ocrLetter/ocrIsBlankTile each set the whitelist + PSM they need
    // before recognizing, since the same worker is reused for both.
    return worker;
  }

  function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not read that image file.'));
      img.src = URL.createObjectURL(file);
    });
  }

  function drawToCanvas(image) {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    canvas.getContext('2d').drawImage(image, 0, 0);
    return canvas;
  }

  // Crop a `w`x`h` box centered at (cx, cy) from `sourceCanvas`, scaled
  // down by `shrink` (tiles usually have some background bleed at the
  // very edge of each cell, so we crop slightly inside the cell).
  function extractCellCanvas(sourceCanvas, cx, cy, w, h, shrink = 0.78) {
    const cw = Math.max(4, w * shrink);
    const ch = Math.max(4, h * shrink);
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(sourceCanvas, cx - cw / 2, cy - ch / 2, cw, ch, 0, 0, cw, ch);
    return canvas;
  }

  // Tiles are often printed as light letters on a dark/colored background
  // (this game's tiles are white-on-blue), which OCR engines — tuned for
  // dark text on a light page — tend to miss entirely. Detect that case
  // by average brightness and invert to dark-on-light before handing the
  // crop to Tesseract.
  // Otsu's method: pick the gray-level threshold that best splits a
  // histogram into two classes (background / foreground) by maximizing
  // the variance between their means. Used to binarize tiles that carry
  // subtle shading — a rounded-corner highlight, a drop shadow, the
  // point-value digit — beyond just their base color and printed letter;
  // those all sit closer to the background's gray level than the bold
  // letter does, so a good threshold drops them out entirely.
  function otsuThreshold(hist, total) {
    let sumAll = 0;
    for (let i = 0; i < 256; i++) sumAll += i * hist[i];
    let sumB = 0, wB = 0, best = 0, bestVar = -1;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (wB === 0) continue;
      const wF = total - wB;
      if (wF === 0) break;
      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sumAll - sumB) / wF;
      const between = wB * wF * (mB - mF) ** 2;
      if (between > bestVar) { bestVar = between; best = t; }
    }
    return best;
  }

  function normalizeForOcr(canvas) {
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { data } = imgData;
    const n = data.length / 4;
    const gray = new Uint8ClampedArray(n);
    const hist = new Array(256).fill(0);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const g = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
      gray[i] = g;
      hist[Math.round(g)]++;
      sum += g;
    }
    const mean = sum / n;
    // A solid-colored tile with a big white letter on it can still average
    // above the usual 128 midpoint (the letter itself is bright), so this
    // leans well past that toward "invert" — a true light background (the
    // synthetic white tiles, or an actual empty square) reads much higher
    // still (~200+), while every observed dark-tile style stays well below.
    const invert = mean < 180;
    const cut = otsuThreshold(hist, n);
    for (let i = 0; i < n; i++) {
      const isFg = invert ? gray[i] > cut : gray[i] < cut;
      const v = isFg ? 0 : 255;
      data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v;
    }
    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }

  function upscale(canvas, targetSize = 140, padding = 16) {
    normalizeForOcr(canvas);
    const out = document.createElement('canvas');
    out.width = targetSize + padding * 2;
    out.height = targetSize + padding * 2;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, padding, padding, targetSize, targetSize);
    return out;
  }

  function cellBrightness(canvas) {
    const ctx = canvas.getContext('2d');
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const n = data.length / 4;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    return sum / n;
  }

  // Distinguishing a filled square from an empty one can't rely on
  // "has contrast" the way plain Scrabble boards would: this game (like
  // several others) prints a "2L"/"3W"-style label on every empty bonus
  // square, so an empty square has letter-shaped contrast too. What
  // actually separates them is *color* — a printed tile is a solid accent
  // color distinctly different from an empty square of the same bonus
  // type. Rather than assume tiles are darker (true for this game's blue
  // tiles, false for e.g. plain cream ones), compare each cell only
  // against other cells that share its bonus type: since most squares of
  // any given type are still empty at any point in a game, the *median*
  // brightness within a type is a good stand-in for "empty," and a cell
  // that deviates far from it — lighter or darker — is a tile.
  function boardFillThresholds(cellsMeta) {
    const byType = new Map();
    for (const c of cellsMeta) {
      const key = BONUS_GRID[c.row][c.col] || 'plain';
      if (!byType.has(key)) byType.set(key, []);
      byType.get(key).push(c.brightness);
    }
    const medians = new Map();
    for (const [key, arr] of byType) {
      const sorted = [...arr].sort((a, b) => a - b);
      medians.set(key, sorted[Math.floor(sorted.length / 2)]);
    }
    return (c) => medians.get(BONUS_GRID[c.row][c.col] || 'plain');
  }

  function linspace(a, b, n) {
    if (n <= 1) return [a];
    const out = [];
    for (let i = 0; i < n; i++) out.push(a + ((b - a) * i) / (n - 1));
    return out;
  }

  // Tesseract's own confidence score turns out to correlate poorly with
  // actual correctness here: a tile's leftover shading and its small
  // point-value digit both get folded into the same "word" as the main
  // letter, and can tank the reported confidence even when the text
  // Tesseract returns is exactly right. So: trust the text whenever
  // Tesseract found any at all, rather than gating on confidence — the
  // UI's job is showing the result for review, not silently discarding
  // plausible reads.
  const LETTER_WHITELIST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  // PSM.SINGLE_BLOCK (6) reads most isolated tile letters reliably, but a
  // handful of otherwise-clean glyphs (Z, O, I in testing) come back
  // completely empty under it for reasons that don't seem to depend on
  // image quality. PSM.SINGLE_WORD (8) catches some of those PSM 6
  // misses (and vice versa), so it's worth a second attempt before
  // giving up on a cell that's already been identified as a tile.
  const LETTER_PSMS = ['6', '8'];
  const DIGIT_MODE = { tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: '7' };

  async function ocrLetter(w, canvas) {
    for (const psm of LETTER_PSMS) {
      await w.setParameters({ tessedit_char_whitelist: LETTER_WHITELIST, tessedit_pageseg_mode: psm });
      const { data } = await w.recognize(canvas);
      const text = (data.text || '').toUpperCase().replace(/[^A-Z]/g, '');
      if (text) return text[0];
    }
    return null;
  }

  // A tile's point-value badge sits in its top-right corner. A tile
  // played from a blank shows a real letter there (any letter can be
  // chosen when it's played) but is worth 0 points, and prints that "0"
  // in the same badge — so reading it tells us isBlank independently of
  // whatever letter OCR found in the middle of the tile.
  function extractCornerCanvas(sourceCanvas, cx, cy, cellW, cellH) {
    const w = cellW * 0.4;
    const h = cellH * 0.4;
    const sx = cx + cellW / 2 - w;
    const sy = cy - cellH / 2;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(sourceCanvas, sx, sy, w, h, 0, 0, w, h);
    return canvas;
  }

  async function ocrIsBlankTile(w, cornerCanvas) {
    await w.setParameters(DIGIT_MODE);
    const { data } = await w.recognize(upscale(cornerCanvas, 80, 12));
    return (data.text || '').replace(/[^0-9]/g, '') === '0';
  }

  // points: [{x,y}, {x,y}] = natural-image-pixel centers of cell (0,0)
  // and cell (rows-1, cols-1). Assumes an axis-aligned (unrotated) grid,
  // which holds for screenshots and reasonably careful photos.
  async function scanBoardFromImage(image, points, { rows = 15, cols = 15, onProgress } = {}) {
    const source = drawToCanvas(image);
    const [p0, p1] = points;
    const colXs = linspace(p0.x, p1.x, cols);
    const rowYs = linspace(p0.y, p1.y, rows);
    const cellW = cols > 1 ? Math.abs(colXs[1] - colXs[0]) : source.width / cols;
    const cellH = rows > 1 ? Math.abs(rowYs[1] - rowYs[0]) : source.height / rows;

    // Pass 1: brightness of every cell, to find which cells hold a tile
    // at all before spending any OCR time. Cropped tight (shrink 0.55) so
    // a bonus square's printed label barely nudges the average.
    const cells = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const b = cellBrightness(extractCellCanvas(source, colXs[c], rowYs[r], cellW, cellH, 0.55));
        cells.push({ row: r, col: c, brightness: b });
      }
    }
    const FILL_MARGIN = 30;
    const medianFor = boardFillThresholds(cells);
    const filled = cells.filter((c) => Math.abs(c.brightness - medianFor(c)) > FILL_MARGIN);

    // Pass 2: OCR only the cells identified as filled, re-cropped with the
    // looser default shrink (a tight crop good for a brightness average
    // can clip part of the letterform, which OCR needs in full).
    const w = await getWorker();
    const found = [];
    let done = 0;
    for (const { row, col } of filled) {
      done++;
      if (onProgress) onProgress(done, filled.length);
      const cell = extractCellCanvas(source, colXs[col], rowYs[row], cellW, cellH);
      const letter = await ocrLetter(w, upscale(cell));
      if (!letter) continue;
      const corner = extractCornerCanvas(source, colXs[col], rowYs[row], cellW, cellH);
      const isBlank = await ocrIsBlankTile(w, corner);
      found.push({ row, col, letter, isBlank });
    }
    if (onProgress) onProgress(filled.length, filled.length);
    return found;
  }

  // points: [{x,y}, {x,y}] = centers of the first and last rack tile.
  async function scanRackFromImage(image, points, count, { onProgress } = {}) {
    const source = drawToCanvas(image);
    const [p0, p1] = points;
    const xs = linspace(p0.x, p1.x, count);
    const ys = linspace(p0.y, p1.y, count);
    const spacing = count > 1 ? Math.hypot(p1.x - p0.x, p1.y - p0.y) / (count - 1) : source.width / 8;
    const size = spacing * 0.95 || source.width / 8;

    const w = await getWorker();
    const letters = [];
    for (let i = 0; i < count; i++) {
      if (onProgress) onProgress(i + 1, count);
      const cell = extractCellCanvas(source, xs[i], ys[i], size, size, 0.85);
      const letter = await ocrLetter(w, upscale(cell));
      letters.push(letter || '?');
    }
    return letters;
  }

  async function terminateWorker() {
    if (worker) {
      await worker.terminate();
      worker = null;
    }
  }

  // ---- Auto-detection: find the board and rack in a full screenshot ----
  //
  // Strategy: a tile grid (board or rack) is a large, contiguous region
  // that differs from the page's flat background on almost every pixel
  // row/column it spans (bonus-square colors and printed tiles both
  // contrast with the background), whereas surrounding UI chrome (score
  // header, status text) is sparser and much shorter. So: find the
  // background color, build a per-row/per-column "differs from
  // background" density profile, and look for the tallest contiguous
  // high-density band (the board) and the next one below it (the rack).
  // Thin gaps between board cells briefly drop density to ~0, so a small
  // max-filter smooths over those without merging genuinely separate UI
  // sections (which are separated by much wider gaps).

  function backgroundColor(imgData) {
    const { data } = imgData;
    const buckets = new Map();
    const BUCKET = 16;
    const bucketOf = (v) => Math.min(255, Math.round(v / BUCKET) * BUCKET);
    for (let i = 0; i < data.length; i += 4) {
      const key = `${bucketOf(data[i])},${bucketOf(data[i + 1])},${bucketOf(data[i + 2])}`;
      buckets.set(key, (buckets.get(key) || 0) + 1);
    }
    let best = '255,255,255';
    let bestCount = -1;
    for (const [key, count] of buckets) {
      if (count > bestCount) { bestCount = count; best = key; }
    }
    return best.split(',').map(Number);
  }

  function maxFilter(arr, radius) {
    const out = new Array(arr.length);
    for (let i = 0; i < arr.length; i++) {
      let m = 0;
      for (let k = -radius; k <= radius; k++) {
        const j = i + k;
        if (j >= 0 && j < arr.length) m = Math.max(m, arr[j]);
      }
      out[i] = m;
    }
    return out;
  }

  // All maximal contiguous runs where arr[i] > threshold, as [start, end) pairs.
  function findRuns(arr, threshold) {
    const runs = [];
    let start = -1;
    for (let i = 0; i <= arr.length; i++) {
      const on = i < arr.length && arr[i] > threshold;
      if (on && start === -1) start = i;
      if (!on && start !== -1) { runs.push([start, i]); start = -1; }
    }
    return runs;
  }

  function longestRun(arr, threshold) {
    const runs = findRuns(arr, threshold);
    if (runs.length === 0) return null;
    return runs.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));
  }

  function rowDensity(imgData, w, h, bg, thresh, y0 = 0, y1 = h) {
    const { data } = imgData;
    const out = new Array(y1 - y0).fill(0);
    for (let y = y0; y < y1; y++) {
      let cnt = 0;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const dr = data[i] - bg[0], dg = data[i + 1] - bg[1], db = data[i + 2] - bg[2];
        if (Math.sqrt(dr * dr + dg * dg + db * db) > thresh) cnt++;
      }
      out[y - y0] = cnt / w;
    }
    return out;
  }

  function colDensity(imgData, w, bg, thresh, y0, y1) {
    const { data } = imgData;
    const out = new Array(w).fill(0);
    for (let x = 0; x < w; x++) {
      let cnt = 0;
      for (let y = y0; y < y1; y++) {
        const i = (y * w + x) * 4;
        const dr = data[i] - bg[0], dg = data[i + 1] - bg[1], db = data[i + 2] - bg[2];
        if (Math.sqrt(dr * dr + dg * dg + db * db) > thresh) cnt++;
      }
      out[x] = cnt / (y1 - y0);
    }
    return out;
  }

  const DENSITY_THRESH = 24;
  const RUN_THRESH = 0.3;

  // Returns { boardBox, rackBox } in ANALYSIS-canvas pixel coordinates
  // ({top,left,bottom,right} each), with either possibly null if not
  // confidently found. Internal helper shared by the public detectors.
  function analyzeScreenshot(image) {
    const W = image.naturalWidth || image.width;
    const H = image.naturalHeight || image.height;
    const maxDim = 500;
    const scale = Math.min(1, maxDim / Math.max(W, H));
    const cw = Math.max(1, Math.round(W * scale));
    const ch = Math.max(1, Math.round(H * scale));
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, cw, ch);
    const imgData = ctx.getImageData(0, 0, cw, ch);
    const bg = backgroundColor(imgData);

    const rowD = maxFilter(rowDensity(imgData, cw, ch, bg, DENSITY_THRESH), 3);
    const boardRowRun = longestRun(rowD, RUN_THRESH);

    let boardBox = null;
    let rackBox = null;

    if (boardRowRun) {
      const [rTop, rBot] = boardRowRun;
      const colD = maxFilter(colDensity(imgData, cw, bg, DENSITY_THRESH, rTop, rBot), 3);
      const boardColRun = longestRun(colD, RUN_THRESH);
      if (boardColRun) {
        const bw = boardColRun[1] - boardColRun[0];
        const bh = rBot - rTop;
        const minSize = 0.3 * Math.min(cw, ch);
        const aspect = bw / bh;
        if (bw > minSize && bh > minSize && aspect > 0.6 && aspect < 1.6) {
          boardBox = { top: rTop, bottom: rBot, left: boardColRun[0], right: boardColRun[1] };
        }
      }

      // Look for the rack as the next high-density row band below the board.
      if (boardBox) {
        const belowRowD = rowD.slice(rBot);
        const rackRunRel = longestRun(belowRowD, RUN_THRESH);
        if (rackRunRel) {
          const rackTop = rackRunRel[0] + rBot;
          const rackBot = rackRunRel[1] + rBot;
          if (rackBot - rackTop > 8 && rackBot - rackTop < (boardBox.bottom - boardBox.top) / 3) {
            // Two versions of the same profile: smoothed, to find the
            // rack's overall left/right extent (bridging over narrow
            // inter-tile gaps); raw, to later split that span back into
            // individual tiles (where those same gaps are the signal).
            const rackColDRaw = colDensity(imgData, cw, bg, DENSITY_THRESH, rackTop, rackBot);
            const rackColD = maxFilter(rackColDRaw, 2);
            const rackColRun = longestRun(rackColD, RUN_THRESH);
            if (rackColRun && rackColRun[1] - rackColRun[0] > 0.2 * cw) {
              rackBox = { top: rackTop, bottom: rackBot, left: rackColRun[0], right: rackColRun[1], colDensityRaw: rackColDRaw };
            }
          }
        }
      }
    }

    return { scale, boardBox, rackBox };
  }

  // Returns [{x,y}, {x,y}] (natural-image-pixel centers of the top-left
  // and bottom-right playing squares) or null if no confident board
  // region was found.
  function autoDetectBoard(image, rows = 15, cols = 15) {
    const { scale, boardBox } = analyzeScreenshot(image);
    if (!boardBox) return null;
    const cellW = (boardBox.right - boardBox.left) / cols;
    const cellH = (boardBox.bottom - boardBox.top) / rows;
    const p0 = { x: (boardBox.left + cellW / 2) / scale, y: (boardBox.top + cellH / 2) / scale };
    const p1 = { x: (boardBox.right - cellW / 2) / scale, y: (boardBox.bottom - cellH / 2) / scale };
    return [p0, p1];
  }

  // Returns { points: [{x,y},{x,y}], count } (natural-pixel centers of
  // the first/last rack tile, and how many tiles were segmented) or null.
  function autoDetectRack(image) {
    const { scale, boardBox, rackBox } = analyzeScreenshot(image);
    if (!boardBox || !rackBox) return null;

    // Segment the rack's column-density profile into individual tiles by
    // finding contiguous non-gap runs, so the tile count doesn't need to
    // be guessed up front. Uses the raw (unsmoothed) profile, restricted
    // to the rack's own span, since the narrow gaps *between* tiles are
    // exactly what smoothing (used to find that span in the first place)
    // deliberately erases.
    const span = rackBox.colDensityRaw.slice(rackBox.left, rackBox.right);
    const tileRuns = findRuns(span, RUN_THRESH)
      .filter(([s, e]) => e - s > 0.03 * (rackBox.right - rackBox.left))
      .map(([s, e]) => [s + rackBox.left, e + rackBox.left]);
    if (tileRuns.length < 1 || tileRuns.length > 7) return null;

    const cy = (rackBox.top + rackBox.bottom) / 2 / scale;
    const centers = tileRuns.map(([s, e]) => (s + e) / 2 / scale);
    const points = [
      { x: centers[0], y: cy },
      { x: centers[centers.length - 1], y: cy },
    ];
    return { points, count: tileRuns.length };
  }

  global.CrossplayScan = {
    loadImageFromFile,
    scanBoardFromImage,
    scanRackFromImage,
    extractCellCanvas,
    upscale,
    terminateWorker,
    autoDetectBoard,
    autoDetectRack,
  };
})(typeof window !== 'undefined' ? window : globalThis);
