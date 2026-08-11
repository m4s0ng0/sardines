(() => {
  "use strict";

  const FISH_SVG_URL = "logo.svg";
  let fishMarkup = "";

  const screens = {
    join: document.getElementById("screen-join"),
    lobby: document.getElementById("screen-lobby"),
    game: document.getElementById("screen-game"),
  };
  function showScreen(name) {
    Object.entries(screens).forEach(([k, el]) => el.classList.toggle("active", k === name));
  }

  const roomInput = document.getElementById("roomInput");
  const nameInput = document.getElementById("nameInput");
  const roleHiderBtn = document.getElementById("roleHider");
  const roleSeekerBtn = document.getElementById("roleSeeker");
  const joinBtn = document.getElementById("joinBtn");
  const joinErr = document.getElementById("joinErr");
  const roomBadge = document.getElementById("roomBadge");
  const lobbyRoomName = document.getElementById("lobbyRoomName");
  const hiderList = document.getElementById("hiderList");
  const seekerList = document.getElementById("seekerList");
  const startBtn = document.getElementById("startBtn");
  const lobbyHint = document.getElementById("lobbyHint");
  const phaseLabel = document.getElementById("phaseLabel");
  const timerDisplay = document.getElementById("timerDisplay");
  const hintDots = document.getElementById("hintDots");
  const seekerPanel = document.getElementById("seekerPanel");
  const hiderPanel = document.getElementById("hiderPanel");
  const hintBtn = document.getElementById("hintBtn");
  const hintStatus = document.getElementById("hintStatus");
  const requestBanner = document.getElementById("requestBanner");
  const hintText = document.getElementById("hintText");
  const sendHintBtn = document.getElementById("sendHintBtn");
  const hiderIdle = document.getElementById("hiderIdle");
  const hintLog = document.getElementById("hintLog");
  const newRoundBtn = document.getElementById("newRoundBtn");

  let selectedRole = null;
  let ws = null;
  let myId = null;
  let latestState = null;
  let tickHandle = null;

  const HIDE_DURATION_FALLBACK = 120000;

  // --- fish mark injection (so currentColor / CSS color works) ---
  fetch(FISH_SVG_URL).then(r => r.text()).then(svg => {
    fishMarkup = svg;
    document.getElementById("logoMark").innerHTML = svg;
  }).catch(() => {});

  function fishIcon() {
    return fishMarkup || "";
  }

  // --- role selection ---
  function selectRole(role) {
    selectedRole = role;
    roleHiderBtn.classList.toggle("selected", role === "hider");
    roleSeekerBtn.classList.toggle("selected", role === "seeker");
  }
  roleHiderBtn.addEventListener("click", () => selectRole("hider"));
  roleSeekerBtn.addEventListener("click", () => selectRole("seeker"));

  function slugRoom(v) {
    return v.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  }

  // --- connection ---
  joinBtn.addEventListener("click", () => {
    joinErr.textContent = "";
    const room = slugRoom(roomInput.value);
    const name = nameInput.value.trim();
    if (!room) { joinErr.textContent = "Enter a room code."; return; }
    if (!name) { joinErr.textContent = "Enter your name."; return; }
    if (!selectedRole) { joinErr.textContent = "Pick a role."; return; }

    joinBtn.disabled = true;
    joinBtn.textContent = "Connecting\u2026";

    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/room/${encodeURIComponent(room)}`);

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "join", name, role: selectedRole }));
      roomBadge.textContent = room;
      roomBadge.style.display = "inline-block";
      lobbyRoomName.textContent = room;
    });

    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "welcome") {
        myId = msg.id;
      } else if (msg.type === "state") {
        latestState = msg.state;
        render();
      } else if (msg.type === "error") {
        joinErr.textContent = msg.message || "Something went wrong.";
      }
    });

    ws.addEventListener("close", () => {
      joinBtn.disabled = false;
      joinBtn.textContent = "Join room";
      if (screens.join.classList.contains("active") === false) {
        joinErr.textContent = "Connection lost. Refresh to rejoin.";
      }
    });

    ws.addEventListener("error", () => {
      joinErr.textContent = "Couldn't connect. Check the room code and try again.";
      joinBtn.disabled = false;
      joinBtn.textContent = "Join room";
    });
  });

  startBtn.addEventListener("click", () => send({ type: "start" }));
  hintBtn.addEventListener("click", () => send({ type: "requestHint" }));
  sendHintBtn.addEventListener("click", () => {
    const text = hintText.value.trim();
    if (!text) return;
    send({ type: "sendHint", text });
    hintText.value = "";
  });
  newRoundBtn.addEventListener("click", () => send({ type: "reset" }));

  function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }

  // --- rendering ---
  function render() {
    if (!latestState) return;
    const s = latestState;
    const me = myId ? s.players[myId] : null;

    if (s.phase === "lobby") {
      showScreen("lobby");
      renderLobby(s);
    } else {
      showScreen("game");
      renderGame(s, me);
    }
    startTicking();
  }

  function playerChip(p) {
    return `<div class="player-chip"><span class="fish">${fishIcon()}</span>${escapeHtml(p.name)}</div>`;
  }
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function renderLobby(s) {
    const players = Object.values(s.players);
    const hiders = players.filter(p => p.role === "hider");
    const seekers = players.filter(p => p.role === "seeker");
    hiderList.innerHTML = hiders.length ? hiders.map(playerChip).join("") : `<p class="empty-note">Nobody yet</p>`;
    seekerList.innerHTML = seekers.length ? seekers.map(playerChip).join("") : `<p class="empty-note">Nobody yet</p>`;
    const ready = hiders.length > 0 && seekers.length > 0;
    startBtn.disabled = !ready;
    lobbyHint.textContent = ready
      ? `${hiders.length} hider${hiders.length === 1 ? "" : "s"}, ${seekers.length} seeker${seekers.length === 1 ? "" : "s"}. Anyone can start.`
      : "Waiting for at least one hider and one seeker\u2026";
  }

  function renderGame(s, me) {
    const isHider = me && me.role === "hider";
    const isSeeker = me && me.role === "seeker";
    seekerPanel.style.display = isSeeker ? "block" : "none";
    hiderPanel.style.display = isHider ? "block" : "none";

    // hint dots
    hintDots.innerHTML = "";
    for (let i = 0; i < s.hints.max; i++) {
      const d = document.createElement("span");
      d.className = "dot" + (i < s.hints.used ? " filled" : "");
      hintDots.appendChild(d);
    }

    // hint log
    hintLog.innerHTML = s.log.length
      ? s.log.map(h => `<div class="log-item"><div class="from">${escapeHtml(h.from)}</div>${escapeHtml(h.text)}</div>`).join("")
      : `<p class="log-empty">No hints sent yet.</p>`;

    // hider request banner
    if (isHider) {
      requestBanner.style.display = s.pendingRequest ? "block" : "none";
      hintText.style.display = s.pendingRequest ? "block" : "none";
      sendHintBtn.style.display = s.pendingRequest ? "block" : "none";
      hiderIdle.style.display = s.pendingRequest ? "none" : "block";
    }
  }

  // --- ticking clock (drives timer, cooldown, phase label) ---
  function startTicking() {
    if (tickHandle) return;
    tickHandle = setInterval(tick, 250);
    tick();
  }

  function tick() {
    if (!latestState || latestState.phase === "lobby") return;
    const s = latestState;
    const now = Date.now();
    const elapsed = now - (s.startTime || now);
    const remaining = Math.max(0, (s.duration || HIDE_DURATION_FALLBACK) - elapsed);
    const seekPhase = remaining <= 0;

    phaseLabel.textContent = seekPhase ? "Seek!" : "Hiding";
    phaseLabel.classList.toggle("seek", seekPhase);

    const totalSec = Math.ceil(remaining / 1000);
    const mm = Math.floor(totalSec / 60);
    const ss = totalSec % 60;
    timerDisplay.textContent = `${mm}:${String(ss).padStart(2, "0")}`;
    timerDisplay.classList.toggle("warn", !seekPhase && remaining <= 15000);
    timerDisplay.classList.toggle("done", seekPhase);

    newRoundBtn.style.display = seekPhase ? "block" : "none";

    // hint button state (seeker)
    const me = myId ? s.players[myId] : null;
    if (me && me.role === "seeker") {
      const cooldownLeft = Math.max(0, (s.hints.cooldownUntil || 0) - now);
      const usedUp = s.hints.used >= s.hints.max;
      hintBtn.disabled = usedUp || s.pendingRequest || cooldownLeft > 0;
      if (usedUp) {
        hintStatus.textContent = "All hints used.";
      } else if (s.pendingRequest) {
        hintStatus.textContent = "Waiting for a hider to answer\u2026";
      } else if (cooldownLeft > 0) {
        const cs = Math.ceil(cooldownLeft / 1000);
        hintStatus.textContent = `Next hint available in ${Math.floor(cs / 60)}:${String(cs % 60).padStart(2, "0")}`;
      } else {
        hintStatus.textContent = `${s.hints.max - s.hints.used} hint${s.hints.max - s.hints.used === 1 ? "" : "s"} left.`;
      }
    }
  }
})();
