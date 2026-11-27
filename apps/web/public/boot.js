/* global window, document, performance, requestAnimationFrame, setTimeout, localStorage */
// The start screen's drawing starts once the first frame is on screen, so its first moments
// don't drop frames while the app's own script loads (src/bootSplash.ts counts from here).
(function () {
  // A later start (the drawing seen before, src/bootSplash.ts): the logo shows finished at once.
  // The app is ready in about 0.6 s and the screen goes then, so a drawing would be cut off
  // half-way (a tower without its lamp).
  try {
    if (localStorage.getItem("vuurtoren-boot-seen") === "1")
      document.documentElement.classList.add("boot-seen");
  } catch {
    // No storage: the drawing plays.
  }
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
