// Change payouts here
const PRIZES = { 1: 100, 2: 30, 3: 20 };

let currentPeriod = "current";
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

function prizeFor(rank) {
  return PRIZES[rank] || 0;
}

function setActiveButtons(period) {
  el("btn-current").classList.toggle("active", period === "current");
  el("btn-previous").classList.toggle("active", period === "previous");
  el("period-badge").textContent = period === "current" ? "Current" : "Last";
}

function startCountdown(targetMs) {
  if (countdownInterval) clearInterval(countdownInterval);

  const tick = () => {
    const diff = targetMs - Date.now();
    if (diff <= 0) {
      el("countdown-text").textContent = "Resetting leaderboard…";
      clearInterval(countdownInterval);
      countdownInterval = null;
      loadLeaderboard("current"); // auto-start next cycle
      return;
    }

    const totalSeconds = Math.floor(diff / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    el("countdown-text").textContent =
      `Time left: ${days}d ${String(hours).padStart(2,"0")}:${String(minutes).padStart(2,"0")}:${String(seconds).padStart(2,"0")}`;
  };

  tick();
  countdownInterval = setInterval(tick, 1000);
}

function renderRows(data) {
  const tbody = el("leaderboard-body");
  tbody.innerHTML = "";

  data.forEach((entry, idx) => {
    const rank = idx + 1;
    const prize = prizeFor(rank);

    const safeUsername = entry.isAnon ? "Anonymous" : (entry.username || "Unknown");
    const avatarSrc = entry.avatar || "";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="col-rank">
        <div class="rank-pill ${rank <= 3 ? `rank-${rank}` : ""}">${rank}</div>
      </td>
      <td>
        <div class="avatar-name">
          <div class="avatar">
            ${avatarSrc ? `<img src="${avatarSrc}" alt="${safeUsername}" />` : ""}
          </div>
          <div>
            <div class="username">${safeUsername}</div>
            ${entry.isAnon ? `<div class="anon-tag">Anon</div>` : ""}
          </div>
        </div>
      </td>
      <td class="amount">${formatAmount(entry.totalAmount ?? entry.amount ?? entry.total ?? entry.wagered)}</td>
      <td>
        ${prize ? `<span class="prize-badge">🏆 ${prize}</span>` : "—"}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function loadLeaderboard(period) {
  currentPeriod = period;
  setActiveButtons(period);

  el("status").textContent = "Loading…";

  try {
    const res = await fetch(`/api/leaderboard?period=${period}`);
    const json = await res.json();

    if (!json.success) {
      el("status").textContent = "Failed to load leaderboard.";
      console.error(json);
      return;
    }

    el("date-range-text").textContent = formatDateRangeText(json.meta.after, json.meta.before);

    if (period === "current" && json.meta.nextResetAt) {
      startCountdown(json.meta.nextResetAt);
    } else {
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

el("btn-current").addEventListener("click", () => loadLeaderboard("current"));
el("btn-previous").addEventListener("click", () => loadLeaderboard("previous"));
el("refresh-btn").addEventListener("click", () => loadLeaderboard(currentPeriod));

loadLeaderboard("current");




