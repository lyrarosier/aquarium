/*jshint esversion: 6 */
// @ts-check

/*
 * Aquarium Game (P3) - Aquarium
 *
 * goals:
 * - fills entire camera view edge-to-edge
 * - flat 2.5d aquarium look
 * - bright water colour
 * - animated light caustics (no waves, no stirring)
 * - subtle surface highlight band near top
 *
 * prototype: primitives only
 * full: fancier looks, detailed caustics
 */

import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

export class Aquarium {
  /**
   * @param {object} opts
   * @param {number} opts.width
   * @param {number} opts.height
   * @param {number} opts.depth
   * @param {"prototype"|"full"} opts.mode
   */
  constructor(opts) {
    this.width = opts.width;
    this.height = opts.height;
    this.depth = opts.depth;
    this.mode = opts.mode || "prototype";

    this.group = new THREE.Group();
    this.group.name = "aquarium";

    this._disposables = [];

    // border sizing relative to view
    const s = Math.min(this.width, this.height);
    this.frameT = s * 0.028;
    this.inset = s * 0.012;

    // ------------------------------------------------------------------
    // explicit inner water bounds (safe area inside glass)
    // ------------------------------------------------------------------
    this.innerLeft   = -this.width  / 2 + this.frameT + this.inset;
    this.innerRight  =  this.width  / 2 - this.frameT - this.inset;
    this.innerBottom = -this.height / 2 + this.frameT + this.inset;
    this.innerTop    =  this.height / 2 - this.frameT - this.inset;
    // ------------------------------------------------------------------

    // water
    if (this.mode === "prototype") {
      this._buildWaterPrimitive();
    } else {
      this._buildWaterWithCaustics();
    }

    this._buildGlassFrame();
    this._buildSurfaceBand();

    this._collectDisposables();
  }

  update(dt, t) {
    if (this.causticMaterial) {
      this.causticMaterial.uniforms.uTime.value = t;
    }
    void dt;
  }

  dispose() {
    for (const d of this._disposables) {
      if (d && typeof d.dispose === "function") d.dispose();
    }
    this._disposables.length = 0;
  }

  _collectDisposables() {
    this.group.traverse((o) => {
      if (o && o.isMesh) {
        if (o.geometry) this._disposables.push(o.geometry);
        if (o.material) this._disposables.push(o.material);
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* primitive water (prototype mode)                                    */
  /* ------------------------------------------------------------------ */

  _buildWaterPrimitive() {
    const geometry = new THREE.PlaneGeometry(this.width, this.height, 1, 1);

    const material = new THREE.MeshBasicMaterial({
      color: 0x6fc7f2
    });

    const water = new THREE.Mesh(geometry, material);

    // pushed back so fish never clip behind it
    water.position.set(0, 0, -3.0);
    water.renderOrder = 0;

    this.group.add(water);
  }

  /* ------------------------------------------------------------------ */
  /* water with animated caustic light (full mode)                       */
  /* ------------------------------------------------------------------ */

  _buildWaterWithCaustics() {
    const w = this.width;
    const h = this.height;

    const geometry = new THREE.PlaneGeometry(w, h, 1, 1);

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },

        uTopColor: { value: new THREE.Color(0x86d6ff) },
        uBottomColor: { value: new THREE.Color(0x2d86b8) },

        uCausticScale: { value: 2.13 },
        uCausticStrength: { value: 0.36 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform float uTime;
        uniform vec3 uTopColor;
        uniform vec3 uBottomColor;
        uniform float uCausticScale;
        uniform float uCausticStrength;

        float caustic(vec2 p) {
          float t = uTime * 0.55;
          p += vec2(
            0.06 * sin(p.y * 6.0 + t * 1.3),
            0.06 * sin(p.x * 5.0 - t * 1.1)
          );

          float c = 0.0;
          c += sin((p.x + t * 1.2) * 10.0);
          c += sin((p.y - t * 0.9) * 9.0);
          c += sin((p.x + p.y + t * 1.1) * 8.0);
          c += sin((p.x * 0.7 - p.y * 1.1 + t * 0.8) * 11.0);
          return c / 4.0;
        }

        void main() {
          vec3 waterColor = mix(uBottomColor, uTopColor, vUv.y);

          float depthFade = smoothstep(0.60, 0.98, vUv.y);
          vec2 p = vUv * (1.55 * uCausticScale);

          float c = smoothstep(0.10, 0.62, caustic(p));
          c = pow(c, 1.35);

          vec3 light = vec3(c * uCausticStrength) * depthFade;
          vec3 lifted = waterColor + vec3(0.03, 0.04, 0.05);

          gl_FragColor = vec4(lifted + light, 1.0);
        }
      `
    });

    this.causticMaterial = material;

    const water = new THREE.Mesh(geometry, material);
    water.position.set(0, 0, -3.0);
    water.renderOrder = 0;

    this.group.add(water);
  }

  /* ------------------------------------------------------------------ */
  /* glass frame                                                          */
  /* ------------------------------------------------------------------ */

  _buildGlassFrame() {
    const w = this.width;
    const h = this.height;
    const t = this.frameT;
    const inset = this.inset;

    const frameMat = new THREE.MeshBasicMaterial({
      color: this.mode === "prototype" ? 0x16222c : 0x0f171e
    });

    const top = new THREE.Mesh(new THREE.PlaneGeometry(w, t), frameMat);
    top.position.set(0, h / 2 - t / 2, 2);

    const bot = new THREE.Mesh(new THREE.PlaneGeometry(w, t), frameMat);
    bot.position.set(0, -h / 2 + t / 2, 2);

    const left = new THREE.Mesh(new THREE.PlaneGeometry(t, h), frameMat);
    left.position.set(-w / 2 + t / 2, 0, 2);

    const right = new THREE.Mesh(new THREE.PlaneGeometry(t, h), frameMat);
    right.position.set(w / 2 - t / 2, 0, 2);

    this.group.add(top, bot, left, right);

    const rimMat = new THREE.MeshBasicMaterial({
      color: 0xe9f7ff,
      transparent: true,
      opacity: 0.22
    });

    const iw = w - 2 * (t + inset);
    const ih = h - 2 * (t + inset);

    const rimTop = new THREE.Mesh(new THREE.PlaneGeometry(iw, t * 0.38), rimMat);
    rimTop.position.set(0, ih / 2, 2.1);

    const rimBot = new THREE.Mesh(new THREE.PlaneGeometry(iw, t * 0.38), rimMat);
    rimBot.position.set(0, -ih / 2, 2.1);

    const rimLeft = new THREE.Mesh(new THREE.PlaneGeometry(t * 0.38, ih), rimMat);
    rimLeft.position.set(-iw / 2, 0, 2.1);

    const rimRight = new THREE.Mesh(new THREE.PlaneGeometry(t * 0.38, ih), rimMat);
    rimRight.position.set(iw / 2, 0, 2.1);

    this.group.add(rimTop, rimBot, rimLeft, rimRight);
  }

  /* ------------------------------------------------------------------ */
  /* surface light band                                                   */
  /* ------------------------------------------------------------------ */

  _buildSurfaceBand() {
    const w = this.width;
    const h = this.height;

    const band = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 0.97, h * 0.05),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: this.mode === "prototype" ? 0.10 : 0.18
      })
    );

    band.position.set(0, h * 0.445, 1.5);
    band.renderOrder = 5;

    this.group.add(band);
  }
}
