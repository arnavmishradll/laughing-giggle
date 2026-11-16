/* Calendar feed (.ics) reader + TV calendar views. ES5 so older Fire TV browsers can run it. */
(function () {
  var DAY = 86400000;
  var COLORS = ["#F4511E", "#E67C73", "#F6BF26", "#8E24AA", "#795548", "#33B679", "#039BE5", "#3F51B5", "#0B8043", "#D50000"];

  // ---------- time zone helpers ("wall" = local clock time stored as a fake-UTC number) ----------
  var fmtCache = {};
  function tzOffset(tz, ms) {
    var f = fmtCache[tz];
    if (!f) {
      f = fmtCache[tz] = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    }
    var p = {}, parts = f.formatToParts(new Date(ms));
    for (var i = 0; i < parts.length; i++) p[parts[i].type] = parts[i].value;
    var h = +p.hour === 24 ? 0 : +p.hour;
    return Date.UTC(+p.year, +p.month - 1, +p.day, h, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
  }
  function safeTz(tz, fallback) {
    if (!tz || tz === "UTC") return tz || fallback;
    try { tzOffset(tz, Date.now()); return tz; } catch (e) { return fallback; }
  }
  function toUtc(wall, tz) {
    if (tz === "UTC") return wall;
    var off = tzOffset(tz, wall), utc = wall - off, off2 = tzOffset(tz, utc);
    return off2 === off ? utc : wall - off2;
  }
  function toWall(ms, tz) { return tz === "UTC" ? ms : ms + tzOffset(tz, ms); }
  function dayNum(wall) { return Math.floor(wall / DAY); }

  // ---------- .ics parsing ----------
  function unescapeText(s) { return s.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1"); }
  function parseLine(line) {
    var q = false, i;
    for (i = 0; i < line.length; i++) { var c = line.charAt(i); if (c === '"') q = !q; else if (c === ":" && !q) break; }
    var left = line.slice(0, i), val = line.slice(i + 1), parts = left.split(";"), params = {};
    for (var j = 1; j < parts.length; j++) { var k = parts[j].indexOf("="); params[parts[j].slice(0, k).toUpperCase()] = parts[j].slice(k + 1).replace(/"/g, ""); }
    return { name: parts[0].toUpperCase(), params: params, val: val };
  }
  // -> {allDay, wall, tz}
  function parseDate(val, params, dispTz) {
    var m = String(val).match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/);
    if (!m) return null;
    if (!m[4] || params.VALUE === "DATE") return { allDay: true, wall: Date.UTC(+m[1], +m[2] - 1, +m[3]), tz: "DAY" };
    var wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    return { allDay: false, wall: wall, tz: m[7] ? "UTC" : safeTz(params.TZID, dispTz) };
  }
  function realMs(d, dispTz) { return d.tz === "DAY" ? toUtc(d.wall, dispTz) : toUtc(d.wall, d.tz); }
  function occKey(d, dispTz) { return d.allDay ? "D" + dayNum(d.wall) : "T" + realMs(d, dispTz); }

  function parseIcs(text, dispTz) {
    var lines = String(text).replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
    var cal = { name: "", events: [] }, ev = null;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line) continue;
      if (line === "BEGIN:VEVENT") { ev = { ex: [] }; continue; }
      if (line === "END:VEVENT") { if (ev && ev.start) cal.events.push(ev); ev = null; continue; }
      var p = parseLine(line);
      if (!ev) { if (p.name === "X-WR-CALNAME") cal.name = unescapeText(p.val); continue; }
      switch (p.name) {
        case "SUMMARY": ev.title = unescapeText(p.val); break;
        case "LOCATION": ev.loc = unescapeText(p.val); break;
        case "UID": ev.uid = p.val; break;
        case "STATUS": ev.cancelled = /CANCELLED/i.test(p.val); break;
        case "DTSTART": ev.start = parseDate(p.val, p.params, dispTz); break;
        case "DTEND": ev.end = parseDate(p.val, p.params, dispTz); break;
        case "DURATION": ev.dur = p.val; break;
        case "RRULE": ev.rrule = p.val; break;
        case "RECURRENCE-ID": ev.recId = parseDate(p.val, p.params, dispTz); break;
        case "EXDATE":
          var vals = p.val.split(",");
          for (var j = 0; j < vals.length; j++) { var d = parseDate(vals[j], p.params, dispTz); if (d) ev.ex.push(d); }
          break;
      }
    }
    return cal;
  }

  function durationMs(s) {
    var m = String(s || "").match(/P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?/);
    if (!m) return 0;
    return ((+m[1] || 0) * 7 * DAY) + ((+m[2] || 0) * DAY) + ((+m[3] || 0) * 3600000) + ((+m[4] || 0) * 60000) + ((+m[5] || 0) * 1000);
  }

  // ---------- recurring events ----------
  var DOW = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  function addDays(wall, n) { return wall + n * DAY; }
  function timeOfDay(wall) { return ((wall % DAY) + DAY) % DAY; }
  function ymd(wall) { var d = new Date(wall); return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCDay()]; }
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); }
  function monthDays(y, m, byday, bymd, defaultDay) {
    var out = [], n = daysInMonth(y, m), i;
    if (byday.length) {
      for (i = 0; i < byday.length; i++) {
        var bm = byday[i].match(/^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/);
        if (!bm) continue;
        var want = DOW[bm[2]], all = [];
        for (var d = 1; d <= n; d++) if (new Date(Date.UTC(y, m, d)).getUTCDay() === want) all.push(d);
        if (bm[1]) { var k = +bm[1]; var pick = k > 0 ? all[k - 1] : all[all.length + k]; if (pick) out.push(pick); }
        else out = out.concat(all);
      }
    } else if (bymd.length) {
      for (i = 0; i < bymd.length; i++) { var v = +bymd[i]; var dd = v > 0 ? v : n + v + 1; if (dd >= 1 && dd <= n) out.push(dd); }
    } else if (defaultDay <= n) out.push(defaultDay);
    out.sort(function (a, b) { return a - b; });
    return out;
  }

  // calls cb(wall) for each occurrence start (wall time in the event's own zone) up to limit
  function eachOccurrence(start, rruleStr, limit, cb) {
    var r = {}, parts = rruleStr.split(";");
    for (var i = 0; i < parts.length; i++) { var kv = parts[i].split("="); r[kv[0].toUpperCase()] = kv[1]; }
    var freq = r.FREQ, interval = +(r.INTERVAL || 1) || 1, count = r.COUNT ? +r.COUNT : Infinity;
    var until = Infinity;
    if (r.UNTIL) {
      var u = parseDate(r.UNTIL, {}, "UTC");
      if (u) until = u.allDay ? u.wall + DAY - 1 : (start.tz === "UTC" || start.tz === "DAY" ? u.wall : toWall(u.wall, start.tz));
    }
    var byday = r.BYDAY ? r.BYDAY.split(",") : [], bymd = r.BYMONTHDAY ? r.BYMONTHDAY.split(",") : [];
    var bymonth = r.BYMONTH ? r.BYMONTH.split(",").map(function (x) { return +x - 1; }) : [];
    var s = start.wall, tod = timeOfDay(s), sp = ymd(s), n = 0, guard = 0;
    function emit(w) {
      if (w < s) return true;
      if (w > until || n >= count || w > limit) return false;
      n++; cb(w); return true;
    }
    if (freq === "DAILY") {
      for (var k = 0; guard++ < 5000; k++) if (!emit(addDays(s, k * interval))) return;
    } else if (freq === "WEEKLY") {
      var wkst = DOW[r.WKST || "MO"], days = byday.length ? byday.map(function (x) { return DOW[x.slice(-2)]; }) : [sp[3]];
      days.sort(function (a, b) { return ((a - wkst + 7) % 7) - ((b - wkst + 7) % 7); });
      var weekStart = addDays(s - tod, -((sp[3] - wkst + 7) % 7));
      for (var w = 0; guard++ < 3000; w++) {
        var base = addDays(weekStart, w * 7 * interval);
        for (var j = 0; j < days.length; j++) if (!emit(base + ((days[j] - wkst + 7) % 7) * DAY + tod)) return;
      }
    } else if (freq === "MONTHLY" || freq === "YEARLY") {
      for (var step = 0; guard++ < 2000; step++) {
        var months = [];
        if (freq === "MONTHLY") months.push([sp[0], sp[1] + step * interval]);
        else {
          var yy = sp[0] + step * interval, list = bymonth.length ? bymonth : [sp[1]];
          for (var q = 0; q < list.length; q++) months.push([yy, list[q]]);
        }
        for (var mi = 0; mi < months.length; mi++) {
          var y = months[mi][0], m = months[mi][1];
          y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
          var ds = monthDays(y, m, byday, bymd, sp[2]);
          for (var di = 0; di < ds.length; di++) if (!emit(Date.UTC(y, m, ds[di]) + tod)) return;
        }
      }
    } else {
      emit(s);
    }
  }

  // Turn parsed calendars into a flat list of occurrences between fromMs and toMs
  function expand(cals, fromMs, toMs, dispTz) {
    var out = [];
    cals.forEach(function (cal, ci) {
      if (!cal) return;
      var overrides = {};
      cal.events.forEach(function (ev) { if (ev.recId && ev.uid) (overrides[ev.uid] = overrides[ev.uid] || {})[occKey(ev.recId, dispTz)] = 1; });
      cal.events.forEach(function (ev) {
        var st = ev.start;
        var startReal = realMs(st, dispTz);
        var len;
        if (st.allDay) len = ev.end && ev.end.allDay ? Math.max(1, Math.round((ev.end.wall - st.wall) / DAY)) : 1;
        else len = ev.end ? Math.max(0, realMs(ev.end, dispTz) - startReal) : durationMs(ev.dur);
        function push(wall) {
          if (ev.cancelled) return;
          var d = { allDay: st.allDay, wall: wall, tz: st.tz };
          if (st.allDay) {
            var a = dayNum(wall);
            out.push({ cal: ci, title: ev.title || "(busy)", allDay: true, startDay: a, endDay: a + len - 1, loc: ev.loc || "" });
          } else {
            var s = realMs(d, dispTz);
            if (s + len < fromMs || s > toMs) return;
            var sw = toWall(s, dispTz);
            out.push({ cal: ci, title: ev.title || "(busy)", allDay: false, start: s, end: s + len, startDay: dayNum(sw), endDay: dayNum(sw), loc: ev.loc || "" });
          }
        }
        var fromDay = dayNum(toWall(fromMs, dispTz)), toDay = dayNum(toWall(toMs, dispTz));
        if (!ev.rrule) {
          if (st.allDay) { var a = dayNum(st.wall); if (a + len - 1 < fromDay || a > toDay) return; }
          push(st.wall);
          return;
        }
        var skip = overrides[ev.uid] || {}, ex = {};
        ev.ex.forEach(function (x) { ex[occKey(x, dispTz)] = 1; });
        var toWallLimit = (st.allDay ? (toDay + 1) * DAY : toWall(toMs, st.tz === "DAY" ? dispTz : st.tz) + DAY);
        eachOccurrence(st, ev.rrule, toWallLimit, function (w) {
          var key = occKey({ allDay: st.allDay, wall: w, tz: st.tz }, dispTz);
          if (skip[key] || ex[key]) return;
          if (st.allDay) { var a = dayNum(w); if (a + len - 1 < fromDay || a > toDay) return; }
          push(w);
        });
      });
    });
    out.sort(function (a, b) {
      if (a.startDay !== b.startDay) return a.startDay - b.startDay;
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      return (a.start || 0) - (b.start || 0) || (a.title < b.title ? -1 : 1);
    });
    return out;
  }

  // ---------- rendering ----------
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var WD = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  var MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
  function dParts(day) { var d = new Date(day * DAY); return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), w: d.getUTCDay() }; }
  function fmtTime(ms, tz, short) {
    var w = new Date(toWall(ms, tz)), h = w.getUTCHours(), m = w.getUTCMinutes();
    var ap = h < 12 ? (short ? "a" : " AM") : (short ? "p" : " PM"); h = h % 12 || 12;
    return h + (m ? ":" + (m < 10 ? "0" : "") + m : "") + ap;
  }
  function color(i) { return COLORS[i % COLORS.length]; }
  function onDay(evs, day) { return evs.filter(function (e) { return e.startDay <= day && e.endDay >= day; }); }

  function chip(e, tz, short) {
    var c = color(e.cal);
    if (e.allDay) return '<div class="ce ce-all" style="background:' + c + '">' + esc(e.title) + "</div>";
    return '<div class="ce"><i style="background:' + c + '"></i><span class="tx"><b>' + fmtTime(e.start, tz, short) + "</b> " + esc(e.title) + "</span></div>";
  }
  // hide items that don't fit and say "+N more"
  function clip(box) {
    var items = box.querySelectorAll(".ce"), hidden = 0;
    if (box.scrollHeight <= box.clientHeight + 1) return;
    var more = document.createElement("div"); more.className = "ce ce-more"; box.appendChild(more);
    for (var i = items.length - 1; i >= 0 && box.scrollHeight > box.clientHeight + 1; i--) {
      items[i].style.display = "none"; hidden++; more.textContent = "+" + hidden + " more";
    }
  }

  function render(el, data, opts) {
    var tz = opts.timezone, mode = opts.mode || "WEEK";
    var today = dayNum(toWall(Date.now(), tz)), evs = data.events, h = "";
    var tp = dParts(today);
    if (mode === "MONTH") {
      var first = Math.round(Date.UTC(tp.y, tp.m, 1) / DAY), start = first - dParts(first).w;
      var last = Math.round(Date.UTC(tp.y, tp.m + 1, 0) / DAY), weeks = Math.ceil((last - start + 1) / 7);
      h += '<div class="cm" style="grid-template-rows:56px repeat(' + weeks + ',minmax(0,1fr))">';
      for (var i = 0; i < 7; i++) h += '<div class="cm-wd">' + WD[i] + "</div>";
      for (var d = start; d < start + weeks * 7; d++) {
        var p = dParts(d), out = p.m !== tp.m;
        h += '<div class="cm-cell' + (out ? " out" : "") + (d === today ? " today" : "") + '"><div class="cm-n"><span>' + p.d + "</span></div><div class=\"cm-ev\">";
        onDay(evs, d).forEach(function (e) { h += chip(e, tz, true); });
        h += "</div></div>";
      }
      h += "</div>";
      opts.setRange && opts.setRange(MONTHS[tp.m] + " " + tp.y);
    } else if (mode === "AGENDA") {
      h += '<div class="ca">';
      var shown = 0;
      for (var a = today; a < today + 21 && shown < 12; a++) {
        var list = onDay(evs, a); if (!list.length) continue; shown++;
        var ap = dParts(a);
        h += '<div class="ca-day' + (a === today ? " today" : "") + '"><div class="ca-h">' + WD[ap.w] + " " + (ap.m + 1) + "/" + ap.d + (a === today ? " · TODAY" : a === today + 1 ? " · TOMORROW" : "") + "</div>";
        list.forEach(function (e) { h += chip(e, tz, false); });
        h += "</div>";
      }
      if (!shown) h += '<div class="c-empty">Nothing on the calendar for the next 3 weeks.</div>';
      h += "</div>";
      opts.setRange && opts.setRange("NEXT 3 WEEKS");
    } else {
      h += '<div class="cw">';
      for (var w = today; w < today + 7; w++) {
        var wp = dParts(w);
        h += '<div class="cw-col' + (w === today ? " today" : "") + '"><div class="cw-h"><span class="d">' + WD[wp.w] + '</span> <span class="dt">' + (wp.m + 1) + "/" + wp.d + "</span>" + (w === today ? '<span class="tag">TODAY</span>' : "") + '</div><div class="cw-ev">';
        var l = onDay(evs, w);
        if (!l.length) h += '<div class="cw-none">—</div>';
        l.forEach(function (e) { h += chip(e, tz, false); });
        h += "</div></div>";
      }
      h += "</div>";
      opts.setRange && opts.setRange("THIS WEEK");
    }
    // legend
    h += '<div class="c-legend">';
    data.sources.forEach(function (s, i) {
      if (!s.ok) return;
      h += '<span><i style="background:' + color(i) + '"></i>' + esc(s.name || ("Calendar " + (i + 1))) + "</span>";
    });
    h += "</div>";
    el.innerHTML = h;
    var boxes = el.querySelectorAll(".cm-ev, .cw-ev");
    for (var b = 0; b < boxes.length; b++) clip(boxes[b]);
  }

  // ---------- loading ----------
  // fetch /api/ics/0..n-1 ; cb({sources:[{ok,name,status,count}], events})
  var lastGood = {};
  function load(count, tz, cb) {
    var cals = [], sources = [], left = count;
    if (!count) return cb({ sources: [], events: [] });
    for (var i = 0; i < count; i++) (function (i) {
      var xhr = new XMLHttpRequest();
      xhr.open("GET", "/api/ics/" + i + "?t=" + Date.now());
      xhr.timeout = 25000;
      function done(ok, text, status) {
        var cal = null;
        if (ok) { try { cal = parseIcs(text, tz); lastGood[i] = cal; } catch (e) { ok = false; status = "unreadable"; } }
        if (!ok && lastGood[i] && status !== 404) cal = lastGood[i]; // network hiccup: keep showing the last copy
        cals[i] = cal;
        sources[i] = { ok: !!cal, name: cal ? cal.name : "", status: status, events: cal ? cal.events.length : 0 };
        if (--left === 0) {
          var now = Date.now();
          cb({ sources: sources, events: expand(cals, now - 45 * DAY, now + 60 * DAY, tz) });
        }
      }
      xhr.onload = function () { done(xhr.status === 200, xhr.responseText, xhr.status); };
      xhr.onerror = xhr.ontimeout = function () { done(false, "", 0); };
      xhr.send();
    })(i);
  }

  window.CalFeed = { parse: parseIcs, expand: expand, render: render, load: load, color: color };
})();
