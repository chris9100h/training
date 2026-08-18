(function () {
  'use strict';

  // Keep the public policy page readable in the same light/dark themes as the
  // welcome page, without making the policy depend on the app bundle.
  var root = document.documentElement;
  var key = 'zane-public-theme';
  var saved = null;
  try { saved = localStorage.getItem(key); } catch (_) {}
  if (saved === 'light' || saved === 'dark') root.dataset.theme = saved;

  var button = document.getElementById('themeBtn');
  if (!button) return;
  button.addEventListener('click', function () {
    var next = root.dataset.theme === 'light' ? 'dark' : 'light';
    root.dataset.theme = next;
    try { localStorage.setItem(key, next); } catch (_) {}
    button.setAttribute('aria-label', 'Switch to ' + (next === 'light' ? 'dark' : 'light') + ' theme');
  });
}());
