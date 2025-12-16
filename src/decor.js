/*jshint esversion: 6 */
// @ts-check

/*
 * Aquarium Game (P3) - Decor
 *
 * goals:
 * - loads decoration glb
 * - drops it from water down onto sand, like eggs do
 * - keeps it in-bounds and sitting on sand line
 *
 * expects:
 * - assets/decor/<name>.glb
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export class Decor {
  // caches prototype blob textures so multiple instances don't allocate canvases repeatedly
  static _protoTexCache = {};

  static _rgba(str) {
    // accepts: rgba(r,g,b,a) or rgb(r,g,b)
    const s = (str || "").trim();
    const m = s.match(/rgba?\(([^)]+)\)/i);
    if (!m) return { r: 255, g: 255, b: 255, a: 1 };
    const parts = m[1].split(",").map((x) => parseFloat(x.trim()));
    const r = Math.max(0, Math.min(255, parts[0] || 0));
    const g = Math.max(0, Math.min(255, parts[1] || 0));
    const b = Math.max(0, Math.min(255, parts[2] || 0));
    const a = (parts.length >= 4) ? Math.max(0, Math.min(1, parts[3])) : 1;
    return { r, g, b, a };
  }

  static _rgbaStr(c) {
    return `rgba(${c.r|0},${c.g|0},${c.b|0},${(typeof c.a === "number") ? c.a : 1})`;
  }

  static _makeProtoBlobTexture(decorType) {
    if (Decor._protoTexCache[decorType]) return Decor._protoTexCache[decorType];

    // matches same palette + styling used by makePrimitiveDecorThumb in main.js
    const pal = {
      seaweed: { a: "rgba(120,245,170,0.78)", b: "rgba(40,185,120,1.0)" },
      rock: { a: "rgba(210,220,235,0.85)", b: "rgba(140,155,175,1.0)" },
      shell: { a: "rgba(255,205,225,0.82)", b: "rgba(245,150,195,1.0)" },
      log: { a: "rgba(195,145,105,0.82)", b: "rgba(135,95,70,1.0)" },
      coral: { a: "rgba(255,170,175,0.78)", b: "rgba(255,120,145,1.0)" },
      sandcastle: { a: "rgba(255,235,175,0.85)", b: "rgba(235,200,135,1.0)" }
    };
    const p = pal[decorType] || { a: "rgba(210,238,255,0.85)", b: "rgba(140,205,255,1.0)" };

    const a = Decor._rgba(p.a);
    const b = Decor._rgba(p.b);

    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");

    // blob path
    const blobPath = () => {
      const w = size;
      const h = size;
      const cx = w * 0.50;
      const cy = h * 0.54;
      const rx = w * 0.40;
      const ry = h * 0.33;
      ctx.beginPath();
      const bumps = 10;
      for (let i = 0; i <= bumps; i++) {
        const t = (i / bumps) * Math.PI * 2;
        // deterministic wobble so each decorType has a consistent blob silhouette
        const wob1 = 0.085 * Math.sin(t * 2 + decorType.length * 0.7);
        const wob2 = 0.060 * Math.sin(t * 3.0 + 1.1);
        const rrx = rx * (1 + wob1 + wob2);
        const rry = ry * (1 - wob1 * 0.55 + wob2 * 0.35);
        const x = cx + Math.cos(t) * rrx;
        const y = cy + Math.sin(t) * rry;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.quadraticCurveTo(
          cx + Math.cos(t - Math.PI / bumps) * (rx * 1.02),
          cy + Math.sin(t - Math.PI / bumps) * (ry * 1.02),
          x,
          y
        );
      }
      ctx.closePath();
    };

    // base fill: radial gradient like shop blob
    blobPath();
    const g1 = ctx.createRadialGradient(size * 0.70, size * 0.68, size * 0.05, size * 0.70, size * 0.68, size * 0.78);
    g1.addColorStop(0, Decor._rgbaStr({ ...a, a: a.a }));
    g1.addColorStop(1, Decor._rgbaStr({ ...b, a: b.a }));
    ctx.fillStyle = g1;
    ctx.fill();

    // highlight spot (white sheen)
    blobPath();
    const g2 = ctx.createRadialGradient(size * 0.30, size * 0.28, size * 0.0, size * 0.30, size * 0.28, size * 0.52);
    g2.addColorStop(0, "rgba(255,255,255,0.55)");
    g2.addColorStop(1, "rgba(255,255,255,0.0)");
    ctx.fillStyle = g2;
    ctx.fill();

    // subtle inner shadow hint
    ctx.save();
    ctx.globalCompositeOperation = "source-atop";
    ctx.shadowColor = "rgba(0,0,0,0.18)";
    ctx.shadowBlur = 14;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 10;
    blobPath();
    ctx.strokeStyle = "rgba(0,0,0,0.16)";
    ctx.lineWidth = 18;
    ctx.stroke();
    ctx.restore();

    // soft outline
    blobPath();
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 10;
    ctx.stroke();

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;

    Decor._protoTexCache[decorType] = tex;
    return tex;
  }
  /**
   * @param {object} opts
   * @param {string} opts.decorType
   * @param {string} opts.url
   * @param {number} opts.worldW
   * @param {number} opts.worldH
   * @param {any} [opts.aquarium]
   * @param {any} [opts.sand]
   * @param {number} [opts.x]
   * @param {number} [opts.y]
   * @param {number} [opts.z]
   */
  constructor(opts) {
    this.decorType = opts.decorType || "decor";
    this.url = opts.url;

    // visuals mode (prototype uses primitives)
    this.mode = opts.mode || "prototype";

    this.worldW = opts.worldW;
    this.worldH = opts.worldH;
    this.aquarium = opts.aquarium || null;
    this.sand = opts.sand || null;

    this.group = new THREE.Group();
    this.group.name = `decor_${this.decorType}`;

    // in prototype mode shows primitive visual immediately
    this.group.visible = true;

    // always in front of sand
    if (opts.sand && typeof opts.sand.z === "number") {
      this.group.position.z = opts.sand.z + 0.70; // 0.45 + 0.70 = 1.15
    } else {
      this.group.position.z = (typeof opts.z === "number") ? opts.z : 1.15;
    }
    this.group.renderOrder = 2;

    // motion
    this._x = (typeof opts.x === "number") ? opts.x : 0;
    this._y = (typeof opts.y === "number") ? opts.y : 0;

    // velocities are in world-units per second
    this._vx = (Math.random() * 2 - 1) * 0.12;
    this._vy = -0.55 - Math.random() * 0.25;

    this._phase = Math.random() * Math.PI * 2;

    this._landed = false;

    // drag state (set by main.js)
    this._dragging = false;

    // bounds
    this._xMin = -1;
    this._xMax = 1;
    this._yMin = -1;
    this._yMax = 1;
    this._sandTopY = -1;

    // size proxy for landing
    this._halfH = 0.08;

    // root container
    this._root = new THREE.Group();
    this._root.name = "root";
    this.group.add(this._root);

    this._disposables = [];

    this._modelRoot = null;
    this._protoRoot = Decor._makePrototypeVisual(this.decorType);
    this._protoRoot.visible = (this.mode === "prototype");
    this._root.add(this._protoRoot);
    if (this._protoRoot.userData && Array.isArray(this._protoRoot.userData._disposables)) {
      this._disposables.push(...this._protoRoot.userData._disposables);
    }
    this._mixer = null;

    this._syncEnv();
    if (typeof opts.x !== "number" || typeof opts.y !== "number") this._spawnDefault();
    this._applyPos();

    this._load();
  }

  setEnvironment(worldW, worldH, aquarium, sand) {
    this.worldW = worldW;
    this.worldH = worldH;
    this.aquarium = aquarium || this.aquarium;
    this.sand = sand || this.sand;
    this._syncEnv();
    this._x = THREE.MathUtils.clamp(this._x, this._xMin, this._xMax);
    this._y = THREE.MathUtils.clamp(this._y, this._yMin, this._yMax);
    this._applyPos();

    // fixed z in front of sand (always)
    if (this.sand && typeof this.sand.z === "number") {
      this.group.position.z = this.sand.z + 0.70;
    }
  }

  /**
   * swaps between prototype (primitive) visuals and full model visuals
   * @param {"prototype"|"full"} nextMode
   */
  setMode(nextMode) {
    this.mode = nextMode || this.mode;
    if (this._protoRoot) this._protoRoot.visible = (this.mode === "prototype");
    if (this._modelRoot) this._modelRoot.visible = (this.mode === "full");
  }

  /**
   * starts dragging: freezes fall physics and keeps decor in front of sand.
   */
  startDrag() {
    this._dragging = true;
    this._landed = true;
    this._vx = 0;
    this._vy = 0;
    this.group.rotation.z = 0;

    // always in front of sand
    if (this.sand && typeof this.sand.z === "number") {
      this.group.position.z = this.sand.z + 0.70; // 0.45 + 0.70 = 1.15
    }
  }

  /**
   * drags to a world-space position, clamped inside sand region.
   * @param {number} x
   * @param {number} y
   */
  dragTo(x, y) {
    this._syncEnv();

    const cx = THREE.MathUtils.clamp(x, this._xMin, this._xMax);

    // y is locked to sand band (base stays on sand)
    const yMin = this._yMin;
    const yMax = this._sandTopY;
    const cy = THREE.MathUtils.clamp(y, yMin, yMax);

    this._x = cx;
    this._y = cy;
    this._applyPos();

    // keeps z fixed in front of sand
    if (this.sand && typeof this.sand.z === "number") {
      this.group.position.z = this.sand.z + 0.70;
    }
  }

  /**
   * ends dragging.
   */
  endDrag() {
    this._dragging = false;
    this._landed = true;
    this._vx = 0;
    this._vy = 0;
    this.group.rotation.z = 0;

    if (this.sand && typeof this.sand.z === "number") {
      this.group.position.z = this.sand.z + 0.70;
    }
  }

  update(dt, t) {
    if (!dt) return;

    // waits until model is actually loaded so player sees it fall
    if (!this._root) return;

    // dragging owns position
    if (this._dragging) {
      this._applyPos();
      return;
    }

    if (!this._landed) {
      // small drift so it doesn't fall perfectly straight
      const swirl = 0.02 * Math.sin((t + this._phase) * 0.9);
      this._vx += swirl * dt;

      this._vx *= Math.pow(0.92, dt * 60);
      this._vy *= Math.pow(0.98, dt * 60);

      // gravity
      this._vy -= 0.95 * dt;

      this._x += this._vx * dt;
      this._y += this._vy * dt;

      if (this._x < this._xMin) { this._x = this._xMin; this._vx = Math.abs(this._vx) * 0.45; }
      if (this._x > this._xMax) { this._x = this._xMax; this._vx = -Math.abs(this._vx) * 0.45; }

      // lands slightly into sand
      const groundY = this._sandTopY + this._halfH * 0.15;
      if (this._y <= groundY) {
        this._y = groundY;
        this._landed = true;
        this._vy = 0;
        this._vx *= 0.18;
        this.group.position.y = this._y;
      }
    } else {
      // tiny settle wobble
      const wob = 0.012 * Math.sin((t + this._phase) * 2.6);
      this.group.rotation.z = wob;
    }

    this._applyPos();
  }

  dispose() {
    if (this._mixer) {
      this._mixer.stopAllAction();
      this._mixer = null;
    }
    for (const d of this._disposables) {
      if (d && typeof d.dispose === "function") d.dispose();
    }
    this._disposables.length = 0;
    if (this.group) this.group.clear();
  }

  /* ------------------------------------------------------------------ */

  _applyPos() {
    this.group.position.x = this._x;
    this.group.position.y = this._y;
  }

  _syncEnv() {
    const w = this.worldW;
    const h = this.worldH;

    if (this.aquarium && typeof this.aquarium.innerLeft === "number") {
      this._xMin = this.aquarium.innerLeft + 0.10;
      this._xMax = this.aquarium.innerRight - 0.10;
      this._yMin = this.aquarium.innerBottom + 0.12;
      this._yMax = this.aquarium.innerTop - 0.12;
    } else {
      this._xMin = -w / 2 + 0.12;
      this._xMax = w / 2 - 0.12;
      this._yMin = -h / 2 + 0.12;
      this._yMax = h / 2 - 0.12;
    }

    // sand top: uses Sand.bedH if available, otherwise falls back to same rule Sand uses (22% of view height)
    const bedH = (this.sand && typeof this.sand.bedH === "number") ? this.sand.bedH : (h * 0.22);
    this._sandTopY = -h / 2 + bedH;
  }

  _spawnDefault() {
    // drops from near top of water area
    const spawnY = (this.aquarium && typeof this.aquarium.innerTop === "number")
      ? (this.aquarium.innerTop - 0.05)
      : (this.worldH / 2 - 0.12);

    this._x = THREE.MathUtils.lerp(this._xMin, this._xMax, 0.15 + 0.70 * Math.random());
    this._y = spawnY;
  }

  _load() {
    if (!this.url) return;

    const loader = new GLTFLoader();
    loader.load(
      this.url,
      (gltf) => {
        const model = gltf.scene || gltf.scenes?.[0];
        const root = model ? model.clone(true) : new THREE.Group();
        root.name = "decorModel";

        // makes it visible even in no-lights situations
        const toBasic = (m) => {
          if (!m) return m;
          const color = (m.color && m.color.isColor) ? m.color : new THREE.Color(0xffffff);
          const basic = new THREE.MeshBasicMaterial({
            map: m.map || null,
            color,
            transparent: !!m.transparent,
            opacity: (typeof m.opacity === "number") ? m.opacity : 1,
            alphaTest: (typeof m.alphaTest === "number") ? m.alphaTest : 0,
            side: THREE.DoubleSide
          });
          return basic;
        };

        root.traverse((n) => {
          if (!n || !n.isMesh) return;
          if (Array.isArray(n.material)) n.material = n.material.map(toBasic);
          else if (n.material) n.material = toBasic(n.material);
        });

        // centres + scales nicely into tank
        const box = new THREE.Box3().setFromObject(root);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);

        const maxDim = Math.max(0.0001, size.x, size.y, size.z);
        root.position.sub(center);

        // keep decor reasonably small; per-type tweaks help tall models like seaweed
        const baseTarget = Math.min(this.worldW, this.worldH) * 0.16;
        const perType = {
          seaweed: 1.80,
          coral: 0.90,
          shell: 0.85,
          rock: 0.90,
          log: 0.95,
          sandcastle: 1.05
        };

        const target = baseTarget * (perType[this.decorType] || 1.0);
        const k = target / maxDim;
        root.scale.multiplyScalar(k);

        // per-type pivot tweaks:
        // some models (notably sandcastle.glb) have a bounding-box centre that
        // makes visual sit too low when clamping decor's y within sand band during dragging
        // nudges model upward a bit so its effective centre is lower and player can place it higher
        {
          const boxT = new THREE.Box3().setFromObject(root);
          const sizeT = new THREE.Vector3();
          boxT.getSize(sizeT);

          const liftFracByType = {
            sandcastle: 0.93
          };

          const liftFrac = (typeof liftFracByType[this.decorType] === "number")
            ? liftFracByType[this.decorType]
            : 0;

          if (liftFrac !== 0) {
            root.position.y += sizeT.y * liftFrac;
          }
        }

        // recomputes final size for landing
        const box2 = new THREE.Box3().setFromObject(root);
        const size2 = new THREE.Vector3();
        box2.getSize(size2);
        this._halfH = Math.max(0.02, size2.y * 0.5);

        // slight random yaw so repeated decors don't look stamped
        root.rotation.y = (Math.random() * 2 - 1) * 0.35;

        this._modelRoot = root;
        this._root.add(root);

        // shows correct visuals for current mode
        root.visible = (this.mode === "full");
        if (this._protoRoot) this._protoRoot.visible = (this.mode === "prototype");
      },
      undefined,
      (err) => {
        console.warn("decor load failed:", this.url, err);
      }
    );
  }

  /* ------------------------------------------------------------------ */
  /* prototype (primitive) visual                                         */
  /* ------------------------------------------------------------------ */

  static _makePrototypeVisual(decorType) {
    const g = new THREE.Group();
    g.name = "protoDecor";

    const tex = Decor._makeProtoBlobTexture(decorType);
    const geo = new THREE.PlaneGeometry(0.26, 0.235, 1, 1);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 1,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: true
    });
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = 2;
    m.position.z = 0;

    // matches shop tilt a bit (rotate(-10deg))
    m.rotation.z = -0.17;

    g.add(m);
    g.userData._disposables = [geo, mat];
    return g;
  }
}
