// Counts finished builds on the public demo only. Self-hosted copies load this
// file and send nothing. The builder itself just fires 'openvgal:gallery-built'.
(function () {
  if (location.hostname !== 'demo.openvgal.com') return;

  var s = document.createElement('script');
  s.defer = true;
  s.src = 'https://stats.openvgal.com/site.js';
  s.setAttribute('data-website-id', 'f25e0aaa-899e-4a6d-add0-ae43634577a1');
  s.setAttribute('data-auto-track', 'false');
  document.head.appendChild(s);

  window.addEventListener('openvgal:gallery-built', function () {
    if (window.umami && typeof window.umami.track === 'function') {
      window.umami.track('gallery-built');
    }
  });
})();
