/*jshint esversion: 6 */
// @ts-check

/*
 * Aquarium Game (P3) - Ornamental Fish (Koi)
 *
 * goals:
 * - loads one ornamental fish model (glb)
 * - koi.glb is already animated and skinned, so prefer built-in swim clip
 * - renders even if there are no lights (use MeshBasicMaterial)
 * - stays inside bounds and above sand
 * - allows per-fish zLayer to avoid weird overlap fights
 *
 * expects:
 * - assets/fish/koi.glb
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export class OrnamentalFish {
  constructor(opts) {
    this.width = opts.width;
    this.height = opts.height;
    this.depth = opts.depth || 6;
    this.mode = opts.mode || "prototype";
    this.url = opts.url || "assets/fish/koi.glb";

    this.scaleMul = (typeof opts.scaleMul === "number") ? opts.scaleMul : 0.78;
    this.facingFix = (typeof opts.facingFix === "number") ? opts.facingFix : 0.0;
    this.speedMul = (typeof opts.speedMul === "number") ? opts.speedMul : 0.92;
    this.zLayer = (typeof opts.zLayer === "number") ? opts.zLayer : 0.04;

    this.forceProcedural = !!opts.proceduralWiggle;
    this.wiggleAmp = (typeof opts.wiggleAmp === "number") ? opts.wiggleAmp : 0.22;
    this.wiggleRate = (typeof opts.wiggleRate === "number") ? opts.wiggleRate : 2.2;

    this.group = new THREE.Group();
    this.group.name = "ornamentalFish";
    this.group.position.z = 1.15 + this.zLayer;
    this.group.renderOrder = 3;

    this._baseYaw = Math.PI / 2;

    this._dir = Math.random() < 0.5 ? 1 : -1;
    this._x = 0;
    this._y = 0;
    this._phase = Math.random() * Math.PI * 2;

    this._speed = 0.26;
    this._bobAmp = 0.03;
    this._bobRate = 0.85;
    this._swerveAmp = 0.045;
    this._swerveRate = 0.42;
    this._turnCooldown = 0;

    this._xMin = -1;
    this._xMax = 1;
    this._yMin = -1;
    this._yMax = 1;

    this._halfWidth = 0.18;

    this._mixer = null;
    this._clipAction = null;
    this._animSpeed = 1.0;

    this._procedural = false;
    this._rootBaseRot = new THREE.Euler();
    this._root = null;
    this._disposables = [];

    this._syncBounds();
    this._spawnInitialPosition();
    this._load();
  }

  setBounds(w, h) {
    this.width = w;
    this.height = h;
    this._syncBounds();
    this._x = THREE.MathUtils.clamp(this._x, this._xMin, this._xMax);
    this._y = THREE.MathUtils.clamp(this._y, this._yMin, this._yMax);
    this.group.position.x = this._x;
    this.group.position.y = this._y;
  }

  update(dt, t) {
    if (!dt) return;

    if (this._turnCooldown > 0) this._turnCooldown -= dt;

    this._x += this._dir * this._speed * this.speedMul * dt;

    if (this._x > this._xMax) {
      this._x = this._xMax;
      this._flip(-1);
    } else if (this._x < this._xMin) {
      this._x = this._xMin;
      this._flip(1);
    }

    const swerve = this._swerveAmp * Math.sin((this._phase + t * this._swerveRate) * 2);
    this._y = THREE.MathUtils.clamp(this._y + swerve * dt, this._yMin, this._yMax);

    const bob = Math.sin((this._phase + t) * this._bobRate) * this._bobAmp;

    this.group.position.x = this._x;
    this.group.position.y = this._y + bob;

    if (this._mixer) this._mixer.update(dt * this._animSpeed);
  }

  _syncBounds() {
    const w = this.width;
    const h = this.height;

    const marginX = Math.max(0.09 * w, 0.20);
    const topMargin = Math.max(0.11 * h, 0.18);

    const sandTopY = -h / 2 + (h * 0.22);
    const sandMargin = Math.max(0.09 * h, 0.13);

    this._xMin = -w / 2 + marginX + this._halfWidth;
    this._xMax =  w / 2 - marginX - this._halfWidth;

    this._yMin = sandTopY + sandMargin + (0.08 * h);
    this._yMax = h / 2 - topMargin;
  }

  _spawnInitialPosition() {
    this._x = THREE.MathUtils.lerp(this._xMin, this._xMax, 0.3 + 0.4 * Math.random());
    this._y = THREE.MathUtils.lerp(this._yMin, this._yMax, 0.6 + 0.3 * Math.random());
    this._applyFacing();
  }

  _flip(d) {
    if (this._turnCooldown > 0) return;
    this._dir = d;
    this._turnCooldown = 0.15;
    this._applyFacing();
  }

  _applyFacing() {
    const flip = (this._dir >= 0) ? 0 : Math.PI;
    this.group.rotation.y = this._baseYaw + flip + this.facingFix;
  }

  _load() {
    const loader = new GLTFLoader();
    loader.load(this.url, (gltf) => {
      const root = gltf.scene;
      root.traverse((o) => {
        if (!o.isMesh) return;

        const oldMat = o.material;
        const mat = new THREE.MeshBasicMaterial({
          color: oldMat.color?.clone() || new THREE.Color(0xffffff),
          map: oldMat.map || null,
          transparent: oldMat.transparent || false,
          opacity: 1
        });

        if (o.isSkinnedMesh) mat.skinning = true;
        o.material = mat;
        this._disposables.push(mat);
      });

      this._root = root;
      this.group.add(root);

      if (gltf.animations.length && !this.forceProcedural) {
        this._mixer = new THREE.AnimationMixer(root);
        this._clipAction = this._mixer.clipAction(gltf.animations[0]);
        this._clipAction.play();
      }

      this._rescaleToView();
      this._applyFacing();
    });
  }

  _rescaleToView() {
    if (!this._root) return;

    const box = new THREE.Box3().setFromObject(this._root);
    const size = new THREE.Vector3();
    box.getSize(size);

    const s = ((this.width * 0.16) / 3) * this.scaleMul / Math.max(size.x, size.y, size.z);
    this._root.scale.setScalar(s);

    box.setFromObject(this._root);
    box.getSize(size);
    this._halfWidth = Math.max(0.1, size.x * 0.5);

    this._syncBounds();
    this._x = THREE.MathUtils.clamp(this._x, this._xMin, this._xMax);
    this._y = THREE.MathUtils.clamp(this._y, this._yMin, this._yMax);

    this.group.position.x = this._x;
    this.group.position.y = this._y;
  }
}
