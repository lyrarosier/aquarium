/*jshint esversion: 6 */
// @ts-check

/*
 * Aquarium Game (P3) - Reef Fish (Sea Turtle)
 *
 * goals:
 * - loads turtle.glb
 * - plays built-in animation if present; otherwise use a gentle procedural wiggle
 * - renders even if there are no lights (use MeshBasicMaterial)
 * - stays inside bounds and above sand
 * - prefers swimming in lower half of tank (reef vibe)
 *
 * expects:
 * - assets/fish/turtle.glb
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export class ReefFish {
  /**
   * @param {object} opts
   * @param {number} opts.width
   * @param {number} opts.height
   * @param {number} [opts.depth]
   * @param {string} [opts.mode]
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

    this.url = opts.url || "assets/fish/turtle.glb";

    this.scaleMul = (typeof opts.scaleMul === "number") ? opts.scaleMul : 0.78;
    this.facingFix = (typeof opts.facingFix === "number") ? opts.facingFix : 0.0;
    this.speedMul = (typeof opts.speedMul === "number") ? opts.speedMul : 0.90;
    this.zLayer = (typeof opts.zLayer === "number") ? opts.zLayer : 0.0;

    this.forceProcedural = !!opts.proceduralWiggle;
    this.wiggleAmp = (typeof opts.wiggleAmp === "number") ? opts.wiggleAmp : 0.16;
    this.wiggleRate = (typeof opts.wiggleRate === "number") ? opts.wiggleRate : 1.55;

    this.group = new THREE.Group();
    this.group.name = "reefFish";

    // keeps fish in front of sand (sand z is 0.45)
    this.group.position.z = 1.15 + this.zLayer;
    this.group.renderOrder = 3;

    // swims left/right along x
    this._baseYaw = Math.PI / 2;

    // motion state (reef turtle: slow, steady, a bit floaty)
    this._dir = Math.random() < 0.5 ? 1 : -1;
    this._x = 0;
    this._y = 0;

    this._phase = Math.random() * Math.PI * 2;

    this._speed = 0.20;
    this._bobAmp = 0.022;
    this._bobRate = 0.55;

    // gentle drift so it does not feel like a straight rail
    this._driftAmp = 0.040;
    this._driftRate = 0.32;

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
    this._animSpeed = 1.0;

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
   */
  setBounds(width, height) {
    this.width = width;
    this.height = height;
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

    const drift = this._driftAmp * Math.sin((this._phase + t * this._driftRate) * 2.0);
    this._y = THREE.MathUtils.clamp(this._y + drift * dt, this._yMin, this._yMax);

    const bob = Math.sin((this._phase + t) * this._bobRate) * this._bobAmp;

    this.group.position.x = this._x;
    this.group.position.y = THREE.MathUtils.clamp(this._y + bob, this._yMin, this._yMax);

    if (this._mixer) this._mixer.update(dt * this._animSpeed);

    if (this._root && this._procedural) {
      const w = (t + this._phase) * this.wiggleRate;
      const yaw = Math.sin(w) * this.wiggleAmp;
      const roll = Math.sin(w * 0.85 + 0.6) * (this.wiggleAmp * 0.22);

      this._root.rotation.y = this._rootBaseRot.y + yaw;
      this._root.rotation.z = this._rootBaseRot.z + roll;
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

    // reef turtle likes lower half, but never inside sand band
    const yMin = sandTopY + sandMargin + (0.06 * h);

    // keeps it below upper third
    let yMax = h / 2 - topMargin - (0.22 * h);
    if (yMax < yMin + 0.15) yMax = yMin + 0.15;

    // subtracts half-extents so it does not clip off-screen before flipping
    this._xMin = xMin + this._halfW;
    this._xMax = xMax - this._halfW;

    this._yMin = yMin + this._halfH;
    this._yMax = yMax - this._halfH;

    if (this._yMax < this._yMin) {
      const mid = (this._yMin + this._yMax) * 0.5;
      this._yMin = mid - 0.05;
      this._yMax = mid + 0.05;
    }
  }

  _clampToBounds() {
    this._x = THREE.MathUtils.clamp(this._x, this._xMin, this._xMax);
    this._y = THREE.MathUtils.clamp(this._y, this._yMin, this._yMax);
    this.group.position.x = this._x;
    this.group.position.y = this._y;
  }

  _spawnInitialPosition() {
    const x = THREE.MathUtils.lerp(this._xMin, this._xMax, 0.15 + 0.70 * Math.random());
    const y = THREE.MathUtils.lerp(this._yMin, this._yMax, 0.15 + 0.70 * Math.random());

    this._x = x;
    this._y = y;

    this.group.position.x = x;
    this.group.position.y = y;

    this._applyFacing();
  }

  _flip(newDir) {
    if (this._turnCooldown > 0) return;

    this._dir = newDir;
    this._turnCooldown = 0.20;

    this._applyFacing();
  }

  _applyFacing() {
    if (!this._root) return;
    const face = (this._dir >= 0) ? 1 : -1;

    // baseYaw makes it swim along x; face controls left/right; facingFix for per-model correction
    this._root.rotation.set(0, this._baseYaw + this.facingFix + (face < 0 ? Math.PI : 0), 0);

    // preserves any captured base rotations if in procedural mode
    if (this._procedural) {
      this._rootBaseRot.set(this._root.rotation.x, this._root.rotation.y, this._root.rotation.z);
    }
  }

  _rescaleToView() {
    if (!this._root) return;

    // keeps reasonable size relative to tank
    const w = this.width;
    const h = this.height;

    const target = 0.22 * Math.min(w, h);

    const box = new THREE.Box3().setFromObject(this._root);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;

    const s = (target / maxDim) * this.scaleMul;
    this._root.scale.setScalar(s);

    // updates half extents for bound clamping
    const box2 = new THREE.Box3().setFromObject(this._root);
    const size2 = new THREE.Vector3();
    box2.getSize(size2);

    this._halfW = Math.max(0.08, size2.x * 0.5);
    this._halfH = Math.max(0.06, size2.y * 0.5);

    this._syncBounds();
    this._clampToBounds();
  }

  _load() {
    const loader = new GLTFLoader();

    loader.load(
      this.url,
      (gltf) => {
        const root = gltf.scene;
        this._root = root;

        // forces visibility without lighting
        root.traverse((o) => {
          if (!o) return;
          // @ts-ignore
          if (o.isMesh && o.material) {
            // @ts-ignore
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of mats) {
              const mm = new THREE.MeshBasicMaterial({
                map: m.map || null,
                color: (m.color && m.color.isColor) ? m.color : new THREE.Color(0xffffff),
                transparent: !!m.transparent,
                opacity: (typeof m.opacity === "number") ? m.opacity : 1.0,
                side: m.side
              });
              // @ts-ignore
              mm.depthWrite = true;
              // @ts-ignore
              mm.depthTest = true;
              this._disposables.push(mm);

              // swap in
              // @ts-ignore
              m.dispose && m.dispose();
              // @ts-ignore
              o.material = mm;
            }
          }
        });

        if (gltf.animations && gltf.animations.length) {
          this._mixer = new THREE.AnimationMixer(root);
          const clip = gltf.animations[0];
          this._clipAction = this._mixer.clipAction(clip);
          this._clipAction.play();
          this._procedural = false;
        } else {
          this._procedural = true;
        }

        this.group.add(root);

        this._applyFacing();

        // captures base rot after facing
        this._rootBaseRot.set(root.rotation.x, root.rotation.y, root.rotation.z);

        this._rescaleToView();
      },
      undefined,
      (err) => {
        console.warn("[reefFish] failed to load", this.url, err);
      }
    );
  }
}
