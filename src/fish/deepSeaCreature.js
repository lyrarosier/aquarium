/*jshint esversion: 6 */
// @ts-check

/*
 * Aquarium Game (P3) - Deep Sea Creature (Octopus)
 *
 * goals:
 * - load a deep sea creature model (glb)
 * - prefer built-in animation clips (most do have them)
 * - render even if there are no lights (MeshBasicMaterial)
 * - stay inside bounds and above sand
 * - allow per-creature zLayer to avoid weird overlap fights
 *
 * expects:
 * - assets/fish/octo.glb
 * - assets/fish/anglerfish.glb
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export class DeepSeaCreature {
  /**
   * @param {object} opts
   * @param {number} opts.width
   * @param {number} opts.height
   * @param {number} [opts.depth]
   * @param {"prototype"|"full"} [opts.mode]
   * @param {string} [opts.url]
   *
   * @param {number} [opts.scaleMul]
   * @param {number} [opts.facingFix]
   * @param {number} [opts.speedMul]
   * @param {number} [opts.zLayer]
   *
   * @param {boolean} [opts.proceduralWiggle]   force procedural even if anim exists
   * @param {number} [opts.wiggleAmp]
   * @param {number} [opts.wiggleRate]
   */
  constructor(opts) {
    this.width = opts.width;
    this.height = opts.height;
    this.depth = opts.depth || 6;
    this.mode = opts.mode || "prototype";
    this.url = opts.url || "assets/fish/octo.glb";

    this.scaleMul = (typeof opts.scaleMul === "number") ? opts.scaleMul : 0.75;
    this.facingFix = (typeof opts.facingFix === "number") ? opts.facingFix : 0.0;
    this.speedMul = (typeof opts.speedMul === "number") ? opts.speedMul : 0.78;

    // depth separation so overlap is stable
    this.zLayer = (typeof opts.zLayer === "number") ? opts.zLayer : 0.0;

    this.forceProcedural = !!opts.proceduralWiggle;
    this.wiggleAmp = (typeof opts.wiggleAmp === "number") ? opts.wiggleAmp : 0.18;
    this.wiggleRate = (typeof opts.wiggleRate === "number") ? opts.wiggleRate : 1.9;

    this.group = new THREE.Group();
    this.group.name = "deepSeaCreature";

    // in front of sand (sand z is 0.45)
    this.group.position.z = 1.15 + this.zLayer;
    this.group.renderOrder = 3;

    // swims left/right along x
    this._baseYaw = Math.PI / 2;

    // motion state (deep sea: slower, floatier)
    this._dir = Math.random() < 0.5 ? 1 : -1;
    this._x = 0;
    this._y = 0;

    this._phase = Math.random() * Math.PI * 2;

    this._speed = 0.22;
    this._bobAmp = 0.050;
    this._bobRate = 0.65;

    this._driftAmp = 0.05;
    this._driftRate = 0.32;

    this._turnCooldown = 0;

    // bounds
    this._xMin = -1;
    this._xMax = 1;
    this._yMin = -1;
    this._yMax = 1;

    // animation
    this._mixer = null;
    this._clipAction = null;
    this._animSpeed = 1.0;

    // loaded root
    this._root = null;
    this._halfWidth = 0.15; // fallback until model loads
    this._rootBaseRot = new THREE.Euler(0, 0, 0);
    this._procedural = false;

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

    // gentle vertical drift + bob (deep sea float)
    const drift = this._driftAmp * Math.sin((this._phase + t * this._driftRate) * 2.0);
    this._y = THREE.MathUtils.clamp(this._y + drift * dt, this._yMin, this._yMax);

    const bob = Math.sin((this._phase + t) * this._bobRate) * this._bobAmp;

    this.group.position.x = this._x;
    this.group.position.y = this._y + bob;

    if (this._mixer) this._mixer.update(dt * this._animSpeed);

    // fallback wiggle (only if no anims or forced)
    if (this._root && this._procedural) {
      const w = (t + this._phase) * this.wiggleRate;

      const yaw = Math.sin(w) * this.wiggleAmp;
      const roll = Math.sin(w * 0.8 + 0.6) * (this.wiggleAmp * 0.35);
      const pitch = Math.sin(w * 0.55 + 1.1) * (this.wiggleAmp * 0.20);

      this._root.rotation.y = this._rootBaseRot.y + yaw;
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
    const topMargin = Math.max(0.14 * h, 0.20);

    // sand geometry
    const sandBedH = h * 0.22;
    const sandTopY = -h / 2 + sandBedH;

    // deep-sea fish should hug the sand line
    const sandClearance = Math.max(0.04 * h, 0.06); // just above sand
    const bandHeight = Math.max(0.16 * h, 0.22);   // shallow vertical band

    this._xMin = -w / 2 + marginX;
    this._xMax =  w / 2 - marginX;

    this._yMin = sandTopY + sandClearance;
    this._yMax = this._yMin + bandHeight;

    // slower, heavier motion
    const base = w * 0.10;
    this._speed = THREE.MathUtils.clamp(base, 0.14, 0.55);
    this._bobAmp = THREE.MathUtils.clamp(h * 0.016, 0.025, 0.050);
  }

  _spawnInitialPosition() {
    this._x = THREE.MathUtils.lerp(this._xMin, this._xMax, 0.25 + 0.5 * Math.random());
    this._y = THREE.MathUtils.lerp(this._yMin, this._yMax, 0.28 + 0.55 * Math.random());
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
    this._turnCooldown = 0.12;
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
        root.name = "deepSea";

        root.traverse((o) => {
          if (!o || !o.isMesh) return;

          o.castShadow = false;
          o.receiveShadow = false;
          o.renderOrder = 3;

          const oldMat = o.material;
          const baseCol = (oldMat && oldMat.color) ? oldMat.color.clone() : new THREE.Color(0xc9c9c9);

          // FIX TEXTURES: preserve maps when swapping to MeshBasicMaterial
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

        if (hasAnims && !this.forceProcedural) {
          this._mixer = new THREE.AnimationMixer(root);

          let clip = gltf.animations[0];
          for (const c of gltf.animations) {
            const n = (c && c.name) ? c.name.toLowerCase() : "";
            if (n.includes("swim") || n.includes("idle") || n.includes("float")) { clip = c; break; }
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
        console.warn("DeepSeaCreature load failed:", this.url, err);
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
  }
}
