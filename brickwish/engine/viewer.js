// BrickWish 3D viewer: the model builds itself brick by brick, then spins.
// A classic script (no modules) so the same file runs on the website and inside the video recorder.
//
//   const v = BrickWishViewer.create(canvas, viewerModel, THREE, { onFrame, preserve });
//   v.setTime(seconds)   // draws that moment of the animation (deterministic, for recording)
//   v.duration           // seconds from first brick to the end of the spin
//   v.play() / v.stop()  // real-time playback on a page; drag to turn the model
//
// viewerModel comes from engine.js viewerModel(model): {title, steps, colors, bricks: [[x,y,z,w,d,color,kind,step], ...]}
(function (root) {
  "use strict";
  const H = 1.2;

  function create(canvas, model, THREE, opts = {}) {
    THREE.ColorManagement.legacyMode = false;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: !!opts.preserve });
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, opts.maxPixelRatio || 2));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 6000);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x5a6578, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 1.35); sun.position.set(40, 90, 60); scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.35); fill.position.set(-50, 30, -20); scene.add(fill);

    const B = model.bricks.map(([x, y, z, w, d, color, kind, step], i) => ({ i, x, y, z, w, d, color, kind, step }));
    let X = 0, Y = 0, Z = 0;
    for (const b of B) { X = Math.max(X, b.x + b.w); Y = Math.max(Y, b.y + b.d); Z = Math.max(Z, b.z + 1); }
    const cx = X / 2, cy = Y / 2, top = Z * H;
    const cellOwner = new Map();
    const ck = (x, y, z) => (x * 4096 + y) * 1024 + z;
    for (const b of B) for (let i = 0; i < b.w; i++) for (let j = 0; j < b.d; j++) cellOwner.set(ck(b.x + i, b.y + j, b.z), b.i);

    // one instanced mesh per brick shape; colors per instance with a tiny variation so seams read
    const material = new THREE.MeshStandardMaterial({ roughness: 0.38, metalness: 0 });
    const geos = {};
    const geoFor = (b) => {
      const k = b.kind === "brick" ? `b${b.w}x${b.d}` : b.kind;
      if (!geos[k]) {
        geos[k] = b.kind === "brick" ? new THREE.BoxGeometry(b.w - 0.05, H - 0.02, b.d - 0.05)
          : b.kind === "cone1x1" ? new THREE.CylinderGeometry(0.26, 0.48, H - 0.02, 20)
          : new THREE.CylinderGeometry(b.kind === "round2x2" ? 0.98 : 0.48, b.kind === "round2x2" ? 0.98 : 0.48, H - 0.02, 24);
      }
      return k;
    };
    const groups = {};
    for (const b of B) (groups[geoFor(b)] ??= []).push(b);
    const color = new THREE.Color();
    const tint = (i) => 1 + (((i * 2654435761) >>> 0) % 1000 / 1000 - 0.5) * 0.08;
    const meshes = [];
    for (const [k, list] of Object.entries(groups)) {
      const mesh = new THREE.InstancedMesh(geos[k], material, list.length);
      list.forEach((b, n) => {
        b.mesh = mesh; b.slot = n;
        color.set(model.colors[b.color]).multiplyScalar(tint(b.i));
        mesh.setColorAt(n, color);
      });
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(mesh); meshes.push(mesh);
    }
    // studs: one instanced mesh, only the studs that stay visible on the finished model (keeps big models fast)
    const studs = [];
    for (const b of B) {
      if (b.kind === "cone1x1") continue;
      for (let i = 0; i < b.w; i++) for (let j = 0; j < b.d; j++)
        if (!cellOwner.has(ck(b.x + i, b.y + j, b.z + 1))) studs.push({ b: b.i, ox: i + 0.5 - b.w / 2, oz: j + 0.5 - b.d / 2 });
    }
    const studMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.3, 0.2, B.length > 2000 ? 8 : 12), material, Math.max(1, studs.length));
    studs.forEach((s, n) => { color.set(model.colors[B[s.b].color]).multiplyScalar(tint(s.b)); studMesh.setColorAt(n, color); });
    studMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(studMesh);

    const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ color: 0x14203b, transparent: true, opacity: 0.12 }));
    shadow.rotation.x = -Math.PI / 2; shadow.scale.set(X * 0.75, Y * 0.95, 1); shadow.position.y = 0.01; scene.add(shadow);

    // timeline
    const INTRO = 1.2, BUILD = Math.min(12, Math.max(6, model.steps * 0.17)), SPIN = 4.5, OUTRO = 1.6;
    const DURATION = INTRO + BUILD + SPIN + OUTRO, DROP = 0.4, perStep = BUILD / Math.max(1, model.steps);
    const byStep = new Map();
    for (const b of B) { if (!byStep.has(b.step)) byStep.set(b.step, []); byStep.get(b.step).push(b); }
    for (const list of byStep.values()) list.forEach((b, n) => { b.start = INTRO + (b.step - 1) * perStep + n * Math.min(0.06, perStep / (list.length + 1)); });
    const easeOutBack = (x) => 1 + 2.5 * Math.pow(x - 1, 3) + 1.5 * Math.pow(x - 1, 2);
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const R = Math.hypot(X, Y) / 2;
    const m = new THREE.Matrix4(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const k = new Float32Array(B.length), lift = new Float32Array(B.length);
    let dragOffset = 0;

    function resize() {
      const w = canvas.clientWidth || canvas.width, h = canvas.clientHeight || canvas.height;
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    }

    function setTime(t) {
      let placed = 0;
      for (const b of B) {
        const kk = clamp((t - b.start) / DROP, 0, 1);
        k[b.i] = kk;
        lift[b.i] = (1 - easeOutBack(kk)) * 9;
        if (kk > 0) placed++;
        if (kk <= 0) b.mesh.setMatrixAt(b.slot, zero);
        else b.mesh.setMatrixAt(b.slot, m.makeTranslation(b.x + b.w / 2 - cx, b.z * H + H / 2 + lift[b.i], b.y + b.d / 2 - cy));
      }
      for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
      studs.forEach((s, n) => {
        const b = B[s.b];
        if (k[s.b] <= 0) studMesh.setMatrixAt(n, zero);
        else studMesh.setMatrixAt(n, m.makeTranslation(b.x + b.w / 2 - cx + s.ox, b.z * H + H + 0.1 + lift[s.b], b.y + b.d / 2 - cy + s.oz));
      });
      studMesh.instanceMatrix.needsUpdate = true;

      const spin = clamp((t - INTRO - BUILD) / SPIN, 0, 1);
      const ang = 0.78 + 0.5 * clamp(t / (INTRO + BUILD), 0, 1) + spin * Math.PI * 2 + dragOffset;
      const half = Math.tan((camera.fov * Math.PI) / 360), e = 0.42;
      const fitH = (top * Math.cos(e) + 2 * R * Math.sin(e)) / 2 / 0.62 / half;
      const fitW = R / 0.85 / (half * camera.aspect);
      const dist = Math.max(fitH, fitW, 20);
      const ty = top * 0.45;
      camera.position.set(Math.cos(ang) * dist * Math.cos(e), ty + dist * Math.sin(e), Math.sin(ang) * dist * Math.cos(e));
      camera.lookAt(0, ty, 0);
      renderer.render(scene, camera);
      if (opts.onFrame) opts.onFrame({ t, placed, total: B.length, finished: t >= INTRO + BUILD + SPIN * 0.35 });
    }

    let raf = 0, t0 = 0;
    function play() {
      stop();
      t0 = performance.now();
      const loop = (now) => { setTime(Math.min((now - t0) / 1000, DURATION)); raf = requestAnimationFrame(loop); };
      raf = requestAnimationFrame(loop);
    }
    function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; }
    let dragging = false, lastX = 0;
    canvas.addEventListener("pointerdown", (ev) => { dragging = true; lastX = ev.clientX; canvas.setPointerCapture?.(ev.pointerId); });
    canvas.addEventListener("pointermove", (ev) => { if (dragging) { dragOffset += (ev.clientX - lastX) * 0.01; lastX = ev.clientX; } });
    canvas.addEventListener("pointerup", () => { dragging = false; });
    canvas.addEventListener("pointercancel", () => { dragging = false; });

    function dispose() {
      stop();
      for (const g of Object.values(geos)) g.dispose();
      studMesh.geometry.dispose(); material.dispose(); renderer.dispose();
    }
    resize();
    return { setTime, play, stop, resize, dispose, duration: DURATION, pieces: B.length };
  }

  root.BrickWishViewer = { create };
})(typeof window !== "undefined" ? window : globalThis);
