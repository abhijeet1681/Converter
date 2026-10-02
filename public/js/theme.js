// Applies the saved theme before first paint (prevents a flash). DARK is the default;
// light mode is used only if the visitor chose it with the toggle.
(function () {
  try {
    var t = localStorage.getItem('ch-theme');
    document.documentElement.setAttribute('data-theme', t === 'light' ? 'light' : 'dark');
  } catch (e) { /* ignore */ }
})();
