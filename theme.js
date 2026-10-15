// Light / dark mode. Loaded in <head> so a saved choice applies before the
// first paint. With no saved choice the page follows the system setting.
(function () {
  'use strict';
  const KEY = 'select-and-return:mode';
  const root = document.documentElement;
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) { /* storage unavailable */ }
  if (saved === 'light' || saved === 'dark') root.setAttribute('data-theme', saved);

  const current = () => root.getAttribute('data-theme') || (media.matches ? 'dark' : 'light');

  function syncButton() {
    const b = document.getElementById('mode-toggle');
    if (!b) return;
    const dark = current() === 'dark';
    b.querySelector('span').textContent = dark ? '☀' : '☾';
    b.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  }

  document.addEventListener('DOMContentLoaded', () => {
    syncButton();
    document.getElementById('mode-toggle').addEventListener('click', () => {
      const next = current() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem(KEY, next); } catch (e) { /* ignore */ }
      syncButton();
    });
    media.addEventListener('change', syncButton);
  });
})();
