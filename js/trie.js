// Minimal trie (prefix tree) used for dictionary lookups and move generation.

class TrieNode {
  constructor() {
    this.children = Object.create(null);
    this.isWord = false;
  }
}

class Trie {
  constructor() {
    this.root = new TrieNode();
  }

  insert(word) {
    let node = this.root;
    for (const ch of word) {
      if (!node.children[ch]) node.children[ch] = new TrieNode();
      node = node.children[ch];
    }
    node.isWord = true;
  }

  has(word) {
    let node = this.root;
    for (const ch of word) {
      node = node.children[ch];
      if (!node) return false;
    }
    return node.isWord;
  }

  child(node, letter) {
    return node.children[letter];
  }

  static fromWordList(text) {
    const trie = new Trie();
    const words = text.split(/\r?\n/);
    for (let w of words) {
      w = w.trim().toUpperCase();
      if (w.length > 1 && /^[A-Z]+$/.test(w)) {
        trie.insert(w);
      } else if (w.length === 1 && /^[A-Z]$/.test(w)) {
        // Single-letter words (A, I) are valid plays.
        trie.insert(w);
      }
    }
    return trie;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Trie, TrieNode };
} else {
  const g = typeof window !== 'undefined' ? window : globalThis;
  g.Trie = Trie;
  g.TrieNode = TrieNode;
}
