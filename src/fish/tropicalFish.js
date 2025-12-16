/*jshint esversion: 6 */
// @ts-check

/*
 * Aquarium Game (P3) - Tropical Fish
 *
 * goals:
 * - loads one tropical fish model (glb)
 * - prefers built-in swim clip if present
 * - otherwise do a lively procedural swim (more agile than common fish)
 * - renders even if there are no lights (use MeshBasicMaterial)
 * - stays inside bounds and above sand
 * - adds simple eye (optional)
 *
 * expects:
 * - assets/fish/dory.glb (default)
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export class TropicalFish {
  /**
   * @param {object} opts
   * @param {number} opts.width
   * @param {number} opts.height
   * @param {number} [opts.depth]
   * @param {"prototype"|"full"} [opts.mode]
   * @param {string} [opts.url]
   *
   * @param {boolean} [opts.addEye]
   * @param {object} [opts.eye]
   * @param {number} [opts.eye.r]
   * @param {number} [opts.eye.x]
   * @param {number} [opts.eye.y]
   * @param {number} [opts.eye.z]
   * @param {number} [opts.eye.color]
   * @param {number} [opts.eye.mirrorX]
   *
   * @param {boolean} [opts.proceduralWiggle]
   * @param {number} [opts.wiggleAmp]
   * @param {number} [opts.wiggleRate]
   * @param {number} [opts.scaleMul]
   * @param {number} [opts.facingFix]
   * @param {number} [opts.speedMul]
   * @param {number} [opts.zLayer]   tiny extra z offset so fish can occlude each other
   */
  constructor(opts) {
    this.width = opts.width;
    this.height = opts.height;
    this.depth = opts.depth || 6;
    this.mode = opts.mode || "prototype";
    this.url = opts.url || "assets/fish/dory.glb";

    // eye settings
    this.addEye = (typeof opts.addEye === "boolean") ? opts.addEye : true;
    this.eye = opts.eye || null;

    // behaviour knobs
    this.forceProcedural = !!opts.proceduralWiggle;
    this.wiggleAmp = (typeof opts.wiggleAmp === "number") ? opts.wiggleAmp : 0.34;
    this.wiggleRate = (typeof opts.wiggleRate === "number") ? opts.wiggleRate : 3.6;

    this.scaleMul = (typeof opts.scaleMul === "number") ? opts.scaleMul : 1.1;

    // default: no flip
    this.facingFix = (typeof opts.facingFix === "number") ? opts.facingFix : 0.0;

    this.speedMul = (typeof opts.speedMul === "number") ? opts.speedMul : 1.05;

    // small per-fish depth separation so overlap looks correct
    this.zLayer = (typeof opts.zLayer === "number") ? opts.zLayer : 0.0;

    this.group = new THREE.Group();
    this.group.name = "tropicalFish";

    // keeps fish in front of sand (sand z is 0.45)
    this.group.position.z = 1.15 + this.zLayer;
    this.group.renderOrder = 3;

    // rotates so it swims left/right along x
    this._baseYaw = Math.PI / 2;

    // motion state
    this._dir = Math.random() < 0.5 ? 1 : -1;
    this._x = 0;
    this._y = 0;

    this._phase = Math.random() * Math.PI * 2;

    // tropical fish: a bit faster, a bit more bob, plus a gentle swerve
    this._speed = 0.34;
    this._bobAmp = 0.036;
    this._bobRate = 1.15;

    this._swerveAmp = 0.06;
    this._swerveRate = 0.65;

    this._turnCooldown = 0;

    // bounds
    this._xMin = -1;
    this._xMax = 1;
    this._yMin = -1;
    this._yMax = 1;

    // approximates half-extents in world units (computed after load + scale)
    this._halfW = 0.12;
    this._halfH = 0.08;

    // animation
    this._mixer = null;
    this._clipAction = null;
    this._animSpeed = 1.15;

    // procedural wiggle
    this._procedural = false;
    this._rootBaseRot = new THREE.Euler(0, 0, 0);

    // loaded root
    this._root = null;
    this._eyes = null;
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

    const swerve = this._swerveAmp * Math.sin((this._phase + t * this._swerveRate) * 2.0);
    this._y = THREE.MathUtils.clamp(this._y + swerve * dt, this._yMin, this._yMax);

    const bob = Math.sin((this._phase + t) * this._bobRate) * this._bobAmp;

    this.group.position.x = this._x;
    this.group.position.y = THREE.MathUtils.clamp(this._y + bob, this._yMin, this._yMax);

    // built-in animation
    if (this._mixer) this._mixer.update(dt * this._animSpeed);

    // procedural swim
    if (this._root && this._procedural) {
      const w = (t + this._phase) * this.wiggleRate;

      const wag = Math.sin(w) * this.wiggleAmp;
      const roll = Math.sin(w * 0.9 + 0.7) * (this.wiggleAmp * 0.26);
      const pitch = Math.sin(w * 0.7 + 1.2) * (this.wiggleAmp * 0.10);

      const push = Math.sin(w * 2.2) * (this.wiggleAmp * 0.12);

      this._root.rotation.y = this._rootBaseRot.y + wag;
      this._root.rotation.z = this._rootBaseRot.z + roll;
      this._root.rotation.x = this._rootBaseRot.x + pitch;
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

    this._yMin = sandTopY + sandMargin + (0.06 * h) + this._halfH;
    this._yMax = h / 2 - topMargin - this._halfH;

    const base = w * 0.13;
    this._speed = THREE.MathUtils.clamp(base, 0.20, 0.90);
    this._bobAmp = THREE.MathUtils.clamp(h * 0.013, 0.020, 0.050);
  }

  _spawnInitialPosition() {
    this._x = THREE.MathUtils.lerp(this._xMin, this._xMax, 0.25 + 0.5 * Math.random());
    this._y = THREE.MathUtils.lerp(this._yMin, this._yMax, 0.30 + 0.55 * Math.random());
    this._applyFacing();
  }

  _clampToBounds() {
    this._x = THREE.MathUtils.clamp(this._x, this._xMin, this._xMax);
    this._y = THREE.MathUtils.clamp(this._y, this._yMin, this._yMax);
  }

  /**
   * @param {number} nextDir
   */
  _flip(nextDir) {
    if (this._turnCooldown > 0) return;
    this._dir = nextDir;
    this._turnCooldown = 0.10;
    this._applyFacing();
  }

  _applyFacing() {
    const flip = (this._dir >= 0) ? 0 : Math.PI;
    this.group.rotation.y = this._baseYaw + flip + this.facingFix;
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

          // keeps animation working for skinned/morph meshes
          if (o.isSkinnedMesh) mat.skinning = true;
          if (o.morphTargetInfluences) mat.morphTargets = true;

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
            if (n.includes("swim")) { clip = c; break; }
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
        console.warn("TropicalFish load failed:", this.url, err);
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
    this.group.position.x = this._x;
    this.group.position.y = this._y;

    if (this.addEye) this._addEyeManual();
  }

  _addEyeManual() {
    if (!this._root) return;

    if (this._eyes) {
      this._root.remove(this._eyes);
      this._eyes = null;
    }

    const urlLower = (this.url || "").toLowerCase();
    const isNemo = urlLower.includes("nemo");
    const isDory = urlLower.includes("dory");

    const fallback = isNemo ? {
      r: 0.022,
      x: 0.30,
      y: 0.010,
      z: 0.22,
      color: 0x221d1b,
      mirrorX: 1.0
    } : (isDory ? {
      r: 0.022,
      x: 0.28,
      y: 0.014,
      z: 0.22,
      color: 0x2b2422,
      mirrorX: 1.0
    } : {
      r: 0.022,
      x: 0.30,
      y: 0.012,
      z: 0.22,
      color: 0x221d1b,
      mirrorX: 1.0
    });

    const EYE_R = (this.eye && typeof this.eye.r === "number") ? this.eye.r : fallback.r;
    const EYE_X = (this.eye && typeof this.eye.x === "number") ? this.eye.x : fallback.x;
    const EYE_Y = (this.eye && typeof this.eye.y === "number") ? this.eye.y : fallback.y;
    const EYE_Z = (this.eye && typeof this.eye.z === "number") ? this.eye.z : fallback.z;
    const EYE_COLOR = (this.eye && typeof this.eye.color === "number") ? this.eye.color : fallback.color;
    const MIRROR_X = (this.eye && typeof this.eye.mirrorX === "number") ? this.eye.mirrorX : fallback.mirrorX;

    const eyes = new THREE.Group();
    eyes.name = "eyes";
    eyes.renderOrder = 3;

    const geom = new THREE.SphereGeometry(EYE_R, 14, 14);
    const mat = new THREE.MeshBasicMaterial({
      color: EYE_COLOR,

      // lets other fish occlude it
      depthTest: true,

      depthWrite: false,

      // reduces z-fighting against the head surface
      polygonOffset: true,
      polygonOffsetFactor: -0.5,
      polygonOffsetUnits: -0.5
    });

    this._disposables.push(geom);
    this._disposables.push(mat);

    const eye1 = new THREE.Mesh(geom, mat);
    eye1.renderOrder = 3;
    eye1.position.set(EYE_X, EYE_Y, EYE_Z);
    eye1.position.z += EYE_R * 0.25;
    eyes.add(eye1);

    if (MIRROR_X > 0) {
      const eye2 = new THREE.Mesh(geom, mat);
      eye2.renderOrder = 3;
      eye2.position.set(-EYE_X * MIRROR_X, EYE_Y, EYE_Z);
      eye2.position.z += EYE_R * 0.25;
      eyes.add(eye2);
    }

    this._eyes = eyes;
    this._root.add(eyes);
  }
}
