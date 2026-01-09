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

const ROSTAKE_API_KEY = process.env.ROSTAKE_API_KEY;
if (!ROSTAKE_API_KEY) {
  console.error("Missing ROSTAKE_API_KEY in environment (.env / Railway Variables)");
  process.exit(1);
}

// Fixed anchor so timer does NOT reset on Railway sleep/restart
const LB_START_ISO = process.env.LB_START_ISO || new Date().toISOString();
const BASE_START_MS = Date.parse(LB_START_ISO);
if (Number.isNaN(BASE_START_MS)) {
  console.error("Invalid LB_START_ISO. Use format like 2026-01-09T00:00:00Z");
  process.exit(1);
}

const LB_DAYS = Number(process.env.LB_DAYS || 14);
if (!Number.isFinite(LB_DAYS) || LB_DAYS <= 0) {
  console.error("Invalid LB_DAYS. Must be a number > 0.");
  process.exit(1);
}

const MS_PER_PERIOD = LB_DAYS * 24 * 60 * 60 * 1000;

// Rostake edge endpoint (confirmed)
const ROSTAKE_ENDPOINT = "https://rostake.com/api/v1/affiliate/leaderboard";

// Optional debug logging
const DEBUG_ROSTAKE = process.env.DEBUG_ROSTAKE === "1";

function isoNoMs(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function getPeriodRange(offset = 0) {
  const nowMs = Date.now();
  const diff = nowMs - BASE_START_MS;

  // If anchor is in the future, clamp
  const currentIndex = diff >= 0 ? Math.floor(diff / MS_PER_PERIOD) : 0;
  const targetIndex = currentIndex + offset;

  const after = BASE_START_MS + targetIndex * MS_PER_PERIOD;
  const before = after + MS_PER_PERIOD;

  return { after, before, endMs: before, periodIndex: targetIndex };
}

async function fetchRostake(startIso) {
  const response = await axios.get(ROSTAKE_ENDPOINT, {
    params: {
      api: ROSTAKE_API_KEY,
      start: startIso
    },
    headers: {
      "Accept": "application/json, text/plain, */*",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Referer": "https://rostake.com/"
    },
    timeout: 15000
  });

  return response.data;
}

// GET /api/leaderboard?period=current|previous
app.get("/api/leaderboard", async (req, res) => {
  try {
    const period = req.query.period === "previous" ? "previous" : "current";
    const offset = period === "previous" ? -1 : 0;

    const { after, before, endMs, periodIndex } = getPeriodRange(offset);
    const startIso = isoNoMs(after);

    const raw = await fetchRostake(startIso);

    if (DEBUG_ROSTAKE) {
      console.log("ROSTAKE start:", startIso);
      console.log("ROSTAKE raw:", JSON.stringify(raw).slice(0, 2000));
    }

    if (!raw || raw.success !== true) {
      return res.status(500).json({
        success: false,
        message: "Rostake API returned success:false",
        details: raw
      });
    }

    // ✅ Rostake shape confirmed:
    // { success:true, data:{ users:[{ id, username, avatarVersion, wagered }, ...] } }
    const users = Array.isArray(raw?.data?.users) ? raw.data.users : [];

    // Sort by wagered and take top 10
    const top10 = users
      .slice()
      .sort((a, b) => Number(b.wagered || 0) - Number(a.wagered || 0))
      .slice(0, 10);

    // Normalize output so your frontend can stay simple
    const normalized = top10.map((u) => ({
      id: u.id,
      username: u.username,
      avatarVersion: u.avatarVersion,
      wagered: u.wagered
    }));

    res.json({
      success: true,
      data: normalized,
      meta: {
        period,
        after,
        before,
        durationDays: LB_DAYS,
        periodIndex,
        nextResetAt: period === "current" ? endMs : null
      }
    });
  } catch (e) {
    const details = e.response?.data || e.message;
    console.error("Leaderboard error:", details);
    res.status(500).json({
      success: false,
      message: "Failed to fetch leaderboard",
      details
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`ROSTAKE_ENDPOINT: ${ROSTAKE_ENDPOINT}`);
  console.log(`LB_START_ISO: ${LB_START_ISO}`);
  console.log(`LB_DAYS: ${LB_DAYS}`);
  console.log(`DEBUG_ROSTAKE: ${DEBUG_ROSTAKE ? "ON" : "OFF"}`);
});






