(function () {
  'use strict';

  // Keep the page completely static for crawlers while avoiding a stale year
  // in a cached copy of the public verification page.
  var year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());
}());
