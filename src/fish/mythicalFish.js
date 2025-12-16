/*jshint esversion: 6 */
// @ts-check

/*
 * Aquarium Game (P3) - Mythical Fish
 *
 * goals:
 * - loads "mythical" fish model (glb)
 * - prefers built-in swim clip if present, otherwise use procedural swim
 * - renders even if there are no lights (use MeshBasicMaterial)
 * - stays inside bounds and above sand
 * - slightly more dramatic, fast, and "glidey" 
 *
 * expects:
 * - assets/fish/shark.glb 
 * - assets/fish/sailfish.glb
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export class MythicalFish {
  /**
   * @param {object} opts
   * @param {number} opts.width
   * @param {number} opts.height
   * @param {number} [opts.depth]
   * @param {"prototype"|"full"} [opts.mode]
   * @param {any} [opts.aquarium]
   * @param {string} [opts.url]
   * @param {number} [opts.scaleMul]
   * @param {number} [opts.facingFix]
   * @param {number} [opts.speedMul]
   * @param {number} [opts.zLayer]
   * @param {boolean} [opts.proceduralWiggle]
   * @param {number} [opts.wiggleAmp]
   * @param {number} [opts.wiggleRate]
   */
  constructor(opts) {
    this.width = opts.width;
    this.height = opts.height;
    this.depth = opts.depth || 6;
    this.mode = opts.mode || "prototype";

    this.aquarium = opts.aquarium || null;
    this.url = opts.url || "assets/fish/shark.glb";

    this.scaleMul = (typeof opts.scaleMul === "number") ? opts.scaleMul : 1.0;
    this.facingFix = (typeof opts.facingFix === "number") ? opts.facingFix : 0.0;
    this.speedMul = (typeof opts.speedMul === "number") ? opts.speedMul : 1.15;
    this.zLayer = (typeof opts.zLayer === "number") ? opts.zLayer : 0.0;

    this.forceProcedural = !!opts.proceduralWiggle;
    this.wiggleAmp = (typeof opts.wiggleAmp === "number") ? opts.wiggleAmp : 0.26;
    this.wiggleRate = (typeof opts.wiggleRate === "number") ? opts.wiggleRate : 2.9;

    this.group = new THREE.Group();
    this.group.name = "mythicalFish";

    // keeps fish in front of sand (sand z is 0.45)
    this.group.position.z = 1.15 + this.zLayer;
    this.group.renderOrder = 3;

    // swims left/right along x
    this._baseYaw = Math.PI / 2;

    // motion state
    this._dir = Math.random() < 0.5 ? 1 : -1;
    this._x = 0;
    this._y = 0;

    this._phase = Math.random() * Math.PI * 2;

    // mythical: faster with smoother glide and a wider arc
    this._speed = 0.44;
    this._bobAmp = 0.030;
    this._bobRate = 0.92;

    this._swerveAmp = 0.085;
    this._swerveRate = 0.42;

    this._turnCooldown = 0;

    // bounds
    this._xMin = -1;
    this._xMax = 1;
    this._yMin = -1;
    this._yMax = 1;

    // approximates half-extents in world units (computed after load + scale)
    this._halfW = 0.16;
    this._halfH = 0.10;

    // animation
    this._mixer = null;
    this._clipAction = null;
    this._animSpeed = 1.05;

    // procedural wiggle
    this._procedural = false;
    this._rootBaseRot = new THREE.Euler(0, 0, 0);

    // loaded root
    this._root = null;
    this._disposables = [];

    this._syncBounds();
    this._spawnInitialPosition();
    this._load();
  }

  /**
   * @param {number} width
   * @param {number} height
   * @param {any} [aquarium]
   */
  setBounds(width, height, aquarium) {
    this.width = width;
    this.height = height;
    if (aquarium) this.aquarium = aquarium;
    this._syncBounds();
    this._clampToBounds();
    this._rescaleToView();
  }

  /**
   * @param {number} dt
   * @param {number} t
   */
  update(dt, t) {
    if (!dt) return;

    if (this._turnCooldown > 0) this._turnCooldown = Math.max(0, this._turnCooldown - dt);

    this._x += this._dir * this._speed * this.speedMul * dt;

    if (this._x > this._xMax) {
      this._x = this._xMax;
      this._flip(-1);
    } else if (this._x < this._xMin) {
      this._x = this._xMin;
      this._flip(1);
    }

    const swerve = this._swerveAmp * Math.sin((this._phase + t * this._swerveRate) * 2.0);
    this._y = THREE.MathUtils.clamp(this._y + swerve * dt, this._yMin, this._yMax);

    const bob = Math.sin((this._phase + t) * this._bobRate) * this._bobAmp;

    this.group.position.x = this._x;
    this.group.position.y = THREE.MathUtils.clamp(this._y + bob, this._yMin, this._yMax);

    if (this._mixer) this._mixer.update(dt * this._animSpeed);

    if (this._root && this._procedural) {
      const w = (t + this._phase) * this.wiggleRate;

      const wag = Math.sin(w) * this.wiggleAmp;
      const roll = Math.sin(w * 0.85 + 0.6) * (this.wiggleAmp * 0.22);
      const pitch = Math.sin(w * 0.55 + 1.0) * (this.wiggleAmp * 0.10);

      this._root.rotation.y = this._rootBaseRot.y + wag;
      this._root.rotation.z = this._rootBaseRot.z + roll;
      this._root.rotation.x = this._rootBaseRot.x + pitch;
    }
  }

  dispose() {
    if (this._clipAction) {
      this._clipAction.stop();
      this._clipAction = null;
    }
    if (this._mixer) {
      this._mixer.stopAllAction();
      this._mixer = null;
    }
    if (this._root) {
      this.group.remove(this._root);
      this._root = null;
    }

    for (const d of this._disposables) {
      if (d && typeof d.dispose === "function") d.dispose();
    }
    this._disposables.length = 0;
  }

  _syncBounds() {
    const w = this.width;
    const h = this.height;

    const marginX = Math.max(0.10 * w, 0.22);
    const topMargin = Math.max(0.12 * h, 0.18);

    const sandBedH = h * 0.22;
    const sandTopY = -h / 2 + sandBedH;
    const sandMargin = Math.max(0.10 * h, 0.14);

    const xMin = -w / 2 + marginX;
    const xMax = w / 2 - marginX;

    // mythical hangs around mid-to-upper band, but never at top edge
    const yMin = sandTopY + sandMargin + (0.18 * h);

    let yMax;
    if (this.aquarium && typeof this.aquarium.innerTop === "number") {
      yMax = this.aquarium.innerTop - topMargin - (0.04 * h);
    } else {
      yMax = (h / 2) - topMargin - (0.04 * h);
    }

    if (yMax < yMin + 0.16) yMax = yMin + 0.16;

    this._xMin = xMin + this._halfW;
    this._xMax = xMax - this._halfW;

    this._yMin = yMin + this._halfH;
    this._yMax = yMax - this._halfH;
  }

  _clampToBounds() {
    this._x = THREE.MathUtils.clamp(this._x, this._xMin, this._xMax);
    this._y = THREE.MathUtils.clamp(this._y, this._yMin, this._yMax);
    this.group.position.x = this._x;
    this.group.position.y = this._y;
  }

  _spawnInitialPosition() {
    const x = THREE.MathUtils.lerp(this._xMin, this._xMax, 0.20 + 0.60 * Math.random());
    const y = THREE.MathUtils.lerp(this._yMin, this._yMax, 0.20 + 0.60 * Math.random());

    this._x = x;
    this._y = y;

    this.group.position.x = x;
    this.group.position.y = y;

    this._applyFacing();
  }

  _flip(newDir) {
    if (this._turnCooldown > 0) return;
    this._dir = newDir;
    this._turnCooldown = 0.18;
    this._applyFacing();
  }

  _applyFacing() {
    if (!this._root) return;
    const face = (this._dir >= 0) ? 1 : -1;
    this._root.rotation.set(0, this._baseYaw + this.facingFix + (face < 0 ? Math.PI : 0), 0);

    if (this._procedural) {
      this._rootBaseRot.set(this._root.rotation.x, this._root.rotation.y, this._root.rotation.z);
    }
  }

  _rescaleToView() {
    if (!this._root) return;

    const w = this.width;
    const h = this.height;
    const target = 0.26 * Math.min(w, h);

    const box = new THREE.Box3().setFromObject(this._root);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;

    const s = (target / maxDim) * this.scaleMul;
    this._root.scale.setScalar(s);

    const box2 = new THREE.Box3().setFromObject(this._root);
    const size2 = new THREE.Vector3();
    box2.getSize(size2);

    this._halfW = Math.max(0.10, size2.x * 0.5);
    this._halfH = Math.max(0.07, size2.y * 0.5);

    this._syncBounds();
    this._clampToBounds();
  }

  _load() {
    const loader = new GLTFLoader();

    loader.load(
      this.url,
      (gltf) => {
        const root = gltf.scene || new THREE.Group();
        root.name = "fish";

        root.traverse((o) => {
          if (!o || !o.isMesh || !o.material) return;

          o.castShadow = false;
          o.receiveShadow = false;
          o.renderOrder = 3;

          const oldMat = o.material;
          const mats = Array.isArray(oldMat) ? oldMat : [oldMat];
          const next = [];

          for (const m of mats) {
            if (!m) continue;
            const mm = new THREE.MeshBasicMaterial({
              map: m.map || null,
              alphaMap: m.alphaMap || null,
              color: (m.color && m.color.isColor) ? m.color : new THREE.Color(0xffffff),
              transparent: !!m.transparent,
              opacity: (typeof m.opacity === "number") ? m.opacity : 1,
              side: m.side
            });
            if (o.isSkinnedMesh) mm.skinning = true;
            if (o.morphTargetInfluences) mm.morphTargets = true;
            next.push(mm);
            this._disposables.push(mm);

            if (typeof m.dispose === "function") m.dispose();
          }

          o.material = Array.isArray(oldMat) ? next : next[0];
          if (o.geometry) this._disposables.push(o.geometry);
        });

        this._root = root;
        this.group.add(root);

        const hasAnims = !!(gltf.animations && gltf.animations.length);

        if (!this.forceProcedural && hasAnims) {
          this._mixer = new THREE.AnimationMixer(root);

          let clip = gltf.animations[0];
          for (const c of gltf.animations) {
            const n = (c && c.name) ? c.name.toLowerCase() : "";
            if (n.includes("swim")) { clip = c; break; }
          }

          this._clipAction = this._mixer.clipAction(clip);
          this._clipAction.play();
          this._procedural = false;
        } else {
          this._mixer = null;
          this._clipAction = null;
          this._procedural = true;
        }

        // centre root so scaling is stable
        const box = new THREE.Box3().setFromObject(root);
        const centre = new THREE.Vector3();
        box.getCenter(centre);
        root.position.sub(centre);
        root.position.z = 0;

        this._applyFacing();
        if (this._procedural) this._rootBaseRot.copy(root.rotation);

        this._rescaleToView();
      },
      undefined,
      (err) => {
        console.warn("MythicalFish load failed:", this.url, err);
      }
    );
  }
}
