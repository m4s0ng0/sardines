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
  const toastStack = document.getElementById("toastStack");

  let selectedRole = null;
  let ws = null;
  let myId = null;
  let latestState = null;
  let tickHandle = null;
  let pendingJoin = null; // {room, name, role} — replayed on (re)connect

  const HIDE_DURATION_FALLBACK = 120000;

  // --- fish mark injection (so currentColor / CSS color works) ---
  fetch(FISH_SVG_URL).then(r => r.text()).then(svg => {
    fishMarkup = svg;
    document.getElementById("logoMark").innerHTML = svg;
  }).catch(() => {});
  function fishIcon() { return fishMarkup || ""; }

  // --- notifications: toast / sound / vibration / system ---
  let audioCtx = null;
  let notifPermissionAsked = false;
  function ensureAudio() {
    if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch { audioCtx = null; } }
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  }
  function beep(freq = 880, duration = 140) {
    if (!audioCtx) return;
    try {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = freq;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.001, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.18, audioCtx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration / 1000);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + duration / 1000 + 0.02);
    } catch {}
  }
  function vibrate(pattern) { if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch {} } }
  function toast(message) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = message;
    toastStack.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 300); }, 3600);
  }
  function systemNotify(title, body) {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "granted" && document.hidden) {
      try { new Notification(title, { body, icon: "logo.svg" }); } catch {}
    }
  }
  function maybeAskNotificationPermission() {
    if (notifPermissionAsked) return;
    notifPermissionAsked = true;
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }
  function notify(message, { soundFreq, vibratePattern, sysTitle } = {}) {
    toast(message);
    if (soundFreq) beep(soundFreq);
    if (vibratePattern) vibrate(vibratePattern);
    if (sysTitle) systemNotify(sysTitle, message);
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
  function connect(room, name, role) {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${proto}://${location.host}/room/${encodeURIComponent(room)}`);

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "join", name, role }));
      roomBadge.textContent = room;
      roomBadge.style.display = "inline-block";
      lobbyRoomName.textContent = room;
      joinErr.textContent = "";
    });

    socket.addEventListener("message", (ev) => {
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

    socket.addEventListener("close", (ev) => {
      joinBtn.disabled = false;
      joinBtn.textContent = "Join room";
      if (!screens.join.classList.contains("active")) {
        joinErr.textContent = `Connection lost (code ${ev.code}). Tap below to rejoin.`;
        toast("Disconnected from the room.");
      }
    });

    socket.addEventListener("error", () => {
      joinErr.textContent = `Couldn't reach ${location.host}. Make sure this page is being served from your deployed Cloudflare Worker (not a plain static host like GitHub Pages), and that it has a Durable Object binding named GAME_ROOM.`;
      joinBtn.disabled = false;
      joinBtn.textContent = "Join room";
    });

    return socket;
  }

  joinBtn.addEventListener("click", () => {
    ensureAudio();
    maybeAskNotificationPermission();
    joinErr.textContent = "";
    const room = slugRoom(roomInput.value);
    const name = nameInput.value.trim();
    if (!room) { joinErr.textContent = "Enter a room code."; return; }
    if (!name) { joinErr.textContent = "Enter your name."; return; }
    if (!selectedRole) { joinErr.textContent = "Pick a role."; return; }

    joinBtn.disabled = true;
    joinBtn.textContent = "Connecting\u2026";
    pendingJoin = { room, name, role: selectedRole };
    ws = connect(room, name, selectedRole);
  });

  startBtn.addEventListener("click", () => send({ type: "start" }));
  hintBtn.addEventListener("click", () => send({ type: "requestHint" }));
  sendHintBtn.addEventListener("click", () => {
    const text = hintText.value.trim();
    if (!text) return;
    send({ type: "sendHint", text });
    hintText.value = "";
  });
  newRoundBtn.addEventListener("click", () => {
    const stillHiding = latestState && latestState.phase === "hiding" &&
      Date.now() - latestState.startTime < latestState.duration;
    if (stillHiding && !confirm("End the round early for everyone?")) return;
    send({ type: "reset" });
  });

  function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    } else if (pendingJoin) {
      joinErr.textContent = "Not connected yet \u2014 reconnecting\u2026";
      ws = connect(pendingJoin.room, pendingJoin.name, pendingJoin.role);
    }
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
    detectEvents(s, me);
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

    hintDots.innerHTML = "";
    for (let i = 0; i < s.hints.max; i++) {
      const d = document.createElement("span");
      d.className = "dot" + (i < s.hints.used ? " filled" : "");
      hintDots.appendChild(d);
    }

    hintLog.innerHTML = s.log.length
      ? s.log.map(h => `<div class="log-item"><div class="from">${escapeHtml(h.from)}</div>${escapeHtml(h.text)}</div>`).join("")
      : `<p class="log-empty">No hints sent yet.</p>`;

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

  let seekAnnounced = false;
  function tick() {
    if (!latestState || latestState.phase === "lobby") return;
    const s = latestState;
    const now = Date.now();
    const elapsed = now - (s.startTime || now);
    const remaining = Math.max(0, (s.duration || HIDE_DURATION_FALLBACK) - elapsed);
    const seekPhase = remaining <= 0;

    phaseLabel.textContent = seekPhase ? "Seek!" : "Hiding";
    phaseLabel.classList.toggle("seek", seekPhase);

    if (seekPhase && !seekAnnounced) {
      seekAnnounced = true;
      notify("Time's up \u2014 seekers, go!", { soundFreq: 520, vibratePattern: [120, 60, 120], sysTitle: "Sardines" });
    }

    const totalSec = Math.ceil(remaining / 1000);
    const mm = Math.floor(totalSec / 60);
    const ss = totalSec % 60;
    timerDisplay.textContent = `${mm}:${String(ss).padStart(2, "0")}`;
    timerDisplay.classList.toggle("warn", !seekPhase && remaining <= 15000);
    timerDisplay.classList.toggle("done", seekPhase);

    newRoundBtn.style.display = "block";
    newRoundBtn.textContent = seekPhase ? "New round" : "End round";

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

  // --- event diffing (fires notifications on state transitions) ---
  let prevPhase = null;
  let prevPendingRequest = false;
  let prevLogLength = 0;

  function detectEvents(s, me) {
    if (prevPhase === "lobby" && s.phase === "hiding") {
      notify("Round started \u2014 hiders have 2 minutes.", { soundFreq: 660, vibratePattern: [80], sysTitle: "Sardines" });
      seekAnnounced = false;
    }
    if (prevPhase === "hiding" && s.phase === "lobby") {
      notify("Round ended. Back in the lobby.", { soundFreq: 440, vibratePattern: [60], sysTitle: "Sardines" });
    }
    if (s.pendingRequest && !prevPendingRequest && me && me.role === "hider") {
      notify("A seeker is asking for a hint.", { soundFreq: 990, vibratePattern: [80, 60, 80], sysTitle: "Hint requested" });
    }
    if (s.log.length > prevLogLength) {
      const latest = s.log[s.log.length - 1];
      if (me && me.role === "seeker") {
        notify(`Hint: ${latest.text}`, { soundFreq: 770, vibratePattern: [80], sysTitle: "New hint" });
      }
    }
    prevPhase = s.phase;
    prevPendingRequest = s.pendingRequest;
    prevLogLength = s.log.length;
  }
})();
