// parse.js — a fast drop-in for marked 18.1.3 (default options).
// Written from scratch against the CommonMark 0.31.2 + GFM 0.29 spec
// examples and marked's observed output. No marked code is used.

const isDigit = c => c >= 48 && c <= 57;
const isAlpha = c => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const isAlnum = c => isDigit(c) || isAlpha(c);
const PUNCT = new Set('!\"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'.split(''));
const isPunct = c => c < 128 && PUNCT.has(String.fromCharCode(c));
// Unicode punctuation for flanking: ASCII punctuation plus the general
// categories P and S (approximated by the common ranges, including the
// currency symbols U+00A3 and U+20AC).
const isPunctU = c => {
  if (c < 128) return PUNCT.has(String.fromCharCode(c));
  return (c >= 0x00a1 && c <= 0x00bf) || (c >= 0x2000 && c <= 0x206f) ||
    (c >= 0x20a0 && c <= 0x20bf) || (c >= 0x2190 && c <= 0x2bff) ||
    (c >= 0x3000 && c <= 0x303f) || (c >= 0xff00 && c <= 0xffef);
};
const isUnicodeWS = c => c === 32 || c === 9 || c === 10 || c === 11 || c === 12 || c === 13 || c === 0xA0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200A) || c === 0x202F || c === 0x205F || c === 0x3000 || c === 0xFEFF;
const lowerStr = s => s.replace(/\u00df|\u1e9e/g, 'ss').toLowerCase();

function escapeCode(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0xe000) out += '&amp;';
    else if (c === 38) out += '&amp;';
    else if (c === 60) out += '&lt;';
    else if (c === 62) out += '&gt;';
    else if (c === 34) out += '&quot;';
    else if (c === 39) out += '&#39;';
    else out += s[i];
  }
  return out;
}
function escapeAttr(s) {
  // Attribute values: keep valid entity references as-is; escape a bare
  // "&". A U+E000 placeholder stands for a literal "&" from a backslash
  // escape and is always escaped.
  let out = '', i = 0;
  while (i < s.length) {
    const c = s.charCodeAt(i);
    if (c === 0xe000) { out += '&amp;'; i++; continue; }
    if (c === 38) {
      let j = i + 1;
      if (j < s.length && s.charCodeAt(j) === 35) {
        let k = j + 1, hex = false;
        if (k < s.length && (s.charCodeAt(k) === 120 || s.charCodeAt(k) === 88)) { hex = true; k++; }
        const ds = k;
        while (k < s.length) {
          const d = s.charCodeAt(k);
          if (hex ? ((d >= 48 && d <= 57) || (d >= 65 && d <= 70) || (d >= 97 && d <= 102)) : (d >= 48 && d <= 57)) k++;
          else break;
        }
        const nd = k - ds;
        if (k < s.length && s.charCodeAt(k) === 59 && nd >= 1 && nd <= (hex ? 6 : 7)) {
          out += s.slice(i, k + 1); i = k + 1; continue;
        }
        out += '&amp;'; i++; continue;
      }
      let k = j;
      while (k < s.length) {
        const d = s.charCodeAt(k);
        if ((d >= 48 && d <= 57) || (d >= 65 && d <= 90) || (d >= 97 && d <= 122) || d === 95) k++;
        else break;
      }
      if (k > j && k < s.length && s.charCodeAt(k) === 59) {
        out += s.slice(i, k + 1); i = k + 1; continue;
      }
      out += '&amp;'; i++; continue;
    }
    if (c === 60) out += '&lt;';
    else if (c === 62) out += '&gt;';
    else if (c === 34) out += '&quot;';
    else out += s[i];
    i++;
  }
  return out;
}

const NAMED_ENTITY_RE = /^&[A-Za-z][A-Za-z0-9]*;/;
function decodeNumericRefs(s) {
  // Fast path: no "&", "<", ">", '"', "'", or U+E000 placeholder --
  // the overwhelmingly common case for plain text. Return as-is.
  let hasSpecial = false;
  for (let k = 0; k < s.length; k++) {
    const c = s.charCodeAt(k);
    if (c === 38 || c === 60 || c === 62 || c === 34 || c === 39 || c === 0xe000) { hasSpecial = true; break; }
  }
  if (!hasSpecial) return s;
  let out = '', i = 0;
  while (i < s.length) {
    const c = s.charCodeAt(i);
    if (c === 0xe000) { out += '&amp;'; i++; continue; }
    if (c === 38 && i + 1 < s.length && s.charCodeAt(i + 1) === 35) {
      let j = i + 2, hex = false;
      if (j < s.length && (s.charCodeAt(j) === 120 || s.charCodeAt(j) === 88)) { hex = true; j++; }
      const ds = j;
      if (hex) while (j < s.length && ((s.charCodeAt(j) >= 48 && s.charCodeAt(j) <= 57) || (s.charCodeAt(j) >= 65 && s.charCodeAt(j) <= 70) || (s.charCodeAt(j) >= 97 && s.charCodeAt(j) <= 102))) j++;
      else while (j < s.length && isDigit(s.charCodeAt(j))) j++;
      const nd = j - ds;
      if (j < s.length && s.charCodeAt(j) === 59 && nd >= 1 && nd <= (hex ? 6 : 7)) {
        const v = parseInt(s.slice(ds, j), hex ? 16 : 10);
        let ch;
        if (v === 0 || v > 0x10FFFF || (v >= 0xD800 && v <= 0xDFFF)) ch = '�';
        else ch = String.fromCodePoint(v);
        out += escapeCode(ch);
        i = j + 1; continue;
      }
      out += '&amp;'; i++; continue;
    }
    if (c === 38) {
      // Manual named-entity scan (avoids slice + regex per "&").
      let j = i + 1;
      if (j < s.length && isAlpha(s.charCodeAt(j))) {
        j++;
        while (j < s.length && isAlnum(s.charCodeAt(j))) j++;
        if (j < s.length && s.charCodeAt(j) === 59) { out += s.slice(i, j + 1); i = j + 1; continue; }
      }
      out += '&amp;'; i++; continue;
    }
    if (c === 60) out += '&lt;';
    else if (c === 62) out += '&gt;';
    else if (c === 34) out += '&quot;';
    else if (c === 39) out += '&#39;';
    else out += s[i];
    i++;
  }
  return out;
}
function escapeText(s) { return decodeNumericRefs(s); }

function encodeHref(dest) {
  let enc = encodeURI(dest);
  // Fast path: no "[", "]", "%", "&", "<", ">", '"', "'" -- return the
  // encodeURI result directly (the common case for plain URLs).
  let special = false;
  for (let k = 0; k < enc.length; k++) {
    const c = enc.charCodeAt(k);
    if (c === 91 || c === 93 || c === 37 || c === 38 || c === 60 || c === 62 || c === 34 || c === 39) { special = true; break; }
  }
  if (!special) return enc;
  enc = enc.replace(/\[/g, '%5B').replace(/\]/g, '%5D').replace(/%25/g, '%');
  // After the bracket fixes, only "&" and "<>\"'" need escaping.
  let special2 = false;
  for (let k = 0; k < enc.length; k++) {
    const c = enc.charCodeAt(k);
    if (c === 38 || c === 60 || c === 62 || c === 34 || c === 39) { special2 = true; break; }
  }
  if (!special2) return enc;
  let out = '', i = 0;
  while (i < enc.length) {
    const c = enc.charCodeAt(i);
    if (c === 38) {
      // Manual entity check (no slice + regex): "&" + optional "#"
      // + optional x/X + 1-7 digits/1-6 hex + ";", or "&" + letter +
      // alnum* + ";".
      let j = i + 1, ok = false;
      if (j < enc.length && enc.charCodeAt(j) === 35) {
        j++;
        if (j < enc.length && (enc.charCodeAt(j) === 120 || enc.charCodeAt(j) === 88)) j++;
        const ds = j;
        let hex = false;
        if (ds > i + 2) hex = true;
        while (j < enc.length) {
          const d = enc.charCodeAt(j);
          if (hex ? ((d >= 48 && d <= 57) || (d >= 65 && d <= 70) || (d >= 97 && d <= 102)) : (d >= 48 && d <= 57)) { j++; continue; }
          break;
        }
        if (j < enc.length && enc.charCodeAt(j) === 59 && j - ds >= 1 && j - ds <= (hex ? 6 : 7)) ok = true;
      } else if (j < enc.length && isAlpha(enc.charCodeAt(j))) {
        j++;
        while (j < enc.length && isAlnum(enc.charCodeAt(j))) j++;
        if (j < enc.length && enc.charCodeAt(j) === 59) ok = true;
      }
      if (ok) { out += '&'; i++; continue; }
      out += '&amp;'; i++; continue;
    }
    if (c === 60) out += '&lt;';
    else if (c === 62) out += '&gt;';
    else if (c === 34) out += '&quot;';
    else if (c === 39) out += '&#39;';
    else out += enc[i];
    i++;
  }
  return out;
}

function cleanDest(raw) {
  let out = '', i = 0;
  while (i < raw.length) {
    const c = raw.charCodeAt(i);
    if (c === 92 && i + 1 < raw.length && isPunct(raw.charCodeAt(i + 1))) { out += raw[i + 1]; i += 2; }
    else { out += raw[i]; i++; }
  }
  return out;
}
function cleanTitle(raw) {
  let out = '', i = 0;
  while (i < raw.length) {
    const c = raw.charCodeAt(i);
    if (c === 92 && i + 1 < raw.length && isPunct(raw.charCodeAt(i + 1))) { out += raw[i + 1]; i += 2; }
    else { out += raw[i]; i++; }
  }
  return out;
}

// ------------------------------------------------------------ inline HTML tag
// Returns {text,end} when src[pos] starts a valid inline HTML tag, else null.
function scanTagAt(src, pos) {
  const n = src.length;
  if (src.charCodeAt(pos) !== 60) return null;
  let i = pos + 1;
  let closing = false;
  if (i < n && src.charCodeAt(i) === 47) { closing = true; i++; }
  if (i >= n || !isAlpha(src.charCodeAt(i))) {
    if (i < n && src.charCodeAt(i) === 33) {
      if (src.slice(i, i + 3) === '!--') {
        // "<!-->" and "<!--->" are short (abruptly closed) comments.
        if (src.charCodeAt(i + 3) === 62) return { text: src.slice(pos, i + 4), end: i + 4 };
        if (src.slice(i + 3, i + 5) === '->') return { text: src.slice(pos, i + 6), end: i + 6 };
        const e = src.indexOf('-->', i + 3);
        if (e === -1) return null;
        return { text: src.slice(pos, e + 3), end: e + 3 };
      }
      if (src.slice(i, i + 8) === '![CDATA[') {
        const e = src.indexOf(']]>', i + 8);
        if (e === -1) return null;
        return { text: src.slice(pos, e + 3), end: e + 3 };
      }
      if (i + 1 < n && isAlpha(src.charCodeAt(i + 1))) {
        const e = src.indexOf('>', i + 1);
        if (e === -1) return null;
        return { text: src.slice(pos, e + 1), end: e + 1 };
      }
      return null;
    }
    if (i < n && src.charCodeAt(i) === 63) {
      const e = src.indexOf('?>', i + 1);
      if (e === -1) return null;
      return { text: src.slice(pos, e + 2), end: e + 2 };
    }
    return null;
  }
  let j = i;
  while (j < n && (isAlnum(src.charCodeAt(j)) || src.charCodeAt(j) === 45)) j++;
  i = j;
  if (closing) {
    while (i < n && (src.charCodeAt(i) === 32 || src.charCodeAt(i) === 9 || src.charCodeAt(i) === 10)) i++;
    if (i < n && src.charCodeAt(i) === 62) return { text: src.slice(pos, i + 1), end: i + 1 };
    return null;
  }
  let lastNonWS = -1;
  let firstAttr = true;
  for (;;) {
    const wsStart = i;
    while (i < n && (src.charCodeAt(i) === 32 || src.charCodeAt(i) === 9 || src.charCodeAt(i) === 10)) i++;
    if (i >= n) return null;
    if (src.charCodeAt(i) === 62) return { text: src.slice(pos, i + 1), end: i + 1 };
    if (src.charCodeAt(i) === 47 && i + 1 < n && src.charCodeAt(i + 1) === 62) return { text: src.slice(pos, i + 2), end: i + 2 };
    // The first attribute must be preceded by whitespace: a tag name
    // followed directly by other characters (e.g. "<m:abc>") is not a tag.
    if (firstAttr && i === wsStart) return null;
    firstAttr = false;
    if (lastNonWS >= 0 && i === lastNonWS + 1 && src.charCodeAt(i) !== 62 && src.charCodeAt(i) !== 47) return null;
    const an = i;
    if (!isAlpha(src.charCodeAt(i)) && src.charCodeAt(i) !== 95 && src.charCodeAt(i) !== 58) return null;
    i++;
    while (i < n && (isAlnum(src.charCodeAt(i)) || src.charCodeAt(i) === 95 || src.charCodeAt(i) === 58 || src.charCodeAt(i) === 46 || src.charCodeAt(i) === 45)) i++;
    while (i < n && (src.charCodeAt(i) === 32 || src.charCodeAt(i) === 9 || src.charCodeAt(i) === 10)) i++;
    if (i < n && src.charCodeAt(i) === 61) {
      i++;
      while (i < n && (src.charCodeAt(i) === 32 || src.charCodeAt(i) === 9 || src.charCodeAt(i) === 10)) i++;
      if (i >= n) return null;
      const q = src.charCodeAt(i);
      if (q === 34 || q === 39) {
        const e = src.indexOf(String.fromCharCode(q), i + 1);
        if (e === -1) return null;
        i = e + 1;
      } else {
        if (i < n && (src.charCodeAt(i) === 34 || src.charCodeAt(i) === 39 || src.charCodeAt(i) === 61 || src.charCodeAt(i) === 60 || src.charCodeAt(i) === 62 || src.charCodeAt(i) === 96)) return null;
        let st = i;
        while (i < n && src.charCodeAt(i) !== 32 && src.charCodeAt(i) !== 9 && src.charCodeAt(i) !== 10 && src.charCodeAt(i) !== 62 && src.charCodeAt(i) !== 34 && src.charCodeAt(i) !== 39 && src.charCodeAt(i) !== 61 && src.charCodeAt(i) !== 60 && src.charCodeAt(i) !== 96) i++;
        if (i === st) return null;
      }
      lastNonWS = i - 1;
    } else {
      lastNonWS = i - 1;
      if (an === i) return null;
    }
  }
}

// ----------------------------------------------- link reference definitions
// lines: array of paragraph lines starting at the def. Returns
// {label, dest, title, consumed} or null.
function tryParseDef(lines) {
  if (!lines.length) return null;
  const joined = lines.join('\n');
  let p = 0;
  while (p < joined.length && (joined.charCodeAt(p) === 32 || joined.charCodeAt(p) === 9)) p++;
  if (p > 3) return null;
  if (joined.charCodeAt(p) !== 91) return null;
  // The label may span lines, so search the joined text (not just the
  // first line) for its closing "]".
  const closeIdx = findLabelClose(joined, p + 1);
  if (closeIdx === -1) return null;
  const labelRaw = joined.slice(p + 1, closeIdx);
  // A definition label may not contain an UNESCAPED "[" (an escaped
  // "\[" is fine and part of the label).
  let hasUnescBracket = false;
  for (let bi = 0; bi < labelRaw.length; bi++) {
    if (labelRaw.charCodeAt(bi) === 92) { bi++; continue; }
    if (labelRaw.charCodeAt(bi) === 91) { hasUnescBracket = true; break; }
  }
  if (hasUnescBracket) return null;
  const label = lowerStr(labelRaw.replace(/[ \t\n]+/g, ' ').trim());
  if (!label) return null;
  // Assemble the tail from subsequent lines (dest/title may be on later
  // lines), keeping the LONGEST successful parse.
  const base = closeIdx + 1;
  let best = null;
  for (let usedLines = 1; usedLines <= lines.length; usedLines++) {
    const tail = joined.slice(base, lines.slice(0, usedLines).join('\n').length);
    const r = tryParseDefTail(tail);
    if (r) best = { label, dest: r.dest, title: r.title, consumed: usedLines };
    if (tail.trim() === '') continue;
  }
  return best;
}
function findLabelClose(s, i) {
  // A link label can contain balanced brackets: "[" increments the
  // depth, "]" decrements it; the label closes when depth returns to 0.
  // Backslash escapes and code spans are skipped.
  let depth = 1;
  while (i < s.length) {
    const c = s.charCodeAt(i);
    if (c === 92 && i + 1 < s.length) { i += 2; continue; }
    if (c === 96) {
      let j = i;
      while (j < s.length && s.charCodeAt(j) === 96) j++;
      const run = j - i;
      let m = j;
      let found = -1;
      while (m < s.length) {
        if (s.charCodeAt(m) === 96) {
          let k = m;
          while (k < s.length && s.charCodeAt(k) === 96) k++;
          if (k - m === run) { found = k; break; }
          m = k;
        } else m++;
      }
      if (found !== -1) { i = found; continue; }
      i = j;
      continue;
    }
    if (c === 91) depth++;
    else if (c === 93) { depth--; if (depth === 0) return i; }
    i++;
  }
  return -1;
}
function tryParseDefTail(tail) {
  let p = 0;
  while (p < tail.length && (tail.charCodeAt(p) === 32 || tail.charCodeAt(p) === 9 || tail.charCodeAt(p) === 10)) p++;
  if (p >= tail.length || tail.charCodeAt(p) !== 58) return null;
  p++;
  while (p < tail.length && (tail.charCodeAt(p) === 32 || tail.charCodeAt(p) === 9)) p++;
  // A newline may follow the colon; a tab may NOT. The destination may
  // be on a later line with any indentation.
  if (p < tail.length && tail.charCodeAt(p) === 10) {
    p++;
    while (p < tail.length && (tail.charCodeAt(p) === 32 || tail.charCodeAt(p) === 9)) { p++; }
  }
  if (p >= tail.length) return null;
  let dest, afterDest;
  if (tail.charCodeAt(p) === 60) {
    const ce = tail.indexOf('>', p + 1);
    if (ce === -1) return null;
    const raw = tail.slice(p + 1, ce);
    for (let q = 0; q < raw.length; q++) {
      const cc = raw.charCodeAt(q);
      if (cc === 10 || cc < 32) return null;
    }
    dest = cleanDest(raw);
    afterDest = ce + 1;
  } else {
    let d = p, paren = 0;
    while (d < tail.length) {
      const c = tail.charCodeAt(d);
      if (c === 32 || c === 9 || c === 10) break;
      if (c === 40) paren++;
      if (c === 41) { if (paren === 0) break; paren--; }
      if (c === 92 && d + 1 < tail.length && isPunct(tail.charCodeAt(d + 1))) { d += 2; continue; }
      d++;
    }
    if (d === p) return null;
    const raw = tail.slice(p, d);
    for (let q = 0; q < raw.length; q++) {
      const cc = raw.charCodeAt(q);
      if (cc === 10 || cc < 32) return null;
    }
    dest = cleanDest(raw);
    afterDest = d;
  }
  let q = afterDest;
  let spacesBeforeTitle = 0, hasNL = false;
  while (q < tail.length && (tail.charCodeAt(q) === 32 || tail.charCodeAt(q) === 9 || tail.charCodeAt(q) === 10)) {
    if (tail.charCodeAt(q) === 10) hasNL = true;
    else spacesBeforeTitle++;
    q++;
  }
  if (q >= tail.length) return { dest, title: null };
  // The title must be separated from the destination by whitespace.
  if (spacesBeforeTitle === 0 && !hasNL) return null;
  const qc = tail.charCodeAt(q);
  if (qc !== 34 && qc !== 39 && qc !== 40) return null;
  const closeQ = qc === 40 ? 41 : qc;
  let e2 = q + 1;
  let title = '';
  while (e2 < tail.length) {
    const c = tail.charCodeAt(e2);
    if (c === 92 && e2 + 1 < tail.length && isPunct(tail.charCodeAt(e2 + 1))) { title += tail[e2 + 1]; e2 += 2; continue; }
    if (c === closeQ) break;
    if (c === 10 && closeQ !== 41 && hasNL) return null;
    title += tail[e2]; e2++;
  }
  if (e2 >= tail.length || tail.charCodeAt(e2) !== closeQ) return null;
  let r = e2 + 1;
  while (r < tail.length && (tail.charCodeAt(r) === 32 || tail.charCodeAt(r) === 9)) r++;
  if (r < tail.length) return null;
  return { dest, title: cleanTitle(title) };
}

// ----------------------------------------------------------------- autolinks
function tryAutolink(src, i) {
  const n = src.length;
  const gt = src.indexOf('>', i + 1);
  if (gt === -1) return null;
  const inner = src.slice(i + 1, gt);
  if (!inner) return null;
  if (/[ \t\n]/.test(inner)) return null;
  const schemeM = /^[A-Za-z][A-Za-z0-9+.-]{1,31}:/.exec(inner);
  if (schemeM) {
    return { href: inner, text: inner, end: gt + 1 };
  }
  if (/^mailto:/i.test(inner)) {
    const after = inner.slice(7);
    if (/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z0-9-]{2,}$/.test(after)) {
      return { href: inner, text: inner, end: gt + 1 };
    }
    return null;
  }
  if (inner.startsWith('mailto:')) return null;
  const at = inner.indexOf('@');
  if (at > 0) {
    const local = inner.slice(0, at);
    const dom = inner.slice(at + 1);
    if (/^[A-Za-z0-9._%+-]+$/.test(local) && /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z0-9-]{2,}$/.test(dom)) {
      return { href: 'mailto:' + inner, text: inner, end: gt + 1 };
    }
  }
  return null;
}
function schemeUrlEnd(src, i) {
  let j = i;
  while (j < src.length) {
    const c = src.charCodeAt(j);
    if (c === 32 || c === 9 || c === 10 || c === 60 || c === 62) break;
    j++;
  }
  let end = j;
  // A trailing "&word;" entity-like suffix is excluded. This must run
  // BEFORE the trailing-punctuation trim, which would otherwise strip
  // the ";" and hide the entity.
  const amp = src.lastIndexOf('&', end);
  if (amp >= i) {
    const semi = src.indexOf(';', amp);
    if (semi !== -1 && semi < end && /^&\w+;$/.test(src.slice(amp, semi + 1))) end = amp;
  }
  while (end > i) {
    const c = src.charCodeAt(end - 1);
    if (c === 46 || c === 44 || c === 59 || c === 58 || c === 33 || c === 63 || c === 34 || c === 39 || c === 95 || c === 126 || c === 42) end--;
    else break;
  }
  let bal = 0;
  for (let k = i; k < end; k++) {
    const c = src.charCodeAt(k);
    if (c === 40) bal++;
    if (c === 41) bal--;
  }
  while (bal < 0 && end > i) {
    if (src.charCodeAt(end - 1) === 41) { end--; bal++; } else break;
  }
  let parenDepth = 0;
  for (let k = i; k < end; k++) {
    const c = src.charCodeAt(k);
    if (c === 40) {
      // An unbalanced "(" truncates the URL just before it, whether or
      // not earlier ")"s drove the depth negative.
      if (k > i) {
        let bal2 = 0;
        for (let m = k; m < end; m++) {
          if (src.charCodeAt(m) === 40) bal2++;
          if (src.charCodeAt(m) === 41) bal2--;
        }
        if (bal2 > 0) { end = k; break; }
      }
      parenDepth++;
    }
    if (c === 41 && parenDepth > 0) parenDepth--;
  }
  return end;
}
function tryWww(src, i) {
  const prev = i === 0 ? -1 : src.charCodeAt(i - 1);
  if (prev !== -1) {
    const ok = prev === 32 || prev === 9 || prev === 10 || prev === 42 || prev === 95 || prev === 126 || prev === 40;
    if (!ok) return null;
  }
  const end = schemeUrlEnd(src, i);
  if (end - i < 5) return null;
  const text = src.slice(i, end);
  if (!/^(www\.)[^ \t\n]*[A-Za-z0-9_~\-]$/.test(text) && !/^www\.[A-Za-z0-9-]+/.test(text)) return null;
  if (text === 'www.' || /[^A-Za-z0-9._~:/?#@!$&'()*+,;=%-]/.test(text)) return null;
  return { href: 'http://' + text, text, end };
}
const SCHEMES = ['http://', 'https://', 'ftp://', 'sftp://'];
function trySchemeUrl(src, i) {
  // Case-insensitive scheme match without slicing: compare the first
  // letter, then the rest char by char (lowercased on the fly).
  const c0 = src.charCodeAt(i) | 32;
  if (c0 === 104 || c0 === 102 || c0 === 115) {
    for (const s of SCHEMES) {
      if ((src.charCodeAt(i) | 32) !== s.charCodeAt(0)) continue;
      let ok = true;
      for (let k = 1; k < s.length; k++) {
        if ((src.charCodeAt(i + k) | 32) !== s.charCodeAt(k)) { ok = false; break; }
      }
      if (!ok) continue;
      const end = schemeUrlEnd(src, i);
      if (end - i <= s.length) return null;
      return { href: src.slice(i, end), text: src.slice(i, end), end };
    }
  }
  // A scheme followed by an email (+ one path segment) is autolinked,
  // but ONLY for "mailto:" and "xmpp:" (probed: tel/foo/abc/irc/sip/
  // skype/callto/bitcoin/magnet do NOT link as a whole). The scheme
  // must be all-lowercase: "MAILTO:foo@bar.com" does NOT link as a
  // whole (only "foo@bar.com" becomes an email link). A scheme followed
  // by "//" is only linked for http/https/ftp/sftp (handled above).
  // Manual scheme scan (no slice): letter, then alnum/+/-/. (2-32),
  // then ":".
  let k = i + 1;
  let lower = src.charCodeAt(i) >= 97 && src.charCodeAt(i) <= 122;
  while (k < src.length) {
    const d = src.charCodeAt(k);
    if (d >= 65 && d <= 90) lower = false;
    if (isAlnum(d) || d === 43 || d === 45 || d === 46) { k++; continue; }
    break;
  }
  const schemeText = src.slice(i, k);
  if (lower && (schemeText === 'mailto' || schemeText === 'xmpp') && k < src.length && src.charCodeAt(k) === 58) {
    const afterColon = k + 1;
    if (!src.startsWith('//', afterColon)) {
      const e = tryEmailAt(src, afterColon, afterColon);
      if (e) {
        let end = e.end;
        if (end < src.length && src.charCodeAt(end) === 47) {
          let p2 = end + 1;
          while (p2 < src.length) {
            const d = src.charCodeAt(p2);
            if (d === 32 || d === 9 || d === 10 || d === 60 || d === 47) break;
            p2++;
          }
          if (p2 > end + 1) end = p2;
        }
        return { href: src.slice(i, end), text: src.slice(i, end), end };
      }
    }
  }
  return null;
}
function tryEmailAt(src, localStart, matchStart) {
  let j = localStart;
  const n = src.length;
  let at = -1;
  while (j < n) {
    const c = src.charCodeAt(j);
    if (isAlnum(c) || c === 46 || c === 95 || c === 43 || c === 45) { j++; continue; }
    if (c === 64) { at = j; j++; break; }
    break;
  }
  if (at === -1) return null;
  let k = j;
  while (k < n) {
    const c = src.charCodeAt(k);
    if (isAlnum(c) || c === 46 || c === 95 || c === 45) { k++; continue; }
    break;
  }
  let end = k;
  // A trailing "-" or "_" after the domain makes the WHOLE thing not an
  // email (unlike ".", which is trimmed and the email still forms).
  if (end > j) {
    const lastDom = src.charCodeAt(end - 1);
    if (lastDom === 45 || lastDom === 95) return null;
  }
  while (end > j) {
    const c = src.charCodeAt(end - 1);
    if (c === 46 || c === 95 || c === 45 || c === 58 || c === 47 || c === 63 || c === 35 || c === 44 || c === 59 || c === 33 || c === 46) end--;
    else break;
  }
  const dom = src.slice(j, end);
  if (!dom || dom.charCodeAt(0) === 46 || !dom.includes('.')) return null;
  if (/[._-]/.test(dom.charAt(dom.length - 1))) return null;
  const local = src.slice(localStart, at);
  if (!local) return null;
  return { start: matchStart, end, text: src.slice(matchStart, end) };
}
function tryEmail(src, i) {
  // i is the '@'. Find the local part start.
  let s = i - 1;
  while (s >= 0) {
    const c = src.charCodeAt(s);
    if (isAlnum(c) || c === 46 || c === 95 || c === 43 || c === 45) s--;
    else break;
  }
  s++;
  if (s === i) return null;
  // A backslash-escaped first character is not part of an email.
  if (s > 0 && src.charCodeAt(s - 1) === 92 && isPunct(src.charCodeAt(s))) return null;
  return tryEmailAt(src, s, s);
}
function isBlankLine(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

// ------------------------------------------------------------ inline parsing
function parseInline(src, refs) {
  const nodes = [];
  const n = src.length;
  let i = 0;
  let buf = '';
  const flush = () => { if (buf) { nodes.push({ t: 'text', s: buf }); buf = ''; } };
  while (i < n) {
    const c = src.charCodeAt(i);
    if (c === 92) {
      const d = src.charCodeAt(i + 1);
      if (d === 10) {
        flush(); nodes.push({ t: 'br' });
        i += 2;
        while (i < n && (src.charCodeAt(i) === 32 || src.charCodeAt(i) === 9)) i++;
        continue;
      }
      if (i + 1 < n && isPunct(d)) { buf += d === 38 ? '\uE000' : String.fromCharCode(d); i += 2; continue; }
      buf += '\\'; i++; continue;
    }
    if (c === 96) {
      let j = i;
      while (j < n && src.charCodeAt(j) === 96) j++;
      const run = j - i;
      let k = j, found = -1;
      while (k < n) {
        if (src.charCodeAt(k) === 96) {
          let m = k;
          while (m < n && src.charCodeAt(m) === 96) m++;
          if (m - k === run) { found = k; break; }
          k = m;
        } else k++;
      }
      if (found === -1) { buf += src.slice(i, j); i = j; continue; }
      let content = src.slice(j, found);
      content = content.replace(/\n/g, ' ');
      if (content.length >= 2 && content.charCodeAt(0) === 32
        && content.charCodeAt(content.length - 1) === 32 && /\S/.test(content)) {
        content = content.slice(1, -1);
      }
      flush(); nodes.push({ t: 'code', s: content }); i = found + run; continue;
    }
    if (c === 42 || c === 95 || c === 126) {
      let j = i;
      while (j < n && src.charCodeAt(j) === c) j++;
      const len = j - i;
      const before = i === 0 ? 10 : src.charCodeAt(i - 1);
      const after = j >= n ? 10 : src.charCodeAt(j);
      const beforeWS = isUnicodeWS(before), afterWS = isUnicodeWS(after);
      const beforePunct = isPunctU(before), afterPunct = isPunctU(after);
      const leftFlanking = !afterWS && (!afterPunct || beforeWS || beforePunct);
      const rightFlanking = !beforeWS && (!beforePunct || afterWS || afterPunct);
      let canOpen = false, canClose = false;
      if (c === 42) { canOpen = leftFlanking; canClose = rightFlanking; }
      else if (c === 95) {
        canOpen = leftFlanking && (!rightFlanking || beforePunct);
        canClose = rightFlanking && (!leftFlanking || afterPunct);
      } else { canOpen = leftFlanking; canClose = rightFlanking; }
      flush();
      nodes.push({ t: 'delim', ch: c, len, canOpen, canClose, orig: src.slice(i, j) });
      i = j; continue;
    }
    if (c === 60) {
      const a = tryAutolink(src, i);
      if (a) { flush(); nodes.push({ t: 'link', href: a.href, text: a.text, auto: true }); i = a.end; continue; }
      const tag = scanTagAt(src, i);
      if (tag) { flush(); nodes.push({ t: 'html', s: tag.text }); i = tag.end; continue; }
      buf += '&lt;'; i++; continue;
    }
    if (c === 38) { buf += '&'; i++; continue; }
    if (c === 91) {
      // An image marker is a bare "!" immediately before "[". A "!" that
      // is itself backslash-escaped (an odd run of backslashes before it)
      // is literal text, not an image marker.
      let img = false;
      if (i > 0 && src.charCodeAt(i - 1) === 33) {
        let bs = 0;
        let q = i - 2;
        while (q >= 0 && src.charCodeAt(q) === 92) { bs++; q--; }
        img = bs % 2 === 0;
      }
      const parsed = parseLinkAt(src, i, refs, img);
      if (parsed) {
        flush();
        if (img) {
          const last = nodes[nodes.length - 1];
          if (last && last.t === 'text') {
            last.s = last.s.slice(0, -1);
            if (!last.s) nodes.pop();
          }
          nodes.push({ t: 'image', src: parsed.href, title: parsed.title, alt: plainText(parsed.children) });
        } else {
          nodes.push({ t: 'link', href: parsed.href, title: parsed.title, children: parsed.children });
        }
        i = parsed.end; continue;
      }
      buf += '['; i++; continue;
    }
    if (c === 93) { buf += ']'; i++; continue; }
    if (c === 33) { buf += '!'; i++; continue; }
    if (c === 10) {
      let s = i - 1, sp = 0;
      while (s >= 0 && src.charCodeAt(s) === 32) { sp++; s--; }
      if (sp >= 2) {
        while (buf.endsWith(' ')) buf = buf.slice(0, -1);
        flush(); nodes.push({ t: 'br' }); i++;
        while (i < n && (src.charCodeAt(i) === 32 || src.charCodeAt(i) === 9)) i++;
        continue;
      }
      buf += '\n'; i++; continue;
    }
    if (c === 119 && src.slice(i, i + 4) === 'www.') {
      const w = tryWww(src, i);
      if (w) { flush(); nodes.push({ t: 'link', href: w.href, text: w.text, auto: true }); i = w.end; continue; }
    }
    if (isAlpha(c)) {
      const u = trySchemeUrl(src, i);
      if (u) { flush(); nodes.push({ t: 'link', href: u.href, text: u.text, auto: true }); i = u.end; continue; }
    }
    if (c === 64) {
      const e = tryEmail(src, i);
      if (e) {
        const localLen = i - e.start;
        if (localLen > 0 && buf.length >= localLen) buf = buf.slice(0, buf.length - localLen);
        else if (localLen > 0) {
          let need = localLen - buf.length;
          buf = '';
          while (need > 0 && nodes.length) {
            const last = nodes[nodes.length - 1];
            if (last.t === 'text') {
              const take = Math.min(need, last.s.length);
              last.s = last.s.slice(0, last.s.length - take);
              need -= take;
              if (!last.s) nodes.pop();
            } else if (last.t === 'delim') {
              // A "_" (or other delimiter) inside an email local part is
              // consumed as text, not emphasis.
              const take = Math.min(need, last.orig.length);
              last.orig = last.orig.slice(0, last.orig.length - take);
              last.len = last.orig.length;
              need -= take;
              if (!last.orig) nodes.pop();
            } else break;
          }
        }
        flush();
        const isMailto = e.text.startsWith('mailto:');
        const href = isMailto ? e.text : 'mailto:' + e.text;
        nodes.push({ t: 'link', href, text: e.text, auto: true });
        i = e.end; continue;
      }
      buf += '@'; i++; continue;
    }
    buf += src[i]; i++;
  }
  flush();
  processEmphasis(nodes);
  return nodes;
}

// Skip a nested image "![label](dest)" / "![label][ref]" / "![label]"
// starting at src[j] === '!' (src[j+1] === '['). Returns the index just
// past the image, or -1 when it is not a complete image.
function skipImageAt(src, j) {
  const close = findLabelClose(src, j + 2);
  if (close === -1) return -1;
  const k = close + 1;
  if (k < src.length && src.charCodeAt(k) === 40) {
    const inl = parseInlineDestAt(src, k);
    if (inl) return inl.end;
    return -1;
  }
  if (k < src.length && src.charCodeAt(k) === 91) {
    const close2 = findLabelClose(src, k + 1);
    if (close2 === -1) return -1;
    return close2 + 1;
  }
  return k;
}

function parseLinkAt(src, i, refs, isImage) {
  let j = i + 1, close = -1;
  // The label can contain balanced brackets: "[" increments the depth,
  // "]" decrements it; the label closes when depth returns to 0.
  let depth = 1;
  while (j < src.length) {
    const c = src.charCodeAt(j);
    if (c === 92 && j + 1 < src.length) { j += 2; continue; }
    // A "<" that starts an unclosed/invalid HTML tag invalidates the
    // whole link (the label cannot contain an incomplete tag). A valid
    // tag is skipped as a whole so a "]" inside it does not close the
    // label. An autolink (<scheme:...> or <email>) is NOT a tag and is
    // allowed in a label.
    if (c === 60 && j + 1 < src.length) {
      const nc = src.charCodeAt(j + 1);
      if ((nc >= 65 && nc <= 90) || (nc >= 97 && nc <= 122) || nc === 33 || nc === 63 || nc === 47) {
        // Skip an autolink: "<" + scheme (letter, then alnum/+/-/.,
        // 2-32 chars) + ":" or an email-ish "<...@...>".
        let ai = j + 1;
        if (isAlpha(src.charCodeAt(ai))) {
          let k2 = ai + 1;
          while (k2 < src.length && (isAlnum(src.charCodeAt(k2)) || src.charCodeAt(k2) === 43 || src.charCodeAt(k2) === 45 || src.charCodeAt(k2) === 46)) k2++;
          const isScheme = k2 - ai >= 2 && k2 - ai <= 32 && k2 < src.length && src.charCodeAt(k2) === 58;
          const gt = src.indexOf('>', j + 1);
          const isEmail = gt !== -1 && src.slice(j + 1, gt).includes('@');
          if (isScheme || isEmail) { j = gt + 1; continue; }
        }
        const tg = scanTagAt(src, j);
        if (!tg) return null;
        j = tg.end;
        continue;
      }
    }
    if (c === 96) {
      let k = j;
      while (k < src.length && src.charCodeAt(k) === 96) k++;
      const run = k - j;
      let m = k;
      let found = -1;
      while (m < src.length) {
        if (src.charCodeAt(m) === 96) {
          let q = m;
          while (q < src.length && src.charCodeAt(q) === 96) q++;
          if (q - m === run) { found = q; break; }
          m = q;
        } else m++;
      }
      if (found !== -1) { j = found; continue; }
      j = k;
      continue;
    }
    // A nested image "![label](dest)" (or "![label][ref]" / "![label]")
    // is skipped as a whole: its "]" does not close the outer label.
    // This is what makes the badge pattern "[![alt](img)](url)" work.
    if (c === 33 && j + 1 < src.length && src.charCodeAt(j + 1) === 91) {
      const skipped = skipImageAt(src, j);
      if (skipped !== -1) { j = skipped; continue; }
    }
    if (c === 91) depth++;
    else if (c === 93) { depth--; if (depth === 0) { close = j; break; } }
    j++;
  }
  if (close === -1) return null;
  const labelSrc = src.slice(i + 1, close);
  let k = close + 1;
  let dest = null, title = null;
  if (k < src.length && src.charCodeAt(k) === 40) {
    const inl = parseInlineDestAt(src, k);
    if (inl) {
      dest = inl.dest; title = inl.title;
      return finishLink(labelSrc, dest, title, inl.end, refs, isImage);
    }
    // Inline "(...)" failed: fall through to the reference forms.
  }
  if (k < src.length && src.charCodeAt(k) === 91) {
    let m = k + 1, close2 = -1;
    while (m < src.length) {
      const c = src.charCodeAt(m);
      if (c === 92 && m + 1 < src.length) { m += 2; continue; }
      if (c === 96) {
        let q2 = m;
        while (q2 < src.length && src.charCodeAt(q2) === 96) q2++;
        const run2 = q2 - m;
        let p2 = q2;
        let found2 = -1;
        while (p2 < src.length) {
          if (src.charCodeAt(p2) === 96) {
            let r2 = p2;
            while (r2 < src.length && src.charCodeAt(r2) === 96) r2++;
            if (r2 - p2 === run2) { found2 = r2; break; }
            p2 = r2;
          } else p2++;
        }
        if (found2 !== -1) { m = found2; continue; }
        m = q2;
        continue;
      }
      if (c === 93) { close2 = m; break; }
      m++;
    }
    if (close2 === -1) return null;
    const refLabel = src.slice(k + 1, close2);
    const key = lowerStr((refLabel === '' ? labelSrc : refLabel).replace(/[ \t\n]+/g, ' ').trim());
    const def = refs.get(key);
    if (!def) return null;
    return finishLink(labelSrc, def.dest, def.title, close2 + 1, refs, isImage);
  }
  const key = lowerStr(labelSrc.replace(/[ \t\n]+/g, ' ').trim());
  const def = refs.get(key);
  if (!def) return null;
  return finishLink(labelSrc, def.dest, def.title, close + 1, refs, isImage);
}

// Parse an inline "(dest title)" starting at src[k] === '('. Returns
// {dest, title, end} or null. An escaped "\>" inside an angle-bracket
// destination does NOT close it.
function parseInlineDestAt(src, k) {
  let p = k + 1;
  while (p < src.length && (src.charCodeAt(p) === 32 || src.charCodeAt(p) === 9 || src.charCodeAt(p) === 10)) p++;
  if (p >= src.length) return null;
  let dest;
  if (src.charCodeAt(p) === 60) {
    let ce = -1;
    let e = p + 1;
    while (e < src.length) {
      const c = src.charCodeAt(e);
      if (c === 92 && e + 1 < src.length) { e += 2; continue; }
      if (c === 62) { ce = e; break; }
      if (c === 10) return null;
      e++;
    }
    if (ce === -1) return null;
    const rawDest = src.slice(p + 1, ce);
    for (let q = 0; q < rawDest.length; q++) {
      const cc = rawDest.charCodeAt(q);
      if (cc === 10 || cc < 32) return null;
    }
    dest = cleanDest(rawDest);
    p = ce + 1;
  } else {
    let d = p, paren = 0;
    while (d < src.length) {
      const c = src.charCodeAt(d);
      if (c === 32 || c === 9 || c === 10) break;
      if (c === 40) paren++;
      if (c === 41) { if (paren === 0) break; paren--; }
      if (c === 92 && d + 1 < src.length && isPunct(src.charCodeAt(d + 1))) { d += 2; continue; }
      d++;
    }
    const rawDest = src.slice(p, d);
    for (let q = 0; q < rawDest.length; q++) {
      const cc = rawDest.charCodeAt(q);
      if (cc === 10 || cc < 32) return null;
    }
    dest = cleanDest(rawDest);
    p = d;
  }
  let t = p;
  while (t < src.length && (src.charCodeAt(t) === 32 || src.charCodeAt(t) === 9 || src.charCodeAt(t) === 10)) t++;
  let title = null;
  if (t < src.length && src.charCodeAt(t) !== 41) {
    const q0 = src.charCodeAt(t);
    if (q0 !== 34 && q0 !== 39 && q0 !== 40) return null;
    const closeQ = q0 === 40 ? 41 : q0;
    let e2 = t + 1;
    while (e2 < src.length) {
      const c = src.charCodeAt(e2);
      if (c === 92 && e2 + 1 < src.length) { e2 += 2; continue; }
      if (c === closeQ) break;
      if (c === 10) return null;
      e2++;
    }
    if (e2 >= src.length || src.charCodeAt(e2) !== closeQ) return null;
    title = cleanTitle(src.slice(t + 1, e2));
    t = e2 + 1;
    while (t < src.length && (src.charCodeAt(t) === 32 || src.charCodeAt(t) === 9 || src.charCodeAt(t) === 10)) t++;
    if (t >= src.length || src.charCodeAt(t) !== 41) return null;
  }
  if (t >= src.length || src.charCodeAt(t) !== 41) return null;
  return { dest, title, end: t + 1 };
}

function finishLink(labelSrc, dest, title, end, refs, isImage) {
  const children = parseInline(labelSrc, refs);
  // An image label may contain links (they are stripped to plain text
  // in the alt); a link label may not.
  if (!isImage && containsLink(children)) return null;
  return { end, href: dest, title: title === '' ? null : title, label: labelSrc, children };
}
function containsLink(nodes) {
  for (const nd of nodes) {
    // Only a markdown-style link blocks an outer link; an autolink
    // (<...> or www./email) inside a label is allowed.
    if (nd.t === 'link' && !nd.auto) return true;
    if (nd.children && containsLink(nd.children)) return true;
  }
  return false;
}
// Render inline nodes to plain text (markup stripped) for image alt text.
function plainText(nodes) {
  let out = '';
  const walk = (list) => {
    for (const nd of list) {
      if (nd.t === 'text') out += nd.s.replace(/\uE000/g, '&');
      else if (nd.t === 'code') out += nd.s;
      else if (nd.t === 'delim') out += nd.orig || '';
      else if (nd.t === 'br' || nd.t === 'softbr') out += '\n';
      else if (nd.t === 'html') out += nd.s;
      else if (nd.t === 'image') out += nd.alt || '';
      else if (nd.children) walk(nd.children);
    }
  };
  walk(nodes);
  return out;
}

function processEmphasis(nodes) {
  for (;;) {
    let matched = false;
    for (let ci = 0; ci < nodes.length; ci++) {
      const closer = nodes[ci];
      if (closer.t !== 'delim' || !closer.canClose) continue;
      const ch = closer.ch;
      let oi = -1, use = 0;
      for (let s = ci - 1; s >= 0; s--) {
        const cand = nodes[s];
        if (cand.t !== 'delim' || cand.ch !== ch || !cand.canOpen) continue;
        if (ch === 126) {
          if (cand.len !== closer.len || closer.len > 2) continue;
          use = closer.len;
        } else {
          // Rule 9 (odd match): applies to * and _ (not ~). If either
          // delimiter can both open and close, and the sum of the two
          // run lengths is a multiple of 3 (unless both are multiples
          // of 3), they cannot match.
          const bothWays = (cand.canOpen && cand.canClose) || (closer.canOpen && closer.canClose);
          if (bothWays && (cand.len + closer.len) % 3 === 0
            && !(cand.len % 3 === 0 && closer.len % 3 === 0)) continue;
          use = (cand.len >= 2 && closer.len >= 2) ? 2 : 1;
        }
        oi = s;
        break;
      }
      if (oi === -1) continue;
      const opener = nodes[oi];
      const inner = nodes.slice(oi + 1, ci);
      const tag = ch === 126 ? 'del' : (use === 2 ? 'strong' : 'em');
      const newNode = { t: tag, children: inner };
      const opLeft = opener.len - use;
      const clLeft = closer.len - use;
      const replacement = [];
      if (opLeft > 0) replacement.push({ t: 'delim', ch, len: opLeft, canOpen: opener.canOpen, canClose: opener.canClose, orig: opener.orig.slice(0, opLeft) });
      replacement.push(newNode);
      if (clLeft > 0) replacement.push({ t: 'delim', ch, len: clLeft, canOpen: closer.canOpen, canClose: closer.canClose, orig: closer.orig.slice(0, clLeft) });
      nodes.splice(oi, ci - oi + 1, ...replacement);
      matched = true;
      break;
    }
    if (!matched) break;
  }
  for (let k = 0; k < nodes.length; k++) {
    if (nodes[k].t === 'delim') nodes[k] = { t: 'text', s: nodes[k].orig };
  }
  for (const nd of nodes) {
    if (nd.children) processEmphasis(nd.children);
  }
}

function renderInlineInto(nodes, out) {
  for (const nd of nodes) {
    if (nd.t === 'text') out.push(escapeText(nd.s));
    else if (nd.t === 'code') { out.push('<code>', escapeCode(nd.s), '</code>'); }
    else if (nd.t === 'br') out.push('<br>');
    else if (nd.t === 'html') out.push(nd.s);
    else if (nd.t === 'em') { out.push('<em>'); renderInlineInto(nd.children, out); out.push('</em>'); }
    else if (nd.t === 'strong') { out.push('<strong>'); renderInlineInto(nd.children, out); out.push('</strong>'); }
    else if (nd.t === 'del') { out.push('<del>'); renderInlineInto(nd.children, out); out.push('</del>'); }
    else if (nd.t === 'link') {
      if (nd.auto) { out.push('<a href="', escapeAttr(encodeHref(nd.href)), '">', escapeText(nd.text), '</a>'); }
      else {
        out.push('<a href="', escapeAttr(encodeHref(nd.href)), '"');
        if (nd.title != null) out.push(' title="', escapeAttr(nd.title), '"');
        out.push('>');
        renderInlineInto(nd.children, out);
        out.push('</a>');
      }
    } else if (nd.t === 'image') {
      out.push('<img src="', escapeAttr(encodeHref(nd.src)), '" alt="', escapeAttr(nd.alt || ''), '"');
      if (nd.title != null) out.push(' title="', escapeAttr(nd.title), '"');
      out.push('>');
    }
  }
}
function renderInline(nodes) {
  const out = [];
  renderInlineInto(nodes, out);
  return out.join('');
}

// ------------------------------------------------------------- block parsing
const BLOCK_TAGS = new Set(['address','article','aside','base','basefont','blockquote','body','caption','center','col','colgroup','dd','details','dialog','dir','div','dl','dt','fieldset','figcaption','figure','footer','form','frame','frameset','h1','h2','h3','h4','h5','h6','head','header','hr','html','iframe','legend','li','link','main','menu','menuitem','nav','noframes','ol','optgroup','option','p','param','section','summary','table','tbody','td','tfoot','th','thead','title','tr','track','ul']);
const PRE_TAGS = new Set(['pre', 'script', 'style', 'textarea']);

// HTML block type (1-7) for a line, or 0. Types 1 and 6 are detected from
// the tag NAME only, so a tag whose attributes span lines still counts.
function htmlBlockType(line) {
  // "<!-->" and "<!--->" are NOT valid comments.
  if (line.startsWith('<!--')) {
    if (line.startsWith('<!-->') || line.startsWith('<!--->')) return 0;
    return 2;
  }
  if (line.startsWith('<?')) return 3;
  if (/^<![A-Za-z]/.test(line)) return 4;
  if (line.startsWith('<![CDATA[')) return 5;
  if (line.charCodeAt(0) !== 60) return 0;
  const closing = line.charCodeAt(1) === 47;
  let i = closing ? 2 : 1;
  if (i >= line.length || !isAlpha(line.charCodeAt(i))) return 0;
  let j = i;
  while (j < line.length && (isAlnum(line.charCodeAt(j)) || line.charCodeAt(j) === 45)) j++;
  const name = lowerStr(line.slice(i, j));
  const after = j < line.length ? line.charCodeAt(j) : -1;
  const nameEnd = after === -1 || after === 32 || after === 9 || after === 62 || after === 47 || after === 10;
  if (!closing && PRE_TAGS.has(name) && nameEnd) return 1;
  if (BLOCK_TAGS.has(name) && nameEnd) return 6;
  // Type 7: a complete open/close tag alone on the line.
  const tag = scanTagAt(line, 0);
  if (tag && line.slice(tag.end).trim() === '') return 7;
  return 0;
}
// True when an HTML block's first line already completes it (so the
// block must close at once and not swallow later lines).
function htmlBlockClosedOnFirstLine(h) {
  const t = h.htmlType;
  const line = h.lines[0];
  // Type 7 ends at a blank line, not on its first line.
  if (t === 7) return false;
  if (t === 1) {
    const nm = line.match(/<(pre|script|style|textarea)/i);
    if (nm && line.toLowerCase().includes('</' + nm[1].toLowerCase())) return true;
    return false;
  }
  if (t === 2) return line.includes('-->');
  if (t === 3) return line.includes('?>');
  if (t === 4) return line.includes('>');
  if (t === 5) return line.includes(']]>');
  return false;
}
function isThematicBreak(s) {
  if (s.length < 3) return false;
  const c = s.charCodeAt(0);
  if (c !== 45 && c !== 42 && c !== 95) return false;
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const d = s.charCodeAt(i);
    if (d === c) n++;
    else if (d === 32 || d === 9) continue;
    else return false;
  }
  return n >= 3;
}

let globalRefs = new Map();

export function parse(markdown) {
  const src = markdown.replace(/\r\n?/g, '\n');
  const lines = src.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();

  const refs = new Map();
  globalRefs = refs;
  const root = { t: 'root', children: [] };
  let open = [root];

  const cur = { line: '', off: 0, col: 0, partial: 0, lineNo: 0 };
  const curSave = () => ({ off: cur.off, col: cur.col, partial: cur.partial });
  const curRestore = s => { cur.off = s.off; cur.col = s.col; cur.partial = s.partial; };
  const curChar = () => cur.off < cur.line.length ? cur.line.charCodeAt(cur.off) : -1;
  const curAdvance = n => {
    while (n > 0 && cur.off < cur.line.length) {
      const c = cur.line.charCodeAt(cur.off);
      if (c === 9) {
        const w = 4 - (cur.col % 4);
        if (w > n) { cur.partial = w - n; cur.col += n; return; }
        cur.col += w; cur.off++; cur.partial = 0; n -= w;
      } else if (c === 32) { cur.col++; cur.off++; n--; }
      else break;
    }
  };
  const curAdvanceTo = targetCol => {
    while (cur.col < targetCol && cur.off < cur.line.length) {
      const c = cur.line.charCodeAt(cur.off);
      if (c === 9) {
        const w = 4 - (cur.col % 4);
        if (cur.col + w > targetCol) { cur.partial = cur.col + w - targetCol; cur.col = targetCol; return; }
        cur.col += w; cur.off++; cur.partial = 0;
      } else { cur.col++; cur.off++; }
    }
  };
  const curSkipSpaces = max => {
    let n = 0;
    while (n < max && cur.off < cur.line.length) {
      const ch = cur.line.charCodeAt(cur.off);
      if (ch === 32) { cur.col++; cur.off++; n++; }
      else if (ch === 9) {
        const w = 4 - (cur.col % 4);
        if (n + w > max) { cur.partial = w - (max - n); cur.col += max - n; return; }
        cur.col += w; cur.off++; cur.partial = 0; n += w;
      } else break;
    }
  };
  // Advance up to targetCol columns for a fenced-code content line,
  // consuming only whitespace and blockquote ">" markers (plus one space
  // after each ">"). Stops at any other character, so a content line
  // with less indentation than the fence is not eaten.
  const advanceFenceIndent = targetCol => {
    let sawQuote = false;
    // ">" markers are only consumed when the fence is inside a
    // blockquote; for a top-level fence a leading ">" is content.
    const inQuote = open.some((b) => b.t === 'quote');
    while (cur.col < targetCol && cur.off < cur.line.length) {
      const ch = cur.line.charCodeAt(cur.off);
      if (ch === 32) { cur.off++; cur.col++; cur.partial = 0; }
      else if (ch === 9) {
        const w = 4 - (cur.col % 4);
        if (cur.col + w <= targetCol) { cur.off++; cur.col += w; cur.partial = 0; }
        // A tab straddled by the fence indent is dropped entirely (its
        // remainder is NOT kept as spaces). This differs from a tab
        // partially consumed as the ">" optional space, whose remainder
        // is kept.
        else { cur.off++; cur.col = targetCol; cur.partial = 0; }
      } else if (ch === 62 && inQuote) {
        sawQuote = true;
        cur.off++; cur.col++; cur.partial = 0;
        // The optional space after ">" is consumed as a unit (curAdvance
        // handles a tab there by partially consuming it).
        if (cur.col < targetCol) curAdvance(1);
        else if (cur.off < cur.line.length && cur.line.charCodeAt(cur.off) === 9) {
          // Even at the target column, a tab after ">" is the optional
          // space: consume 1 column of it, leaving the rest as content.
          const w2 = 4 - (cur.col % 4);
          cur.partial = w2 - 1; cur.col += 1;
        } else if (cur.off < cur.line.length && cur.line.charCodeAt(cur.off) === 32) {
          cur.off++; cur.col++;
        }
      } else break;
    }
    return sawQuote;
  };
  const curExpandedText = () => {
    let s = cur.line.slice(cur.off);
    if (cur.partial > 0) s = ' '.repeat(cur.partial) + s.slice(1);
    return s;
  };
  const measureLeadingWhitespace = () => {
    let col = cur.col, off = cur.off, n = 0;
    while (off < cur.line.length) {
      const c = cur.line.charCodeAt(off);
      if (c === 32) { col++; off++; n++; }
      else if (c === 9) { const w = 4 - (col % 4); col += w; off++; n += w; }
      else break;
    }
    return n;
  };

  function listContentIndent(markerCol, markerLen) {
    let p = cur.off + markerLen, col = markerCol + markerLen;
    let spaces = 0;
    const line = cur.line;
    while (p < line.length) {
      const c = line.charCodeAt(p);
      if (c === 32) { spaces++; col++; p++; }
      else if (c === 9) {
        const w = 4 - (col % 4);
        spaces += w; col += w; p++;
      } else break;
    }
    if (spaces >= 5 || p >= line.length) return markerCol + markerLen + 1;
    return col;
  }
  function tryListMarker() {
    const save = curSave();
    curSkipSpaces(3);
    const markerCol = cur.col;
    const c = curChar();
    let li = null;
    if (c === 45 || c === 43 || c === 42) {
      const markerLen = 1;
      const after = cur.off + 1 < cur.line.length ? cur.line.charCodeAt(cur.off + 1) : -1;
      if (after === 32 || after === 9 || cur.off + 1 >= cur.line.length) {
        li = { ordered: false, delim: String.fromCharCode(c), start: 1, markerLen, contentIndent: listContentIndent(markerCol, markerLen) };
      }
    } else if (isDigit(c)) {
      let j = cur.off;
      while (j < cur.line.length && isDigit(cur.line.charCodeAt(j))) j++;
      if (j - cur.off <= 9) {
        const d = cur.line.charCodeAt(j);
        if (d === 46 || d === 41) {
          const after = j + 1 < cur.line.length ? cur.line.charCodeAt(j + 1) : -1;
          if (after === 32 || after === 9 || j + 1 >= cur.line.length) {
            const markerLen = j - cur.off + 1;
            li = { ordered: true, delim: String.fromCharCode(d), start: parseInt(cur.line.slice(cur.off, j), 10), markerLen, contentIndent: listContentIndent(markerCol, markerLen) };
          }
        }
      }
    }
    if (li) {
      // Whether the marker is followed by any non-whitespace content.
      // An empty item (marker alone) cannot interrupt a paragraph.
      let p = cur.off + li.markerLen;
      while (p < cur.line.length && (cur.line.charCodeAt(p) === 32 || cur.line.charCodeAt(p) === 9)) p++;
      li.hasContent = p < cur.line.length;
    }
    curRestore(save);
    return li;
  }
  function isTaskMarker(s) {
    if (s.length >= 3 && s.charCodeAt(0) === 91 && s.charCodeAt(2) === 93) {
      const m = s.charCodeAt(1);
      if (m === 32) return { checked: false, len: 3 };
      if (m === 120 || m === 88) return { checked: true, len: 3 };
    }
    return null;
  }

  function closeBlock() {
    const b = open.pop();
    if (b.t === 'para') finalizePara(b);
    return b;
  }
  function closeDownTo(depth) {
    while (open.length - 1 > depth) closeBlock();
  }
  function finalizePara(b) {
    let idx = 0;
    while (idx < b.lines.length) {
      // Fast pre-check: a definition's first line must start (after at
      // most 3 spaces) with "[". Skip the expensive join/scan otherwise.
      const first = b.lines[idx];
      let sp = 0;
      while (sp < first.length && sp < 4 && (first.charCodeAt(sp) === 32 || first.charCodeAt(sp) === 9)) sp++;
      if (sp > 3 || sp >= first.length || first.charCodeAt(sp) !== 91) break;
      const d = tryParseDef(b.lines.slice(idx));
      if (!d) break;
      if (!refs.has(d.label)) refs.set(d.label, { dest: d.dest, title: d.title });
      idx += d.consumed;
    }
    b.lines = b.lines.slice(idx);
    b.content = b.lines.join('\n');
  }
  function makePara() {
    return { t: 'para', lines: [], content: '' };
  }
  function addChild(b) {
    const parent = open[open.length - 1];
    // A blank line before this new block, with an earlier block already
    // in the same item, makes the item's list loose.
    if (parent.t === 'item' && parent.blankPending && parent.children.length > 0) {
      if (parent._list) parent._list.tight = false;
    }
    // The blank resolves at this item's level: clear the pending flag on
    // all ancestor items so an outer list is not loosened by a blank
    // that was consumed deeper.
    if (parent.t === 'item') {
      parent.blankPending = false;
      for (let k = open.length - 2; k >= 1; k--) {
        if (open[k].t === 'item') open[k].blankPending = false;
      }
    }
    parent.children.push(b);
    open.push(b);
  }

  function startBlocks(skipSpaces = true) {
    const paraStart = curSave();
    const top0 = open[open.length - 1];
    if (top0.t !== 'para' && measureLeadingWhitespace() >= 4) {
      const base = cur.col;
      curAdvance(4);
      addChild({ t: 'code', fenced: false, baseIndent: base, lines: [curExpandedText()] });
      return true;
    }
    if (skipSpaces) curSkipSpaces(3);
    const c = curChar();
    if (c === -1) return false;
    if (top0.t === 'list') {
      let isItem = false;
      if (c === 45 || c === 42 || c === 95) {
        if (!isThematicBreak(cur.line.slice(cur.off)) && tryListMarker()) isItem = true;
      } else if (isDigit(c) || c === 43) {
        if (tryListMarker()) isItem = true;
      }
      if (!isItem) closeBlock();
    }
    if (c === 35) {
      let j = cur.off;
      while (j < cur.line.length && cur.line.charCodeAt(j) === 35) j++;
      if (j - cur.off <= 6 && (j >= cur.line.length || cur.line.charCodeAt(j) === 32 || cur.line.charCodeAt(j) === 9)) {
        let text = cur.line.slice(j).replace(/[ \t]+$/, '');
        if (text.length) {
          let e = text.length;
          while (e > 0 && text.charCodeAt(e - 1) === 35) e--;
          if (e < text.length && e > 0 && (text.charCodeAt(e - 1) === 32 || text.charCodeAt(e - 1) === 9)) {
            text = text.slice(0, e).replace(/[ \t]+$/, '');
          }
        }
        const h = { t: 'heading', level: j - cur.off, text: text.trim() };
        addChild(h); return true;
      }
    }
    if (c === 96 || c === 126) {
      let j = cur.off;
      while (j < cur.line.length && cur.line.charCodeAt(j) === c) j++;
      if (j - cur.off >= 3) {
        if (c === 96 && cur.line.slice(j).includes('`')) { /* not a fence */ }
        else {
          const info = cur.line.slice(j).trim();
          const fence = { t: 'code', fenced: true, fenceChar: c, fenceLen: j - cur.off, fenceIndent: cur.col, info, lines: [] };
          addChild(fence); return true;
        }
      }
    }
    if (c === 60) {
      const t = htmlBlockType(cur.line.slice(cur.off));
      if (t >= 1 && t <= 7) {
        // Preserve the line's leading spaces (up to 3) in the block.
        curRestore(paraStart);
        const firstLine = curExpandedText();
        const h = { t: 'html', htmlType: t, lines: [firstLine], lastLineTerminated: true, endedAtBlank: false };
        addChild(h);
        // If the first line already completes the block, close it at
        // once so later lines are not swallowed as its content. A block
        // that closes on its first line and is followed by a blank line
        // ended at a blank line (no trailing newline).
        if (htmlBlockClosedOnFirstLine(h)) {
          open.pop();
          if (cur.lineNo + 1 < lines.length && isBlankLine(lines[cur.lineNo + 1])) h.endedAtBlank = true;
        }
        return true;
      }
    }
    if (c === 45 || c === 42 || c === 95) {
      if (isThematicBreak(cur.line.slice(cur.off))) { addChild({ t: 'hr' }); return true; }
    }
    const li = tryListMarker();
    if (li) {
      startList(li);
      return startBlocks(false);
    }
    const top = open[open.length - 1];
    if (c === 62) {
      const q = { t: 'quote', children: [] };
      addChild(q);
      cur.off++; cur.col++;
      curAdvance(1);
      return startBlocks();
    }
    if (top.t !== 'para') {
      curRestore(paraStart);
      // A line with only whitespace left (e.g. a list marker followed
      // by spaces) starts no paragraph; the trailing spaces are not
      // content and must not become a hard break.
      const restText = curExpandedText();
      if (restText.trim() === '') return true;
      const p = makePara();
      p.lines.push(restText);
      addChild(p);
      return true;
    }
    return false;
  }
  function startList(li) {
    const top = open[open.length - 1];
    if (top.t === 'list') {
      const same = top.ordered === li.ordered && top.delim === li.delim;
      if (!same) closeBlock();
    }
    let list = open[open.length - 1];
    if (list.t !== 'list') {
      list = { t: 'list', ordered: li.ordered, delim: li.delim, start: li.start, children: [], tight: true };
      addChild(list);
    }
    // A blank line after the previous item makes the list loose.
    if (list.children.length > 0) {
      const prev = list.children[list.children.length - 1];
      if (prev.blankPending) list.tight = false;
    }
    const item = { t: 'item', contentIndent: li.contentIndent, children: [], blankPending: false, task: null, _list: list };
    list.children.push(item);
    open.push(item);
    curAdvanceTo(li.contentIndent);
    const rest = curExpandedText();
    const tm = isTaskMarker(rest);
    if (tm) {
      item.task = tm.checked;
      curAdvanceTo(cur.col + 3);
    }
  }

  function trySetext() {
    const save = curSave();
    curSkipSpaces(3);
    const c = curChar();
    if (c !== 61 && c !== 45) { curRestore(save); return false; }
    let j = cur.off;
    while (j < cur.line.length && cur.line.charCodeAt(j) === c) j++;
    let k = j;
    while (k < cur.line.length && (cur.line.charCodeAt(k) === 32 || cur.line.charCodeAt(k) === 9)) k++;
    if (k < cur.line.length) { curRestore(save); return false; }
    const top = open[open.length - 1];
    if (top.t !== 'para') { curRestore(save); return false; }
    const b = top;
    let idx = 0;
    while (idx < b.lines.length) {
      const d = tryParseDef(b.lines.slice(idx));
      if (!d) break;
      if (!refs.has(d.label)) refs.set(d.label, { dest: d.dest, title: d.title });
      idx += d.consumed;
    }
    const content = b.lines.slice(idx).join('\n').trim();
    if (!content) { curRestore(save); return false; }
    b.lines = b.lines.slice(idx);
    closeBlock();
    const parent = open[open.length - 1];
    if (parent.children.length && parent.children[parent.children.length - 1] === b) parent.children.pop();
    const h = { t: 'heading', level: c === 61 ? 1 : 2, text: content };
    addChild(h);
    closeBlock();
    return true;
  }
  function tryTableDelimiter() {
    const save = curSave();
    curSkipSpaces(3);
    const line = cur.line.slice(cur.off);
    if (!line.includes('|')) { curRestore(save); return false; }
    const top = open[open.length - 1];
    if (top.t !== 'para' || top.lines.length === 0) { curRestore(save); return false; }
    let idx = 0;
    while (idx < top.lines.length) {
      const d = tryParseDef(top.lines.slice(idx));
      if (!d) break;
      if (!refs.has(d.label)) refs.set(d.label, { dest: d.dest, title: d.title });
      idx += d.consumed;
    }
    const remaining = top.lines.slice(idx);
    if (remaining.length === 0) { curRestore(save); return false; }
    const headerLine = remaining[remaining.length - 1];
    const headerCells = splitCells(headerLine);
    const delimCells = splitCells(line);
    if (headerCells.length !== delimCells.length || headerCells.length === 0) { curRestore(save); return false; }
    const aligns = [];
    for (const cell of delimCells) {
      const t = cell.trim();
      if (!/^:?-+:?$/.test(t)) { curRestore(save); return false; }
      const left = t.charCodeAt(0) === 58, right = t.charCodeAt(t.length - 1) === 58;
      aligns.push(left && right ? 'center' : left ? 'left' : right ? 'right' : null);
    }
    const beforeLines = remaining.slice(0, -1);
    top.lines = beforeLines;
    top.content = beforeLines.join('\n');
    closeBlock();
    const table = { t: 'table', aligns, header: headerCells, rows: [] };
    addChild(table);
    return true;
  }
  function splitCells(line) {
    let cells = [];
    let cur2 = '', i = 0;
    while (i < line.length) {
      const c = line.charCodeAt(i);
      if (c === 92 && i + 1 < line.length && line.charCodeAt(i + 1) === 124) { cur2 += '|'; i += 2; continue; }
      if (c === 124) { cells.push(cur2); cur2 = ''; i++; continue; }
      cur2 += line[i]; i++;
    }
    cells.push(cur2);
    if (cells.length && cells[0].trim() === '') cells.shift();
    if (cells.length && cells[cells.length - 1].trim() === '') cells.pop();
    return cells.map(x => x.trim());
  }

  // Does the line start a block that interrupts a paragraph? An ordered
  // list only interrupts when it starts with 1.
  function startsNewBlock(interrupt) {
    const save = curSave();
    curSkipSpaces(3);
    const c = curChar();
    let ok = false;
    if (c === 35) {
      let j = cur.off;
      while (j < cur.line.length && cur.line.charCodeAt(j) === 35) j++;
      if (j - cur.off <= 6 && (j >= cur.line.length || cur.line.charCodeAt(j) === 32 || cur.line.charCodeAt(j) === 9)) ok = true;
    } else if (c === 96 || c === 126) {
      let j = cur.off;
      while (j < cur.line.length && cur.line.charCodeAt(j) === c) j++;
      if (j - cur.off >= 3) {
        if (c === 96) {
          const info = cur.line.slice(j);
          if (!info.includes('`')) ok = true;
        } else ok = true;
      }
    } else if (c === 62) ok = true;
    else if (c === 60) {
      const t = htmlBlockType(cur.line.slice(cur.off));
      if (t >= 1 && t <= 6) ok = true;
    } else if (c === 45 || c === 42 || c === 95) {
      if (isThematicBreak(cur.line.slice(cur.off))) ok = true;
      else {
        const li = tryListMarker();
        // An empty list item cannot interrupt a paragraph.
        if (li && (!interrupt || li.hasContent)) ok = true;
      }
    } else if (isDigit(c) || c === 43) {
      const li = tryListMarker();
      if (li) {
        if ((!li.ordered || li.start === 1) && (!interrupt || li.hasContent)) ok = true;
      }
    }
    curRestore(save);
    return ok;
  }

  function processBlankLine() {
    let topIdx = open.length - 1;
    while (topIdx > 0) {
      const b = open[topIdx];
      if (b.t === 'para' || b.t === 'html' || b.t === 'code' || b.t === 'table') {
        // Fenced code and indented code are NOT closed by a blank line.
        // HTML types 1-5 are NOT closed by a blank line; the blank line
        // is part of the block's content.
        if (b.t === 'code') break;
        if (b.t === 'html' && b.htmlType <= 5) {
          b.lines.push('');
          break;
        }
        if (b.t === 'html') b.endedAtBlank = true;
        closeDownTo(topIdx - 1);
        topIdx = open.length - 1;
        break;
      }
      topIdx--;
    }
    // A blank line closes any open blockquote (the next ">" starts a new
    // one). Lists stay open (they become loose via blankPending).
    let qIdx = -1;
    for (let k = 1; k < open.length; k++) {
      if (open[k].t === 'quote') { qIdx = k; break; }
    }
    if (qIdx !== -1) closeDownTo(qIdx - 1);
    // An empty list item (marker with no content) is closed by a blank
    // line: following indented content belongs outside the list. The
    // blank still loosens the list if another item follows, so the
    // item keeps its blankPending flag.
    let topC = open[open.length - 1];
    if (topC.t === 'item' && topC.children.length === 0) {
      topC.blankPending = true;
      closeDownTo(open.length - 2);
      topC = open[open.length - 1];
      // If the list is now empty, close it too.
      if (topC.t === 'list' && topC.children.length === 0) closeDownTo(open.length - 2);
    }
    // A blank line is pending for every still-open list item. When the
    // next block lands, addChild clears the flag on ancestor items (the
    // blank resolves at the deepest level), so only the list owning the
    // lowest common ancestor becomes loose.
    const topB = open[open.length - 1];
    if (!(topB.t === 'code' && topB.fenced)) {
      for (let k = 1; k < open.length; k++) {
        if (open[k].t === 'item') open[k].blankPending = true;
      }
    }
    const tip = open[open.length - 1];
    if (tip.t === 'code') {
      const save = curSave();
      cur.off = 0; cur.col = 0; cur.partial = 0;
      if (tip.fenced) advanceFenceIndent(tip.fenceIndent);
      else curAdvance((tip.baseIndent || 0) + 4);
      tip.lines.push(curExpandedText());
      curRestore(save);
    }
  }
  function processLine(line, lineNo) {
    cur.line = line; cur.off = 0; cur.col = 0; cur.partial = 0; cur.lineNo = lineNo;
    if (isBlankLine(line)) { processBlankLine(); return; }
    const terminated = lineNo < lines.length - 1 || src.endsWith('\n');
    let matched = 0;
    for (let i = 1; i < open.length; i++) {
      const b = open[i];
      if (b.t === 'quote') {
        const save = curSave();
        curSkipSpaces(3);
        if (curChar() === 62) {
          cur.off++; cur.col++;
          curAdvance(1);
          matched = i;
        } else { curRestore(save); break; }
      } else if (b.t === 'list') { matched = i; }
      else if (b.t === 'item') {
        const save = curSave();
        if (cur.col < b.contentIndent) curAdvance(b.contentIndent - cur.col);
        if (cur.col >= b.contentIndent) matched = i;
        else { curRestore(save); break; }
      } else if (b.t === 'code') { break; }
      else if (b.t === 'html') { break; }
      else break;
    }
    // A line that is only container markers (e.g. ">") is a blank line
    // inside those containers: it closes the paragraph but keeps the
    // containers (quote/list) open. A line with even a space left after
    // the marker (">  ") is paragraph content, not blank.
    const restAfterContainers = cur.line.slice(cur.off);
    if (restAfterContainers === '' && matched > 0) {
      const tipC = open[open.length - 1];
      if (tipC.t === 'para' || tipC.t === 'table') closeBlock();
      // A marker-only line inside a blockquote is a blank inside the
      // quote, not a blank separating list items, so it does not loosen
      // the list.
      return;
    }
    // Lazy continuation: if the tip is a paragraph and this line does not
    // start a new block, the line continues the paragraph even though its
    // containers did not match. But a setext underline, a table delimiter
    // row, or a list marker inside a list must NOT be swallowed.
    const tip0 = open[open.length - 1];
    if (tip0.t === 'para' && matched < open.length - 1) {
      // A setext underline is only valid when the line is inside the
      // paragraph's own containers (matched reaches the para's parent).
      // Otherwise "> foo\n---" would wrongly make the "---" a setext
      // heading instead of an <hr> outside the quote.
      if (matched >= open.length - 2 && trySetext()) return;
      if (matched >= open.length - 2 && tryTableDelimiter()) return;
      const inList = open.some(b => b.t === 'list');
      const lm = tryListMarker();
      if (lm && inList) {
        // fall through: close containers, start a new item
      } else if (!startsNewBlock(true)) {
        // A TRUE lazy line (some container did not match) indented by 4+
        // columns loses exactly 4 columns of indent. A normal top-level
        // paragraph continuation keeps its leading spaces.
        const paraParentIdx = open.length - 2;
        if (matched < paraParentIdx) {
          const lead = measureLeadingWhitespace();
          if (lead >= 4) curAdvance(4);
        }
        tip0.lines.push(curExpandedText());
        return;
      }
    }
    const topIdx = open.length - 1;
    const topBlock = open[topIdx];
    const topIsLeaf = topBlock.t === 'para' || topBlock.t === 'heading'
      || topBlock.t === 'code' || topBlock.t === 'html' || topBlock.t === 'hr'
      || topBlock.t === 'table';
    let closeDownToIdx;
    // A paragraph whose containers all matched stays open: it is being
    // continued, so it must NOT be closed and re-pushed -- closing it
    // would finalise it (stripping link reference definitions) before
    // its continuation lines (e.g. a def title on a later line) arrive.
    if (matched === topIdx - 1 && topIsLeaf) { closeDownToIdx = topIdx; }
    else if (matched >= topIdx) { closeDownToIdx = topIdx; }
    else { closeDownToIdx = matched; }
    // An HTML block closed here ends because its containers ended (not
    // by a blank line or its own ender), so it gets no trailing newline.
    for (let q = open.length - 1; q > closeDownToIdx; q--) {
      if (open[q].t === 'html') open[q].endedByContainer = true;
    }
    closeDownTo(closeDownToIdx);
    let top = open[open.length - 1];
    if (top.t === 'para') {
      if (trySetext()) return;
      if (tryTableDelimiter()) return;
      if (startsNewBlock(true)) {
        closeBlock();
        startBlocks();
        return;
      }
      top.lines.push(curExpandedText());
      return;
    }
    if (top.t === 'table') {
      const save = curSave();
      curSkipSpaces(3);
      const c = curChar();
      let endsTable = false;
      if (c === 35 || c === 96 || c === 126 || c === 62 || c === 60) endsTable = true;
      else if (c === 45 || c === 42 || c === 95) {
        if (isThematicBreak(cur.line.slice(cur.off))) endsTable = true;
      } else if (isDigit(c) || c === 43 || c === 45 || c === 42) {
        if (tryListMarker()) endsTable = true;
      }
      if (!endsTable) {
        const save2 = curSave();
        curAdvance(4);
        if (cur.col >= 4) endsTable = true;
        curRestore(save2);
      }
      curRestore(save);
      if (endsTable) {
        closeBlock();
        startBlocks();
        return;
      }
      top.rows.push(splitCells(curExpandedText()));
      return;
    }
    if (top.t === 'code') {
      if (top.fenced) {
        const save = curSave();
        curSkipSpaces(3);
        const c = curChar();
        if (c === top.fenceChar) {
          let j = cur.off;
          while (j < cur.line.length && cur.line.charCodeAt(j) === c) j++;
          if (j - cur.off >= top.fenceLen) {
            const rest = cur.line.slice(j);
            if (c === 126 || rest.trim() === '') { closeBlock(); return; }
          }
        }
        curRestore(save);
        const save2 = curSave();
        cur.off = 0; cur.col = 0; cur.partial = 0;
        const sawQuote = advanceFenceIndent(top.fenceIndent);
        // A tab at the content start is expanded to spaces to the next
        // tab stop only inside a container (list item / blockquote);
        // for a top-level indented fence it is preserved literally.
        const inContainer = open.some((b) => b.t === 'item' || b.t === 'quote' || b.t === 'list');
        if (cur.off < cur.line.length && cur.line.charCodeAt(cur.off) === 9 && cur.partial === 0
          && (sawQuote || inContainer)) {
          cur.partial = 4 - (cur.col % 4);
        }
        top.lines.push(curExpandedText());
        curRestore(save2);
        return;
      }
      const save = curSave();
      cur.off = 0; cur.col = 0; cur.partial = 0;
      const need = (top.baseIndent || 0) + 4;
      curAdvance(need);
      if (cur.col >= need) {
        top.lines.push(curExpandedText());
        return;
      }
      curRestore(save);
      closeBlock();
      startBlocks();
      return;
    }
    if (top.t === 'html') {
      const t = top.htmlType;
      const lineText = curExpandedText();
      top.lines.push(lineText);
      top.lastLineTerminated = terminated;
      let done = false;
      if (t === 1) {
        const nm = top.lines[0].match(/<(pre|script|style|textarea)/i);
        if (nm && lineText.toLowerCase().includes('</' + nm[1].toLowerCase())) done = true;
      } else if (t === 2) { if (lineText.includes('-->')) done = true; }
      else if (t === 3) { if (lineText.includes('?>')) done = true; }
      else if (t === 4) { if (lineText.includes('>')) done = true; }
      else if (t === 5) { if (lineText.includes(']]>')) done = true; }
      if (done) {
        // A block followed by a blank line gets no trailing newline.
        if (cur.lineNo + 1 < lines.length && isBlankLine(lines[cur.lineNo + 1])) top.endedAtBlank = true;
        closeBlock();
      }
      return;
    }
    if (top.t === 'hr' || top.t === 'heading') {
      closeBlock();
      startBlocks();
      return;
    }
    if (top.t === 'list') {
      const li = tryListMarker();
      if (!li) {
        closeBlock();
        startBlocks();
        return;
      }
      startBlocks();
      return;
    }
    startBlocks();
  }

  for (let ln = 0; ln < lines.length; ln++) processLine(lines[ln], ln);
  while (open.length > 1) closeBlock();
  return renderBlocks(root.children);
}

// -------------------------------------------------------------- rendering
function renderBlocks(children) {
  let out = '';
  for (const b of children) out += renderBlock(b);
  return out;
}
function renderBlock(b) {
  switch (b.t) {
    case 'root': return renderBlocks(b.children);
    case 'heading': {
      const inner = renderInline(parseInline(b.text, globalRefs));
      return '<h' + b.level + '>' + inner + '</h' + b.level + '>\n';
    }
    case 'para': {
      if (!b.content) return '';
      const inner = renderInline(parseInline(b.content, globalRefs));
      return '<p>' + inner + '</p>\n';
    }
    case 'code': {
      if (b.fenced) {
        let content = b.lines.join('\n');
        if (content.endsWith('\n\n')) content = content.slice(0, -1);
        else if (content.endsWith('\n') && b.lines.length > 1 && b.lines[b.lines.length - 1] === '') content = content.slice(0, -1);
        if (content) content += '\n';
        const info = b.info || '';
        let lang = '';
        if (info) {
          const first = info.split(/\s+/)[0];
          lang = ' class="language-' + escapeAttr(cleanInfo(first)) + '"';
        }
        return '<pre><code' + lang + '>' + escapeCode(content) + '</code></pre>\n';
      }
      let content = b.lines.join('\n');
      while (content.endsWith('\n')) content = content.slice(0, -1);
      if (content) content += '\n';
      return '<pre><code>' + escapeCode(content) + '</code></pre>\n';
    }
    case 'hr': return '<hr>\n';
    case 'quote': return '<blockquote>\n' + renderBlocks(b.children) + '</blockquote>\n';
    case 'list': {
      const tag = b.ordered ? 'ol' : 'ul';
      const startAttr = (b.ordered && b.start !== 1) ? ' start="' + b.start + '"' : '';
      let inner = '';
      for (const it of b.children) inner += renderItem(it, b.tight);
      return '<' + tag + startAttr + '>\n' + inner + '</' + tag + '>\n';
    }
    case 'html': {
      let s = b.lines.join('\n');
      if (!b.endedAtBlank && !b.endedByContainer && b.lastLineTerminated && b.lines.length) s += '\n';
      return s;
    }
    case 'table': {
      let out = '<table>\n<thead>\n<tr>\n';
      for (let i = 0; i < b.header.length; i++) {
        const a = b.aligns[i];
        out += '<th' + (a ? ' align="' + a + '"' : '') + '>' + renderInline(parseInline(b.header[i], globalRefs)) + '</th>\n';
      }
      out += '</tr>\n</thead>\n';
      if (b.rows.length) {
        out += '<tbody>';
        for (const row of b.rows) {
          out += '<tr>\n';
          for (let i = 0; i < b.header.length; i++) {
            const cell = row[i] !== undefined ? row[i] : '';
            const a = b.aligns[i];
            out += '<td' + (a ? ' align="' + a + '"' : '') + '>' + renderInline(parseInline(cell, globalRefs)) + '</td>\n';
          }
          out += '</tr>\n';
        }
        out += '</tbody>';
      }
      out += '</table>\n';
      return out;
    }
    default: return '';
  }
}
function renderItem(it, tight) {
  const input = (it.task !== null && it.task !== undefined)
    ? '<input' + (it.task ? ' checked=""' : '') + ' disabled="" type="checkbox">' : '';
  const blocks = it.children;
  let inner = '';
  // In a tight list, EVERY paragraph child renders as bare inline
  // content (no <p>); any other blocks render normally. In a loose
  // list, the checkbox goes INSIDE the first <p>.
  if (tight) {
    let first = true;
    for (const b of blocks) {
      if (b.t === 'para') {
        if (!b.content) continue;
        inner += (first ? input : '') + renderInline(parseInline(b.content, globalRefs));
        first = false;
      } else {
        if (first) { inner += input; first = false; }
        inner += renderBlock(b);
      }
    }
    if (first) inner += input;
  } else {
    let first = true;
    for (const b of blocks) {
      if (b.t === 'para') {
        if (!b.content) continue;
        inner += '<p>' + (first ? input : '') + renderInline(parseInline(b.content, globalRefs)) + '</p>\n';
        first = false;
      } else {
        if (first) { inner += input; first = false; }
        inner += renderBlock(b);
      }
    }
    if (first) inner += input;
  }
  return '<li>' + inner + '</li>\n';
}
function cleanInfo(s) {
  let out = '', i = 0;
  while (i < s.length) {
    if (s.charCodeAt(i) === 92 && i + 1 < s.length && isPunct(s.charCodeAt(i + 1))) { out += s[i + 1]; i += 2; }
    else { out += s[i]; i++; }
  }
  return out;
}
