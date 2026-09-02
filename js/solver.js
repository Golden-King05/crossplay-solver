// Move generator + scorer for NYT Crossplay (standard anchor-based
// Scrabble move-generation algorithm: see Appel & Jacobson,
// "The World's Fastest Scrabble Program").

(function (global) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const {
    BOARD_SIZE, letterValue, RACK_SIZE, BINGO_BONUS,
  } = isNode ? require('./board.js') : global;

  const A_TO_Z = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

  function makeRackCounts(rackLetters) {
    const counts = {};
    for (const l of A_TO_Z) counts[l] = 0;
    counts['?'] = 0;
    for (let ch of rackLetters) {
      ch = ch.toUpperCase();
      if (ch === '?' || ch === '_' || ch === '*') counts['?']++;
      else if (/^[A-Z]$/.test(ch)) counts[ch]++;
    }
    return counts;
  }

  function runLetters(board, r, c, dr, dc) {
    const out = [];
    let rr = r + dr;
    let cc = c + dc;
    while (board.inBounds(rr, cc) && board.get(rr, cc)) {
      out.push({ r: rr, c: cc, letter: board.get(rr, cc).letter, isBlank: board.get(rr, cc).isBlank });
      rr += dr;
      cc += dc;
    }
    return out;
  }

  function computeAnchors(board) {
    const anchors = Array.from({ length: BOARD_SIZE }, () => new Array(BOARD_SIZE).fill(false));
    const empty = board.isEmptyBoard();
    if (empty) {
      anchors[7][7] = true; // center square, first move
      return anchors;
    }
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (board.get(r, c)) continue;
        const neighbors = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
        for (const [nr, nc] of neighbors) {
          if (board.inBounds(nr, nc) && board.get(nr, nc)) {
            anchors[r][c] = true;
            break;
          }
        }
      }
    }
    return anchors;
  }

  function computeCrossChecks(board, trie) {
    const horiz = Array.from({ length: BOARD_SIZE }, () => new Array(BOARD_SIZE).fill(null));
    const vert = Array.from({ length: BOARD_SIZE }, () => new Array(BOARD_SIZE).fill(null));

    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (board.get(r, c)) continue;

        const up = runLetters(board, r, c, -1, 0).reverse().map((t) => t.letter).join('');
        const down = runLetters(board, r, c, 1, 0).map((t) => t.letter).join('');
        if (up.length === 0 && down.length === 0) {
          horiz[r][c] = null;
        } else {
          const set = new Set();
          for (const L of A_TO_Z) if (trie.has(up + L + down)) set.add(L);
          horiz[r][c] = set;
        }

        const left = runLetters(board, r, c, 0, -1).reverse().map((t) => t.letter).join('');
        const right = runLetters(board, r, c, 0, 1).map((t) => t.letter).join('');
        if (left.length === 0 && right.length === 0) {
          vert[r][c] = null;
        } else {
          const set = new Set();
          for (const L of A_TO_Z) if (trie.has(left + L + right)) set.add(L);
          vert[r][c] = set;
        }
      }
    }
    return { horiz, vert };
  }

  // Score a contiguous list of tiles (each { r, c, letter, isBlank, isNew })
  // that form one word, applying letter/word bonuses only for newly placed tiles.
  function scoreTiles(board, tiles) {
    let sum = 0;
    let wordMult = 1;
    for (const t of tiles) {
      const val = letterValue(t.letter, t.isBlank);
      if (t.isNew) {
        const bonus = board.bonusAt(t.r, t.c);
        let letterMult = 1;
        if (bonus === '2L') letterMult = 2;
        else if (bonus === '3L') letterMult = 3;
        sum += val * letterMult;
        if (bonus === '2W') wordMult *= 2;
        else if (bonus === '3W') wordMult *= 3;
      } else {
        sum += val;
      }
    }
    return sum * wordMult;
  }

  function crossWordFor(board, r, c, mainDir) {
    // mainDir 'H' -> cross word is vertical; mainDir 'V' -> cross word is horizontal.
    const [dr, dc] = mainDir === 'H' ? [1, 0] : [0, 1];
    const before = runLetters(board, r, c, -dr, -dc).reverse();
    const after = runLetters(board, r, c, dr, dc);
    if (before.length === 0 && after.length === 0) return null;
    return before.concat([{ r, c, isCenter: true }]).concat(after);
  }

  function generateMoves(board, trie, rackLetters) {
    const anchors = computeAnchors(board);
    const { horiz, vert } = computeCrossChecks(board, trie);
    const results = [];

    function rc(dir, line, pos) {
      return dir === 'H' ? { r: line, c: pos } : { r: pos, c: line };
    }
    function cellAt(dir, line, pos) {
      const { r, c } = rc(dir, line, pos);
      return board.get(r, c);
    }
    function anchorAt(dir, line, pos) {
      const { r, c } = rc(dir, line, pos);
      return anchors[r][c];
    }
    function crossSetAt(dir, line, pos) {
      const { r, c } = rc(dir, line, pos);
      return dir === 'H' ? horiz[r][c] : vert[r][c];
    }

    function recordMove(dir, line, tiles, rackCounts) {
      const newTiles = tiles.filter((t) => t.isNew);
      if (newTiles.length === 0) return;

      const rcTiles = tiles.map((t) => ({ ...rc(dir, line, t.pos), letter: t.letter, isBlank: !!t.isBlank, isNew: !!t.isNew }));
      let total = scoreTiles(board, rcTiles);

      for (const t of rcTiles) {
        if (!t.isNew) continue;
        const cross = crossWordFor(board, t.r, t.c, dir);
        if (!cross) continue;
        const crossRcTiles = cross.map((ct) =>
          ct.isCenter
            ? { r: t.r, c: t.c, letter: t.letter, isBlank: t.isBlank, isNew: true }
            : { r: ct.r, c: ct.c, letter: ct.letter, isBlank: ct.isBlank, isNew: false }
        );
        total += scoreTiles(board, crossRcTiles);
      }

      if (newTiles.length === RACK_SIZE) total += BINGO_BONUS;

      const start = rc(dir, line, tiles[0].pos);
      results.push({
        dir,
        row: start.r,
        col: start.c,
        word: tiles.map((t) => t.letter).join(''),
        tiles: rcTiles,
        newTileCount: newTiles.length,
        score: total,
      });
    }

    function extendRight(dir, line, anchorPos, pos, node, tiles, rackCounts) {
      const outOfBounds = pos >= BOARD_SIZE;
      const cell = outOfBounds ? null : cellAt(dir, line, pos);

      if (!outOfBounds && cell) {
        const child = node.children[cell.letter];
        if (child) {
          extendRight(dir, line, anchorPos, pos + 1, child, tiles.concat([{ pos, letter: cell.letter, isBlank: cell.isBlank, isNew: false }]), rackCounts);
        }
        return;
      }

      // A word can only be recorded once it actually reaches/covers the
      // anchor square — otherwise it's a "left part" that never connects
      // to the anchor and would (if valid) be generated from a different
      // anchor instead.
      if (node.isWord && tiles.some((t) => t.pos === anchorPos)) {
        recordMove(dir, line, tiles, rackCounts);
      }
      if (outOfBounds) return;

      const allowed = crossSetAt(dir, line, pos);
      for (const letter of Object.keys(node.children)) {
        if (allowed && !allowed.has(letter)) continue;
        const child = node.children[letter];
        if (rackCounts[letter] > 0) {
          rackCounts[letter]--;
          extendRight(dir, line, anchorPos, pos + 1, child, tiles.concat([{ pos, letter, isBlank: false, isNew: true }]), rackCounts);
          rackCounts[letter]++;
        }
        if (rackCounts['?'] > 0) {
          rackCounts['?']--;
          extendRight(dir, line, anchorPos, pos + 1, child, tiles.concat([{ pos, letter, isBlank: true, isNew: true }]), rackCounts);
          rackCounts['?']++;
        }
      }
    }

    // `node` must be the trie node reached by walking the root through
    // `tiles`' letters in left-to-right order (tiles may be empty, in which
    // case node === trie.root). Because we build the left part by prepending
    // (each new letter sits to the LEFT of everything placed so far), we
    // cannot reuse forward-trie child pointers for the new letter — those
    // only extend a prefix to the right. Instead we re-walk from the root
    // through [candidateLetter, ...existing tiles] each time; tiles never
    // exceeds the rack size so this stays cheap.
    function leftPart(dir, line, anchorPos, pos, limit, node, tiles, rackCounts) {
      extendRight(dir, line, anchorPos, anchorPos, node, tiles, rackCounts);
      if (limit <= 0) return;
      const allowed = crossSetAt(dir, line, pos);
      for (const letter of A_TO_Z) {
        if (allowed && !allowed.has(letter)) continue;
        let child = trie.root.children[letter];
        for (let i = 0; child && i < tiles.length; i++) child = child.children[tiles[i].letter];
        if (!child) continue;
        if (rackCounts[letter] > 0) {
          rackCounts[letter]--;
          leftPart(dir, line, anchorPos, pos - 1, limit - 1, child, [{ pos, letter, isBlank: false, isNew: true }].concat(tiles), rackCounts);
          rackCounts[letter]++;
        }
        if (rackCounts['?'] > 0) {
          rackCounts['?']--;
          leftPart(dir, line, anchorPos, pos - 1, limit - 1, child, [{ pos, letter, isBlank: true, isNew: true }].concat(tiles), rackCounts);
          rackCounts['?']++;
        }
      }
    }

    for (const dir of ['H', 'V']) {
      for (let line = 0; line < BOARD_SIZE; line++) {
        for (let pos = 0; pos < BOARD_SIZE; pos++) {
          if (!anchorAt(dir, line, pos)) continue;
          const rackCounts = makeRackCounts(rackLetters);

          if (pos - 1 >= 0 && cellAt(dir, line, pos - 1)) {
            // Fixed prefix already on the board: walk the trie through it.
            let run = [];
            let p = pos - 1;
            while (p >= 0 && cellAt(dir, line, p)) {
              run.unshift({ pos: p, cell: cellAt(dir, line, p) });
              p--;
            }
            let node = trie.root;
            let ok = true;
            const tiles = [];
            for (const { pos: rp, cell } of run) {
              node = node.children[cell.letter];
              if (!node) { ok = false; break; }
              tiles.push({ pos: rp, letter: cell.letter, isBlank: cell.isBlank, isNew: false });
            }
            if (ok) extendRight(dir, line, pos, pos, node, tiles, rackCounts);
          } else {
            let limit = 0;
            let p = pos - 1;
            while (p >= 0 && !cellAt(dir, line, p) && !anchorAt(dir, line, p)) {
              limit++;
              p--;
            }
            leftPart(dir, line, pos, pos - 1, limit, trie.root, [], rackCounts);
          }
        }
      }
    }

    // De-duplicate the rare case where a single new tile simultaneously
    // completes a horizontal and a vertical word (recorded once per pass).
    const seen = new Map();
    for (const mv of results) {
      const key = mv.tiles
        .filter((t) => t.isNew)
        .map((t) => `${t.r},${t.c},${t.letter},${t.isBlank ? 1 : 0}`)
        .sort()
        .join('|');
      const existing = seen.get(key);
      if (!existing || mv.word.length > existing.word.length) {
        seen.set(key, mv);
      }
    }

    return Array.from(seen.values()).sort((a, b) => b.score - a.score);
  }

  const api = { generateMoves, computeAnchors, computeCrossChecks, makeRackCounts };
  if (isNode) module.exports = api;
  else global.CrossplaySolver = api;
})(typeof window !== 'undefined' ? window : globalThis);
