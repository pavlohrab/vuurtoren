// The start screen's drawing starts once the first frame is on screen, so its first moments
// don't drop frames while the app's own script loads (src/bootSplash.ts counts from here).
(function () {
  var started = false;
  function go() {
    if (started) return;
    started = true;
    window.__vuurtorenBootAt = performance.now();
    document.documentElement.classList.add("boot-go");
  }
  requestAnimationFrame(function () {
    requestAnimationFrame(go);
  });
  setTimeout(go, 800);
})();
