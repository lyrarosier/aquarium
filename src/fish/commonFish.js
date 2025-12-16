/*jshint esversion: 6 */
// @ts-check

/*
 * Aquarium Game (P3) - Common Fish
 *
 * goals:
 * - loads one fish model (glb)
 * - if model has animations: play built-in swim clip
 * - if model has no animations: add a small procedural wiggle so it feels alive
 * - keeps behaviour simple and stable
 * - renders even if there are no lights (use MeshBasicMaterial)
 * - stays inside bounds and above sand
 * - adds one simple eye (if model does not already have one)
 *
 * expects:
 * - assets/fish/carp.glb
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export class CommonFish {
  /**
   * @param {object} opts
   * @param {number} opts.width
   * @param {number} opts.height
   * @param {number} [opts.depth]
   * @param {"prototype"|"full"} [opts.mode]
   * @param {any} [opts.aquarium]               aquarium instance (for hard innerTop wall)
   * @param {string} [opts.url]
   * @param {boolean} [opts.addEye]              sets false if model already has eyes
   * @param {object} [opts.eye]                  manual eye overrides
   * @param {number} [opts.eye.r]
   * @param {number} [opts.eye.x]
   * @param {number} [opts.eye.y]
   * @param {number} [opts.eye.z]
   * @param {number} [opts.eye.color]
   * @param {number} [opts.eye.mirrorX]          0 for single eye, 1 for mirrored second eye
   * @param {boolean} [opts.proceduralWiggle]    force wiggle even if animations exist
   * @param {number} [opts.wiggleAmp]            radians
   * @param {number} [opts.wiggleRate]           Hz-ish
   * @param {number} [opts.scaleMul]             extra scale multiplier (use 2.0 for "double size")
   * @param {number} [opts.facingFix]            extra yaw (radians), use Math.PI to flip forward/back
   * @param {number} [opts.zLayer]               tiny extra z offset so fish can occlude each other
   */
  constructor(opts) {
    this.width = opts.width;
    this.height = opts.height;
    this.depth = opts.depth || 6;
    this.mode = opts.mode || "prototype";
    this.url = opts.url || "assets/fish/carp.glb";

    this.aquarium = opts.aquarium || null;

    // eye settings 
    this.addEye = (typeof opts.addEye === "boolean") ? opts.addEye : true;
    this.eye = opts.eye || null;

    // wiggle settings
    this.forceProcedural = !!opts.proceduralWiggle;
    this.wiggleAmp = (typeof opts.wiggleAmp === "number") ? opts.wiggleAmp : 0.22;
    this.wiggleRate = (typeof opts.wiggleRate === "number") ? opts.wiggleRate : 2.2;

    // per-fish tuning knobs
    this.scaleMul = (typeof opts.scaleMul === "number") ? opts.scaleMul : 1.0;
    this.facingFix = (typeof opts.facingFix === "number") ? opts.facingFix : 0.0;

    // small per-fish depth separation so overlap looks correct
    this.zLayer = (typeof opts.zLayer === "number") ? opts.zLayer : 0.0;

    this.group = new THREE.Group();
    this.group.name = "commonFish";

    // keeps fish in front of sand
    this.group.position.z = 1.15 + this.zLayer;
    this.group.renderOrder = 3;

    // rotates model so its side shows forward
    this._baseYaw = Math.PI / 2;

    // motion
    this._dir = Math.random() < 0.5 ? 1 : -1;
    this._x = 0;
    this._y = 0;
    this._phase = Math.random() * Math.PI * 2;
    this._speed = 0.3;
    this._bobAmp = 0.03;
    this._bobRate = 0.9;
    this._turnCooldown = 0;

    // bounds
    this._xMin = -1;
    this._xMax = 1;
    this._yMin = -1;
    this._yMax = 1;

    // approximates half-extents in world units (computed after load + scale)
    // used so fish never clips off-screen before flipping direction
    this._halfW = 0.12;
    this._halfH = 0.08;

    // animation
    this._mixer = null;
    this._clipAction = null;
    this._animSpeed = 1.0;

    // procedural wiggle
    this._procedural = false;
    this._rootBaseRot = new THREE.Euler(0, 0, 0);

    // loaded root
    this._root = null;
    this._eyes = null;
    this._disposables = [];

    // spawn stabiliser: keeps internal state synced to externally-driven hatch motion
    this._spawnLocked = true;
    this._spawnLockTime = 0.35; // shorter, just enough to avoid initial jitter

    this._syncBounds();
    this._spawnInitialPosition();
    this._load();
  }

  setBounds(width, height, aquarium) {
    this.width = width;
    this.height = height;
    if (aquarium) this.aquarium = aquarium;
    this._syncBounds();
    this._clampToBounds();
    this._rescaleToView();
  }

  update(dt, t) {
    if (!dt) return;

    // spawn stabiliser:
    // continuously syncs internal _x/_y from current rendered position
    // - when unlocking, align phase so bob starts at 0 (prevents sudden down-teleport)
    if (this._spawnLocked) {
      this._spawnLockTime = Math.max(0, this._spawnLockTime - dt);

      // pulls current rendered position into logic state
      this._x = this.group.position.x;
      this._y = this.group.position.y;

      if (this._mixer) this._mixer.update(dt * this._animSpeed);

      if (this._root && this._procedural) {
        const w = (t + this._phase) * this.wiggleRate;

        const wag = Math.sin(w) * this.wiggleAmp;
        const roll = Math.sin(w * 0.85 + 0.8) * (this.wiggleAmp * 0.28);
        const push = Math.sin(w * 2.0) * (this.wiggleAmp * 0.10);

        this._root.rotation.y = this._rootBaseRot.y + wag;
        this._root.rotation.z = this._rootBaseRot.z + roll;
        this._root.position.x = push;
      }

      if (this._spawnLockTime <= 0) {
        // starts bob at 0 so first "real" frame cannot jump down
        this._phase = -t;
        this._spawnLocked = false;

        // snaps logic to bounds once, but doesnt move render position
        this._clampToBounds();
        this._applyFacing();
      }
      return;
    }

    if (this._turnCooldown > 0) this._turnCooldown = Math.max(0, this._turnCooldown - dt);

    this._x += this._dir * this._speed * dt;

    if (this._x > this._xMax) {
      this._x = this._xMax;
      this._flip(-1);
    } else if (this._x < this._xMin) {
      this._x = this._xMin;
      this._flip(1);
    }

    const driftY = 0.03 * Math.sin((this._phase + t * 0.7) * 0.55);
    this._y = THREE.MathUtils.clamp(this._y + driftY * dt, this._yMin, this._yMax);

    const bob = Math.sin((this._phase + t) * this._bobRate) * this._bobAmp;

    // clamps after bob so it still stays inside camera bounds
    this.group.position.x = this._x;
    this.group.position.y = THREE.MathUtils.clamp(this._y + bob, this._yMin, this._yMax);

    if (this._mixer) this._mixer.update(dt * this._animSpeed);

    if (this._root && this._procedural) {
      const w = (t + this._phase) * this.wiggleRate;

      const wag = Math.sin(w) * this.wiggleAmp;
      const roll = Math.sin(w * 0.85 + 0.8) * (this.wiggleAmp * 0.28);
      const push = Math.sin(w * 2.0) * (this.wiggleAmp * 0.10);

      this._root.rotation.y = this._rootBaseRot.y + wag;
      this._root.rotation.z = this._rootBaseRot.z + roll;
      this._root.position.x = push;
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
    this._eyes = null;

    for (const d of this._disposables) {
      if (d && typeof d.dispose === "function") d.dispose();
    }
    this._disposables.length = 0;
  }

  _syncBounds() {
    const w = this.width;
    const h = this.height;

    const marginX = Math.max(0.08 * w, 0.18);
    const topMargin = Math.max(0.10 * h, 0.16);

    const sandBedH = h * 0.22;
    const sandTopY = -h / 2 + sandBedH;
    const sandMargin = Math.max(0.08 * h, 0.12);

    this._xMin = -w / 2 + marginX + this._halfW;
    this._xMax = w / 2 - marginX - this._halfW;

    this._yMin = sandTopY + sandMargin + this._halfH;
    // hard top wall: doesn't let common fish enter surface band
    if (this.aquarium && typeof this.aquarium.innerTop === "number") {
      this._yMax = this.aquarium.innerTop - this._halfH;
    } else {
      this._yMax = h / 2 - topMargin - this._halfH;
    }

    const base = w * 0.12;
    this._speed = THREE.MathUtils.clamp(base, 0.18, 0.75);
    this._bobAmp = THREE.MathUtils.clamp(h * 0.012, 0.018, 0.045);
  }

  _spawnInitialPosition() {
    this._x = THREE.MathUtils.lerp(this._xMin, this._xMax, 0.25 + 0.5 * Math.random());
    this._y = THREE.MathUtils.lerp(this._yMin, this._yMax, 0.20 + 0.6 * Math.random());
    this._applyFacing();
  }

  _clampToBounds() {
    this._x = THREE.MathUtils.clamp(this._x, this._xMin, this._xMax);
    this._y = THREE.MathUtils.clamp(this._y, this._yMin, this._yMax);
  }

  _flip(nextDir) {
    if (this._turnCooldown > 0) return;
    this._dir = nextDir;
    this._turnCooldown = 0.12;
    this._applyFacing();
  }

  _applyFacing() {
    const flip = (this._dir >= 0) ? 0 : Math.PI;
    this.group.rotation.y = this._baseYaw + flip + this.facingFix;

    // keeps eyes flattened in tank depth (world z) even when fish yaws
    if (this._eyes && this._eyes.userData && this._eyes.userData.eyePivots) {
      const pivots = this._eyes.userData.eyePivots;
      for (const p of pivots) {
        p.rotation.y = -this.group.rotation.y;
      }
    }
  }

  _load() {
    const loader = new GLTFLoader();

    loader.load(
      this.url,
      (gltf) => {
        const root = gltf.scene || new THREE.Group();
        root.name = "fish";

        root.traverse((o) => {
          if (!o || !o.isMesh) return;

          o.castShadow = false;
          o.receiveShadow = false;
          o.renderOrder = 3;

          const oldMat = o.material;
          const baseCol = (oldMat && oldMat.color) ? oldMat.color.clone() : new THREE.Color(0xc9c9c9);

          const mat = new THREE.MeshBasicMaterial({
            color: baseCol,
            transparent: !!(oldMat && oldMat.transparent),
            opacity: 1,
            depthTest: true,
            depthWrite: true
          });

          o.material = mat;

          if (o.geometry) this._disposables.push(o.geometry);
          this._disposables.push(mat);

          const oldList = Array.isArray(oldMat) ? oldMat : [oldMat];
          for (const m of oldList) {
            if (m && typeof m.dispose === "function") m.dispose();
          }
        });

        this._root = root;
        this.group.add(root);

        const hasAnims = !!(gltf.animations && gltf.animations.length);

        if (hasAnims && !this.forceProcedural) {
          this._mixer = new THREE.AnimationMixer(root);

          let clip = gltf.animations[0];
          for (const c of gltf.animations) {
            const n = (c && c.name) ? c.name.toLowerCase() : "";
            if (n.includes("swim")) {
              clip = c;
              break;
            }
          }

          this._clipAction = this._mixer.clipAction(clip);
          this._clipAction.play();

          this._procedural = false;
        } else {
          this._mixer = null;
          this._clipAction = null;
          this._procedural = true;
          this._rootBaseRot.copy(root.rotation);
        }

        this._rescaleToView();
        this._applyFacing();
      },
      undefined,
      (err) => {
        console.warn("CommonFish load failed:", this.url, err);
      }
    );
  }

  _rescaleToView() {
    if (!this._root) return;

    const targetLen = (Math.max(0.22, this.width * 0.16) / 3) * this.scaleMul;

    const box = new THREE.Box3().setFromObject(this._root);
    const size = new THREE.Vector3();
    box.getSize(size);

    const longest = Math.max(1e-6, size.x, size.y, size.z);
    const s = targetLen / longest;

    this._root.scale.setScalar(s);

    const box2 = new THREE.Box3().setFromObject(this._root);
    const centre = new THREE.Vector3();
    box2.getCenter(centre);
    this._root.position.sub(centre);

    this._root.position.z = 0;

    this._rootBaseRot.copy(this._root.rotation);

    // computes visible half-extents after scaling so bounds are correct
    const box3 = new THREE.Box3().setFromObject(this._root);
    const size3 = new THREE.Vector3();
    box3.getSize(size3);
    this._halfW = Math.max(0.06, size3.x * 0.5);
    this._halfH = Math.max(0.05, size3.y * 0.5);

    this._syncBounds();
    this._clampToBounds();

    //  doesn't stomp externally-set positions (fresh hatch may already be placed)
    // if group position is still at origin, initialise it from _x/_y; otherwise sync _x/_y from group
    const eps = 1e-6;
    const atOrigin = (Math.abs(this.group.position.x) < eps) && (Math.abs(this.group.position.y) < eps);
    if (atOrigin) {
      this.group.position.x = this._x;
      this.group.position.y = this._y;
    } else {
      this._x = this.group.position.x;
      this._y = this.group.position.y;
      this._clampToBounds();
    }

    if (this.addEye) this._addEyeManual();
  }

  _addEyeManual() {
    if (!this._root) return;

    if (this._eyes) {
      this._root.remove(this._eyes);
      this._eyes = null;
    }

    const EYE_R = (this.eye && typeof this.eye.r === "number") ? this.eye.r : 0.026;
    const EYE_X = (this.eye && typeof this.eye.x === "number") ? this.eye.x : 1.32;
    const EYE_Y = (this.eye && typeof this.eye.y === "number") ? this.eye.y : -0.02;
    const EYE_Z = (this.eye && typeof this.eye.z === "number") ? this.eye.z : 0.37;
    const EYE_COLOR = (this.eye && typeof this.eye.color === "number") ? this.eye.color : 0x332d28;

    const MIRROR_X = (this.eye && typeof this.eye.mirrorX === "number") ? this.eye.mirrorX : 1.0;

    const eyes = new THREE.Group();
    eyes.name = "eyes";
    eyes.renderOrder = 3;

    const geom = new THREE.SphereGeometry(EYE_R, 14, 14);
    const mat = new THREE.MeshBasicMaterial({
      color: EYE_COLOR,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -0.5,
      polygonOffsetUnits: -0.5
    });

    this._disposables.push(geom);
    this._disposables.push(mat);

    // makes each eye a pivot so can cancel fish yaw and keep "flat" axis aligned to tank depth
    const pivots = [];

    const makeEyePivot = (px) => {
      const pivot = new THREE.Group();
      pivot.renderOrder = 3;
      pivot.position.set(px, EYE_Y, EYE_Z);

      const eyeMesh = new THREE.Mesh(geom, mat);
      eyeMesh.renderOrder = 3;
      eyeMesh.position.set(0, 0, 0);

      // squashes eye along its local z, then cancels yaw on pivot in _applyFacing()
      eyeMesh.scale.set(1.0, 1.0, 0.15);

      pivot.add(eyeMesh);
      pivots.push(pivot);
      return pivot;
    };

    const eye1Pivot = makeEyePivot(EYE_X);
    eyes.add(eye1Pivot);

    if (MIRROR_X > 0) {
      const eye2Pivot = makeEyePivot(-EYE_X * MIRROR_X);
      eyes.add(eye2Pivot);
    }

    eyes.userData.eyePivots = pivots;

    this._eyes = eyes;
    this._root.add(eyes);

    // applies current facing immediately so pivots get aligned right away
    this._applyFacing();
  }
}
