/*jshint esversion: 6 */
// @ts-check

/*
 * Aquarium Game (P3) - Schooling Fish
 *
 * goals:
 * - loads fish models that swim as a small school (simple flocking)
 * - prefers built-in swim clip if present, otherwise do procedural wiggle
 * - renders even if there are no lights (use MeshBasicMaterial)
 * - stays inside bounds and above sand
 * - keeps behaviour stable and predictable (no teleporting)
 *
 * notes:
 * - each instance is one fish
 * - fishes with same schoolId share a "leader" target and loosely follow it
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export class SchoolingFish {
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
   * @param {string} [opts.schoolId]
   * @param {number} [opts.memberIndex]
   * @param {number} [opts.schoolSize]
   */
  constructor(opts) {
    this.width = opts.width;
    this.height = opts.height;
    this.depth = opts.depth || 6;
    this.mode = opts.mode || "prototype";
    this.url = opts.url || "assets/fish/fish2.glb";

    this.aquarium = opts.aquarium || null;

    this.scaleMul = (typeof opts.scaleMul === "number") ? opts.scaleMul : 1.0;
    this.facingFix = (typeof opts.facingFix === "number") ? opts.facingFix : 0.0;

    // fish2.glb and bass.glb are authored facing the opposite direction relative to our x-axis swim
    // if facingFix is left at 0, auto-flip them so they don't swim backwards
    if (this.facingFix === 0.0) {
      const u = (this.url || "");
      if (u.includes("fish2.glb") || u.includes("bass.glb")) this.facingFix = Math.PI;
    }

    this.speedMul = (typeof opts.speedMul === "number") ? opts.speedMul : 1.0;

    this.zLayer = (typeof opts.zLayer === "number") ? opts.zLayer : 0.0;

    this.schoolId = (typeof opts.schoolId === "string" && opts.schoolId) ? opts.schoolId : "school_default";
    this.memberIndex = (typeof opts.memberIndex === "number") ? opts.memberIndex : 0;
    this.schoolSize = (typeof opts.schoolSize === "number" && opts.schoolSize > 0) ? opts.schoolSize : 2;

    this.group = new THREE.Group();
    this.group.name = "schoolingFish";
    this.group.position.z = 1.15 + this.zLayer;
    this.group.renderOrder = 3;

    // swims left/right along x
    this._baseYaw = Math.PI / 2;

    // movement state
    this._x = 0;
    this._y = 0;
    this._vx = 0;
    this._vy = 0;

    this._phase = Math.random() * Math.PI * 2;

    // calmer defaults (less spazz)
    const jitter = 0.90 + 0.22 * Math.random();
    this._maxSpeed = 0.62 * jitter * this.speedMul;
    this._maxAccel = 1.45 * jitter;

    // damping kills twitch near target
    this._velDamp = 0.92;

    // bobs
    this._bobAmp = 0.018 + 0.008 * Math.random();
    this._bobRate = 0.90 + 0.22 * Math.random();

    // bounds
    this._xMin = -1;
    this._xMax = 1;
    this._yMin = -1;
    this._yMax = 1;

    // strict buffer under rim
    this._topBuffer = 0.14;

    // half-extents
    this._halfW = 0.12;
    this._halfH = 0.08;

    // animation
    this._mixer = null;
    this._clipAction = null;
    this._animSpeed = 1.0;

    // procedural wiggle fallback
    this._procedural = false;
    this._rootBaseRot = new THREE.Euler(0, 0, 0);
    this._wiggleAmp = 0.28;
    this._wiggleRate = 3.0;

    // facing stability
    this._faceDir = (Math.random() < 0.5) ? 1 : -1;
    this._faceFlipThreshold = 0.06;

    // proper hold logic
    this._faceHoldDir = 0;
    this._faceHoldT = 0;
    this._faceHoldTime = 0.22;

    this._root = null;
    this._disposables = [];

    this._syncBounds();
    this._spawnInitialPosition();

    // registers school
    this._school = SchoolingFish._getSchool(this.schoolId, this.width, this.height, this.aquarium);
    this._school.sizeHint = Math.max(this._school.sizeHint, this.schoolSize);
    this._school.leaderHalfH = this._halfH;
    this._school.topBuffer = this._topBuffer;

    this._load();
  }

  setBounds(width, height, aquarium) {
    this.width = width;
    this.height = height;
    if (aquarium) this.aquarium = aquarium;

    this._syncBounds();
    this._clampToBounds();

    if (this._school) {
      this._school.width = width;
      this._school.height = height;
      if (aquarium) this._school.aquarium = aquarium;
      this._school.needsRespawn = true;

      this._school.leaderHalfH = this._halfH;
      this._school.topBuffer = this._topBuffer;
    }

    this._rescaleToView();
  }

  /**
   * apply facing even when update() is being skipped (hatch lift)
   */
  _applyFacingNow() {
    const flip = (this._faceDir >= 0) ? 0 : Math.PI;
    this.group.rotation.y = this._baseYaw + flip + this.facingFix;
  }

  update(dt, t) {
    if (!dt) return;

    if (!this._school) {
      this._school = SchoolingFish._getSchool(this.schoolId, this.width, this.height, this.aquarium);
    }

    SchoolingFish._tickSchool(this._school, dt);

    const leader = this._school.leader;

    const behind = 0.18 + 0.08 * (this.schoolSize - 1);
    const along = -behind * (this.memberIndex / Math.max(1, this.schoolSize - 1));

    const lateral = (this.memberIndex - (this.schoolSize - 1) * 0.5) * 0.085;
    const vertical = Math.sin(this._phase + t * 0.55) * 0.022;

    const lv = new THREE.Vector2(leader.vx, leader.vy);
    if (lv.lengthSq() < 1e-6) lv.set(1, 0);
    lv.normalize();

    const perp = new THREE.Vector2(-lv.y, lv.x);

    const targetX = leader.x + lv.x * along + perp.x * lateral;
    const targetY = leader.y + lv.y * along + perp.y * lateral + vertical;

    const dx = targetX - this._x;
    const dy = targetY - this._y;

    const desire = new THREE.Vector2(dx, dy);
    const dist = desire.length();

    let desiredSpeed = this._maxSpeed;
    if (dist < 0.55) desiredSpeed *= THREE.MathUtils.clamp(dist / 0.55, 0.08, 1.0);

    if (dist > 1e-6) desire.multiplyScalar(1 / dist);
    desire.multiplyScalar(desiredSpeed);

    const steerX = desire.x - this._vx;
    const steerY = desire.y - this._vy;

    const steerLen = Math.sqrt(steerX * steerX + steerY * steerY) || 1e-6;
    const accelMag = Math.min(this._maxAccel, steerLen / dt);

    const ax = (steerX / steerLen) * accelMag;
    const ay = (steerY / steerLen) * accelMag;

    this._vx += ax * dt;
    this._vy += ay * dt;

    const damp = Math.pow(this._velDamp, dt);
    this._vx *= damp;
    this._vy *= damp;

    const sp = Math.sqrt(this._vx * this._vx + this._vy * this._vy) || 1e-6;
    const maxSp = this._maxSpeed;
    if (sp > maxSp) {
      this._vx = (this._vx / sp) * maxSp;
      this._vy = (this._vy / sp) * maxSp;
    }

    this._x += this._vx * dt;
    this._y += this._vy * dt;

    if (this._x > this._xMax) { this._x = this._xMax; this._vx = -Math.abs(this._vx) * 0.55; }
    else if (this._x < this._xMin) { this._x = this._xMin; this._vx = Math.abs(this._vx) * 0.55; }

    if (this._y > this._yMax) { this._y = this._yMax; this._vy = -Math.abs(this._vy) * 0.55; }
    else if (this._y < this._yMin) { this._y = this._yMin; this._vy = Math.abs(this._vy) * 0.55; }

    const bob = Math.sin((this._phase + t) * this._bobRate) * this._bobAmp;

    const yMaxWithBob = this._yMax - this._bobAmp;
    const yMinWithBob = this._yMin + this._bobAmp;

    this.group.position.x = this._x;
    this.group.position.y = THREE.MathUtils.clamp(this._y + bob, yMinWithBob, yMaxWithBob);

    // facing hold
    if (this._vx > this._faceFlipThreshold) {
      if (this._faceHoldDir !== 1) { this._faceHoldDir = 1; this._faceHoldT = 0; }
      this._faceHoldT += dt;
      if (this._faceHoldT >= this._faceHoldTime) this._faceDir = 1;
    } else if (this._vx < -this._faceFlipThreshold) {
      if (this._faceHoldDir !== -1) { this._faceHoldDir = -1; this._faceHoldT = 0; }
      this._faceHoldT += dt;
      if (this._faceHoldT >= this._faceHoldTime) this._faceDir = -1;
    } else {
      this._faceHoldDir = 0;
      this._faceHoldT = 0;
    }

    this._applyFacingNow();

    if (this._mixer) this._mixer.update(dt * this._animSpeed);

    if (this._root && this._procedural) {
      const w = (t + this._phase) * this._wiggleRate;

      const wag = Math.sin(w) * this._wiggleAmp;
      const roll = Math.sin(w * 0.85 + 0.7) * (this._wiggleAmp * 0.24);
      const pitch = Math.sin(w * 0.55 + 1.1) * (this._wiggleAmp * 0.14);
      const push = Math.sin(w * 2.2) * (this._wiggleAmp * 0.09);

      this._root.rotation.y = this._rootBaseRot.y + wag;
      this._root.rotation.z = this._rootBaseRot.z + roll;
      this._root.rotation.x = this._rootBaseRot.x + pitch;
      this._root.position.x = push;
    }
  }

  dispose() {
    if (this._clipAction) { this._clipAction.stop(); this._clipAction = null; }
    if (this._mixer) { this._mixer.stopAllAction(); this._mixer = null; }
    if (this._root) { this.group.remove(this._root); this._root = null; }

    for (const d of this._disposables) {
      if (d && typeof d.dispose === "function") d.dispose();
    }
    this._disposables.length = 0;
  }

  _syncBounds() {
    const w = this.width;
    const h = this.height;

    const marginX = Math.max(0.08 * w, 0.18);
    this._topBuffer = Math.max(0.04 * h, 0.14);

    const sandBedH = h * 0.22;
    const sandTopY = -h / 2 + sandBedH;
    const sandMargin = Math.max(0.08 * h, 0.12);

    this._xMin = -w / 2 + marginX + this._halfW;
    this._xMax = w / 2 - marginX - this._halfW;

    this._yMin = sandTopY + sandMargin + this._halfH;

    if (this.aquarium && typeof this.aquarium.innerTop === "number") {
      this._yMax = this.aquarium.innerTop - this._topBuffer - this._halfH;
    } else {
      this._yMax = (h / 2) - this._topBuffer - this._halfH;
    }

    const base = w * 0.19;
    this._maxSpeed = THREE.MathUtils.clamp(base, 0.28, 0.92) * this.speedMul;
    this._maxAccel = THREE.MathUtils.clamp(base * 2.15, 0.95, 2.45);

    this._faceFlipThreshold = THREE.MathUtils.clamp(this._maxSpeed * 0.12, 0.045, 0.13);

    if (this._school) {
      this._school.leaderHalfH = this._halfH;
      this._school.topBuffer = this._topBuffer;
    }
  }

  _spawnInitialPosition() {
    this._x = THREE.MathUtils.lerp(this._xMin, this._xMax, 0.25 + 0.5 * Math.random());
    this._y = THREE.MathUtils.lerp(this._yMin, this._yMax, 0.25 + 0.55 * Math.random());

    this.group.position.x = this._x;
    this.group.position.y = this._y;

    this._vx = (Math.random() * 2 - 1) * 0.12;
    this._vy = (Math.random() * 2 - 1) * 0.06;

    this._faceDir = (this._vx >= 0) ? 1 : -1;
    this._applyFacingNow();
  }

  _clampToBounds() {
    this._x = THREE.MathUtils.clamp(this._x, this._xMin, this._xMax);
    this._y = THREE.MathUtils.clamp(this._y, this._yMin, this._yMax);
    this.group.position.x = this._x;
    this.group.position.y = this._y;
    this._applyFacingNow();
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

          const texMap = (oldMat && oldMat.map) ? oldMat.map : null;
          const alphaMap = (oldMat && oldMat.alphaMap) ? oldMat.alphaMap : null;

          const mat = new THREE.MeshBasicMaterial({
            color: baseCol,
            map: texMap,
            alphaMap: alphaMap,
            transparent: !!(oldMat && (oldMat.transparent || alphaMap)),
            opacity: 1,
            alphaTest: (oldMat && typeof oldMat.alphaTest === "number") ? oldMat.alphaTest : (alphaMap ? 0.5 : 0.0),
            depthTest: true,
            depthWrite: true
          });

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

        if (hasAnims) {
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
      },
      undefined,
      (err) => {
        console.warn("SchoolingFish load failed:", this.url, err);
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

    const box3 = new THREE.Box3().setFromObject(this._root);
    const size3 = new THREE.Vector3();
    box3.getSize(size3);
    this._halfW = Math.max(0.06, size3.x * 0.5);
    this._halfH = Math.max(0.05, size3.y * 0.5);

    this._syncBounds();

    // do not stomp hatch position when model finishes loading
    const eps = 1e-6;
    const atOrigin = (Math.abs(this.group.position.x) < eps) && (Math.abs(this.group.position.y) < eps);

    if (atOrigin) {
      this._clampToBounds();
    } else {
      this._x = THREE.MathUtils.clamp(this.group.position.x, this._xMin, this._xMax);
      this._y = THREE.MathUtils.clamp(this.group.position.y, this._yMin, this._yMax);
      this.group.position.x = this._x;
      this.group.position.y = this._y;
      this._applyFacingNow();
    }

    if (this._school) {
      this._school.leaderHalfH = this._halfH;
      this._school.topBuffer = this._topBuffer;
      this._school.needsRespawn = true;
    }
  }

  /* ------------------------------------------------------------------ */
  /* shared school state                                                  */
  /* ------------------------------------------------------------------ */

  static _getSchool(id, width, height, aquarium) {
    if (!SchoolingFish._schools) SchoolingFish._schools = new Map();

    let s = SchoolingFish._schools.get(id);
    if (!s) {
      s = {
        id,
        width,
        height,
        aquarium: aquarium || null,
        sizeHint: 2,
        needsRespawn: true,
        leaderHalfH: 0.08,
        topBuffer: 0.14,
        leader: { x: 0, y: 0, vx: 0.30, vy: 0.06 },
        timer: 0,
        target: { x: 0, y: 0 }
      };
      SchoolingFish._schools.set(id, s);
    } else {
      s.width = width;
      s.height = height;
      if (aquarium) s.aquarium = aquarium;
    }
    return s;
  }

  static _tickSchool(s, dt) {
    if (!s) return;

    if (s.needsRespawn) {
      s.needsRespawn = false;
      s.timer = 0;
      s.leader.x = 0;
      s.leader.y = 0;
      s.leader.vx = 0.30 * (Math.random() < 0.5 ? 1 : -1);
      s.leader.vy = 0.06 * (Math.random() * 2 - 1);
      SchoolingFish._pickNewTarget(s);
    }

    s.timer -= dt;
    if (s.timer <= 0) SchoolingFish._pickNewTarget(s);

    const w = s.width;
    const h = s.height;

    const marginX = Math.max(0.10 * w, 0.22);

    const sandBedH = h * 0.22;
    const sandTopY = -h / 2 + sandBedH;
    const sandMargin = Math.max(0.10 * h, 0.14);

    const xMin = -w / 2 + marginX;
    const xMax = w / 2 - marginX;

    const yMin = sandTopY + sandMargin;

    let yMax = (h / 2) - (s.topBuffer || 0.14) - (s.leaderHalfH || 0);
    if (s.aquarium && typeof s.aquarium.innerTop === "number") {
      yMax = s.aquarium.innerTop - (s.topBuffer || 0.14) - (s.leaderHalfH || 0);
    }

    const dx = s.target.x - s.leader.x;
    const dy = s.target.y - s.leader.y;

    const dist = Math.sqrt(dx * dx + dy * dy) || 1e-6;

    const maxSpeed = THREE.MathUtils.clamp(w * 0.15, 0.22, 0.80);
    const maxAccel = THREE.MathUtils.clamp(w * 0.42, 0.55, 1.45);

    let desiredSpeed = maxSpeed;
    if (dist < 0.55) desiredSpeed *= THREE.MathUtils.clamp(dist / 0.55, 0.10, 1.0);

    const dvx = (dx / dist) * desiredSpeed - s.leader.vx;
    const dvy = (dy / dist) * desiredSpeed - s.leader.vy;

    const dLen = Math.sqrt(dvx * dvx + dvy * dvy) || 1e-6;

    const ax = (dvx / dLen) * Math.min(maxAccel, dLen / dt);
    const ay = (dvy / dLen) * Math.min(maxAccel, dLen / dt);

    s.leader.vx += ax * dt;
    s.leader.vy += ay * dt;

    const ld = Math.pow(0.90, dt);
    s.leader.vx *= ld;
    s.leader.vy *= ld;

    const sp = Math.sqrt(s.leader.vx * s.leader.vx + s.leader.vy * s.leader.vy) || 1e-6;
    if (sp > maxSpeed) {
      s.leader.vx = (s.leader.vx / sp) * maxSpeed;
      s.leader.vy = (s.leader.vy / sp) * maxSpeed;
    }

    s.leader.x += s.leader.vx * dt;
    s.leader.y += s.leader.vy * dt;

    if (s.leader.x > xMax) { s.leader.x = xMax; s.leader.vx = -Math.abs(s.leader.vx) * 0.65; }
    else if (s.leader.x < xMin) { s.leader.x = xMin; s.leader.vx = Math.abs(s.leader.vx) * 0.65; }

    if (s.leader.y > yMax) { s.leader.y = yMax; s.leader.vy = -Math.abs(s.leader.vy) * 0.65; }
    else if (s.leader.y < yMin) { s.leader.y = yMin; s.leader.vy = Math.abs(s.leader.vy) * 0.65; }
  }

  static _pickNewTarget(s) {
    const w = s.width;
    const h = s.height;

    const marginX = Math.max(0.12 * w, 0.26);

    const sandBedH = h * 0.22;
    const sandTopY = -h / 2 + sandBedH;
    const sandMargin = Math.max(0.10 * h, 0.14);

    const xMin = -w / 2 + marginX;
    const xMax = w / 2 - marginX;

    const yMin = sandTopY + sandMargin + (0.06 * h);

    let yMax = (h / 2) - (s.topBuffer || 0.14) - (s.leaderHalfH || 0);
    if (s.aquarium && typeof s.aquarium.innerTop === "number") {
      yMax = s.aquarium.innerTop - (s.topBuffer || 0.14) - (s.leaderHalfH || 0);
    }

    s.target.x = THREE.MathUtils.lerp(xMin, xMax, 0.18 + 0.64 * Math.random());
    s.target.y = THREE.MathUtils.lerp(yMin, yMax, 0.18 + 0.64 * Math.random());

    s.timer = 2.8 + Math.random() * 2.4;
  }
}
