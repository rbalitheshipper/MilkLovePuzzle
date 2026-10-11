(() => {
  "use strict";

  // ------------------------------------------------------------------
  // EDIT THIS LIST to match the files in your images/ folder (4:3 photos).
  // ------------------------------------------------------------------
  const PICTURES = [
    { name: "Picture 1", src: "images/1.png" },
    { name: "Picture 2", src: "images/2.png" },
    { name: "Picture 3", src: "images/3.png" },
    { name: "Picture 4", src: "images/4.png" },
    { name: "Picture 5", src: "images/5.png" }
  ];

  const $ = (id) => document.getElementById(id);
  const pictureSelect = $("picture");
  const difficultySelect = $("difficulty");
  const board = $("board");
  const piecesLayer = $("pieces");
  const playfield = $("playfield");
  const timerEl = $("timer");
  const movesEl = $("moves");
  const bestEl = $("best");
  const progressEl = $("progress");
  const messageEl = $("message");
  const emptyMessage = $("emptyMessage");
  const intro = $("intro");
  const introImage = $("introImage");
  const startBtn = $("startBtn");
  const winModal = $("winModal");
  const winSummary = $("winSummary");

  // state: loading | idle (intro shown) | running | done
  let state = "loading";
  let img = null, currentSrc = "", currentKey = null, customUrl = null;
  let size = 4, edges = null, pieces = [], geo = null;
  let moves = 0, placed = 0, zTop = 10, token = 0, drag = null;
  let startedAt = 0, elapsedMs = 0, timerId = null;

  const hitCtx = document.createElement("canvas").getContext("2d");
  hitCtx.lineWidth = 8; // forgiving hit area around a piece outline

  // ---------------- helpers ----------------
  const pad2 = (n) => String(n).padStart(2, "0");
  function fmt(ms) {
    const s = Math.floor(ms / 1000);
    return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
  }
  function fmtPrecise(ms) {
    const t = Math.floor(ms / 100) / 10;
    const m = Math.floor(t / 60);
    return `${pad2(m)}:${(t - m * 60).toFixed(1).padStart(4, "0")}`;
  }
  const say = (t) => { messageEl.textContent = t; };
  const total = () => size * size;

  function startTimer() {
    startedAt = performance.now();
    clearInterval(timerId);
    timerId = setInterval(() => { timerEl.textContent = fmt(performance.now() - startedAt); }, 200);
  }
  function clearTimer() { clearInterval(timerId); timerId = null; }

  function resetStats() {
    moves = 0; placed = 0; elapsedMs = 0;
    movesEl.textContent = "0";
    timerEl.textContent = "00:00";
    updateProgress();
  }
  function updateProgress() { progressEl.textContent = `${placed} / ${total()} placed`; }

  const bestKey = () => (currentKey ? `jigsaw-best:${currentKey}:${size}` : null);
  function loadBest() {
    try {
      const k = bestKey();
      const v = k && localStorage.getItem(k);
      return v ? Number(v) : null;
    } catch { return null; }
  }
  function saveBest(ms) {
    try { const k = bestKey(); if (k) localStorage.setItem(k, String(Math.round(ms))); } catch { }
  }
  function showBest() {
    const b = loadBest();
    bestEl.textContent = b ? fmt(b) : "--:--";
  }

  // ---------------- picture loading ----------------
  function selected() {
    if (pictureSelect.value === "__custom" && customUrl) return { src: customUrl, key: null };
    const pic = PICTURES[Number(pictureSelect.value)] || PICTURES[0];
    return { src: pic.src, key: pic.src };
  }

  function loadPicture({ src, key }) {
    const t = ++token;
    state = "loading";
    clearTimer();
    drag = null;
    pieces = [];
    piecesLayer.innerHTML = "";
    winModal.hidden = true;
    intro.hidden = true;
    emptyMessage.hidden = false;
    emptyMessage.textContent = "Loading picture…";

    const im = new Image(); // no crossOrigin: it breaks local file:// loading
    im.onload = () => {
      if (t !== token) return;
      img = im; currentSrc = src; currentKey = key;
      showIntro();
    };
    im.onerror = () => {
      if (t !== token) return;
      emptyMessage.hidden = false;
      emptyMessage.textContent = `Could not load "${src}". Check the PICTURES list in game.js.`;
      say("Picture failed to load.");
    };
    im.src = src;
  }

  // Original picture is shown here once, before the timer starts.
  function showIntro() {
    state = "idle";
    size = Number(difficultySelect.value);
    resetStats();
    showBest();
    emptyMessage.hidden = true;
    introImage.src = currentSrc;
    intro.hidden = false;
    computeGeometry();
    say("Study the picture, then press Start.");
  }

  // ---------------- geometry ----------------
  function computeGeometry() {
    const W = playfield.clientWidth, H = playfield.clientHeight;
    const maxW = Math.min(W * (W < 600 ? 0.8 : 0.58), H * 0.62 * 4 / 3, 680);
    // Integer piece sizes in an exact 4:3 ratio, so pieces tile with no seams.
    const w = Math.max(8, Math.floor(maxW / size / 4) * 4);
    const h = (w * 3) / 4;
    const bw = w * size, bh = h * size;
    const u = Math.min(w, h);
    geo = {
      W, H, w, h, bw, bh, u,
      pad: Math.ceil(u * 0.34),
      bx: Math.round((W - bw) / 2),
      by: Math.round((H - bh) / 2)
    };
    board.style.left = `${geo.bx}px`;
    board.style.top = `${geo.by}px`;
    board.style.width = `${bw}px`;
    board.style.height = `${bh}px`;
    board.style.setProperty("--rows", size);
    board.style.setProperty("--cols", size);
  }

  // ---------------- jigsaw cutting ----------------
  // One shared sign per internal edge: +1 tab on one piece, -1 blank on its neighbour.
  function makeEdges() {
    const mk = () => ({
      sign: Math.random() < 0.5 ? 1 : -1,        // +1 tab, -1 blank (for the piece before the edge)
      off: (Math.random() - 0.5) * 0.16,          // knob shifted along the edge
      k: 0.9 + Math.random() * 0.2                // knob size
    });
    // vertical[r][c]   = edge between piece (r,c) and (r,c+1)
    // horizontal[r][c] = edge between piece (r,c) and (r+1,c)
    const vertical = Array.from({ length: size }, () => Array.from({ length: size - 1 }, mk));
    const horizontal = Array.from({ length: size - 1 }, () => Array.from({ length: size }, mk));
    const side = (e, flip) => ({ sign: flip ? -e.sign : e.sign, off: e.off, k: e.k });
    return Array.from({ length: size }, (_, r) =>
      Array.from({ length: size }, (_, c) => ({
        top: r === 0 ? null : side(horizontal[r - 1][c], true),
        right: c === size - 1 ? null : side(vertical[r][c], false),
        bottom: r === size - 1 ? null : side(horizontal[r][c], false),
        left: c === 0 ? null : side(vertical[r][c - 1], true)
      })));
  }

  // Knob profile in units of u (= shorter piece side), centred on the edge.
  // [along, outward]. It is mirror-symmetric, so the tab on one piece and the
  // blank on its neighbour trace exactly the same curve.
  function addEdge(path, xa, ya, xb, yb, e, nx, ny, u) {
    if (!e) { path.lineTo(xb, yb); return; }
    const { sign, off, k } = e;
    const L = Math.hypot(xb - xa, yb - ya);
    const tx = (xb - xa) / L, ty = (yb - ya) / L;
    // Shift is along the global +x/+y axis, so both neighbours place the knob identically.
    const sh = (tx + ty) * off * u;
    const cx = (xa + xb) / 2 + tx * sh, cy = (ya + yb) / 2 + ty * sh;
    const pt = (a, o) => [cx + tx * a * k * u + nx * sign * o * k * u,
    cy + ty * a * k * u + ny * sign * o * k * u];
    const line = (a, o) => { const q = pt(a, o); path.lineTo(q[0], q[1]); };
    const curve = (c1, c2, e) => {
      const A = pt(...c1), B = pt(...c2), C = pt(...e);
      path.bezierCurveTo(A[0], A[1], B[0], B[1], C[0], C[1]);
    };
    line(-0.14, 0);
    curve([-0.11, 0], [-0.075, 0.04], [-0.075, 0.09]);   // into the neck
    curve([-0.075, 0.13], [-0.165, 0.13], [-0.165, 0.2]); // flare to widest point
    curve([-0.165, 0.27], [-0.09, 0.3], [0, 0.3]);        // round the top
    curve([0.09, 0.3], [0.165, 0.27], [0.165, 0.2]);
    curve([0.165, 0.13], [0.075, 0.13], [0.075, 0.09]);
    curve([0.075, 0.04], [0.11, 0], [0.14, 0]);           // back out of the neck
    path.lineTo(xb, yb);
  }

  function buildPath(w, h, pad, e, u) {
    const x0 = pad, y0 = pad, x1 = pad + w, y1 = pad + h;
    const p = new Path2D();
    p.moveTo(x0, y0);
    addEdge(p, x0, y0, x1, y0, e.top, 0, -1, u);
    addEdge(p, x1, y0, x1, y1, e.right, 1, 0, u);
    addEdge(p, x1, y1, x0, y1, e.bottom, 0, 1, u);
    addEdge(p, x0, y1, x0, y0, e.left, -1, 0, u);
    p.closePath();
    return p;
  }

  let boardSrc = null;
  function makeBoardSource() {
    const { bw, bh } = geo;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cv = document.createElement("canvas");
    cv.width = Math.round(bw * dpr);
    cv.height = Math.round(bh * dpr);
    // Centre-crop the source to 4:3 in case a photo isn't exactly that ratio.
    const iw = img.naturalWidth, ih = img.naturalHeight, ar = iw / ih;
    let sx = 0, sy = 0, sw = iw, sh = ih;
    if (ar > 4 / 3) { sw = ih * 4 / 3; sx = (iw - sw) / 2; }
    else if (ar < 4 / 3) { sh = iw * 3 / 4; sy = (ih - sh) / 2; }
    cv.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
    return cv;
  }

  function makePiece(r, c) {
    const { w, h, u, pad, bw, bh, bx, by } = geo;
    const cw = w + pad * 2, ch = h + pad * 2;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
    canvas.className = "piece";
    const ctx = canvas.getContext("2d");
    ctx.scale(canvas.width / cw, canvas.height / ch);

    const path = buildPath(w, h, pad, edges[r][c], u);

    // Pattern = the whole picture at board scale, offset so this piece shows its own area.
    const pat = ctx.createPattern(boardSrc, "no-repeat");
    pat.setTransform(new DOMMatrix()
      .translate(pad - c * w, pad - r * h)
      .scale(bw / boardSrc.width, bh / boardSrc.height));
    ctx.fillStyle = pat;
    ctx.fill(path);
    // Stroking with the same pattern bleeds the piece ~0.8px outward, so locked
    // neighbours overlap slightly and no hairline gaps show between them.
    ctx.strokeStyle = pat;
    ctx.lineWidth = 1.6;
    ctx.lineJoin = "round";
    ctx.stroke(path);

    ctx.save();
    ctx.clip(path);
    const shade = ctx.createLinearGradient(0, pad, 0, pad + h);
    shade.addColorStop(0, "rgba(255,255,255,.06)");
    shade.addColorStop(1, "rgba(0,0,0,.09)");
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, cw, ch);
    ctx.restore();

    ctx.strokeStyle = "rgba(255,255,255,.3)";
    ctx.lineWidth = 1;
    ctx.stroke(path);

    return {
      el: canvas, path, r, c, cw, ch,
      tx: bx + c * w - pad, ty: by + r * h - pad, // canvas position when solved
      x: 0, y: 0, z: 0, locked: false
    };
  }

  // ---------------- placing pieces ----------------
  function setPos(p, x, y) {
    p.x = x; p.y = y;
    p.el.style.left = `${x}px`;
    p.el.style.top = `${y}px`;
  }
  function setZ(p, z) { p.z = z; p.el.style.zIndex = String(z); }

  function clampX(x) { return Math.max(-geo.pad, Math.min(geo.W - geo.w - geo.pad, x)); }
  function clampY(y) { return Math.max(-geo.pad, Math.min(geo.H - geo.h - geo.pad, y)); }

  function scatterOne(p) {
    const { W, H, w, h, pad, bx, by, bw, bh } = geo;
    let x = 0, y = 0;
    for (let i = 0; i < 80; i++) {
      x = -pad + Math.random() * (W - w);
      y = -pad + Math.random() * (H - h);
      const vx = x + pad, vy = y + pad;
      const overlapsBoard = vx < bx + bw - w * 0.25 && vx + w > bx + w * 0.25 &&
        vy < by + bh - h * 0.25 && vy + h > by + h * 0.25;
      if (!overlapsBoard) break;
    }
    setPos(p, clampX(x), clampY(y));
    setZ(p, ++zTop);
  }

  function lockPiece(p) {
    setPos(p, p.tx, p.ty);
    p.locked = true;
    p.el.classList.add("locked");
    setZ(p, 5);
  }

  function buildPieces(saved) {
    piecesLayer.innerHTML = "";
    pieces = [];
    zTop = 10;
    boardSrc = makeBoardSource();
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const p = makePiece(r, c);
        const s = saved && saved[pieces.length];
        if (s && s.locked) lockPiece(p);
        else if (s) { setPos(p, clampX(s.nx * geo.W), clampY(s.ny * geo.H)); setZ(p, s.z); zTop = Math.max(zTop, s.z); }
        else scatterOne(p);
        pieces.push(p);
        piecesLayer.appendChild(p.el);
      }
    }
  }

  // ---------------- game flow ----------------
  function startGame() {
    if (state !== "idle") return;
    intro.hidden = true;
    size = Number(difficultySelect.value);
    edges = makeEdges();
    resetStats();
    computeGeometry();
    buildPieces(null);
    state = "running";
    startTimer();
    say("Timer running. Drag pieces onto the grid.");
  }

  function finishGame() {
    state = "done";
    elapsedMs = performance.now() - startedAt;
    clearTimer();
    timerEl.textContent = fmt(elapsedMs);
    const prev = loadBest();
    let line = `You solved ${total()} pieces in ${fmtPrecise(elapsedMs)} with ${moves} moves.`;
    if (currentKey && (!prev || elapsedMs < prev)) { saveBest(elapsedMs); line += " New best time!"; }
    else if (prev) line += ` Best: ${fmt(prev)}.`;
    showBest();
    winSummary.textContent = line;
    say("Picture complete. Nicely done!");
    winModal.hidden = false;
  }

  function trySnap(p) {
    const dist = Math.hypot(p.x - p.tx, p.y - p.ty);
    if (dist <= Math.max(14, Math.min(geo.w, geo.h) * 0.3)) {
      lockPiece(p);
      placed++;
      updateProgress();
      if (placed === total()) finishGame();
      else say("Good fit. Keep going.");
    } else {
      say("Not quite. Try another spot.");
    }
  }

  // ---------------- pointer handling ----------------
  // Pieces are canvases with transparent padding, so hit-test the real outline.
  function pickPiece(px, py) {
    const loose = pieces.filter((p) => !p.locked).sort((a, b) => b.z - a.z);
    for (const p of loose) {
      const lx = px - p.x, ly = py - p.y;
      if (lx < 0 || ly < 0 || lx > p.cw || ly > p.ch) continue;
      if (hitCtx.isPointInPath(p.path, lx, ly) || hitCtx.isPointInStroke(p.path, lx, ly)) return p;
    }
    return null;
  }

  playfield.addEventListener("pointerdown", (e) => {
    if (state !== "running" || e.button > 0 || drag) return;
    const rect = playfield.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    const p = pickPiece(px, py);
    if (!p) return;
    e.preventDefault();
    drag = { p, id: e.pointerId, ox: px - p.x, oy: py - p.y, sx: px, sy: py, moved: false };
    setZ(p, ++zTop);
    p.el.classList.add("dragging");
    playfield.setPointerCapture(e.pointerId);
  });

  playfield.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const rect = playfield.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    if (Math.abs(px - drag.sx) + Math.abs(py - drag.sy) > 3) drag.moved = true;
    setPos(drag.p, clampX(px - drag.ox), clampY(py - drag.oy));
  });

  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const { p, moved } = drag;
    drag = null;
    p.el.classList.remove("dragging");
    if (moved) {
      moves++;
      movesEl.textContent = String(moves);
      trySnap(p);
    }
  }
  playfield.addEventListener("pointerup", endDrag);
  playfield.addEventListener("pointercancel", endDrag);

  // ---------------- controls ----------------
  function reload() { loadPicture(selected()); }

  function reshuffle() {
    if (state !== "running") return;
    pieces.forEach((p) => { if (!p.locked) scatterOne(p); });
    say("Loose pieces scattered again.");
  }

  startBtn.addEventListener("click", startGame);
  $("newGame").addEventListener("click", reload);
  $("playAgain").addEventListener("click", reload);
  $("shuffle").addEventListener("click", reshuffle);
  difficultySelect.addEventListener("change", reload);
  pictureSelect.addEventListener("change", reload);

  $("upload").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { say("Please choose an image file."); return; }
    if (customUrl) URL.revokeObjectURL(customUrl);
    customUrl = URL.createObjectURL(file);
    if (!pictureSelect.querySelector('option[value="__custom"]')) {
      const o = document.createElement("option");
      o.value = "__custom";
      o.textContent = "Your photo";
      pictureSelect.appendChild(o);
    }
    pictureSelect.value = "__custom";
    reload();
    e.target.value = "";
  });

  // Keep an in-progress puzzle intact when the window resizes.
  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!geo || state === "loading" || drag) return;
      if (playfield.clientWidth === geo.W && playfield.clientHeight === geo.H) return;
      const saved = pieces.map((p) => ({ locked: p.locked, nx: p.x / geo.W, ny: p.y / geo.H, z: p.z }));
      computeGeometry();
      if (state === "running" || state === "done") buildPieces(saved);
    }, 150);
  });

  // ---------------- init ----------------
  PICTURES.forEach((pic, i) => {
    const o = document.createElement("option");
    o.value = String(i);
    o.textContent = pic.name;
    pictureSelect.appendChild(o);
  });
  reload();
})();
