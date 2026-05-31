/*
 * OCC Oscilloscope — Optical Camera Communications web demonstrator
 * Copyright (C) 2026  Dr. Vicente Matus, PhD
 * IDeTIC, University of Las Palmas de Gran Canaria
 * https://github.com/inventor-loco   https://idetic.ulpgc.es/
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------- elements
  const video        = $('video');
  const overlay      = $('overlay');
  const scope        = $('scope');
  const videoWrap    = $('videoWrap');
  const scopeWrap    = $('scopeWrap');
  const cameraSelect = $('cameraSelect');
  const camInfo      = $('camInfo');
  const scopeInfo    = $('scopeInfo');

  const startBtn   = $('startBtn');
  const freezeBtn  = $('freezeBtn');
  const clearBtn   = $('clearBtn');
  const csvBtn     = $('csvBtn');
  const helpBtn    = $('helpBtn');
  const helpDialog = $('helpDialog');

  const manualExposure  = $('manualExposure');
  const exposureSupport = $('exposureSupport');
  const exposureSlider  = $('exposureSlider');
  const exposureVal     = $('exposureVal');
  const isoSlider       = $('isoSlider');
  const isoVal          = $('isoVal');

  const globalCtrls  = $('globalCtrls');
  const rollingCtrls = $('rollingCtrls');

  // ----------------------------------------------------------------- canvases
  const octx = overlay.getContext('2d');
  const sctx = scope.getContext('2d');
  // off-screen processing canvas (native video resolution)
  const proc  = document.createElement('canvas');
  const pctx  = proc.getContext('2d', { willReadFrequently: true });

  // --------------------------------------------------------------------- state
  const S = {
    stream: null,
    track: null,
    caps: null,            // MediaStreamTrack capabilities
    W: 0, H: 0,            // native video resolution
    mode: 'global',        // 'global' | 'rolling'
    frozen: false,
    scanAxis: 'y',         // rolling: 'y' (vertical) | 'x' (horizontal)
    useRoi: false,
    // global-shutter time buffers
    buf: { r: [], g: [], b: [] },
    // rolling-shutter latest spatial profile
    profile: { r: [], g: [], b: [], axis: 'y' },
    // fps
    lastT: performance.now(),
    fps: 0,
  };

  // controls cache (percent 0..100 unless noted)
  const C = {
    poiX: $('poiX'), poiY: $('poiY'), poiR: $('poiR'), timeWindow: $('timeWindow'),
    linePos: $('linePos'),
    roiX1: $('roiX1'), roiY1: $('roiY1'), roiX2: $('roiX2'), roiY2: $('roiY2'),
  };

  const COL = { r: '#ff5b5b', g: '#46d369', b: '#5b8bff', grid: '#1a2238', axis: '#46557a' };
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  // ============================================================ CAMERA HANDLING
  async function listCameras(keepId) {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter((d) => d.kind === 'videoinput');
      const prev = keepId || cameraSelect.value;
      cameraSelect.innerHTML = '';
      cams.forEach((d, i) => {
        const opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.textContent = d.label || `Camera ${i + 1}`;
        cameraSelect.appendChild(opt);
      });
      if (prev && cams.some((c) => c.deviceId === prev)) cameraSelect.value = prev;
      if (!cams.length) {
        const opt = document.createElement('option');
        opt.textContent = 'No camera found';
        cameraSelect.appendChild(opt);
      }
    } catch (err) {
      console.warn('enumerateDevices failed', err);
    }
  }

  async function startCamera(deviceId, { silent = false } = {}) {
    stopStream();
    const video_constraints = {
      width:  { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 60 },     // high FPS helps OCC sampling
    };
    if (deviceId) video_constraints.deviceId = { exact: deviceId };
    else video_constraints.facingMode = { ideal: 'environment' };

    try {
      camInfo.textContent = 'requesting…';
      const stream = await navigator.mediaDevices.getUserMedia({ video: video_constraints, audio: false });
      S.stream = stream;
      S.track = stream.getVideoTracks()[0];
      video.srcObject = stream;
      await video.play().catch(() => {});

      // refresh labelled device list now that we have permission
      await listCameras(S.track.getSettings().deviceId);

      setupTrackCapabilities();
      const st = S.track.getSettings();
      camInfo.textContent = `${st.width || '?'}×${st.height || '?'}`;
    } catch (err) {
      console.warn('getUserMedia failed', err);
      camInfo.textContent = silent ? 'press Start' : 'camera blocked';
      if (!silent) {
        alert('Could not access the camera:\n' + err.message +
          '\n\nA camera and a secure context (https:// or localhost) are required.');
      }
    }
  }

  function stopStream() {
    if (S.stream) S.stream.getTracks().forEach((t) => t.stop());
    S.stream = S.track = S.caps = null;
  }

  // --------------------------------------------------- exposure / ISO controls
  function setupTrackCapabilities() {
    const caps = (S.track && S.track.getCapabilities) ? S.track.getCapabilities() : {};
    S.caps = caps;
    const settings = S.track.getSettings ? S.track.getSettings() : {};

    const hasExp = !!caps.exposureTime;
    const hasManual = Array.isArray(caps.exposureMode) && caps.exposureMode.includes('manual');
    const hasIso = !!caps.iso;

    if (hasExp || hasManual || hasIso) {
      exposureSupport.textContent = 'supported';
    } else {
      exposureSupport.textContent = 'not supported by this camera/browser';
    }
    manualExposure.disabled = !hasManual && !hasExp;

    if (hasExp) {
      exposureSlider.min = caps.exposureTime.min;
      exposureSlider.max = caps.exposureTime.max;
      exposureSlider.step = caps.exposureTime.step || 1;
      exposureSlider.value = settings.exposureTime ?? caps.exposureTime.min;
      exposureVal.textContent = fmtExposure(exposureSlider.value);
    } else {
      exposureVal.textContent = 'n/a';
    }
    if (hasIso) {
      isoSlider.min = caps.iso.min;
      isoSlider.max = caps.iso.max;
      isoSlider.step = caps.iso.step || 1;
      isoSlider.value = settings.iso ?? caps.iso.min;
      isoVal.textContent = Math.round(isoSlider.value);
    } else {
      isoVal.textContent = 'n/a';
    }
    syncExposureEnabled();
  }

  // exposureTime is expressed in 100µs units by the spec
  const fmtExposure = (v) => `${Math.round(v)} (${(v * 0.1).toFixed(1)} ms)`;

  function syncExposureEnabled() {
    const on = manualExposure.checked;
    const hasExp = !!(S.caps && S.caps.exposureTime);
    const hasIso = !!(S.caps && S.caps.iso);
    exposureSlider.disabled = !on || !hasExp;
    isoSlider.disabled = !on || !hasIso;
  }

  async function applyExposureMode() {
    if (!S.track) return;
    syncExposureEnabled();
    const mode = manualExposure.checked ? 'manual' : 'continuous';
    try {
      await S.track.applyConstraints({ advanced: [{ exposureMode: mode }] });
      if (manualExposure.checked) { await applyExposureTime(); await applyIso(); }
    } catch (err) { console.warn('exposureMode', err); }
  }

  async function applyExposureTime() {
    if (!S.track || !manualExposure.checked || !(S.caps && S.caps.exposureTime)) return;
    const v = Number(exposureSlider.value);
    exposureVal.textContent = fmtExposure(v);
    try { await S.track.applyConstraints({ advanced: [{ exposureMode: 'manual', exposureTime: v }] }); }
    catch (err) { console.warn('exposureTime', err); }
  }

  async function applyIso() {
    if (!S.track || !manualExposure.checked || !(S.caps && S.caps.iso)) return;
    const v = Number(isoSlider.value);
    isoVal.textContent = Math.round(v);
    try { await S.track.applyConstraints({ advanced: [{ exposureMode: 'manual', iso: v }] }); }
    catch (err) { console.warn('iso', err); }
  }

  // ================================================================ PROCESSING
  function ensureProcSize() {
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return false;
    if (w !== S.W || h !== S.H) {
      S.W = proc.width = w;
      S.H = proc.height = h;
      // radius cap depends on frame size
      C.poiR.max = Math.round(Math.min(w, h) / 2);
    }
    return true;
  }

  // map percent slider -> integer pixel coordinate
  const px = (pct, max) => clamp(Math.round((pct / 100) * (max - 1)), 0, max - 1);

  function sampleGlobal() {
    const { W, H } = S;
    const cx = px(+C.poiX.value, W);
    const cy = px(+C.poiY.value, H);
    const r  = clamp(parseInt(C.poiR.value, 10) || 0, 0, Math.min(W, H));

    const x0 = clamp(cx - r, 0, W - 1);
    const y0 = clamp(cy - r, 0, H - 1);
    const rw = clamp(cx + r, 0, W - 1) - x0 + 1;
    const rh = clamp(cy + r, 0, H - 1) - y0 + 1;

    const img = pctx.getImageData(x0, y0, rw, rh).data;
    let sr = 0, sg = 0, sb = 0, n = 0;
    const r2 = r * r;
    for (let yy = 0; yy < rh; yy++) {
      for (let xx = 0; xx < rw; xx++) {
        const dx = (x0 + xx) - cx, dy = (y0 + yy) - cy;
        if (r === 0 || dx * dx + dy * dy <= r2) {
          const i = (yy * rw + xx) * 4;
          sr += img[i]; sg += img[i + 1]; sb += img[i + 2]; n++;
        }
      }
    }
    if (!n) n = 1;
    pushSample(S.buf, sr / n, sg / n, sb / n);
  }

  function pushSample(buf, r, g, b) {
    const win = parseInt(C.timeWindow.value, 10);
    buf.r.push(r); buf.g.push(g); buf.b.push(b);
    while (buf.r.length > win) { buf.r.shift(); buf.g.shift(); buf.b.shift(); }
  }

  function sampleRolling() {
    const { W, H } = S;
    const pr = [], pg = [], pb = [];

    if (!S.useRoi) {
      // ---- single scan line along the scanning direction ----
      if (S.scanAxis === 'y') {
        const x = px(+C.linePos.value, W);          // vertical line -> X position
        const data = pctx.getImageData(x, 0, 1, H).data;
        for (let y = 0; y < H; y++) {
          const i = y * 4; pr.push(data[i]); pg.push(data[i + 1]); pb.push(data[i + 2]);
        }
      } else {
        const y = px(+C.linePos.value, H);          // horizontal line -> Y position
        const data = pctx.getImageData(0, y, W, 1).data;
        for (let x = 0; x < W; x++) {
          const i = x * 4; pr.push(data[i]); pg.push(data[i + 1]); pb.push(data[i + 2]);
        }
      }
      S.profile = { r: pr, g: pg, b: pb, axis: S.scanAxis };
      return;
    }

    // ---- rectangular ROI: average a band across the perpendicular axis ----
    let x1 = px(+C.roiX1.value, W), x2 = px(+C.roiX2.value, W);
    let y1 = px(+C.roiY1.value, H), y2 = px(+C.roiY2.value, H);
    if (x2 < x1) [x1, x2] = [x2, x1];
    if (y2 < y1) [y1, y2] = [y2, y1];
    const rw = x2 - x1 + 1, rh = y2 - y1 + 1;
    const data = pctx.getImageData(x1, y1, rw, rh).data;

    if (S.scanAxis === 'y') {
      // signal runs along Y: average each row across the X extent
      for (let yy = 0; yy < rh; yy++) {
        let sr = 0, sg = 0, sb = 0;
        for (let xx = 0; xx < rw; xx++) {
          const i = (yy * rw + xx) * 4;
          sr += data[i]; sg += data[i + 1]; sb += data[i + 2];
        }
        pr.push(sr / rw); pg.push(sg / rw); pb.push(sb / rw);
      }
    } else {
      // signal runs along X: average each column across the Y extent
      for (let xx = 0; xx < rw; xx++) {
        let sr = 0, sg = 0, sb = 0;
        for (let yy = 0; yy < rh; yy++) {
          const i = (yy * rw + xx) * 4;
          sr += data[i]; sg += data[i + 1]; sb += data[i + 2];
        }
        pr.push(sr / rh); pg.push(sg / rh); pb.push(sb / rh);
      }
    }
    S.profile = { r: pr, g: pg, b: pb, axis: S.scanAxis };
  }

  // =================================================================== OVERLAY
  // line up the overlay canvas with the *rendered* video rectangle
  function syncOverlay() {
    const vr = video.getBoundingClientRect();
    const wr = videoWrap.getBoundingClientRect();
    if (!vr.width || !vr.height) return null;
    const dpr = window.devicePixelRatio || 1;
    overlay.style.left   = (vr.left - wr.left) + 'px';
    overlay.style.top    = (vr.top - wr.top) + 'px';
    overlay.style.width  = vr.width + 'px';
    overlay.style.height = vr.height + 'px';
    const iw = Math.round(vr.width * dpr), ih = Math.round(vr.height * dpr);
    if (overlay.width !== iw || overlay.height !== ih) { overlay.width = iw; overlay.height = ih; }
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w: vr.width, h: vr.height, sx: vr.width / S.W, sy: vr.height / S.H };
  }

  function drawOverlay() {
    const g = syncOverlay();
    if (!g) return;
    octx.clearRect(0, 0, g.w, g.h);
    octx.lineWidth = 1.5;

    if (S.mode === 'global') {
      const cx = px(+C.poiX.value, S.W) * g.sx;
      const cy = px(+C.poiY.value, S.H) * g.sy;
      const r  = (parseInt(C.poiR.value, 10) || 0) * g.sx;
      octx.strokeStyle = '#38bdf8';
      octx.fillStyle = 'rgba(56,189,248,.15)';
      if (r > 0) { octx.beginPath(); octx.arc(cx, cy, r, 0, Math.PI * 2); octx.fill(); octx.stroke(); }
      // crosshair
      octx.beginPath();
      octx.moveTo(cx - 10, cy); octx.lineTo(cx + 10, cy);
      octx.moveTo(cx, cy - 10); octx.lineTo(cx, cy + 10);
      octx.stroke();
    } else if (!S.useRoi) {
      // single scan line spanning the whole frame along the scanning direction
      octx.strokeStyle = '#38bdf8';
      if (S.scanAxis === 'y') {
        const x = px(+C.linePos.value, S.W) * g.sx;
        octx.beginPath(); octx.moveTo(x, 0); octx.lineTo(x, g.h); octx.stroke();
        octx.strokeStyle = '#ffd166'; octx.fillStyle = '#ffd166';
        drawArrow(octx, x, 6, x, g.h - 6);
      } else {
        const y = px(+C.linePos.value, S.H) * g.sy;
        octx.beginPath(); octx.moveTo(0, y); octx.lineTo(g.w, y); octx.stroke();
        octx.strokeStyle = '#ffd166'; octx.fillStyle = '#ffd166';
        drawArrow(octx, 6, y, g.w - 6, y);
      }
    } else {
      let x1 = px(+C.roiX1.value, S.W) * g.sx, x2 = px(+C.roiX2.value, S.W) * g.sx;
      let y1 = px(+C.roiY1.value, S.H) * g.sy, y2 = px(+C.roiY2.value, S.H) * g.sy;
      if (x2 < x1) [x1, x2] = [x2, x1];
      if (y2 < y1) [y1, y2] = [y2, y1];
      octx.strokeStyle = '#38bdf8';
      octx.fillStyle = 'rgba(56,189,248,.08)';
      octx.fillRect(x1, y1, x2 - x1, y2 - y1);
      octx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      // scan-direction arrow
      octx.strokeStyle = '#ffd166';
      octx.fillStyle = '#ffd166';
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      if (S.scanAxis === 'y') drawArrow(octx, mx, y1 + 6, mx, y2 - 6);
      else drawArrow(octx, x1 + 6, my, x2 - 6, my);
    }
  }

  function drawArrow(ctx, x1, y1, x2, y2) {
    const a = Math.atan2(y2 - y1, x2 - x1), h = 7;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    for (const [ex, ey, dir] of [[x2, y2, a], [x1, y1, a + Math.PI]]) {
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - h * Math.cos(dir - 0.4), ey - h * Math.sin(dir - 0.4));
      ctx.lineTo(ex - h * Math.cos(dir + 0.4), ey - h * Math.sin(dir + 0.4));
      ctx.closePath(); ctx.fill();
    }
  }

  // ==================================================================== SCOPE
  let scopeDpr = 1;
  function setupScopeCanvas() {
    const ro = new ResizeObserver(() => resizeScope());
    ro.observe(scopeWrap);
    resizeScope();
  }
  function resizeScope() {
    const dpr = window.devicePixelRatio || 1;
    scopeDpr = dpr;
    const w = scopeWrap.clientWidth, h = scopeWrap.clientHeight;
    scope.width = Math.max(1, Math.round(w * dpr));
    scope.height = Math.max(1, Math.round(h * dpr));
  }

  function drawScope() {
    const dpr = scopeDpr;
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = scope.width / dpr, H = scope.height / dpr;
    const m = { l: 34, r: 8, t: 8, b: 18 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;

    sctx.clearRect(0, 0, W, H);
    sctx.fillStyle = '#05070d';
    sctx.fillRect(0, 0, W, H);

    const valToY = (v) => m.t + ph - (clamp(v, 0, 255) / 255) * ph;

    // grid + y labels (intensity)
    sctx.lineWidth = 1;
    sctx.font = '10px system-ui'; sctx.textBaseline = 'middle';
    for (const v of [0, 64, 128, 192, 255]) {
      const y = valToY(v);
      sctx.strokeStyle = COL.grid;
      sctx.beginPath(); sctx.moveTo(m.l, y); sctx.lineTo(m.l + pw, y); sctx.stroke();
      sctx.fillStyle = '#6b7aa3';
      sctx.fillText(String(v), 6, y + 3);
    }
    // vertical grid divisions
    for (let i = 0; i <= 10; i++) {
      const x = m.l + (i / 10) * pw;
      sctx.strokeStyle = COL.grid;
      sctx.beginPath(); sctx.moveTo(x, m.t); sctx.lineTo(x, m.t + ph); sctx.stroke();
    }
    // axes
    sctx.strokeStyle = COL.axis; sctx.lineWidth = 1.2;
    sctx.strokeRect(m.l, m.t, pw, ph);

    const series = S.mode === 'global' ? S.buf : S.profile;
    const n = series.r.length;

    // x-axis label
    sctx.fillStyle = '#6b7aa3'; sctx.font = '10px system-ui';
    const xlabel = S.mode === 'global'
      ? 'time → (frames)'
      : `position → (${(S.profile.axis || S.scanAxis).toUpperCase()} px)`;
    sctx.fillText(xlabel, m.l + 2, H - 5);

    if (n >= 1) {
      const denom = S.mode === 'global'
        ? Math.max(parseInt(C.timeWindow.value, 10) - 1, 1)
        : Math.max(n - 1, 1);
      const xAt = (i) => m.l + (i / denom) * pw;
      const trace = (arr, color) => {
        sctx.strokeStyle = color; sctx.fillStyle = color; sctx.lineWidth = 1.6;
        if (n >= 2) {
          sctx.beginPath();
          for (let i = 0; i < n; i++) {
            const x = xAt(i), y = valToY(arr[i]);
            i ? sctx.lineTo(x, y) : sctx.moveTo(x, y);
          }
          sctx.stroke();
        }
        // marker at the latest sample (the only visible point for tiny windows)
        sctx.beginPath();
        sctx.arc(xAt(n - 1), valToY(arr[n - 1]), 2.4, 0, Math.PI * 2);
        sctx.fill();
      };
      trace(series.b, COL.b);
      trace(series.g, COL.g);
      trace(series.r, COL.r);
    }

    // readout badge
    if (S.mode === 'global' && n) {
      const last = (a) => Math.round(a[a.length - 1]);
      scopeInfo.textContent = `R${last(S.buf.r)} G${last(S.buf.g)} B${last(S.buf.b)} · ${S.fps}fps`;
    } else if (S.mode === 'rolling') {
      scopeInfo.textContent = `N=${n} · ${S.fps}fps`;
    }
  }

  // ============================================================== ANIMATION LOOP
  function loop(t) {
    // fps
    const dt = t - S.lastT; S.lastT = t;
    if (dt > 0) S.fps = Math.round(0.9 * S.fps + 0.1 * (1000 / dt));

    if (!S.frozen && S.stream && video.readyState >= 2 && ensureProcSize()) {
      pctx.drawImage(video, 0, 0, S.W, S.H);
      try {
        if (S.mode === 'global') sampleGlobal();
        else sampleRolling();
      } catch (err) { /* getImageData can throw if frame not ready */ }
    }
    drawOverlay();
    drawScope();
    requestAnimationFrame(loop);
  }

  // ====================================================================== CSV
  function downloadCSV() {
    let rows = [];
    if (S.mode === 'global') {
      rows.push('frame,R,G,B');
      const b = S.buf;
      for (let i = 0; i < b.r.length; i++)
        rows.push(`${i},${b.r[i].toFixed(2)},${b.g[i].toFixed(2)},${b.b[i].toFixed(2)}`);
    } else {
      rows.push(`position_${S.profile.axis},R,G,B`);
      const p = S.profile;
      for (let i = 0; i < p.r.length; i++)
        rows.push(`${i},${p.r[i].toFixed(2)},${p.g[i].toFixed(2)},${p.b[i].toFixed(2)}`);
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `occ_${S.mode}_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ================================================================ UI BINDINGS
  function setMode(mode) {
    S.mode = mode;
    globalCtrls.classList.toggle('hidden', mode !== 'global');
    rollingCtrls.classList.toggle('hidden', mode !== 'rolling');
    document.querySelectorAll('.seg-btn[data-mode]').forEach((b) =>
      b.classList.toggle('active', b.dataset.mode === mode));
    clearBuffers();
  }

  function clearBuffers() {
    S.buf = { r: [], g: [], b: [] };
    S.profile = { r: [], g: [], b: [], axis: S.scanAxis };
  }

  function bindUI() {
    startBtn.addEventListener('click', () => startCamera(cameraSelect.value || undefined));
    cameraSelect.addEventListener('change', () => startCamera(cameraSelect.value));

    freezeBtn.addEventListener('click', () => {
      S.frozen = !S.frozen;
      freezeBtn.classList.toggle('on', S.frozen);
      freezeBtn.textContent = S.frozen ? 'Frozen' : 'Freeze';
    });
    clearBtn.addEventListener('click', clearBuffers);
    csvBtn.addEventListener('click', downloadCSV);
    helpBtn.addEventListener('click', () => helpDialog.showModal());

    // user-adjustable video panel height (the video sits above the scope in the stage).
    // Controlled either by the slider or by dragging the divider bar.
    const streamSize = $('streamSize');
    const videoPanel = document.querySelector('.video-panel');
    const stage = document.querySelector('.stage');
    const vResizer = $('vResizer');
    const SS_MIN = parseFloat(streamSize.min), SS_MAX = parseFloat(streamSize.max);

    const applyStreamSize = () => {
      const g = clamp(parseFloat(streamSize.value), SS_MIN, SS_MAX);
      videoPanel.style.flexGrow = g;           // scope panel keeps flex-grow 1
      $('streamSizeVal').textContent = Math.round((g / (g + 1)) * 100) + '%';
    };
    streamSize.addEventListener('input', applyStreamSize);
    applyStreamSize();

    // drag the divider: map the pointer position to the video/scope height split
    let dragging = false;
    const onDrag = (e) => {
      if (!dragging) return;
      const rect = stage.getBoundingClientRect();
      const minPx = 90;                                  // matches .panel min-height
      const vh = clamp(e.clientY - rect.top, minPx, rect.height - minPx);
      const sh = Math.max(rect.height - vh, 1);
      streamSize.value = clamp(vh / sh, SS_MIN, SS_MAX);
      applyStreamSize();
      e.preventDefault();
    };
    vResizer.addEventListener('pointerdown', (e) => {
      dragging = true;
      vResizer.classList.add('dragging');
      vResizer.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    vResizer.addEventListener('pointermove', onDrag);
    const endDrag = () => { dragging = false; vResizer.classList.remove('dragging'); };
    vResizer.addEventListener('pointerup', endDrag);
    vResizer.addEventListener('pointercancel', endDrag);

    // ---- parameters panel: drag the bar to resize, button to collapse ----
    const controls = $('controls');
    const controlsBar = $('controlsBar');
    const collapseBtn = $('collapseBtn');
    const appHeader = document.querySelector('.app-header');
    const MIN_CTRL = 36, MIN_STAGE = 150;       // px guards so nothing vanishes

    let cDragging = false;
    const onCtrlDrag = (e) => {
      if (!cDragging) return;
      const bottom = controls.getBoundingClientRect().bottom;   // pinned above the footer
      const barH = controlsBar.offsetHeight;
      const maxCtrl = bottom - appHeader.getBoundingClientRect().bottom - MIN_STAGE - barH;
      const h = clamp(bottom - e.clientY - barH, MIN_CTRL, Math.max(maxCtrl, MIN_CTRL));
      controls.style.maxHeight = 'none';        // take over from the CSS cap
      controls.style.height = h + 'px';
      e.preventDefault();
    };
    controlsBar.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.collapse-btn')) return;            // let the button handle clicks
      if (controls.classList.contains('collapsed')) return;
      cDragging = true;
      controlsBar.classList.add('dragging');
      controlsBar.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    controlsBar.addEventListener('pointermove', onCtrlDrag);
    const endCtrlDrag = () => { cDragging = false; controlsBar.classList.remove('dragging'); };
    controlsBar.addEventListener('pointerup', endCtrlDrag);
    controlsBar.addEventListener('pointercancel', endCtrlDrag);

    collapseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const collapsed = controls.classList.toggle('collapsed');
      controlsBar.classList.toggle('is-collapsed', collapsed);
      collapseBtn.setAttribute('aria-expanded', String(!collapsed));
    });

    // exposure / iso
    manualExposure.addEventListener('change', applyExposureMode);
    exposureSlider.addEventListener('input', applyExposureTime);
    isoSlider.addEventListener('input', applyIso);

    // mode segmented control
    document.querySelectorAll('.seg-btn[data-mode]').forEach((b) =>
      b.addEventListener('click', () => setMode(b.dataset.mode)));

    // rolling scan-axis segmented control
    document.querySelectorAll('.seg-btn[data-axis]').forEach((b) =>
      b.addEventListener('click', () => {
        S.scanAxis = b.dataset.axis;
        document.querySelectorAll('.seg-btn[data-axis]').forEach((x) =>
          x.classList.toggle('active', x === b));
        // the single scan line is perpendicular to the scan direction
        $('linePosAxis').textContent = S.scanAxis === 'y' ? 'X' : 'Y';
        clearBuffers();
      }));

    // ROI enable: the single-line control is used only when the ROI is off
    $('useRoi').addEventListener('change', (e) => {
      S.useRoi = e.target.checked;
      $('roiCtrls').classList.toggle('disabled', !S.useRoi);
      $('linePosCtrl').classList.toggle('disabled', S.useRoi);
    });

    // numeric value mirrors
    const mirror = (el, out, fn) => {
      const upd = () => { $(out).textContent = fn ? fn(el.value) : el.value; };
      el.addEventListener('input', upd); upd();
    };
    mirror(C.poiX, 'poiXVal'); mirror(C.poiY, 'poiYVal');
    mirror(C.poiR, 'poiRVal'); mirror(C.timeWindow, 'timeWindowVal');
    mirror(C.linePos, 'linePosVal');
    mirror(C.roiX1, 'x1Val'); mirror(C.roiY1, 'y1Val');
    mirror(C.roiX2, 'x2Val'); mirror(C.roiY2, 'y2Val');

    // click on the video to set the POI (global mode)
    videoWrap.addEventListener('pointerdown', (e) => {
      if (S.mode !== 'global' || !S.W) return;
      const vr = video.getBoundingClientRect();
      if (e.clientX < vr.left || e.clientX > vr.right || e.clientY < vr.top || e.clientY > vr.bottom) return;
      const fx = ((e.clientX - vr.left) / vr.width) * 100;
      const fy = ((e.clientY - vr.top) / vr.height) * 100;
      C.poiX.value = clamp(fx, 0, 100); C.poiX.dispatchEvent(new Event('input'));
      C.poiY.value = clamp(fy, 0, 100); C.poiY.dispatchEvent(new Event('input'));
    });
  }

  // ===================================================================== INIT
  async function init() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      camInfo.textContent = 'unsupported';
      alert('This browser does not support camera capture (getUserMedia).');
      return;
    }
    bindUI();
    setupScopeCanvas();
    setMode('global');
    await listCameras();                  // list what we can (labels may be blank pre-permission)
    requestAnimationFrame(loop);
    // try to start the default camera straight away (works on desktop & Android Chrome;
    // iOS Safari may require the Start button gesture instead — fail quietly there)
    startCamera(cameraSelect.value || undefined, { silent: true });
  }

  init();
})();
