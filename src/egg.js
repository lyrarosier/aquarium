/*jshint esversion: 6 */
// @ts-check

/*
 * Aquarium Game (P3) - Egg
 *
 * goals:
 * - small fish-egg looking thing (semi-clear jelly)
 * - colour varies by eggType
 * - falls from water down to sand and then wobbles while incubating
 * - hatches via callback (provides egg position)
 * - prototype mode: simple circles (outer + inner)
 *
 * NOTE (colour match):
 * - primitive (prototype) eggs now match the shop preview palette for primitives.
 * - full jelly eggs keep their existing richer palette.
 */

import * as THREE from "three";

export class Egg {
  /**
   * @param {object} opts
   * @param {"basic"|"schooling"|"tropical"|"saltwater"|"ornamental"|"deepsea"|"mythical"} opts.eggType
   * @param {"prototype"|"full"} [opts.mode]
   * @param {number} opts.worldW
   * @param {number} opts.worldH
   * @param {any} [opts.aquarium]
   * @param {any} [opts.sand]
   * @param {number} [opts.x]
   * @param {number} [opts.y]
   * @param {number} [opts.z]
   * @param {(eggType:string, egg:Egg)=>void} [opts.onHatch]
   */
  constructor(opts) {
    this.eggType = opts.eggType || "basic";
    this.mode = opts.mode || "full";

    this.worldW = opts.worldW;
    this.worldH = opts.worldH;
    this.aquarium = opts.aquarium || null;
    this.sand = opts.sand || null;

    this.onHatch = opts.onHatch || null;

    this.group = new THREE.Group();
    this.group.name = `egg_${this.eggType}`;

    // sit between sand (z~0.45) and fish (z~1.15)
    this.group.position.z = (typeof opts.z === "number") ? opts.z : 0.88;
    this.group.renderOrder = 2;

    // motion
    this._x = (typeof opts.x === "number") ? opts.x : 0;
    this._y = (typeof opts.y === "number") ? opts.y : 0;

    this._vx = (Math.random() * 2 - 1) * 0.03;
    this._vy = -0.06 - Math.random() * 0.03;

    this._phase = Math.random() * Math.PI * 2;

    // state
    this._landed = false;
    this._age = 0;
    this._hatchAt = 7.5 + Math.random() * 5.0;

    // IMPORTANT: prevent spawning fish every frame while shrinking out
    this._didHatch = false;

    // once the pop animation finishes, stop updating/rendering (main should also remove it)
    this._dead = false;

    // sizing
    this._r = Math.max(0.030, Math.min(0.048, Math.min(this.worldW, this.worldH) * 0.021));

    // landing: how much the egg should sit "into" the sand
    // (centre ends up closer to sand surface, so bottom is buried a bit)
    this._sandSinkFactor = 0.38; // smaller = deeper into sand.

    // build mesh
    this._disposables = [];
    this._sparkles = null;
    this._buildEgg();

    // place
    this._syncEnv();
    if (typeof opts.x !== "number" || typeof opts.y !== "number") this._spawnDefault();
    this._applyPos();
  }

  getPosition() {
    return {
      x: this.group.position.x,
      y: this.group.position.y,
      z: this.group.position.z
    };
  }

  /**
   * @param {number} worldW
   * @param {number} worldH
   * @param {any} aquarium
   * @param {any} sand
   */
  setEnvironment(worldW, worldH, aquarium, sand) {
    this.worldW = worldW;
    this.worldH = worldH;
    this.aquarium = aquarium || this.aquarium;
    this.sand = sand || this.sand;
    this._syncEnv();
    this._x = THREE.MathUtils.clamp(this._x, this._xMin, this._xMax);
    this._y = THREE.MathUtils.clamp(this._y, this._yMin, this._yMax);
    this._applyPos();
  }

  /**
   * @param {number} dt
   * @param {number} t
   */
  update(dt, t) {
    if (!dt) return;

    if (this._dead) return;
    this._age += dt;

    if (!this._landed) {
      const swirl = 0.03 * Math.sin((t + this._phase) * 0.9);
      this._vx += swirl * dt;

      this._vx *= Math.pow(0.92, dt * 60);
      this._vy *= Math.pow(0.94, dt * 60);

      this._vy -= 0.028 * dt;

      this._x += this._vx;
      this._y += this._vy;

      if (this._x < this._xMin) { this._x = this._xMin; this._vx = Math.abs(this._vx) * 0.55; }
      if (this._x > this._xMax) { this._x = this._xMax; this._vx = -Math.abs(this._vx) * 0.55; }

      // land slightly "into" the sand instead of sitting on top
      const groundY = this._sandTopY + this._r * this._sandSinkFactor;
      if (this._y <= groundY) {
        this._y = groundY;
        this._landed = true;
        this._vy = 0;
        this._vx *= 0.25;

        // after landing, keep the wobble from drifting the egg upwards
        this.group.position.y = this._y;
      }
    } else {
      // incubating wobble
      const wob = 0.20 * Math.sin((t + this._phase) * 6.2);
      const wob2 = 0.12 * Math.sin((t + this._phase) * 11.0);

      const jx = 0.0019 * Math.sin((t + this._phase) * 17.0);
      const jy = 0.0013 * Math.cos((t + this._phase) * 13.0);

      this.group.rotation.z = wob + wob2 * 0.35;
      this.group.rotation.x = 0.10 * wob2;

      this.group.position.x = this._x + jx;
      this.group.position.y = this._y + jy;

      if (this._sparkles) {
        this._sparkles.rotation.z = 0.12 * Math.sin((t + this._phase) * 1.7);
        const pulse = 0.75 + 0.25 * Math.sin((t + this._phase) * 2.3);
        this._sparkles.scale.setScalar(pulse);
      }

      // hatch ONCE
      if (!this._didHatch && this._age >= this._hatchAt) {
        this._didHatch = true;
        if (this.onHatch) this.onHatch(this.eggType, this);
        this._popAndDisposeSoon();
      }

      return;
    }

    if (!this._landed) {
      this.group.rotation.z = 0.10 * Math.sin((t + this._phase) * 3.1);
      this.group.rotation.x = 0.08 * Math.sin((t + this._phase) * 2.4);
    }

    this._applyPos();
  }

  dispose() {
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
      this._xMin = this.aquarium.innerLeft + this._r * 1.2;
      this._xMax = this.aquarium.innerRight - this._r * 1.2;
      this._yMin = this.aquarium.innerBottom + this._r * 1.2;
      this._yMax = this.aquarium.innerTop - this._r * 1.2;
    } else {
      this._xMin = -w / 2 + 0.18 + this._r;
      this._xMax = w / 2 - 0.18 - this._r;
      this._yMin = -h / 2 + 0.16 + this._r;
      this._yMax = h / 2 - 0.16 - this._r;
    }

    const bedH = (this.sand && typeof this.sand.bedH === "number") ? this.sand.bedH : (h * 0.22);
    this._sandTopY = -h / 2 + bedH;
  }

  _spawnDefault() {
    const x = THREE.MathUtils.lerp(this._xMin, this._xMax, 0.15 + 0.70 * Math.random());
    const y = this._yMax - (0.10 + 0.05 * Math.random());
    this._x = x;
    this._y = y;
  }

  _buildEgg() {
    if (this.mode === "prototype") {
      this._buildEggPrimitive();
    } else {
      this._buildEggFull();
    }
  }

  _buildEggPrimitive() {
    // IMPORTANT: use the exact same palette as the shop's primitive egg thumbs
    const palette = Egg._primitivePaletteFor(this.eggType);

    const outerG = new THREE.CircleGeometry(this._r, 28);
    const outerM = new THREE.MeshBasicMaterial({
      color: new THREE.Color(palette.shell),
      transparent: true,
      opacity: 0.90,
      depthWrite: false
    });
    const outer = new THREE.Mesh(outerG, outerM);
    outer.renderOrder = 2;

    // inner circle
    const innerR = this._r * 0.52;
    const innerG = new THREE.CircleGeometry(innerR, 24);
    const innerM = new THREE.MeshBasicMaterial({
      color: new THREE.Color(palette.inner),
      transparent: true,
      opacity: 0.85,
      depthWrite: false
    });
    const inner = new THREE.Mesh(innerG, innerM);

    // tiny offset so it looks like a “yolk”
    inner.position.set(this._r * 0.10, -this._r * 0.08, 0.001);
    inner.renderOrder = 3;

    this._disposables.push(outerG, outerM, innerG, innerM);

    this.group.add(outer);
    this.group.add(inner);

    // no sparkles in prototype
    this._sparkles = null;
  }

  // your full jelly egg code (kept)
  _buildEggFull() {
    const palette = Egg._paletteFor(this.eggType);

    const outerG = new THREE.SphereGeometry(this._r, 20, 18);

    const outerM = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(palette.shell),
      emissive: new THREE.Color(palette.shellEmissive),
      emissiveIntensity: palette.shellEmissiveIntensity,

      transparent: true,
      opacity: palette.shellOpacity,

      roughness: palette.roughness,
      metalness: 0.0,

      transmission: palette.transmission,
      thickness: palette.thickness,

      clearcoat: palette.clearcoat,
      clearcoatRoughness: palette.clearcoatRoughness,

      iridescence: palette.iridescence,
      iridescenceIOR: palette.iridescenceIOR,
      iridescenceThicknessRange: palette.iridescenceThicknessRange
    });

    const outer = new THREE.Mesh(outerG, outerM);
    outer.scale.set(1.0, 1.02, 0.98);
    outer.renderOrder = 2;

    this._disposables.push(outerG);
    this._disposables.push(outerM);

    const innerR = this._r * 0.60;
    const innerG = new THREE.SphereGeometry(innerR, 18, 16);

    const innerM = new THREE.MeshBasicMaterial({
      color: new THREE.Color(palette.inner),
      transparent: true,
      opacity: palette.innerOpacity,
      depthWrite: false
    });

    const inner = new THREE.Mesh(innerG, innerM);
    inner.position.set(this._r * 0.06, -this._r * 0.03, this._r * 0.06);
    inner.scale.set(1.0, 0.98, 0.90);

    this._disposables.push(innerG);
    this._disposables.push(innerM);

    const coreG = new THREE.SphereGeometry(this._r * 0.34, 14, 12);
    const coreM = new THREE.MeshBasicMaterial({
      color: new THREE.Color(palette.core),
      transparent: true,
      opacity: palette.coreOpacity,
      depthWrite: false
    });
    const core = new THREE.Mesh(coreG, coreM);
    core.position.copy(inner.position).add(new THREE.Vector3(this._r * 0.03, this._r * 0.02, this._r * 0.02));
    core.scale.set(1.0, 0.92, 0.86);

    this._disposables.push(coreG);
    this._disposables.push(coreM);

    if (this.eggType === "ornamental") {
      const tex = Egg._makeMarbleTexture(palette.marbleA, palette.marbleB);
      const marbleM = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: 0.40,
        depthWrite: false
      });
      const marble = new THREE.Mesh(new THREE.SphereGeometry(this._r * 0.988, 20, 18), marbleM);
      marble.scale.set(1.0, 1.02, 0.98);
      marble.renderOrder = 3;

      this._disposables.push(marble.geometry);
      this._disposables.push(marbleM);
      this._disposables.push(tex);

      this.group.add(marble);
    }

    const glintG = new THREE.SphereGeometry(this._r * 0.40, 14, 12);
    const glintM = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.28,
      depthWrite: false
    });
    const glint = new THREE.Mesh(glintG, glintM);
    glint.position.set(-this._r * 0.20, this._r * 0.22, this._r * 0.22);
    glint.scale.set(1.0, 0.78, 0.50);

    this._disposables.push(glintG);
    this._disposables.push(glintM);

    this.group.add(outer);
    this.group.add(inner);
    this.group.add(core);
    this.group.add(glint);

    if (this.eggType === "mythical") {
      const shG = new THREE.SphereGeometry(this._r * 1.01, 22, 20);
      const shM = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(0xfff3c4),
        emissive: new THREE.Color(0xffd977),
        emissiveIntensity: 0.45,
        transparent: true,
        opacity: 0.34,
        roughness: 0.05,
        metalness: 0.0,
        transmission: 0.58,
        thickness: 0.18,
        clearcoat: 1.0,
        clearcoatRoughness: 0.03,
        iridescence: 1.0,
        iridescenceIOR: 1.8,
        iridescenceThicknessRange: [180, 560]
      });
      const shimmer = new THREE.Mesh(shG, shM);
      shimmer.scale.set(1.0, 1.02, 0.98);
      shimmer.renderOrder = 4;

      this._disposables.push(shG);
      this._disposables.push(shM);

      const sparkle = Egg._makeSparkles(this._r * 1.02);
      sparkle.renderOrder = 5;
      this._sparkles = sparkle;

      if (sparkle.geometry) this._disposables.push(sparkle.geometry);
      if (sparkle.material) this._disposables.push(sparkle.material);

      this.group.add(shimmer);
      this.group.add(sparkle);
    }
  }

  _popAndDisposeSoon() {
    const root = this.group;
    let gone = false;
    const start = performance.now();

    // points size does not scale like meshes, so fade opacity and size explicitly
    /** @type {Array<{ mat:any, baseOpacity:number, baseSize:(number|null) }>} */
    const mats = [];
    root.traverse((o) => {
      if (!o || !o.material) return;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of list) {
        if (!m || typeof m !== "object") continue;
        const baseOpacity = (typeof m.opacity === "number") ? m.opacity : 1.0;
        const baseSize = (typeof m.size === "number") ? m.size : null;
        mats.push({ mat: m, baseOpacity, baseSize });
      }
    });

    const tick = () => {
      if (gone) return;
      const now = performance.now();
      const u = Math.min(1, (now - start) / 260);

      const fade = Math.max(0, 1.0 - u);
      root.scale.setScalar(Math.max(0.001, fade));

      for (const rec of mats) {
        const m = rec.mat;
        if (!m) continue;
        if (typeof m.opacity === "number") m.opacity = rec.baseOpacity * fade;
        if (rec.baseSize !== null && typeof m.size === "number") m.size = rec.baseSize * fade;
        if (typeof m.needsUpdate === "boolean") m.needsUpdate = true;
      }

      if (u < 1) requestAnimationFrame(tick);
      else {
        gone = true;
        this._dead = true;
      }
    };
    requestAnimationFrame(tick);
  }

  /* ------------------------------------------------------------------ */

  // EXACT primitive palette used by shop preview thumbs (converted from the RGBA you defined in main.js)
  static _primitivePaletteFor(type) {
    const P = {
      basic:      { shell: 0xd2eeff, inner: 0x8ccdff },
      schooling:  { shell: 0xcdffdc, inner: 0x6edca0 },
      tropical:   { shell: 0xaaebff, inner: 0x37afff },
      saltwater:  { shell: 0xf8c3ff, inner: 0xc869ff },
      ornamental: { shell: 0xfaf5f0, inner: 0xff967d },
      deepsea:    { shell: 0x3c4691, inner: 0x0c1237 },
      mythical:   { shell: 0xffeba0, inner: 0xffffff }
    };
    return P[type] || P.basic;
  }

  static _paletteFor(type) {
    const P = {
      basic: {
        shell: 0xeaf4ff, inner: 0xa8d8ff,
        core: 0xd7f0ff,
        shellOpacity: 0.56, innerOpacity: 0.58, coreOpacity: 0.38,
        roughness: 0.16, transmission: 0.58, thickness: 0.18,
        clearcoat: 0.22, clearcoatRoughness: 0.18,
        iridescence: 0.0, iridescenceIOR: 1.3, iridescenceThicknessRange: [120, 380],
        shellEmissive: 0x9fd8ff, shellEmissiveIntensity: 0.12
      },
      schooling: {
        shell: 0xcff7da, inner: 0x6fe0a3,
        core: 0xcfffe0,
        shellOpacity: 0.54, innerOpacity: 0.58, coreOpacity: 0.36,
        roughness: 0.18, transmission: 0.56, thickness: 0.18,
        clearcoat: 0.20, clearcoatRoughness: 0.20,
        iridescence: 0.0, iridescenceIOR: 1.3, iridescenceThicknessRange: [120, 380],
        shellEmissive: 0x8eeeb7, shellEmissiveIntensity: 0.12
      },
      tropical: {
        shell: 0xa7ecff, inner: 0x2fb6ff,
        core: 0xcdf6ff,
        shellOpacity: 0.54, innerOpacity: 0.60, coreOpacity: 0.36,
        roughness: 0.14, transmission: 0.60, thickness: 0.18,
        clearcoat: 0.26, clearcoatRoughness: 0.16,
        iridescence: 0.0, iridescenceIOR: 1.3, iridescenceThicknessRange: [120, 380],
        shellEmissive: 0x66d8ff, shellEmissiveIntensity: 0.14
      },
      saltwater: {
        shell: 0xf0c2ff, inner: 0xc06aff,
        core: 0xf7d4ff,
        shellOpacity: 0.54, innerOpacity: 0.60, coreOpacity: 0.34,
        roughness: 0.14, transmission: 0.60, thickness: 0.18,
        clearcoat: 0.34, clearcoatRoughness: 0.14,
        iridescence: 0.28, iridescenceIOR: 1.5, iridescenceThicknessRange: [160, 420],
        shellEmissive: 0xd7a0ff, shellEmissiveIntensity: 0.13
      },
      ornamental: {
        shell: 0xf7f3f0, inner: 0xffb3a6,
        core: 0xffdfd9,
        shellOpacity: 0.54, innerOpacity: 0.56, coreOpacity: 0.34,
        roughness: 0.18, transmission: 0.56, thickness: 0.18,
        clearcoat: 0.24, clearcoatRoughness: 0.18,
        iridescence: 0.0, iridescenceIOR: 1.3, iridescenceThicknessRange: [120, 380],
        marbleA: "#ffffff",
        marbleB: "#ff7a66",
        shellEmissive: 0xffc9c0, shellEmissiveIntensity: 0.10
      },
      deepsea: {
        shell: 0x2a2f66, inner: 0x0f143b,
        core: 0x2b3a88,
        shellOpacity: 0.62, innerOpacity: 0.62, coreOpacity: 0.30,
        roughness: 0.20, transmission: 0.50, thickness: 0.20,
        clearcoat: 0.18, clearcoatRoughness: 0.24,
        iridescence: 0.0, iridescenceIOR: 1.3, iridescenceThicknessRange: [120, 380],
        shellEmissive: 0x4657c7, shellEmissiveIntensity: 0.18
      },
      mythical: {
        shell: 0xffe79a, inner: 0xffffff,
        core: 0xfff2c7,
        shellOpacity: 0.52, innerOpacity: 0.46, coreOpacity: 0.36,
        roughness: 0.08, transmission: 0.62, thickness: 0.16,
        clearcoat: 0.90, clearcoatRoughness: 0.06,
        iridescence: 1.0, iridescenceIOR: 1.75, iridescenceThicknessRange: [180, 560],
        shellEmissive: 0xffd977, shellEmissiveIntensity: 0.18
      }
    };

    return P[type] || P.basic;
  }

  static _makeMarbleTexture(a, b) {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext("2d");

    ctx.fillStyle = a;
    ctx.fillRect(0, 0, c.width, c.height);

    for (let i = 0; i < 120; i++) {
      const x = Math.random() * c.width;
      const y = Math.random() * c.height;
      const r = 8 + Math.random() * 32;

      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, b);
      g.addColorStop(1, "rgba(255,255,255,0)");

      ctx.globalAlpha = 0.18 + Math.random() * 0.22;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1.0;

    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
  }

  static _makeSparkles(radius) {
    const count = 26;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(THREE.MathUtils.clamp(Math.random() * 2 - 1, -1, 1));
      const r = radius * (0.75 + 0.35 * Math.random());

      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.cos(phi);
      const z = r * Math.sin(phi) * Math.sin(theta);

      positions[i * 3 + 0] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    const m = new THREE.PointsMaterial({
      color: 0xffffff,
      size: radius * 0.16,
      transparent: true,
      opacity: 0.55,
      depthWrite: false
    });

    return new THREE.Points(g, m);
  }
}
