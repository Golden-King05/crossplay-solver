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
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      tessedit_pageseg_mode: '6', // PSM.SINGLE_BLOCK — more reliable than SINGLE_CHAR for isolated tile letters
    });
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

  function upscale(canvas, targetSize = 140, padding = 16) {
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

  // Heuristic: a printed tile has a letter on it, so the cell has real
  // contrast (edges). An empty square (plain, or a pastel bonus square,
  // or the faint center icon) is close to a single flat color.
  function grayStdDev(canvas) {
    const ctx = canvas.getContext('2d');
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const n = data.length / 4;
    let sum = 0;
    const gray = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const g = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
      gray[i] = g;
      sum += g;
    }
    const mean = sum / n;
    let variance = 0;
    for (let i = 0; i < n; i++) variance += (gray[i] - mean) ** 2;
    return Math.sqrt(variance / n);
  }

  function isCellFilled(cellCanvas, threshold = 18) {
    return grayStdDev(cellCanvas) > threshold;
  }

  function linspace(a, b, n) {
    if (n <= 1) return [a];
    const out = [];
    for (let i = 0; i < n; i++) out.push(a + ((b - a) * i) / (n - 1));
    return out;
  }

  async function ocrLetter(w, canvas, minConfidence = 25) {
    const { data } = await w.recognize(canvas);
    const text = (data.text || '').toUpperCase().replace(/[^A-Z]/g, '');
    if (!text) return null;
    if (typeof data.confidence === 'number' && data.confidence < minConfidence) return null;
    return text[0];
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

    const w = await getWorker();
    const found = [];
    let done = 0;
    const total = rows * cols;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        done++;
        if (onProgress && done % 5 === 0) onProgress(done, total);
        const cell = extractCellCanvas(source, colXs[c], rowYs[r], cellW, cellH);
        if (!isCellFilled(cell)) continue;
        const letter = await ocrLetter(w, upscale(cell));
        if (letter) found.push({ row: r, col: c, letter });
      }
    }
    if (onProgress) onProgress(total, total);
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
      const letter = await ocrLetter(w, upscale(cell), 15);
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

  global.CrossplayScan = {
    loadImageFromFile,
    scanBoardFromImage,
    scanRackFromImage,
    isCellFilled,
    extractCellCanvas,
    upscale,
    terminateWorker,
  };
})(typeof window !== 'undefined' ? window : globalThis);
