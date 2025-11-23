require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const CSGOLD_API_KEY = process.env.CSGOLD_API_KEY;

if (!CSGOLD_API_KEY) {
  console.error("Missing CSGOLD_API_KEY in .env");
  process.exit(1);
}

// length of one leaderboard period in days
const LEADERBOARD_DURATION_DAYS = 14;

// 🕒 anchor: fixed start date for all 14-day cycles
// Format example: "2025-11-23T00:00:00Z"
const LB_START_ISO = process.env.LB_START_ISO || "2025-11-23T00:00:00Z";
const BASE_START_MS = Date.parse(LB_START_ISO);

if (Number.isNaN(BASE_START_MS)) {
  throw new Error("Invalid LB_START_ISO date format");
}


app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/**
 * Period calculation relative to server start:
 * - period 0 (current) is the 14-day block that contains "now"
 * - period -1 is the previous 14-day block
 */
function getPeriodRange(offset = 0) {
  const msPerPeriod = LEADERBOARD_DURATION_DAYS * 24 * 60 * 60 * 1000;
  const nowMs = Date.now();

  const diff = nowMs - BASE_START_MS;
  const currentIndex = Math.floor(diff / msPerPeriod);
  const targetIndex = currentIndex + offset;

  const startMs = BASE_START_MS + targetIndex * msPerPeriod;
  const endMs = startMs + msPerPeriod;

  return {
    after: startMs,
    before: endMs,
    periodIndex: targetIndex,
    endMs,
  };
}

// GET /api/leaderboard?period=current|previous
app.get("/api/leaderboard", async (req, res) => {
  try {
    const periodParam = req.query.period === "previous" ? "previous" : "current";
    const offset = periodParam === "previous" ? -1 : 0;

    const { after, before, periodIndex, endMs } = getPeriodRange(offset);

    const response = await axios.post(
      "https://api.csgold.gg/affiliate/leaderboard/referrals",
      {
        key: CSGOLD_API_KEY,
        type: "WAGER",
        before,
        after,
      },
      {
        headers: { "Content-Type": "application/json" },
      }
    );

    if (!response.data?.success) {
      return res.status(500).json({
        success: false,
        message: "CSGold API returned success: false",
      });
    }

    let data = response.data.data || [];

    // sort by totalAmount desc & keep top 10
    data = data
      .sort((a, b) => Number(b.totalAmount) - Number(a.totalAmount))
      .slice(0, 10);

    res.json({
      success: true,
      data,
      meta: {
        period: periodParam,
        after,
        before,
        periodIndex,
        durationDays: LEADERBOARD_DURATION_DAYS,
        serverStart: BASE_START_MS,
        // for countdown (for current period this is the reset time)
        nextResetAt: periodParam === "current" ? endMs : null,
      },
    });
  } catch (err) {
    console.error("Error fetching leaderboard:", err.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch leaderboard",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Server start timestamp (BASE_START_MS): ${BASE_START_MS}`);
});


