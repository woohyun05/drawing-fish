(() => {
  const STORAGE_KEY = "draw-a-fish-tank";
  const NAME_KEY = "draw-a-fish-name";
  const CLIENT_KEY = "draw-a-fish-client";
  const GLOBAL_ROOM = "global";
  const MAX_FISH = 80;

  function getClientId() {
    let id = localStorage.getItem(CLIENT_KEY);
    if (!id) {
      id = "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
      localStorage.setItem(CLIENT_KEY, id);
    }
    return id;
  }

  const clientId = getClientId();

  const drawScreen = document.getElementById("draw-screen");
  const aquariumScreen = document.getElementById("aquarium-screen");
  const drawCanvas = document.getElementById("draw-canvas");
  const drawCtx = drawCanvas.getContext("2d");
  const aquaCanvas = document.getElementById("aquarium-canvas");
  const aquaCtx = aquaCanvas.getContext("2d");
  const colorPicker = document.getElementById("color-picker");
  const brushSize = document.getElementById("brush-size");
  const btnEraser = document.getElementById("btn-eraser");
  const btnClear = document.getElementById("btn-clear");
  const btnDone = document.getElementById("btn-done");
  const btnDrawAgain = document.getElementById("btn-draw-again");
  const btnWatch = document.getElementById("btn-watch");
  const btnShare = document.getElementById("btn-share");
  const btnShareAqua = document.getElementById("btn-share-aqua");
  const fishCountEl = document.getElementById("fish-count");
  const roomLabel = document.getElementById("room-label");
  const bubblesEl = document.querySelector(".bubbles");
  const syncBadge = document.getElementById("sync-badge");
  const artistName = document.getElementById("artist-name");
  const roomInput = document.getElementById("room-input");

  let painting = false;
  let erasing = false;
  let lastX = 0;
  let lastY = 0;
  let hasDrawn = false;
  let fishList = [];
  let animId = null;
  let aquariumRunning = false;
  let db = null;
  let cloudEnabled = false;
  let roomUnsub = null;
  let sharedRecords = [];

  /* ---------- Room / Firebase ---------- */

  function sanitizeRoom(raw) {
    const cleaned = String(raw || GLOBAL_ROOM)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "")
      .slice(0, 24);
    return cleaned || GLOBAL_ROOM;
  }

  function getRoomFromUrl() {
    const params = new URLSearchParams(location.search);
    return sanitizeRoom(params.get("room") || GLOBAL_ROOM);
  }

  function setRoomInUrl(room) {
    const url = new URL(location.href);
    url.searchParams.set("room", room);
    history.replaceState(null, "", url);
  }

  function currentRoom() {
    return sanitizeRoom(roomInput.value || getRoomFromUrl());
  }

  function shareUrl() {
    const url = new URL(location.href);
    url.searchParams.set("room", currentRoom());
    return url.toString();
  }

  function isConfigReady(cfg) {
    if (!cfg || !cfg.apiKey || !cfg.databaseURL) return false;
    return !String(cfg.apiKey).includes("PASTE") && !String(cfg.databaseURL).includes("PASTE");
  }

  function initFirebase() {
    const cfg = window.FIREBASE_CONFIG;
    if (!isConfigReady(cfg) || typeof firebase === "undefined") {
      cloudEnabled = false;
      syncBadge.textContent = "로컬만";
      syncBadge.className = "sync-badge local";
      syncBadge.title = "firebase-config.js에 Firebase 설정을 넣으면 다른 사람과 공유됩니다";
      return;
    }

    try {
      if (!firebase.apps.length) firebase.initializeApp(cfg);
      db = firebase.database();
      cloudEnabled = true;
      syncBadge.textContent = "글로벌 탱크";
      syncBadge.className = "sync-badge online";
      syncBadge.title = "모두가 그린 물고기가 한 수족관에 모입니다";
    } catch (err) {
      console.error(err);
      cloudEnabled = false;
      syncBadge.textContent = "연결 실패";
      syncBadge.className = "sync-badge local";
    }
  }

  function fishRef(room) {
    return db.ref(`rooms/${room}/fish`);
  }

  function stopRoomListen() {
    if (roomUnsub) {
      roomUnsub();
      roomUnsub = null;
    }
  }

  function listenRoom(room) {
    stopRoomListen();
    if (!cloudEnabled) {
      sharedRecords = loadLocal(room).slice(-MAX_FISH);
      if (aquariumRunning) applyFishRecords(sharedRecords);
      return;
    }

    const query = fishRef(room).orderByKey().limitToLast(MAX_FISH);
    const handler = (snap) => {
      const val = snap.val() || {};
      sharedRecords = Object.entries(val)
        .map(([id, data]) => ({ id, ...data }))
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      if (aquariumRunning) applyFishRecords(sharedRecords);
    };
    query.on("value", handler);
    roomUnsub = () => query.off("value", handler);
  }

  /* ---------- Local fallback ---------- */

  function localKey(room) {
    return `${STORAGE_KEY}:${room}`;
  }

  function loadLocal(room) {
    try {
      const raw = localStorage.getItem(localKey(room));
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveLocal(room, list) {
    localStorage.setItem(localKey(room), JSON.stringify(list));
  }

  async function addFishRecord(record) {
    const room = currentRoom();
    if (cloudEnabled) {
      const newRef = fishRef(room).push();
      await newRef.set({
        image: record.image,
        createdAt: record.createdAt,
        artist: record.artist || "익명",
        ownerId: record.ownerId || clientId,
      });
      return newRef.key;
    }
    const list = loadLocal(room);
    list.push(record);
    saveLocal(room, list);
    sharedRecords = list;
    return record.id;
  }

  /* ---------- Drawing ---------- */

  function clearDrawCanvas() {
    drawCtx.fillStyle = "#e8fbf7";
    drawCtx.fillRect(0, 0, drawCanvas.width, drawCanvas.height);
    hasDrawn = false;
  }

  function canvasPos(e) {
    const rect = drawCanvas.getBoundingClientRect();
    const scaleX = drawCanvas.width / rect.width;
    const scaleY = drawCanvas.height / rect.height;
    const src = e.touches ? e.touches[0] : e;
    return {
      x: (src.clientX - rect.left) * scaleX,
      y: (src.clientY - rect.top) * scaleY,
    };
  }

  function startPaint(e) {
    e.preventDefault();
    painting = true;
    const p = canvasPos(e);
    lastX = p.x;
    lastY = p.y;
  }

  function paint(e) {
    if (!painting) return;
    e.preventDefault();
    const p = canvasPos(e);
    drawCtx.lineCap = "round";
    drawCtx.lineJoin = "round";
    drawCtx.lineWidth = Number(brushSize.value);
    drawCtx.strokeStyle = erasing ? "#e8fbf7" : colorPicker.value;
    drawCtx.globalCompositeOperation = "source-over";
    drawCtx.beginPath();
    drawCtx.moveTo(lastX, lastY);
    drawCtx.lineTo(p.x, p.y);
    drawCtx.stroke();
    lastX = p.x;
    lastY = p.y;
    hasDrawn = true;
  }

  function endPaint() {
    painting = false;
  }

  drawCanvas.addEventListener("mousedown", startPaint);
  drawCanvas.addEventListener("mousemove", paint);
  drawCanvas.addEventListener("mouseup", endPaint);
  drawCanvas.addEventListener("mouseleave", endPaint);
  drawCanvas.addEventListener("touchstart", startPaint, { passive: false });
  drawCanvas.addEventListener("touchmove", paint, { passive: false });
  drawCanvas.addEventListener("touchend", endPaint);
  drawCanvas.addEventListener("touchcancel", endPaint);

  btnEraser.addEventListener("click", () => {
    erasing = !erasing;
    btnEraser.classList.toggle("active", erasing);
  });

  btnClear.addEventListener("click", clearDrawCanvas);

  colorPicker.addEventListener("input", () => {
    erasing = false;
    btnEraser.classList.remove("active");
  });

  function trimTransparent(imageData) {
    const { data, width, height } = imageData;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let found = false;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const a = data[(y * width + x) * 4 + 3];
        const r = data[(y * width + x) * 4];
        const g = data[(y * width + x) * 4 + 1];
        const b = data[(y * width + x) * 4 + 2];
        const isBg = a < 10 || (r > 220 && g > 240 && b > 230);
        if (!isBg) {
          found = true;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (!found) return null;

    const pad = 8;
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(width - 1, maxX + pad);
    maxY = Math.min(height - 1, maxY + pad);

    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    const cropped = document.createElement("canvas");
    cropped.width = w;
    cropped.height = h;
    const c = cropped.getContext("2d");
    c.drawImage(drawCanvas, minX, minY, w, h, 0, 0, w, h);

    const cropData = c.getImageData(0, 0, w, h);
    const d = cropData.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 220 && d[i + 1] > 240 && d[i + 2] > 230) {
        d[i + 3] = 0;
      }
    }
    c.putImageData(cropData, 0, 0);

    // shrink for cloud upload size
    const maxSide = 220;
    const scale = Math.min(1, maxSide / Math.max(w, h));
    if (scale < 1) {
      const small = document.createElement("canvas");
      small.width = Math.round(w * scale);
      small.height = Math.round(h * scale);
      small.getContext("2d").drawImage(cropped, 0, 0, small.width, small.height);
      return small.toDataURL("image/png");
    }
    return cropped.toDataURL("image/png");
  }

  function captureFishDrawing() {
    const temp = document.createElement("canvas");
    temp.width = drawCanvas.width;
    temp.height = drawCanvas.height;
    const tctx = temp.getContext("2d");
    tctx.drawImage(drawCanvas, 0, 0);
    const imageData = tctx.getImageData(0, 0, temp.width, temp.height);
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 220 && d[i + 1] > 240 && d[i + 2] > 230) {
        d[i + 3] = 0;
      }
    }
    return trimTransparent(imageData);
  }

  btnDone.addEventListener("click", async () => {
    if (!hasDrawn) {
      alert("물고기를 먼저 그려주세요!");
      return;
    }

    const dataUrl = captureFishDrawing();
    if (!dataUrl) {
      alert("물고기를 먼저 그려주세요!");
      return;
    }

    const name = (artistName.value || "").trim() || "익명";
    localStorage.setItem(NAME_KEY, name);
    setRoomInUrl(currentRoom());
    listenRoom(currentRoom());

    btnDone.disabled = true;
    btnDone.textContent = "올리는 중…";
    try {
      await addFishRecord({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        image: dataUrl,
        createdAt: Date.now(),
        artist: name,
        ownerId: clientId,
      });
      showAquarium();
    } catch (err) {
      console.error(err);
      alert("저장에 실패했어요. Firebase 설정과 규칙을 확인해 주세요.");
    } finally {
      btnDone.disabled = false;
      btnDone.textContent = "수족관에 넣기!";
    }
  });

  /* ---------- Screens ---------- */

  function showDraw() {
    aquariumRunning = false;
    aquariumScreen.classList.remove("active");
    drawScreen.classList.add("active");
    if (animId) {
      cancelAnimationFrame(animId);
      animId = null;
    }
    clearDrawCanvas();
    erasing = false;
    btnEraser.classList.remove("active");
  }

  function showAquarium() {
    drawScreen.classList.remove("active");
    aquariumScreen.classList.add("active");
    setupAquarium();
  }

  btnDrawAgain.addEventListener("click", showDraw);
  btnWatch.addEventListener("click", () => {
    setRoomInUrl(currentRoom());
    listenRoom(currentRoom());
    showAquarium();
  });

  async function copyShareLink() {
    setRoomInUrl(currentRoom());
    const url = shareUrl();
    try {
      await navigator.clipboard.writeText(url);
      alert("링크를 복사했어요!\n친구에게 보내면 같은 글로벌 수족관에서 함께 볼 수 있어요.");
    } catch {
      prompt("이 링크를 복사해서 공유하세요:", url);
    }
  }

  btnShare.addEventListener("click", copyShareLink);
  btnShareAqua.addEventListener("click", copyShareLink);

  /* ---------- Aquarium ---------- */

  function resizeAqua() {
    const wrap = aquaCanvas.parentElement;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    aquaCanvas.width = Math.floor(w * dpr);
    aquaCanvas.height = Math.floor(h * dpr);
    aquaCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h };
  }

  function wireFishImage(fish) {
    fish.img.onload = () => {
      fish.ready = true;
      const maxSide = fish.isMine ? 175 : 140;
      const ratio = fish.img.width / Math.max(fish.img.height, 1);
      if (ratio >= 1) {
        fish.w = maxSide * fish.scale;
        fish.h = fish.w / ratio;
      } else {
        fish.h = maxSide * fish.scale;
        fish.w = fish.h * ratio;
      }
    };
    if (fish.img.complete && fish.img.naturalWidth) fish.img.onload();
  }

  function createFishEntity(data, w, h) {
    const img = new Image();
    img.src = data.image;
    const isMine = Boolean(data.ownerId) && data.ownerId === clientId;
    const scale = (isMine ? 0.48 : 0.35) + Math.random() * 0.35;
    const speed = 0.6 + Math.random() * 1.4;
    const dir = Math.random() > 0.5 ? 1 : -1;
    const fish = {
      id: data.id,
      artist: data.artist || "",
      ownerId: data.ownerId || "",
      isMine,
      img,
      ready: false,
      w: 0,
      h: 0,
      scale,
      x: Math.random() * w,
      y: 40 + Math.random() * Math.max(h - 100, 40),
      vx: speed * dir,
      phase: Math.random() * Math.PI * 2,
      bobAmp: 8 + Math.random() * 14,
      bobSpeed: 0.015 + Math.random() * 0.02,
    };
    wireFishImage(fish);
    return fish;
  }

  function updateCountLabel() {
    const n = fishList.length;
    fishCountEl.textContent =
      n === 0
        ? "아직 물고기가 없어요. 첫 물고기를 그려보세요!"
        : `${n}마리의 물고기가 함께 헤엄치는 중…`;
    roomLabel.textContent = cloudEnabled
      ? "모두가 그린 물고기가 모이는 글로벌 탱크"
      : "지금은 이 기기에서만 보여요 · Firebase 설정이 필요해요";
  }

  function applyFishRecords(records) {
    const wrap = aquaCanvas.parentElement;
    if (!wrap) return;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    const incoming = new Map(records.map((r) => [r.id, r]));

    fishList = fishList.filter((f) => incoming.has(f.id));
    const existing = new Set(fishList.map((f) => f.id));

    for (const rec of records) {
      if (!existing.has(rec.id) && rec.image) {
        fishList.push(createFishEntity(rec, w, h));
      }
    }
    updateCountLabel();
  }

  function setupAquarium() {
    aquariumRunning = true;
    if (animId) cancelAnimationFrame(animId);

    resizeAqua();
    const room = currentRoom();
    roomInput.value = room;
    updateCountLabel();

    if (!cloudEnabled) {
      sharedRecords = loadLocal(room).slice(-MAX_FISH);
    }
    fishList = [];
    applyFishRecords(sharedRecords);
    makeBubbles();
    animId = requestAnimationFrame(tick);
  }

  function makeBubbles() {
    bubblesEl.innerHTML = "";
    for (let i = 0; i < 14; i++) {
      const span = document.createElement("span");
      const size = 6 + Math.random() * 14;
      span.style.width = `${size}px`;
      span.style.height = `${size}px`;
      span.style.left = `${Math.random() * 100}%`;
      span.style.animationDuration = `${6 + Math.random() * 10}s`;
      span.style.animationDelay = `${Math.random() * 8}s`;
      bubblesEl.appendChild(span);
    }
  }

  function drawTankBg(w, h) {
    const g = aquaCtx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#1a8a9a");
    g.addColorStop(0.45, "#0d5a6a");
    g.addColorStop(0.8, "#084850");
    g.addColorStop(1, "#063038");
    aquaCtx.fillStyle = g;
    aquaCtx.fillRect(0, 0, w, h);

    aquaCtx.save();
    aquaCtx.globalAlpha = 0.06;
    for (let i = 0; i < 4; i++) {
      const x = (w / 5) * (i + 0.5) + Math.sin(Date.now() / 4000 + i) * 20;
      aquaCtx.beginPath();
      aquaCtx.moveTo(x, 0);
      aquaCtx.lineTo(x + 80, h);
      aquaCtx.lineTo(x + 140, h);
      aquaCtx.lineTo(x + 40, 0);
      aquaCtx.closePath();
      aquaCtx.fillStyle = "#fff";
      aquaCtx.fill();
    }
    aquaCtx.restore();

    aquaCtx.fillStyle = "#c4a574";
    aquaCtx.beginPath();
    aquaCtx.moveTo(0, h);
    aquaCtx.lineTo(0, h - 28);
    aquaCtx.quadraticCurveTo(w * 0.25, h - 42, w * 0.5, h - 26);
    aquaCtx.quadraticCurveTo(w * 0.75, h - 18, w, h - 34);
    aquaCtx.lineTo(w, h);
    aquaCtx.fill();
  }

  function tick() {
    const wrap = aquaCanvas.parentElement;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;

    drawTankBg(w, h);

    const others = [];
    const mine = [];
    for (const fish of fishList) {
      if (!fish.ready) continue;
      (fish.isMine ? mine : others).push(fish);
    }

    function drawFish(fish) {
      fish.phase += fish.bobSpeed;
      fish.x += fish.vx;
      const bob = Math.sin(fish.phase) * fish.bobAmp;
      const y = fish.y + bob;

      if (fish.vx > 0 && fish.x - fish.w / 2 > w + 20) {
        fish.x = -fish.w / 2 - 10;
        fish.y = 40 + Math.random() * Math.max(h - 100, 40);
      } else if (fish.vx < 0 && fish.x + fish.w / 2 < -20) {
        fish.x = w + fish.w / 2 + 10;
        fish.y = 40 + Math.random() * Math.max(h - 100, 40);
      }

      aquaCtx.save();
      aquaCtx.translate(fish.x, y);
      aquaCtx.rotate(Math.sin(fish.phase * 1.2) * 0.08);
      if (fish.vx < 0) aquaCtx.scale(-1, 1);

      if (fish.isMine) {
        const pulse = 0.55 + 0.45 * Math.sin(fish.phase * 2.4);
        const rw = fish.w * 0.72;
        const rh = fish.h * 0.55;
        const glow = aquaCtx.createRadialGradient(0, 0, Math.min(rw, rh) * 0.15, 0, 0, Math.max(rw, rh));
        glow.addColorStop(0, `rgba(255, 245, 180, ${0.45 * pulse})`);
        glow.addColorStop(0.45, `rgba(120, 230, 255, ${0.22 * pulse})`);
        glow.addColorStop(1, "rgba(120, 230, 255, 0)");
        aquaCtx.fillStyle = glow;
        aquaCtx.beginPath();
        aquaCtx.ellipse(0, 0, rw, rh, 0, 0, Math.PI * 2);
        aquaCtx.fill();

        aquaCtx.shadowColor = `rgba(255, 236, 140, ${0.75 + pulse * 0.25})`;
        aquaCtx.shadowBlur = 22 + pulse * 18;
      } else {
        aquaCtx.globalAlpha = 0.82;
      }

      aquaCtx.drawImage(fish.img, -fish.w / 2, -fish.h / 2, fish.w, fish.h);
      aquaCtx.restore();
    }

    for (const fish of others) drawFish(fish);
    for (const fish of mine) drawFish(fish);

    animId = requestAnimationFrame(tick);
  }

  window.addEventListener("resize", () => {
    if (aquariumScreen.classList.contains("active")) {
      const { w, h } = resizeAqua();
      fishList.forEach((fish) => {
        fish.x = Math.min(Math.max(fish.x, 0), w);
        fish.y = Math.min(Math.max(fish.y, 40), h - 60);
      });
    }
  });

  /* ---------- Init ---------- */
  const savedName = localStorage.getItem(NAME_KEY);
  if (savedName) artistName.value = savedName;

  const startRoom = getRoomFromUrl();
  roomInput.value = startRoom;
  setRoomInUrl(startRoom);

  initFirebase();
  listenRoom(startRoom);
  clearDrawCanvas();
})();
