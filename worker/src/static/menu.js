/* Shared menu renderer — used by the TV page and the phone preview. ES5-friendly for older Fire TV WebViews. */
(function () {
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function isOff(meal) {
    var t = ((meal && meal.title) || "") + " " + ((meal && meal.items) || []).join(" ");
    return /no meals|fall break|spring break|closed/i.test(t);
  }
  function cell(meal, today) {
    meal = meal || { title: "", items: [] };
    var list = meal.items || [];
    var items = list.map(function (x, i) { return '<span class="it">' + esc(x) + (i < list.length - 1 ? '<span class="dot">&bull;</span>' : "") + "</span>"; }).join(" ");
    var cls = "mn-cell" + (isOff(meal) ? " off" : "") + (today ? " today" : "");
    return '<div class="' + cls + '"><div class="t">' + esc(meal.title || "—") + "</div>" +
      (items ? '<div class="i">' + items + "</div>" : "") + "</div>";
  }
  // "10/12" style date for a JS Date in a given timezone
  function mdToday(tz) {
    try {
      var parts = new Intl.DateTimeFormat("en-US", { timeZone: tz || undefined, month: "numeric", day: "numeric" }).formatToParts(new Date());
      var m = "", d = "";
      parts.forEach(function (p) { if (p.type === "month") m = p.value; if (p.type === "day") d = p.value; });
      return m + "/" + d;
    } catch (e) { var n = new Date(); return (n.getMonth() + 1) + "/" + n.getDate(); }
  }
  function normDate(s) {
    var m = String(s || "").match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
    return m ? parseInt(m[1], 10) + "/" + parseInt(m[2], 10) : "";
  }

  function render(el, menu, opts) {
    opts = opts || {};
    var days = (menu && menu.days) || [];
    var today = normDate(opts.today || mdToday(opts.timezone));
    var todayIdx = -1;
    days.forEach(function (d, i) { if (normDate(d.date) === today) todayIdx = i; });

    var week = esc((menu.title || "").replace(/[★*]/g, "").trim());
    var h = '<div class="mn"><div class="mn-frame"></div>' +
      '<header class="mn-head"><div class="mn-letters">&Sigma;&Nu;</div>' +
      '<div class="mn-titles"><div class="mn-org">' + esc(menu.org || "SIGMA NU") + "</div>" +
      (week ? '<div class="mn-week"><span class="star">&#9733;</span> ' + week + ' <span class="star">&#9733;</span></div>' : "") +
      "</div>" +
      '<div class="mn-right">' +
      (menu.chef ? '<div class="mn-chef"><span class="with">with</span>' + esc(menu.chef) + "</div>" : "") +
      (opts.clock ? '<div class="mn-clock" data-clock></div>' : "") +
      "</div></header>";

    h += '<div class="mn-grid" style="grid-template-columns:110px repeat(' + Math.max(days.length, 1) + ',minmax(0,1fr))">';
    h += '<div class="mn-corner"></div>';
    days.forEach(function (d, i) {
      h += '<div class="mn-dayhead' + (i === todayIdx ? " today" : "") + '"><span class="d">' + esc(d.day) + '</span><span class="dt">' + esc(d.date) + "</span>" +
        (i === todayIdx ? '<span class="mn-today-tag">TODAY</span>' : "") + "</div>";
    });
    h += '<div class="mn-rowlab"><span>LUNCH</span></div>';
    days.forEach(function (d, i) { h += cell(d.lunch, i === todayIdx); });
    h += '<div class="mn-rowlab"><span>DINNER</span></div>';
    days.forEach(function (d, i) { h += cell(d.dinner, i === todayIdx); });
    h += "</div>";

    if (menu.notes && menu.notes.length) {
      h += '<div class="mn-notes">' + menu.notes.map(function (n) {
        return "<div>" + (n.label ? "<b>" + esc(n.label) + ":</b>" : "") + esc(n.text) + "</div>";
      }).join("") + "</div>";
    }
    h += "</div>";
    el.innerHTML = h;
    fit(el);
    if (opts.clock) tickClock(el, opts.timezone);
  }

  // shrink text so every cell fits, then use one shared size so the grid looks even
  function overflows(c) { return c.scrollHeight > c.clientHeight + 1 || c.scrollWidth > c.clientWidth + 1; }
  // Find the largest size where test(size) passes, using a few binary-search steps (fast on slow TV sticks)
  function largest(lo, hi, test) {
    if (!test(lo)) return lo;
    while (lo < hi) { var mid = Math.ceil((lo + hi) / 2); if (test(mid)) lo = mid; else hi = mid - 1; }
    return lo;
  }
  function fit(el) {
    var cells = el.querySelectorAll(".mn-cell"), i;
    if (!cells.length) return;
    var titles = [], details = [];
    for (i = 0; i < cells.length; i++) { titles.push(cells[i].querySelector(".t")); details.push(cells[i].querySelector(".i")); }
    // 1) one shared title size: as big as possible while every title fits nicely
    var T = largest(22, 56, function (sz) {
      var j;
      for (j = 0; j < cells.length; j++) titles[j].style.fontSize = sz + "px";
      for (j = 0; j < cells.length; j++) {
        if (titles[j].scrollWidth > cells[j].clientWidth - 30 || titles[j].offsetHeight > cells[j].clientHeight * 0.42) return false;
      }
      return true;
    });
    for (i = 0; i < cells.length; i++) titles[i].style.fontSize = T + "px";
    // 2) one shared detail size: largest that fits in every cell
    var I = largest(14, Math.round(T * 0.7), function (sz) {
      var j;
      for (j = 0; j < cells.length; j++) if (details[j]) details[j].style.fontSize = sz + "px";
      for (j = 0; j < cells.length; j++) if (details[j] && overflows(cells[j])) return false;
      return true;
    });
    for (i = 0; i < cells.length; i++) if (details[i]) details[i].style.fontSize = I + "px";
    var notes = el.querySelector(".mn-notes");
    if (notes) {
      var ns = 23; notes.style.fontSize = ns + "px";
      while ((notes.scrollHeight > notes.clientHeight + 1 || notes.scrollWidth > notes.clientWidth + 1) && ns > 13) { ns -= 1; notes.style.fontSize = ns + "px"; }
    }
    var head = el.querySelector(".mn-head"), org = el.querySelector(".mn-org");
    if (head && org) {
      var os = 104; org.style.fontSize = os + "px";
      while (head.scrollWidth > head.clientWidth + 1 && os > 60) { os -= 2; org.style.fontSize = os + "px"; }
    }
  }

  var clockTimer = null;
  function tickClock(el, tz) {
    var node = el.querySelector("[data-clock]");
    if (!node) return;
    function upd() {
      var d = new Date(), o = { timeZone: tz || undefined };
      var day, time;
      try {
        day = d.toLocaleDateString("en-US", { timeZone: o.timeZone, weekday: "long", month: "short", day: "numeric" });
        time = d.toLocaleTimeString("en-US", { timeZone: o.timeZone, hour: "numeric", minute: "2-digit" });
      } catch (e) { day = d.toDateString(); time = d.toTimeString().slice(0, 5); }
      node.innerHTML = esc(day) + " &nbsp;<b>" + esc(time) + "</b>";
    }
    upd();
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = setInterval(upd, 15000);
  }

  window.MenuRender = { render: render, fit: fit, esc: esc };
})();
