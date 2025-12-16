/*jshint esversion: 6 */
// @ts-check

/*
 * Aquarium Game (P3) - Feed
 *
 * goals:
 * - a toggle button that sits left of shop button
 * - when enabled, clicking tank drops "flakes" at your pointer x
 * - flakes fall to surface, float briefly, then slowly drift down
 * - main can query nearest flakes so fish can be attracted to them
 */

import * as THREE from "three";

export class Feed {
  /**
   * @param {object} opts
   * @param {HTMLCanvasElement} opts.canvas
   * @param {THREE.Camera} opts.camera
   * @param {THREE.Scene} opts.scene
   * @param {any} [opts.aquarium]
   * @param {any} [opts.sand]
   * @param {(on:boolean)=>void} [opts.onToggle]
   */
  constructor(opts) {
    this.canvas = opts.canvas;
    this.camera = opts.camera;
    this.scene = opts.scene;
    this.aquarium = opts.aquarium || null;
    this.sand = opts.sand || null;
    this.onToggle = opts.onToggle || null;

    this._on = false;

    this._worldW = 2;
    this._worldH = 2;

    this._flakes = [];
    this._flakeId = 1;

    // shared render resources
    this._geo = new THREE.CircleGeometry(0.012, 10);
    this._mat = new THREE.MeshBasicMaterial({
      color: 0xfff6d0,
      transparent: true,
      opacity: 0.9,
      depthTest: true,
      depthWrite: false
    });

    this._injectStyles();
    this._buildButton();
  }

  /* ------------------------------------------------------------------ */
  /* ui                                                                   */
  /* ------------------------------------------------------------------ */

  _injectStyles() {
    if (document.getElementById("aq-feed-style")) return;
    const style = document.createElement("style");
    style.id = "aq-feed-style";
    style.textContent = `
      .aq-feedOn{
        outline: 2px solid rgba(255, 240, 160, 0.55);
        outline-offset: 2px;
        box-shadow: 0 0 0 6px rgba(255,240,170,0.10), 0 0 22px rgba(255,240,170,0.18);
      }
    `;
    document.head.appendChild(style);
  }

  _buildButton() {
    const b = /** @type {HTMLButtonElement} */ (document.createElement("button"));
    b.type = "button";
    b.className = "aq-btn aq-btnPill";
    b.textContent = "feed";
    b.title = "toggle feeding";

    b.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.setOn(!this._on);
    });

    this._btn = b;
  }

  /**
   * inserts button into ShopUI launcher, left of shop button.
   * @param {any} shopUI
   */
  attachToShop(shopUI) {
    if (!shopUI || !this._btn) return;
    const shopBtn = (typeof shopUI.getTutorialElement === "function") ? shopUI.getTutorialElement("shop") : null;
    if (!shopBtn || !shopBtn.parentElement) return;

    const launcher = shopBtn.parentElement;
    if (!launcher.contains(this._btn)) {
      launcher.insertBefore(this._btn, shopBtn);
    }
  }

  /**
   * shopUI drives launcher position via setAnchorRect
   */
  setAnchorRect(r) {
    void r;
  }

  /** @returns {boolean} */
  isOn() {
    return !!this._on;
  }

  /**
   * @param {boolean} on
   */
  setOn(on) {
    this._on = !!on;
    if (this._btn) this._btn.classList.toggle("aq-feedOn", this._on);
    if (this.onToggle) this.onToggle(this._on);
  }

  /* ------------------------------------------------------------------ */
  /* environment + interaction                                            */
  /* ------------------------------------------------------------------ */

  setEnvironment(worldW, worldH, aquarium, sand) {
    this._worldW = worldW;
    this._worldH = worldH;
    if (aquarium) this.aquarium = aquarium;
    if (sand) this.sand = sand;
  }

  /**
   * @param {PointerEvent} ev
   */
  onPointerDown(ev) {
    if (!this._on) return;

    const p = this._pointerToWorld(ev.clientX, ev.clientY);
    if (!p) return;

    this.dropAt(p.x);
  }

  /**
   * drops small cluster at world x
   * @param {number} x
   */
  dropAt(x) {
    const a = this.aquarium;
    if (!a) return;

    const left = (typeof a.innerLeft === "number") ? a.innerLeft : -this._worldW / 2;
    const right = (typeof a.innerRight === "number") ? a.innerRight : this._worldW / 2;
    const surfaceY = (typeof a.innerTop === "number") ? a.innerTop : this._worldH / 2;

    const cx = THREE.MathUtils.clamp(x, left + 0.05, right - 0.05);

    const count = 14;
    for (let i = 0; i < count; i++) {
      const id = this._flakeId++;

      const jitterX = (Math.random() * 2 - 1) * 0.06;
      const startY = surfaceY + 0.35 + Math.random() * 0.08;

      const mesh = new THREE.Mesh(this._geo, this._mat);
      mesh.renderOrder = 5;
      mesh.position.set(cx + jitterX, startY, 1.35);
      mesh.rotation.z = Math.random() * Math.PI;
      mesh.scale.setScalar(0.75 + Math.random() * 0.7);

      this.scene.add(mesh);

      this._flakes.push({
        id,
        mesh,
        x: mesh.position.x,
        y: mesh.position.y,
        vx: (Math.random() * 2 - 1) * 0.02,
        vy: -0.75 - Math.random() * 0.25,
        state: "drop",
        hold: 0,
        life: 9.0 + Math.random() * 6.0,
        surfaceY
      });
    }
  }

  _pointerToWorld(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (clientX - rect.left) / Math.max(1, rect.width);
    const y = (clientY - rect.top) / Math.max(1, rect.height);

    const ndc = new THREE.Vector3(x * 2 - 1, -(y * 2 - 1), 0);
    ndc.unproject(this.camera);

    // ignores clicks outside aquarium water rect
    const a = this.aquarium;
    if (a && typeof a.innerLeft === "number") {
      if (ndc.x < a.innerLeft || ndc.x > a.innerRight) return null;
      if (ndc.y < a.innerBottom || ndc.y > a.innerTop) return null;
    }

    return { x: ndc.x, y: ndc.y };
  }

  /* ------------------------------------------------------------------ */
  /* queries                                                             */
  /* ------------------------------------------------------------------ */

  /**
   * @param {number} x
   * @param {number} y
   * @returns {{id:number,x:number,y:number}|null}
   */
  getNearestFlake(x, y) {
    let best = null;
    let bestD2 = Infinity;

    for (const f of this._flakes) {
      if (!f || !f.mesh) continue;
      const dx = f.x - x;
      const dy = f.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = f;
      }
    }

    if (!best) return null;
    return { id: best.id, x: best.x, y: best.y };
  }

  /**
   * removes flake if any is within radius
   * @param {number} x
   * @param {number} y
   * @param {number} r
   */
  tryEatAt(x, y, r) {
    const rr = r * r;
    for (let i = 0; i < this._flakes.length; i++) {
      const f = this._flakes[i];
      if (!f || !f.mesh) continue;
      const dx = f.x - x;
      const dy = f.y - y;
      if (dx * dx + dy * dy <= rr) {
        this._removeIndex(i);
        return true;
      }
    }
    return false;
  }

  _removeIndex(i) {
    const f = this._flakes[i];
    if (!f) return;
    if (f.mesh) this.scene.remove(f.mesh);
    this._flakes.splice(i, 1);
  }

  /* ------------------------------------------------------------------ */
  /* update                                                              */
  /* ------------------------------------------------------------------ */

  update(dt, t) {
    if (!dt) return;
    void t;

    const a = this.aquarium;
    if (!a) return;

    const surfaceY = (typeof a.innerTop === "number") ? a.innerTop : this._worldH / 2;
    const left = (typeof a.innerLeft === "number") ? a.innerLeft : -this._worldW / 2;
    const right = (typeof a.innerRight === "number") ? a.innerRight : this._worldW / 2;

    const sandTopY = -this._worldH / 2 + (this._worldH * 0.22);
    const floorY = sandTopY + 0.03;

    for (let i = this._flakes.length - 1; i >= 0; i--) {
      const f = this._flakes[i];
      if (!f || !f.mesh) {
        this._flakes.splice(i, 1);
        continue;
      }

      f.life -= dt;
      if (f.life <= 0) {
        this._removeIndex(i);
        continue;
      }

      if (f.state === "drop") {
        // fall quickly to surface band
        f.y += f.vy * dt;
        f.x += f.vx * dt;

        if (f.y <= surfaceY) {
          f.y = surfaceY;
          f.state = "float";
          f.hold = 0.65 + Math.random() * 0.35;
          f.vy = 0;
          f.vx = (Math.random() * 2 - 1) * 0.015;
        }
      } else if (f.state === "float") {
        f.hold -= dt;

        // sits at surface, tiny lateral drift
        f.x += f.vx * dt;
        f.y = surfaceY + Math.sin((f.id * 0.7 + (9 - f.life)) * 3.2) * 0.004;

        if (f.hold <= 0) {
          f.state = "sink";
          f.vy = -0.08 - Math.random() * 0.05;
          f.vx = (Math.random() * 2 - 1) * 0.02;
        }
      } else {
        // sink slowly
        f.x += f.vx * dt;
        f.y += f.vy * dt;

        // gentle slowdown
        f.vx *= Math.pow(0.985, dt);
        f.vy *= Math.pow(0.995, dt);

        if (f.y <= floorY) {
          this._removeIndex(i);
          continue;
        }
      }

      f.x = THREE.MathUtils.clamp(f.x, left + 0.03, right - 0.03);

      f.mesh.position.x = f.x;
      f.mesh.position.y = f.y;
    }
  }
}
