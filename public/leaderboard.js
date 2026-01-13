// Per-site config
const SITE_CONFIG = {
  rostake: {
    title: "Rostake Wager Leaderboard Bubbi69",
    subtitle: "Top 10 • Prizes: 1st 100 • 2nd 30 • 3rd 20",
    prizes: { 1: 100, 2: 30, 3: 20 }
  },
  roulobets: {
    title: "Roulobets $100 Leaderboard Bubbi69",
    subtitle: "Top 10 • Prizes: 1st 50 • 2nd 30 • 3rd 10 • 4th 10",
    prizes: { 1: 50, 2: 30, 3: 10, 4: 10 }
  }
};

let currentPeriod = "current";
let currentSite = "rostake";
let countdownInterval = null;

const el = (id) => document.getElementById(id);

function formatDateRangeText(afterMs, beforeMs) {
  const opts = { day: "2-digit", month: "short", year: "numeric" };
  const start = new Date(afterMs).toLocaleDateString(undefined, opts);
  const end = new Date(beforeMs).toLocaleDateString(undefined, opts);
  return `Tracking wagers from ${start} to ${end}`;
}

function formatAmount(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return "0.00";
  return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function startCountdown(targetMs) {
  if (countdownInterval) clearInterval(countdownInterval);

  const tick = () => {
    const diff = targetMs - Date.now();
    if (diff <= 0) {
      el("countdown-text").textContent = "Resetting leaderboard…";
      clearInterval(countdownInterval);
      countdownInterval = null;
      loadLeaderboard("current", currentSite);
      return;
    }

    const s = Math.floor(diff / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;

    el("countdown-text").textContent =
      `Time left: ${d}d ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  };

  tick();
  countdownInterval = setInterval(tick, 1000);
}

function setActive(btnOn, btnOff) {
  el(btnOn).classList.add("active");
  el(btnOff).classList.remove("active");
}

function updateHeaderForSite(siteKey) {
  const cfg = SITE_CONFIG[siteKey] || SITE_CONFIG.rostake;
  el("lb-title-text").textContent = cfg.title;
  el("lb-subtitle").textContent = cfg.subtitle;
  document.title = cfg.title;
}

function prizeFor(rank) {
  const cfg = SITE_CONFIG[currentSite] || SITE_CONFIG.rostake;
  return cfg.prizes[rank] || 0;
}

function renderRows(data) {
  const tbody = el("leaderboard-body");
  tbody.innerHTML = "";

  data.forEach((entry, idx) => {
    const rank = idx + 1;
    const prize = prizeFor(rank);
    const username = entry.isAnon ? "Anonymous" : (entry.username || "Unknown");

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="col-rank">
        <div class="rank-pill ${rank <= 3 ? `rank-${rank}` : ""}">${rank}</div>
      </td>
      <td>
        <div class="avatar-name">
          <div class="avatar"></div>
          <div>
            <div class="username">${username}</div>
            ${entry.isAnon ? `<div class="anon-tag">Anon</div>` : ""}
          </div>
        </div>
      </td>
      <td class="amount">${formatAmount(entry.wagered)}</td>
      <td>${prize ? `<span class="prize-badge">🏆 ${prize}</span>` : "—"}</td>
    `;
    tbody.appendChild(tr);
  });
}

async function loadLeaderboard(period, site) {
  currentPeriod = period;
  currentSite = site;

  // Buttons
  if (period === "current") setActive("btn-current", "btn-previous");
  else setActive("btn-previous", "btn-current");

  if (site === "rostake") setActive("btn-rostake", "btn-roulobets");
  else setActive("btn-roulobets", "btn-rostake");

  // Title/subtitle
  updateHeaderForSite(site);

  // Badge
  el("period-badge").textContent = period === "current" ? "Current" : "Last";

  el("status").textContent = "Loading…";

  try {
    const res = await fetch(`/api/leaderboard?period=${period}&site=${site}`);
    const json = await res.json();

    if (!json.success) {
      el("status").textContent = "Failed to load leaderboard.";
      console.error(json);
      return;
    }

    el("date-range-text").textContent = formatDateRangeText(json.meta.after, json.meta.before);

    if (period === "current" && json.meta.nextResetAt) startCountdown(json.meta.nextResetAt);
    else {
      if (countdownInterval) clearInterval(countdownInterval);
      el("countdown-text").textContent = "Ended.";
    }

    renderRows(json.data || []);
    el("status").textContent = `Updated • showing top ${json.data.length}`;
  } catch (err) {
    console.error(err);
    el("status").textContent = "Error loading leaderboard.";
  }
}

// Wire buttons
el("btn-current").addEventListener("click", () => loadLeaderboard("current", currentSite));
el("btn-previous").addEventListener("click", () => loadLeaderboard("previous", currentSite));
el("refresh-btn").addEventListener("click", () => loadLeaderboard(currentPeriod, currentSite));

el("btn-rostake").addEventListener("click", () => loadLeaderboard(currentPeriod, "rostake"));
el("btn-roulobets").addEventListener("click", () => loadLeaderboard(currentPeriod, "roulobets"));

// Initial load
updateHeaderForSite("rostake");
loadLeaderboard("current", "rostake");




