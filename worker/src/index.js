// Frat TV — Cloudflare Worker
// Serves:  /tv     -> the TV display (opened by the Fire Stick app)
//          /admin  -> the phone upload page
//          /api/*  -> JSON API used by both
// Storage: Cloudflare KV (binding "TV")

import TV_HTML from "./tv.html";
import ADMIN_HTML from "./admin.html";
import MENU_JS from "./static/menu.js";
import MENU_CSS from "./static/menu.css";

const DEFAULT_SETTINGS = {
  calendar: "",               // Google Calendar ID or embed URL
  calendarMode: "WEEK",       // WEEK | MONTH | AGENDA
  calendarZoom: 1.35,         // makes Google's small text readable on a TV
  timezone: "America/New_York",
  screens: [                  // order = rotation order
    { id: "menu", enabled: true, seconds: 25 },
    { id: "slide", enabled: true, seconds: 15 },
    { id: "calendar", enabled: true, seconds: 20 },
  ],
  geminiModel: "",            // blank = use GEMINI_MODEL from wrangler.toml
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname.replace(/\/+$/, "") || "/";
    try {
      if (p === "/") return Response.redirect(url.origin + "/tv", 302);
      if (p === "/tv") return html(TV_HTML);
      if (p === "/admin") return html(ADMIN_HTML);
      if (p === "/static/menu.js") return text(MENU_JS, "application/javascript");
      if (p === "/static/menu.css") return text(MENU_CSS, "text/css");

      if (p === "/api/state" && request.method === "GET") return json(await getPublicState(env));
      if (p === "/media/slide" && request.method === "GET") return getSlide(env);

      // ---------- admin-only below ----------
      if (p.startsWith("/api/")) {
        if (!(await isAdmin(request, env))) return json({ error: "Wrong password" }, 401);
        if (p === "/api/login") return json({ ok: true });
        if (p === "/api/menu/extract" && request.method === "POST") return extractMenu(request, env);
        if (p === "/api/menu" && request.method === "POST") return saveMenu(request, env);
        if (p === "/api/slide" && request.method === "PUT") return saveSlide(request, env);
        if (p === "/api/settings" && request.method === "POST") return saveSettings(request, env);
      }
      return json({ error: "Not found" }, 404);
    } catch (err) {
      return json({ error: String((err && err.message) || err) }, 500);
    }
  },
};

// ---------------- helpers ----------------
const NO_STORE = { "cache-control": "no-store" };
function html(body) {
  return new Response(body, { headers: { "content-type": "text/html; charset=utf-8", ...NO_STORE } });
}
function text(body, type) {
  return new Response(body, { headers: { "content-type": type + "; charset=utf-8", "cache-control": "public, max-age=300" } });
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...NO_STORE } });
}

async function isAdmin(request, env) {
  const given = request.headers.get("x-admin-password") || "";
  const real = env.ADMIN_PASSWORD || "";
  if (!real) throw new Error("ADMIN_PASSWORD secret is not set on the Worker");
  // constant-time compare
  const a = new TextEncoder().encode(given), b = new TextEncoder().encode(real);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] || 0) ^ (b[i] || 0);
  return diff === 0;
}

async function getState(env) {
  const s = (await env.TV.get("state", "json")) || {};
  s.settings = Object.assign({}, DEFAULT_SETTINGS, s.settings || {});
  if (!Array.isArray(s.settings.screens) || !s.settings.screens.length) s.settings.screens = DEFAULT_SETTINGS.screens;
  s.version = s.version || 0;
  return s;
}
async function putState(env, s) {
  s.version = Date.now();
  await env.TV.put("state", JSON.stringify(s));
  return s;
}
async function getPublicState(env) {
  const s = await getState(env);
  const settings = Object.assign({}, s.settings);
  delete settings.geminiModel;
  return {
    version: s.version,
    menu: s.menu || null,
    menuUpdated: s.menuUpdated || null,
    slide: s.slideUpdated ? { url: "/media/slide?v=" + s.slideUpdated, updated: s.slideUpdated } : null,
    settings,
    geminiModel: s.settings.geminiModel || env.GEMINI_MODEL || "",
  };
}

// ---------------- slide image ----------------
async function getSlide(env) {
  const { value, metadata } = await env.TV.getWithMetadata("slide", "arrayBuffer");
  if (!value) return new Response("No slide yet", { status: 404 });
  return new Response(value, {
    headers: { "content-type": (metadata && metadata.type) || "image/jpeg", "cache-control": "public, max-age=31536000, immutable" },
  });
}
async function saveSlide(request, env) {
  const type = request.headers.get("content-type") || "image/jpeg";
  if (!type.startsWith("image/")) return json({ error: "Send an image" }, 400);
  const buf = await request.arrayBuffer();
  if (buf.byteLength > 20 * 1024 * 1024) return json({ error: "Image too big (max 20 MB)" }, 400);
  await env.TV.put("slide", buf, { metadata: { type } });
  const s = await getState(env);
  s.slideUpdated = Date.now();
  await putState(env, s);
  return json({ ok: true, state: await getPublicState(env) });
}

// ---------------- settings ----------------
async function saveSettings(request, env) {
  const body = await request.json();
  const s = await getState(env);
  const next = Object.assign({}, s.settings);
  if (typeof body.calendar === "string") next.calendar = calendarId(body.calendar);
  if (["WEEK", "MONTH", "AGENDA"].includes(body.calendarMode)) next.calendarMode = body.calendarMode;
  if (typeof body.calendarZoom === "number" && body.calendarZoom >= 0.5 && body.calendarZoom <= 3) next.calendarZoom = body.calendarZoom;
  if (typeof body.timezone === "string" && body.timezone) next.timezone = body.timezone.trim();
  if (typeof body.geminiModel === "string") next.geminiModel = body.geminiModel.trim();
  if (Array.isArray(body.screens)) {
    next.screens = body.screens
      .filter((x) => x && ["menu", "slide", "calendar"].includes(x.id))
      .map((x) => ({ id: x.id, enabled: !!x.enabled, seconds: clamp(Number(x.seconds) || 15, 5, 600) }));
  }
  s.settings = next;
  await putState(env, s);
  return json({ ok: true, state: await getPublicState(env) });
}
// Accepts a Calendar ID, embed code, public URL, iCal link or "shareable link" (?cid=...) and returns the plain ID
function calendarId(raw) {
  raw = String(raw || "").trim().replace(/^["']|["']$/g, "");
  if (!raw) return "";
  let id = raw, m;
  try {
    if ((m = raw.match(/[?&]cid=([^&"'\s]+)/))) {
      let b = decodeURIComponent(m[1]).replace(/-/g, "+").replace(/_/g, "/");
      while (b.length % 4) b += "=";
      id = atob(b);
    } else if ((m = raw.match(/[?&]src=([^&"'\s]+)/))) id = decodeURIComponent(m[1]);
    else if ((m = raw.match(/calendar\/ical\/([^/"'\s]+)/))) id = decodeURIComponent(m[1]);
    else id = decodeURIComponent(raw);
  } catch (e) {}
  return id.trim();
}
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

// ---------------- menu ----------------
async function saveMenu(request, env) {
  const body = await request.json();
  const menu = cleanMenu(body.menu);
  const s = await getState(env);
  s.menu = menu;
  s.menuUpdated = Date.now();
  await putState(env, s);
  return json({ ok: true, state: await getPublicState(env) });
}

function cleanMenu(m) {
  if (!m || !Array.isArray(m.days) || !m.days.length) throw new Error("Menu has no days");
  const str = (v) => (typeof v === "string" ? v.trim() : "");
  const meal = (x) => ({
    title: str(x && x.title),
    items: Array.isArray(x && x.items) ? x.items.map(str).filter(Boolean) : [],
  });
  return {
    org: str(m.org) || "SIGMA NU",
    title: str(m.title),
    chef: str(m.chef),
    days: m.days.slice(0, 7).map((d) => ({ day: str(d.day).toUpperCase(), date: str(d.date), lunch: meal(d.lunch), dinner: meal(d.dinner) })),
    notes: Array.isArray(m.notes) ? m.notes.map((n) => ({ label: str(n.label).replace(/:$/, ""), text: str(n.text) })).filter((n) => n.text) : [],
  };
}

const MEAL_SCHEMA = {
  type: "OBJECT",
  properties: { title: { type: "STRING" }, items: { type: "ARRAY", items: { type: "STRING" } } },
  required: ["title", "items"],
};
const MENU_SCHEMA = {
  type: "OBJECT",
  properties: {
    org: { type: "STRING" },
    title: { type: "STRING" },
    chef: { type: "STRING" },
    days: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { day: { type: "STRING" }, date: { type: "STRING" }, lunch: MEAL_SCHEMA, dinner: MEAL_SCHEMA },
        required: ["day", "date", "lunch", "dinner"],
      },
    },
    notes: {
      type: "ARRAY",
      items: { type: "OBJECT", properties: { label: { type: "STRING" }, text: { type: "STRING" } }, required: ["label", "text"] },
    },
  },
  required: ["title", "days"],
};

const MENU_PROMPT = `You are transcribing a fraternity's weekly meal menu poster into JSON so it can be re-laid-out for a TV.
Transcribe EXACTLY what is printed; never invent dishes. Rules:
- org: the organization name in plain letters (e.g. "SIGMA NU").
- title: the week line without decorative stars, e.g. "FALL WEEK 8 2026".
- chef: the chef credit without the word "with", e.g. "Chef Paris".
- days: one entry per row, top to bottom. day = 3-letter weekday in caps ("MON"); date = as printed ("10/12").
- lunch / dinner: title = the big dish name in the case printed; items = the small description split on the "•" bullets, one string per item, no bullets.
- If a meal says there are no meals (e.g. "FALL BREAK" / "NO MEALS"), use title "FALL BREAK" (or whatever the big text says) and items ["NO MEALS"].
- notes: each fine-print notice at the bottom, label = the bold lead-in without the colon (e.g. "FOOD SAFETY FIRST"), text = the rest.
Fix obvious OCR-style spacing but keep wording.`;

async function extractMenu(request, env) {
  if (!env.GEMINI_API_KEY) return json({ error: "GEMINI_API_KEY secret is not set on the Worker" }, 500);
  const body = await request.json();
  if (!body.image) return json({ error: "No image sent" }, 400);
  const s = await getState(env);
  const model = (s.settings.geminiModel || env.GEMINI_MODEL || "gemini-2.5-flash").replace(/^models\//, "");
  let res;
  try {
  res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: MENU_PROMPT }, { inline_data: { mime_type: body.mimeType || "image/jpeg", data: body.image } }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: MENU_SCHEMA, temperature: 0 },
      }),
    }
  );
  } catch (e) {
    return json({ error: "Couldn't reach Gemini: " + String((e && e.message) || e) }, 502);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data.error && data.error.message) || res.statusText;
    return json({ error: `Gemini (${model}) error: ${msg}` }, 502);
  }
  const textOut = (((data.candidates || [])[0] || {}).content || {}).parts;
  const raw = (textOut || []).map((x) => x.text || "").join("");
  let menu;
  try { menu = cleanMenu(JSON.parse(raw)); }
  catch (e) { return json({ error: "Gemini didn't return a readable menu. Try a clearer photo.", raw: raw.slice(0, 500) }, 502); }
  return json({ ok: true, menu, model });
}
