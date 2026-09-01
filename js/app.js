(function () {
  const boardEl = document.getElementById('board');
  const rackInput = document.getElementById('rackInput');
  const solveBtn = document.getElementById('solveBtn');
  const clearBoardBtn = document.getElementById('clearBoardBtn');
  const statusEl = document.getElementById('status');
  const resultsEl = document.getElementById('results');
  const letterValuesEl = document.getElementById('letterValues');

  const board = new Board();
  let trie = null;
  let lastMoves = [];
  let previewTiles = null; // tiles from a previewed (not-yet-applied) move

  const BONUS_CLASS = { '2L': 'dl', '3L': 'tl', '2W': 'dw', '3W': 'tw' };

  function bonusLabel(code) {
    return { '2L': 'DL', '3L': 'TL', '2W': 'DW', '3W': 'TW' }[code] || '';
  }

  function renderLetterValues() {
    const order = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    letterValuesEl.innerHTML = order
      .map((l) => `<div><b>${l}</b>${LETTER_VALUES[l]}</div>`)
      .join('') + `<div><b>?</b>0</div>`;
  }

  function buildBoardDom() {
    boardEl.innerHTML = '';
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.r = r;
        cell.dataset.c = c;
        const bonus = BONUS_GRID[r][c];
        if (bonus) {
          cell.classList.add(BONUS_CLASS[bonus]);
          cell.textContent = bonusLabel(bonus);
        }
        if (r === CENTER.row && c === CENTER.col) {
          cell.classList.add('center');
          cell.textContent = '';
        }
        boardEl.appendChild(cell);
      }
    }
  }

  function renderBoard() {
    const cells = boardEl.children;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const idx = r * BOARD_SIZE + c;
        const cell = cells[idx];
        if (cell.querySelector('input')) continue; // being edited
        const tile = board.get(r, c);
        cell.classList.remove('filled', 'blank', 'new-tile');
        if (tile) {
          cell.classList.add('filled');
          if (tile.isBlank) cell.classList.add('blank');
          cell.textContent = tile.letter;
        } else {
          const bonus = BONUS_GRID[r][c];
          cell.textContent = bonus ? bonusLabel(bonus) : '';
          if (r === CENTER.row && c === CENTER.col) cell.textContent = '';
        }
      }
    }
    if (previewTiles) applyPreview();
  }

  function applyPreview() {
    for (const t of previewTiles) {
      const idx = t.r * BOARD_SIZE + t.c;
      const cell = boardEl.children[idx];
      cell.classList.add('filled', 'new-tile');
      if (t.isBlank) cell.classList.add('blank');
      cell.textContent = t.letter;
    }
  }

  function clearPreview() {
    previewTiles = null;
  }

  function startEdit(cell) {
    if (cell.querySelector('input')) return;
    const r = Number(cell.dataset.r);
    const c = Number(cell.dataset.c);
    const existing = board.get(r, c);
    const prevText = cell.textContent;
    cell.textContent = '';
    const input = document.createElement('input');
    input.maxLength = 1;
    input.value = existing ? (existing.isBlank ? existing.letter.toLowerCase() : existing.letter) : '';
    cell.appendChild(input);
    input.focus();
    input.select();

    let committed = false;
    function commit() {
      if (committed) return;
      committed = true;
      const val = input.value.trim();
      if (/^[A-Za-z]$/.test(val)) {
        board.set(r, c, val.toUpperCase(), val === val.toLowerCase());
      } else {
        board.set(r, c, null);
      }
      input.remove();
      clearPreview();
      renderBoard();
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        commit();
      } else if (e.key === 'Escape') {
        committed = true;
        cell.textContent = prevText;
        input.remove();
      }
    });
    input.addEventListener('blur', commit);
  }

  boardEl.addEventListener('click', (e) => {
    const cell = e.target.closest('.cell');
    if (cell) startEdit(cell);
  });

  clearBoardBtn.addEventListener('click', () => {
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) board.set(r, c, null);
    }
    clearPreview();
    resultsEl.innerHTML = '';
    renderBoard();
  });

  rackInput.addEventListener('input', () => {
    rackInput.value = rackInput.value.toUpperCase().replace(/[^A-Z?]/g, '').slice(0, 7);
  });

  function setStatus(msg) {
    statusEl.textContent = msg;
  }

  function coordLabel(row, col, dir) {
    // Scrabble-style coordinate: column letter + row number for across,
    // row number + column letter for down.
    const colLetter = String.fromCharCode(65 + col);
    const rowNum = row + 1;
    return dir === 'H' ? `${rowNum}${colLetter}` : `${colLetter}${rowNum}`;
  }

  function renderResults(moves) {
    lastMoves = moves;
    resultsEl.innerHTML = '';
    if (moves.length === 0) {
      resultsEl.innerHTML = '<li class="meta">No legal plays found for this rack.</li>';
      return;
    }
    const top = moves.slice(0, 25);
    top.forEach((m, i) => {
      const li = document.createElement('li');
      const dirWord = m.dir === 'H' ? 'across' : 'down';
      li.innerHTML = `
        <div>
          <div class="word">${m.word}</div>
          <div class="meta">${coordLabel(m.row, m.col, m.dir)} &middot; ${dirWord}${m.newTileCount === 7 ? ' &middot; BINGO!' : ''}</div>
        </div>
        <div style="display:flex; align-items:center;">
          <div class="score">${m.score}</div>
          <button class="apply-btn" type="button">Apply</button>
        </div>
      `;
      li.addEventListener('click', (e) => {
        if (e.target.closest('.apply-btn')) return;
        previewTiles = m.tiles.filter((t) => t.isNew);
        renderBoard();
      });
      li.querySelector('.apply-btn').addEventListener('click', () => {
        for (const t of m.tiles) {
          if (t.isNew) board.set(t.r, t.c, t.letter, t.isBlank);
        }
        clearPreview();
        renderBoard();
        setStatus(`Applied "${m.word}" (${m.score} pts). Enter your new rack to continue.`);
        rackInput.value = '';
        resultsEl.innerHTML = '';
      });
      resultsEl.appendChild(li);
    });
  }

  async function ensureTrie() {
    if (trie) return trie;
    setStatus('Loading dictionary…');
    solveBtn.disabled = true;
    try {
      const res = await fetch('words/enable1.txt');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      trie = Trie.fromWordList(text);
      setStatus('Dictionary loaded. Ready to solve.');
    } catch (err) {
      setStatus(
        'Could not load the dictionary. If you opened this file directly, ' +
        'serve it over http(s) instead (e.g. `python3 -m http.server`) or use the GitHub Pages link.'
      );
      throw err;
    } finally {
      solveBtn.disabled = false;
    }
    return trie;
  }

  solveBtn.addEventListener('click', async () => {
    const rack = rackInput.value.replace(/[^A-Z?]/g, '').split('');
    if (rack.length === 0) {
      setStatus('Enter your rack first.');
      return;
    }
    try {
      await ensureTrie();
    } catch (e) {
      return;
    }
    setStatus('Solving…');
    clearPreview();
    // Let the status message paint before the (synchronous) solve runs.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const t0 = performance.now();
    const moves = CrossplaySolver.generateMoves(board, trie, rack);
    const ms = Math.round(performance.now() - t0);
    setStatus(`Found ${moves.length} legal play${moves.length === 1 ? '' : 's'} in ${ms}ms.`);
    renderResults(moves);
  });

  buildBoardDom();
  renderBoard();
  renderLetterValues();
  ensureTrie().catch(() => {});
})();
