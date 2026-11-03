// Encryption for the capture-the-flag chain. Used by the page and by build.js, so it has no DOM code.
// Each question is AES-GCM encrypted with a key derived (PBKDF2) from the previous question's keyword.
const CTF = (() => {
  const ITERATIONS = 100000;
  const subtle = () => (globalThis.crypto && globalThis.crypto.subtle) || null;
  const enc = new TextEncoder(), dec = new TextDecoder();

  // Keywords ignore case and extra spaces, so "Night  Ferry" unlocks the same as "night ferry".
  const normKeyword = s => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');

  function toB64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function fromB64(b64) {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  async function deriveKey(keyword, salt, iterations) {
    const base = await subtle().importKey('raw', enc.encode(normKeyword(keyword)), 'PBKDF2', false, ['deriveKey']);
    return subtle().deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  // Encrypts any JSON value. Returns { salt, iv, iterations, data } with base64 strings.
  async function seal(value, keyword) {
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(keyword, salt, ITERATIONS);
    const data = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(value))));
    return { salt: toB64(salt), iv: toB64(iv), iterations: ITERATIONS, data: toB64(data) };
  }

  // Resolves to the decrypted value, or null when the keyword is wrong.
  async function open(box, keyword) {
    const key = await deriveKey(keyword, fromB64(box.salt), box.iterations || ITERATIONS);
    try {
      const plain = await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(box.iv) }, key, fromB64(box.data));
      return JSON.parse(dec.decode(plain));
    } catch (e) {
      return null;
    }
  }

  // WebCrypto only exists on https:// and http://localhost pages.
  const available = () => !!subtle();

  return { seal, open, normKeyword, available };
})();
if (typeof module !== 'undefined') module.exports = CTF;
