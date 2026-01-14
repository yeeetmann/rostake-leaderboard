// server.js
require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;

// --------------------
// Endpoints
// --------------------
const ROSTAKE_ENDPOINT = "https://rostake.com/api/v1/affiliate/leaderboard";
const ROULO_ENDPOINT = "https://api.roulobets.com/v1/external/affiliates";

// --------------------
// API Keys (server-side only)
// --------------------
const ROSTAKE_API_KEY = process.env.ROSTAKE_API_KEY || "";
const ROULO_API_KEY = process.env.ROULO_API_KEY || "";

// --------------------
// Per-site schedule (different durations + different anchors)
// --------------------
const SITE_SCHEDULE = {
  rostake: {
    startIso: process.env.ROSTAKE_START_ISO, // e.g. 2026-01-09T00:00:00Z
    days: Number(process.env.ROSTAKE_DAYS || 7),
  },
  roulobets: {
    startIso: process.env.ROULO_START_ISO, // e.g. 2026-01-12T00:00:00Z
    days: Number(process.env.ROULO_DAYS || 14),
  },
};

// Optional debug
const DEBUG = process.env.DEBUG === "1";

// --------------------
// Helpers
// --------------------
function isoNoMs(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function ymdUTC(ms) {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function assertSchedule(site) {
  const cfg = SITE_SCHEDULE[site];
  if (!cfg) throw new Error("Unknown site");

  if (!cfg.startIso) throw new Error(`Missing ${site.toUpperCase()}_START_ISO`);
  const baseMs = Date.parse(cfg.startIso);
  if (Number.isNaN(baseMs)) throw new Error(`Invalid ${site.toUpperCase()}_START_ISO`);

  if (!Number.isFinite(cfg.days) || cfg.days <= 0) throw new Error(`Invalid ${site.toUpperCase()}_DAYS`);

  return { baseMs, days: cfg.days };
}

function getPeriodRangeForSite(site, offset = 0) {
  const { baseMs, days } = assertSchedule(site);
  const msPerPeriod = days * 24 * 60 * 60 * 1000;

  const nowMs = Date.now();
  const diff = nowMs - baseMs;

  // If anchor is in the future, clamp to index 0
  const currentIndex = diff >= 0 ? Math.floor(diff / msPerPeriod) : 0;
  const targetIndex = currentIndex + offset;

  const after = baseMs + targetIndex * msPerPeriod;
  const before = after + msPerPeriod;

  return { after, before, endMs: before, periodIndex: targetIndex, durationDays: days };
}

// --------------------
// Rostake fetch
// Shape confirmed:
// { success:true, data:{ users:[{ id, username, avatarVersion, wagered }, ...] } }
// --------------------
async function fetchRostake(afterMs) {
  if (!ROSTAKE_API_KEY) throw new Error("Missing ROSTAKE_API_KEY");

  const startIso = isoNoMs(afterMs);

  const r = await axios.get(ROSTAKE_ENDPOINT, {
    params: { api: ROSTAKE_API_KEY, start: startIso },
    headers: {
      Accept: "application/json, text/plain, */*",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Referer: "https://rostake.com/",
    },
    timeout: 15000,
  });

  const raw = r.data;
  const users = Array.isArray(raw?.data?.users) ? raw.data.users : [];

  // Normalize
  return users.map((u) => ({
    username: u.username,
    wagered: Number(u.wagered || 0),
    avatar: null, // Rostake only gives avatarVersion; can be added later if URL format is known
    isAnon: false,
  }));
}

// --------------------
// Roulobets fetch with HARD 15-minute caching
// This prevents: "Too many affiliate streamer checks. Please try again later."
// --------------------
const ROULO_CACHE_TTL_MS = 15 * 60 * 1000;
// cacheKey -> { ts, data }
const roulCache = new Map();

async function fetchRoulobets(afterMs, beforeMs) {
  if (!ROULO_API_KEY) throw new Error("Missing ROULO_API_KEY");

  const start_at = ymdUTC(afterMs);
  const end_at = ymdUTC(beforeMs - 1);

  const cacheKey = `${start_at}|${end_at}`;
  const cached = roulCache.get(cacheKey);

  if (cached && Date.now() - cached.ts < ROULO_CACHE_TTL_MS) {
    return {
      rows: cached.data,
      cache: { hit: true, nextRefreshAt: cached.ts + ROULO_CACHE_TTL_MS },
      warning: null,
    };
  }

  try {
    const r = await axios.get(ROULO_ENDPOINT, {
      params: { start_at, end_at, key: ROULO_API_KEY },
      headers: {
        Accept: "application/json, text/plain, */*",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      },
      timeout: 15000,
    });

    const raw = r.data;

    if (DEBUG) {
      console.log("ROULO query:", { start_at, end_at });
      console.log("ROULO raw keys:", raw && typeof raw === "object" ? Object.keys(raw) : typeof raw);
      console.log("ROULO raw sample:", JSON.stringify(raw).slice(0, 2500));
    }

    // ✅ Confirmed by your logs:
    // { affiliates: [ { username, id, wagered_amount:"19.5000", rank:"..." }, ... ] }
    const list = Array.isArray(raw?.affiliates) ? raw.affiliates : [];

    const normalized = list.map((u) => ({
      username: u.username || "Unknown",
      wagered: Number(u.wagered_amount || 0),
      avatar: null,
      isAnon: false,
      rank: u.rank || null
    }));

    roulCache.set(cacheKey, { ts: Date.now(), data: normalized });

    return {
      rows: normalized,
      cache: { hit: false, nextRefreshAt: Date.now() + ROULO_CACHE_TTL_MS },
      warning: null,
    };
  } catch (err) {
    const details = err?.response?.data || err?.message || err;

    if (cached && cached.data) {
      return {
        rows: cached.data,
        cache: { hit: true, nextRefreshAt: cached.ts + ROULO_CACHE_TTL_MS },
        warning: "Roulobets is rate-limiting (15 min). Showing cached results.",
      };
    }

    throw details;
  }
}



// --------------------
// API route
// /api/leaderboard?site=rostake|roulobets&period=current|previous
// --------------------
app.get("/api/leaderboard", async (req, res) => {
  try {
    const site = (req.query.site || "rostake").toString().toLowerCase();
    const period = req.query.period === "previous" ? "previous" : "current";
    const offset = period === "previous" ? -1 : 0;

    const { after, before, endMs, periodIndex, durationDays } = getPeriodRangeForSite(site, offset);

    let rows = [];
    let extraMeta = {};
    let warning = null;

    if (site === "rostake") {
      rows = await fetchRostake(after);
    } else if (site === "roulobets" || site === "roulo") {
      const result = await fetchRoulobets(after, before);
      rows = result.rows;
      extraMeta.rouloCache = result.cache;
      warning = result.warning || null;
    } else {
      return res.status(400).json({ success: false, message: "Unknown site" });
    }

    const top10 = rows
      .slice()
      .sort((a, b) => Number(b.wagered || 0) - Number(a.wagered || 0))
      .slice(0, 10);

    res.json({
      success: true,
      data: top10,
      meta: {
        site,
        period,
        after,
        before,
        durationDays,
        periodIndex,
        nextResetAt: period === "current" ? endMs : null,
        warning,
        ...extraMeta,
      },
    });

    if (DEBUG) {
      console.log(
        `[${site}] ${period} after=${isoNoMs(after)} before=${isoNoMs(before)} returned=${top10.length}`
      );
    }
  } catch (e) {
    const details = e?.response?.data || e?.message || e;
    console.error("Leaderboard error:", details);
    res.status(500).json({
      success: false,
      message: "Failed to fetch leaderboard",
      details,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});






