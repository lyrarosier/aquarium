/*jshint esversion: 6 */
// @ts-check

/*
 * Aquarium Game (P3) - Sand
 *
 * goals:
 * - smooth, fine aquarium sand (no big bumps, no pebbles)
 * - subtle tiny bump shading via shader, not geometry noise
 * - darker at very bottom, slightly lighter toward sand top edge
 * - no "sunny" highlight colours
 * - works in prototype + full modes
 *
 * usage:
 *   import { Sand } from "./src/sand.js";
 *   const sand = new Sand({ width: worldW, height: worldH, depth: 6, mode });
 *   scene.add(sand.group);
 */

import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

export class Sand {
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
    this.group.name = "sand";

    this._disposables = [];

    // sand bed proportions relative to visible tank
    this.bedH = this.height * 0.22;

    // keeps sand in front of water plane but behind frame/rim
    this.z = 0.45;

    this._buildSandPlane();
    this._collectDisposables();
  }

  update(dt, t) {
    if (this.sandMaterial && this.sandMaterial.uniforms) {
      this.sandMaterial.uniforms.uTime.value = t;
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

  _buildSandPlane() {
    const w = this.width;
    const h = this.height;

    const sandW = w;
    const sandH = this.bedH;

    // places at bottom
    const yMid = -h / 2 + sandH / 2;

    // prototype mode: no shader, just simple primitives
    if (this.mode === "prototype") {
      // fakes gradient using two stacked planes
      const topCol = 0xd8caa6;    // slightly lighter near sand top
      const bottomCol = 0xb29f78; // darker at tank floor

      const topH = sandH * 0.55;
      const botH = sandH - topH;

      const gTop = new THREE.PlaneGeometry(sandW, topH, 1, 1);
      const gBot = new THREE.PlaneGeometry(sandW, botH, 1, 1);

      const mTop = new THREE.MeshBasicMaterial({ color: topCol });
      const mBot = new THREE.MeshBasicMaterial({ color: bottomCol });

      const bot = new THREE.Mesh(gBot, mBot);
      bot.position.set(0, yMid - (sandH * 0.5) + (botH * 0.5), this.z);
      bot.renderOrder = 2;

      const top = new THREE.Mesh(gTop, mTop);
      top.position.set(0, yMid + (sandH * 0.5) - (topH * 0.5), this.z + 0.001);
      top.renderOrder = 2;

      this.group.add(bot, top);

      // no animated uniforms in prototype
      this.sandMaterial = null;
      return;
    }

    // full mode: keep your shader sand
    const g = new THREE.PlaneGeometry(sandW, sandH, 1, 1);

    const m = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },

        // neutral aquarium sand, not sunny
        uTopSand: { value: new THREE.Color(0xd8caa6) },     // slightly lighter near sand top
        uBottomSand: { value: new THREE.Color(0xb29f78) },  // darker at tank floor

        // micro detail controls
        uNoiseScale: { value: 34.0 },   // higher = smaller grains (finer)
        uBumpStrength: { value: 0.08 }, // subtle only, keep small
        uMottleScale: { value: 7.0 },   // low-frequency colour variation
        uMottleStrength: { value: 0.05 } // subtle tint variation
      },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        varying vec2 vUv;

        uniform float uTime;
        uniform vec3 uTopSand;
        uniform vec3 uBottomSand;

        uniform float uNoiseScale;
        uniform float uBumpStrength;
        uniform float uMottleScale;
        uniform float uMottleStrength;

        float hash(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
        }

        float fbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          for (int i = 0; i < 4; i++) {
            v += a * noise(p);
            p *= 2.02;
            a *= 0.5;
          }
          return v;
        }

        void main() {
          vec3 base = mix(uBottomSand, uTopSand, smoothstep(0.0, 1.0, vUv.y));

          float mottle = fbm(vUv * uMottleScale + vec2(0.0, uTime * 0.03));
          base += (mottle - 0.5) * uMottleStrength;

          vec2 p = vUv * uNoiseScale;
          p += vec2(uTime * 0.02, -uTime * 0.015);

          float e = 0.03;
          float h0 = noise(p);
          float hx = noise(p + vec2(e, 0.0));
          float hy = noise(p + vec2(0.0, e));

          float dx = (hx - h0) / e;
          float dy = (hy - h0) / e;

          vec3 n = normalize(vec3(-dx * uBumpStrength, -dy * uBumpStrength, 1.0));

          vec3 lightDir = normalize(vec3(0.15, 0.85, 0.50));
          float ndl = max(dot(n, lightDir), 0.0);

          float diffuse = 0.55 + 0.35 * ndl;

          float floorDark = smoothstep(0.0, 0.22, vUv.y);
          diffuse *= mix(0.80, 1.0, floorDark);

          vec3 col = base * diffuse;

          gl_FragColor = vec4(col, 1.0);
        }
      `,
      transparent: false
    });

    this.sandMaterial = m;

    const sand = new THREE.Mesh(g, m);
    sand.position.set(0, yMid, this.z);
    sand.renderOrder = 2;

    this.group.add(sand);
  }
}
