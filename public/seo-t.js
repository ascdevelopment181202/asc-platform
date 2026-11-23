/* ASC site tracking: counts page views, call taps, form sends and directions clicks. No cookies, no personal data. */
(function () {
  var s = document.currentScript;
  if (!s) return;
  var t = s.getAttribute("data-t");
  if (!t) return;
  var u = new URL(s.src).origin + "/api/seo/t";
  function send(k) {
    try {
      var b = JSON.stringify({ t: t, k: k, p: location.pathname, r: document.referrer, q: location.search.slice(0, 200) });
      if (navigator.sendBeacon) navigator.sendBeacon(u, b);
      else fetch(u, { method: "POST", body: b, keepalive: true, mode: "no-cors" });
    } catch (e) {}
  }
  send("view");
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest && e.target.closest("a");
    if (!a) return;
    var h = a.getAttribute("href") || "";
    if (h.indexOf("tel:") === 0) send("call");
    else if (/google\.[a-z.]+\/maps|maps\.app\.goo\.gl|maps\.apple\.com|goo\.gl\/maps/.test(h)) send("directions");
  }, true);
  document.addEventListener("submit", function () { send("form"); }, true);
})();
