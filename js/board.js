// Board geometry and tile data for NYT Crossplay.
// Bonus grid transcribed from the official Crossplay board.
// Codes: null = plain square, '2L'/'3L' = double/triple letter,
// '2W'/'3W' = double/triple word.

const BOARD_SIZE = 15;

const BONUS_GRID = (() => {
  const row = (spec) => {
    const r = new Array(BOARD_SIZE).fill(null);
    for (const [col, code] of spec) r[col] = code;
    return r;
  };

  const rowA = row([[0, '3L'], [3, '3W'], [7, '2L'], [11, '3W'], [14, '3L']]);
  const rowB = row([[1, '2W'], [6, '3L'], [8, '3L'], [13, '2W']]);
  const rowC = row([[4, '2L'], [10, '2L']]);
  const rowD = row([[0, '3W'], [3, '2L'], [7, '2W'], [11, '2L'], [14, '3W']]);
  const rowE = row([[2, '2L'], [5, '3L'], [9, '3L'], [12, '2L']]);
  const rowF = row([[4, '3L'], [7, '2L'], [10, '3L']]);
  const rowG = row([[1, '3L'], [13, '3L']]);
  const rowH = row([[0, '2L'], [3, '2W'], [5, '2L'], [8, '2L'], [11, '2W'], [14, '2L']]);

  return [
    rowA, rowB, rowC, rowD, rowE, rowF, rowG, rowH,
    rowG, rowF, rowE, rowD, rowC, rowB, rowA,
  ];
})();

const CENTER = { row: 7, col: 7 };

const LETTER_VALUES = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8,
  K: 5, L: 1, M: 3, N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1,
  U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10,
};

const BINGO_BONUS = 40; // awarded for playing all 7 rack tiles in one turn
const RACK_SIZE = 7;

const TILE_DISTRIBUTION = {
  A: 9, B: 2, C: 2, D: 4, E: 12, F: 2, G: 3, H: 2, I: 9, J: 1,
  K: 1, L: 4, M: 2, N: 6, O: 8, P: 2, Q: 1, R: 6, S: 4, T: 6,
  U: 4, V: 2, W: 2, X: 1, Y: 2, Z: 1, '?': 2,
};

function letterValue(letter, isBlank) {
  if (isBlank) return 0;
  return LETTER_VALUES[letter] || 0;
}

// A "cell" on the board is either null (empty) or { letter, isBlank }.
class Board {
  constructor() {
    this.grid = Array.from({ length: BOARD_SIZE }, () =>
      new Array(BOARD_SIZE).fill(null)
    );
  }

  clone() {
    const b = new Board();
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const cell = this.grid[r][c];
        b.grid[r][c] = cell ? { ...cell } : null;
      }
    }
    return b;
  }

  inBounds(r, c) {
    return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
  }

  get(r, c) {
    if (!this.inBounds(r, c)) return undefined;
    return this.grid[r][c];
  }

  set(r, c, letter, isBlank = false) {
    this.grid[r][c] = letter ? { letter: letter.toUpperCase(), isBlank } : null;
  }

  isEmptyBoard() {
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (this.grid[r][c]) return false;
      }
    }
    return true;
  }

  bonusAt(r, c) {
    return BONUS_GRID[r][c];
  }
}

const boardExports = {
  BOARD_SIZE,
  BONUS_GRID,
  CENTER,
  LETTER_VALUES,
  BINGO_BONUS,
  RACK_SIZE,
  TILE_DISTRIBUTION,
  letterValue,
  Board,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = boardExports;
} else {
  // Plain <script> tags don't put top-level const/class bindings on
  // `window`, so attach them explicitly for other scripts to consume.
  Object.assign(typeof window !== 'undefined' ? window : globalThis, boardExports);
}
