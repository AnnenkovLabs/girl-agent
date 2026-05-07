(() => {
  const TOKEN = window.__TOKEN__;
  const SCORE_KEYS = ["interest", "trust", "attraction", "annoyance", "cringe"];

  const $ = (id) => document.getElementById(id);
  const logEl = $("log");
  const statusDot = $("status-dot");
  const statusText = $("status-text");

  const setStatus = (kind, text) => {
    statusDot.classList.remove("live", "dead");
    if (kind === "live") statusDot.classList.add("live");
    if (kind === "dead") statusDot.classList.add("dead");
    statusText.textContent = text;
  };

  const renderProfile = (p) => {
    if (!p) return;
    $("profile-name").textContent = `${p.name || "—"}`;
    const meta = [p.age ? `${p.age}` : null, p.mode, p.tz].filter(Boolean).join(" · ");
    $("profile-meta").textContent = meta;
  };

  const renderStage = (s) => {
    if (!s) return;
    $("stage-label").textContent = s.label || s.id || "—";
  };

  const renderScore = (score) => {
    if (!score) return;
    SCORE_KEYS.forEach((k) => {
      const li = document.querySelector(`#score-list li[data-key="${k}"]`);
      if (!li) return;
      const v = clamp(Number(score[k] ?? 0), -100, 100);
      // Visualize from center: positive grows right, negative grows left.
      const widthPct = (Math.abs(v) / 100) * 50;
      const fill = li.querySelector(".fill");
      if (v >= 0) {
        fill.style.left = "50%";
        fill.style.right = "auto";
      } else {
        fill.style.left = `${50 - widthPct}%`;
        fill.style.right = "auto";
      }
      fill.style.width = `${widthPct}%`;
      li.querySelector(".val").textContent = v;
    });
  };

  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  const appendLog = (kind, time, text) => {
    const span = document.createElement("span");
    span.className = `line ${kind}`;
    span.innerHTML = `<span class="ts">${escapeHtml(time)}</span><span class="text">${escapeHtml(text)}</span>\n`;
    logEl.appendChild(span);
    while (logEl.childNodes.length > 400) logEl.removeChild(logEl.firstChild);
    logEl.scrollTop = logEl.scrollHeight;
    $("log-count").textContent = `${logEl.querySelectorAll(".line").length} строк`;
  };

  const escapeHtml = (s) =>
    String(s).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));

  const renderSnapshot = (snap) => {
    if (!snap) return;
    renderProfile(snap.profile);
    renderStage(snap.stage);
    renderScore(snap.score);
    setStatus(snap.running ? "live" : "dead", snap.running ? (snap.paused ? "paused" : "running") : "stopped");
    if (Array.isArray(snap.logs)) {
      logEl.innerHTML = "";
      snap.logs.forEach((l) => appendLog(l.kind, l.time, l.text));
    }
  };

  const onEvent = (ev) => {
    if (!ev) return;
    if (ev.profile) renderProfile(ev.profile);
    if (ev.stage) renderStage(ev.stage);
    if (ev.score) renderScore(ev.score);
    const kind = ev.type;
    if (kind === "ready") setStatus("live", "running");
    if (kind === "stopped") setStatus("dead", "stopped");
    const ts = ev.t ? new Date(ev.t).toTimeString().slice(0, 8) : new Date().toTimeString().slice(0, 8);
    const text = formatLogText(ev);
    if (text) appendLog(kind, ts, text);
  };

  const formatLogText = (ev) => {
    const t = ev.text || "";
    switch (ev.type) {
      case "incoming": return `← ${t}`;
      case "outgoing": return `→ ${t}`;
      case "ignored":  return `· ignore (${ev.reason || ""}): ${t}`;
      case "error":    return `! ${t}`;
      case "response": return ev.ok === false ? `? err: ${t}` : `? ${t}`;
      case "info":     return `i ${t}`;
      case "ready":    return "i ready";
      case "stopped":  return "i stopped";
      default:         return t ? `i ${t}` : null;
    }
  };

  // ── Form ────────────────────────────────────────────────────────────────
  $("cmd-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("cmd");
    const line = input.value.trim();
    if (!line) return;
    input.value = "";
    try {
      const resp = await fetch("/api/command", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ line, token: TOKEN }),
      });
      const j = await resp.json();
      if (!j.ok) appendLog("error", new Date().toTimeString().slice(0, 8), `! ${j.error || "command failed"}`);
    } catch (err) {
      appendLog("error", new Date().toTimeString().slice(0, 8), `! ${err.message}`);
    }
  });

  // ── Initial state via REST + live updates via WS ────────────────────────
  const refreshState = async () => {
    try {
      const resp = await fetch(`/api/state?token=${encodeURIComponent(TOKEN)}`);
      if (!resp.ok) {
        setStatus("dead", `http ${resp.status}`);
        return;
      }
      const j = await resp.json();
      renderSnapshot(j);
    } catch (e) {
      setStatus("dead", "offline");
    }
  };

  const connectWs = () => {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${location.host}/ws?token=${encodeURIComponent(TOKEN)}`;
    const ws = new WebSocket(url);
    ws.onopen = () => setStatus("live", "connected");
    ws.onclose = () => {
      setStatus("dead", "reconnect…");
      setTimeout(connectWs, 1500);
    };
    ws.onerror = () => ws.close();
    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (data.type === "snapshot") renderSnapshot(data.data);
        if (data.type === "event") onEvent(data.event);
      } catch (e) {
        console.error("ws parse", e);
      }
    };
  };

  refreshState().then(connectWs);
})();
