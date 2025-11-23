const PRIZES = {
  1: 100,
  2: 60,
  3: 40,
};

let currentPeriod = "current"; // "current" or "previous"
let countdownInterval = null;

function formatDateRangeText(afterMs, beforeMs) {
  const opts = { day: "2-digit", month: "short", year: "numeric" };
  const start = new Date(afterMs).toLocaleDateString(undefined, opts);
  const end = new Date(beforeMs).toLocaleDateString(undefined, opts);
  return `Tracking wagers from ${start} to ${end}`;
}

function formatAmount(value) {
  const num = Number(value || 0);
  if (isNaN(num)) return "0";
  return num.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function getPrizeForRank(rank) {
  return PRIZES[rank] || 0;
}

function createRow(rank, entry) {
  const tr = document.createElement("tr");

  const prize = getPrizeForRank(rank);
  const safeUsername = entry.isAnon ? "Anonymous" : entry.username || "Unknown";
  const avatarSrc = entry.avatar || "";

  tr.innerHTML = `
    <td class="col-rank">
      <div class="rank-pill rank-${rank <= 3 ? rank : ""}">${rank}</div>
    </td>
    <td>
      <div class="avatar-name">
        <div class="avatar">
          ${
            avatarSrc
              ? `<img src="${avatarSrc}" alt="${safeUsername}'s avatar" />`
              : ""
          }
        </div>
        <div class="username-block">
          <span class="username">${safeUsername}</span>
          ${entry.isAnon ? `<span class="anon-tag">Anon</span>` : ""}
        </div>
      </div>
    </td>
    <td class="amount">${formatAmount(entry.totalAmount)}</td>
    <td>
      ${
        prize > 0
          ? `<span class="prize-badge">
               <span class="icon">🏆</span>
               <span>${prize}</span>
             </span>`
          : `<span class="no-prize">–</span>`
      }
    </td>
  `;

  return tr;
}

function updatePeriodUI(period, meta) {
  currentPeriod = period;

  const badge = document.getElementById("period-badge");
  const subtitle = document.getElementById("lb-subtitle");
  const btnCurrent = document.getElementById("btn-current");
  const btnPrevious = document.getElementById("btn-previous");
  const countdownEl = document.getElementById("countdown-text");

  if (period === "current") {
    badge.textContent = "Current";
    subtitle.textContent =
      "Top 10 affiliates by total wager volume. 1st: 100 • 2nd: 60 • 3rd: 40.";
    btnCurrent.classList.add("active");
    btnPrevious.classList.remove("active");
    if (countdownEl) countdownEl.style.opacity = "1";
  } else {
    badge.textContent = "Last period";
    subtitle.textContent =
      "Results from the previous leaderboard period. No longer updating.";
    btnPrevious.classList.add("active");
    btnCurrent.classList.remove("active");
    if (countdownEl) {
      countdownEl.textContent = "This period has ended.";
      countdownEl.style.opacity = "0.85";
    }
  }
}

function startCountdown(targetMs) {
  const el = document.getElementById("countdown-text");
  if (!el) return;

  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }

  function tick() {
    const now = Date.now();
    let diff = targetMs - now;

    if (diff <= 0) {
      el.textContent = "Resetting leaderboard...";
      clearInterval(countdownInterval);
      countdownInterval = null;

      // when time is up, automatically load the new current period
      fetchLeaderboard("current");
      return;
    }

    const totalSeconds = Math.floor(diff / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const timeStr = `${days}d ${String(hours).padStart(2, "0")}:${String(
      minutes
    ).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

    el.textContent = `Time left this period: ${timeStr}`;
  }

  tick();
  countdownInterval = setInterval(tick, 1000);
}

async function fetchLeaderboard(period = "current") {
  const statusEl = document.getElementById("status");
  const tableBody = document.getElementById("leaderboard-body");
  const dateRangeText = document.getElementById("date-range-text");

  tableBody.innerHTML = "";
  statusEl.textContent = "Loading leaderboard...";
  statusEl.classList.remove("error");
  statusEl.classList.add("loading");

  try {
    const res = await fetch(`/api/leaderboard?period=${period}`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const json = await res.json();
    if (!json.success) {
      throw new Error(json.message || "API success:false");
    }

    const { data, meta } = json;

    updatePeriodUI(period, meta);

    if (meta?.after && meta?.before) {
      dateRangeText.textContent = formatDateRangeText(meta.after, meta.before);
    }

    // countdown only for current period
    if (period === "current" && meta?.nextResetAt) {
      startCountdown(meta.nextResetAt);
    } else {
      if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
    }

    if (!data || data.length === 0) {
      statusEl.textContent = "No wagers found for this period.";
      statusEl.classList.remove("loading");
      return;
    }

    data.forEach((entry, idx) => {
      const rank = idx + 1;
      const row = createRow(rank, entry);
      tableBody.appendChild(row);
    });

    statusEl.textContent = `Updated just now • Showing top ${data.length} players`;
    statusEl.classList.remove("loading");
  } catch (err) {
    console.error(err);
    statusEl.textContent =
      "Failed to load leaderboard. Try again or check the server.";
    statusEl.classList.remove("loading");
    statusEl.classList.add("error");
  }
}

// Buttons
document.getElementById("refresh-btn").addEventListener("click", () => {
  fetchLeaderboard(currentPeriod);
});

document.getElementById("btn-current").addEventListener("click", () => {
  fetchLeaderboard("current");
});

document.getElementById("btn-previous").addEventListener("click", () => {
  fetchLeaderboard("previous");
});

// Initial load
fetchLeaderboard("current");


