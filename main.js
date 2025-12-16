/*jshint esversion: 6 */
// @ts-check

/*
 * Aquarium Game (P3) - main
 *
 * ui:
 * - shop button anchored to  top-right inside  aquarium water area
 * - shop panel has no internal scroll (shorter fixed height)
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import { Aquarium } from "./src/aquarium.js";
import { Sand } from "./src/sand.js";
import { ShopUI } from "./src/shopUI.js";
import { Egg } from "./src/egg.js";
import { Decor } from "./src/decor.js";
import { Feed } from "./src/feed.js";

import { CommonFish } from "./src/fish/commonFish.js";
import { SchoolingFish } from "./src/fish/schoolingFish.js";
import { TropicalFish } from "./src/fish/tropicalFish.js";
import { DeepSeaCreature } from "./src/fish/deepSeaCreature.js";
import { OrnamentalFish } from "./src/fish/ornamentalFish.js";
import { ReefFish } from "./src/fish/reefFish.js";
import { MythicalFish } from "./src/fish/mythicalFish.js";

/** your four-digit group id */
const GROUP_ID = "4150";

const MODE_PROTO = "prototype";
const MODE_FULL = "full";

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("c"));
if (!canvas) throw new Error("Missing <canvas id=\"c\"></canvas> in index.html");

const clock = new THREE.Clock();

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x070b10, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070b10);

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
camera.position.set(0, 0, 10);
camera.lookAt(0, 0, 0);

let mode = MODE_PROTO;
let aquarium = null;
let sand = null;

let worldW = 2;
let worldH = 2;
let _lastWorldH = worldH;

// egg instances
const eggs = [];

// decor instances
const decors = [];

// fish spawned by hatching
/** @type {Array<{ id:number, eggType:string, obj:any, bornAt:number, growDur:number, startF:number, endF:number, adultRootScale:(number|null), baseX:number, baseY:number, liftDur:number, liftDist:number, liftStart:(number|null), liftDone:boolean, settleUntil:(number|null), settleExtra:number, modelUrl:string, displayName:string, thumbYaw:number }>} */
const hatchFish = [];

// SELL: unique id for each hatched fish (for selection + selling)
let fishIdCounter = 1;

// tutorial controller (created after shop ui builds)
let tutorial = null;

// feed system (flakes + toggle)
let feed = null;

// temp objects to avoid per-frame allocations
const _tmpBox3 = new THREE.Box3();

/**
 * hard clamp to prevent ANY fish from crossing top of tank
 * file itself writes position.y during hatch-lift animation,
 * must clamp here too
 * @param {any} obj
 * @param {number} y
 * @returns {number}
 */
function clampYForFish(obj, y) {
  if (!obj) return y;

  // prefers per-fish bounds if present
  const hasFishBounds = (typeof obj._yMin === "number") && (typeof obj._yMax === "number");
  if (hasFishBounds) {
    // if fish has a bob amplitude, keeps bob from pushing it past ceiling
    const bobAmp = (typeof obj._bobAmp === "number") ? Math.abs(obj._bobAmp) : 0;
    const yMin = obj._yMin + bobAmp;
    const yMax = obj._yMax - bobAmp;
    return THREE.MathUtils.clamp(y, yMin, yMax);
  }

  // Fallback to aquarium innerTop.
  if (aquarium && typeof aquarium.innerTop === "number") {
    const pad = 0.02;
    return Math.min(y, aquarium.innerTop - pad);
  }

  return y;
}

/**
 * absolute hard ceiling clamp using rendered bounds
 * fixes cases where model origin is below  mesh and fish visually clips above  tank
 * applied every frame after movement (and also during hatch lift)
 * @param {any} obj
 */
function enforceTopCeiling(obj) {
  if (!obj || !obj.group || !aquarium || typeof aquarium.innerTop !== "number") return;

  // keeps little air-gap so nothing ever touches glass
  const pad = 0.06;
  const top = aquarium.innerTop - pad;

  _tmpBox3.setFromObject(obj.group);
  const maxY = _tmpBox3.max.y;

  if (maxY > top) {
    const dy = top - maxY;
    obj.group.position.y += dy;

    if (typeof obj._y === "number") obj._y += dy;

    // kills upward velocity
    if (typeof obj._vy === "number") obj._vy = Math.min(0, obj._vy);
  }
}

/* ------------------------------------------------------------------ */
/* MODE: egg rebuild so toggle actually changes egg visuals             */
/* ------------------------------------------------------------------ */

function rebuildEggVisualsForMode() {
  if (!eggs.length) return;

  for (let i = 0; i < eggs.length; i++) {
    const old = eggs[i];
    if (!old || !old.group) continue;

    // snapshot runtime state (so toggling mode doesn't "reset" incubation)
    const snap = {
      eggType: old.eggType,
      x: old.group.position.x,
      y: old.group.position.y,
      z: old.group.position.z,

      _x: (typeof old._x === "number") ? old._x : old.group.position.x,
      _y: (typeof old._y === "number") ? old._y : old.group.position.y,
      _vx: (typeof old._vx === "number") ? old._vx : 0,
      _vy: (typeof old._vy === "number") ? old._vy : 0,
      _phase: (typeof old._phase === "number") ? old._phase : (Math.random() * Math.PI * 2),

      _landed: !!old._landed,
      _age: (typeof old._age === "number") ? old._age : 0,
      _hatchAt: (typeof old._hatchAt === "number") ? old._hatchAt : (7.5 + Math.random() * 5.0),
      _didHatch: !!old._didHatch,
      _dead: !!old._dead,

      _sandSinkFactor: (typeof old._sandSinkFactor === "number") ? old._sandSinkFactor : null,

      onHatch: old.onHatch || null
    };

    // remove old
    scene.remove(old.group);
    if (typeof old.dispose === "function") old.dispose();

    // rebuild with current mode
    const neu = new Egg({
      eggType: snap.eggType,
      mode, // IMPORTANT: use the new mode so the visuals switch
      worldW,
      worldH,
      aquarium,
      sand,
      x: snap.x,
      y: snap.y,
      z: snap.z,
      onHatch: snap.onHatch
    });

    // restore internal motion/state so it doesn't restart its lifecycle
    neu._x = snap._x;
    neu._y = snap._y;
    neu._vx = snap._vx;
    neu._vy = snap._vy;
    neu._phase = snap._phase;

    neu._landed = snap._landed;
    neu._age = snap._age;
    neu._hatchAt = snap._hatchAt;
    neu._didHatch = snap._didHatch;
    neu._dead = snap._dead;

    if (snap._sandSinkFactor !== null) neu._sandSinkFactor = snap._sandSinkFactor;

    // re-sync env + apply exact pose
    if (typeof neu.setEnvironment === "function") neu.setEnvironment(worldW, worldH, aquarium, sand);
    if (typeof neu._applyPos === "function") neu._applyPos();

    eggs[i] = neu;
    scene.add(neu.group);
  }
}


function rebuildHatchedVisualsForMode() {
  if (!hatchFish.length) return;

  for (let i = 0; i < hatchFish.length; i++) {
    const hf = hatchFish[i];
    if (!hf || !hf.obj || !hf.obj.group) continue;

    const snap = {
      x: hf.obj.group.position.x,
      y: hf.obj.group.position.y,
      z: hf.obj.group.position.z,
      _x: (typeof hf.obj._x === "number") ? hf.obj._x : hf.obj.group.position.x,
      _y: (typeof hf.obj._y === "number") ? hf.obj._y : hf.obj.group.position.y,
      _hasVx: (typeof hf.obj._vx === "number"),
      _hasVy: (typeof hf.obj._vy === "number"),
      _vx: (typeof hf.obj._vx === "number") ? hf.obj._vx : 0,
      _vy: (typeof hf.obj._vy === "number") ? hf.obj._vy : 0,
      _dir: (typeof hf.obj._dir === "number") ? hf.obj._dir : 1,
      _phase: (typeof hf.obj._phase === "number") ? hf.obj._phase : (Math.random() * Math.PI * 2)
    };

    scene.remove(hf.obj.group);
    if (typeof hf.obj.dispose === "function") hf.obj.dispose();

    const spec = hf.spec || {};
    let obj = null;

    if (mode === MODE_PROTO) {
      obj = new PrimitiveFish({
        eggType: hf.eggType,
        width: worldW,
        height: worldH,
        aquarium,
        zLayer: (typeof spec.zLayer === "number") ? spec.zLayer : 0.0
      });
    } else {
      if (spec.kind === "common") {
        obj = new CommonFish({
          width: worldW, height: worldH, depth: 6, mode,
          aquarium,
          url: spec.url,
          scaleMul: spec.scaleMul,
          facingFix: spec.facingFix || 0,
          zLayer: spec.zLayer,
          addEye: !!spec.addEye,
          eye: spec.eye || undefined
        });
      } else if (spec.kind === "school") {
        obj = new SchoolingFish({
          width: worldW, height: worldH, depth: 6, mode,
          aquarium,
          url: spec.url,
          scaleMul: spec.scaleMul,
          facingFix: spec.facingFix || 0,
          zLayer: spec.zLayer,
          schoolId: `hatch_${Math.random().toString(16).slice(2)}`,
          memberIndex: 0,
          schoolSize: 1
        });
      } else if (spec.kind === "trop") {
        obj = new TropicalFish({
          width: worldW, height: worldH, depth: 6, mode,
          url: spec.url,
          scaleMul: spec.scaleMul,
          facingFix: spec.facingFix || 0,
          zLayer: spec.zLayer,
          addEye: !!spec.addEye,
          eye: spec.eye || undefined
        });
      } else if (spec.kind === "reef") {
        obj = new ReefFish({
          width: worldW, height: worldH, depth: 6, mode,
          url: spec.url,
          scaleMul: spec.scaleMul,
          facingFix: spec.facingFix || 0,
          zLayer: spec.zLayer,
          speedMul: (typeof spec.speedMul === "number") ? spec.speedMul : 1.0
        });
      } else if (spec.kind === "orn") {
        obj = new OrnamentalFish({
          width: worldW, height: worldH, depth: 6, mode,
          url: spec.url,
          scaleMul: spec.scaleMul,
          facingFix: spec.facingFix || 0,
          zLayer: spec.zLayer,
          speedMul: 0.92
        });
      } else if (spec.kind === "deep") {
        obj = new DeepSeaCreature({
          width: worldW, height: worldH, depth: 6, mode,
          url: spec.url,
          scaleMul: spec.scaleMul,
          facingFix: spec.facingFix || 0,
          zLayer: spec.zLayer,
          speedMul: spec.speedMul || 1.0
        });
      } else if (spec.kind === "myth") {
        obj = new MythicalFish({
          width: worldW, height: worldH, depth: 6, mode,
          aquarium,
          url: spec.url,
          scaleMul: spec.scaleMul,
          facingFix: spec.facingFix || 0,
          zLayer: spec.zLayer,
          speedMul: (typeof spec.speedMul === "number") ? spec.speedMul : 1.0
        });
      }
    }

    if (!obj) continue;

    if (!obj.group.userData) obj.group.userData = {};
    obj.group.userData.fishId = hf.id;

    if (typeof obj._x === "number") obj._x = snap._x;
    if (typeof obj._y === "number") obj._y = snap._y;
    if (snap._hasVx && typeof obj._vx === "number") obj._vx = snap._vx;
    if (snap._hasVy && typeof obj._vy === "number") obj._vy = snap._vy;
    if (typeof obj._dir === "number") obj._dir = snap._dir;
    if (typeof obj._phase === "number") obj._phase = snap._phase;

    if (obj instanceof PrimitiveFish && typeof obj._vx === "number") {
      obj._dir = (obj._vx >= 0) ? 1 : -1;
    }

    obj.group.position.set(snap.x, snap.y, snap.z);

    hf.obj = obj;
    scene.add(obj.group);
    // re-apply facing immediately (important after restoring _dir)
    if (typeof obj._applyFacingNow === "function") obj._applyFacingNow();
    else if (typeof obj._applyFacing === "function") obj._applyFacing();

    const now = (clock && typeof clock.elapsedTime === "number") ? clock.elapsedTime : 0;
    retargetGrowthForMode(hf, now);

  }
}

function rebuildDecorVisualsForMode() {
  if (!decors.length) return;

  for (let i = 0; i < decors.length; i++) {
    const d = decors[i];
    if (!d || !d.group) continue;

    // decor objects support both visuals internally, so just flip the mode.
    if (typeof d.setMode === "function") d.setMode(mode);
    if (typeof d.setEnvironment === "function") d.setEnvironment(worldW, worldH, aquarium, sand);

    // ensure pick tags survive mode rebuilds
    if (d.group) {
      if (!d.group.userData) d.group.userData = {};
      if (!d.group.userData.decor) d.group.userData.decor = d;
    }

    // fixed z in front of sand
    if (sand && typeof sand.z === "number") {
      d.group.position.z = sand.z + 0.70;
    }
  }
}

function rebuildScene() {
  if (aquarium) {
    scene.remove(aquarium.group);
    aquarium.dispose();
    aquarium = null;
  }
  if (sand) {
    scene.remove(sand.group);
    sand.dispose();
    sand = null;
  }

  aquarium = new Aquarium({
    width: worldW,
    height: worldH,
    depth: 6,
    mode
  });
  scene.add(aquarium.group);

  sand = new Sand({
    width: worldW,
    height: worldH,
    depth: 6,
    mode
  });
  scene.add(sand.group);

  // MODE: eggs need visuals rebuilt (not just environment)
  rebuildEggVisualsForMode();

  // MODE: swap existing fish + decor visuals when toggling
  rebuildHatchedVisualsForMode();
  rebuildDecorVisualsForMode();

  for (const e of eggs) {
    if (e && typeof e.setEnvironment === "function") e.setEnvironment(worldW, worldH, aquarium, sand);
  }

  for (const d of decors) {
    if (d && typeof d.setEnvironment === "function") d.setEnvironment(worldW, worldH, aquarium, sand);
  }

  for (const hf of hatchFish) {
    if (hf && hf.obj && typeof hf.obj.setBounds === "function") hf.obj.setBounds(worldW, worldH, aquarium);
  }

  if (feed && typeof feed.setEnvironment === "function") {
    feed.setEnvironment(worldW, worldH, aquarium, sand);
  }

  // MODE: shop thumbs depend on mode too
  if (shopUI && typeof shopUI.refresh === "function") shopUI.refresh();
}

/* ------------------------------------------------------------------ */
/* minimal mode toggle ui                                               */
/* ------------------------------------------------------------------ */

function buildModeToggle() {
  const bar = document.createElement("div");
  bar.style.position = "fixed";
  bar.style.left = "12px";
  bar.style.bottom = "12px";
  bar.style.zIndex = "40";
  bar.style.pointerEvents = "auto";
  bar.style.display = "flex";
  bar.style.alignItems = "center";
  bar.style.gap = "10px";
  bar.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  bar.style.color = "#eaf4ff";

  const idText = document.createElement("strong");
  idText.textContent = `group id: ${GROUP_ID}`;

  const label = document.createElement("label");
  label.style.display = "flex";
  label.style.alignItems = "center";
  label.style.gap = "8px";
  label.style.padding = "8px 10px";
  label.style.borderRadius = "14px";
  label.style.border = "1px solid rgba(255,255,255,0.12)";
  label.style.background = "rgba(10,14,20,0.45)";
  label.style.backdropFilter = "blur(10px)";
  label.style.webkitBackdropFilter = "blur(10px)";
  label.style.userSelect = "none";

  const toggle = /** @type {HTMLInputElement} */ (document.createElement("input"));
  toggle.type = "checkbox";
  toggle.checked = false;

  const txt = document.createElement("span");
  txt.textContent = "full mode";

  toggle.addEventListener("change", () => {
    mode = toggle.checked ? MODE_FULL : MODE_PROTO;
    rebuildScene();
    const now = (clock && typeof clock.elapsedTime === "number") ? clock.elapsedTime : 0;
    for (const hf of hatchFish) retargetGrowthForMode(hf, now);

    syncShopAnchor();
    if (shopUI && typeof shopUI.refresh === "function") shopUI.refresh();
  });

  label.appendChild(toggle);
  label.appendChild(txt);

  bar.appendChild(idText);
  bar.appendChild(label);

  document.body.appendChild(bar);
}

/* ------------------------------------------------------------------ */
/* shop ui data                                                         */
/* ------------------------------------------------------------------ */

const gameState = { coins: 30 };

const shopData = {
  eggs: [
    { id: "egg_basic", name: "basic egg", desc: "common freshwater fish", price: 0, eggType: "basic" },
    { id: "egg_schooling", name: "schooling egg", desc: "peaceful group fish", price: 35, eggType: "schooling" },
    { id: "egg_tropical", name: "tropical egg", desc: "warm-water freshwater fish", price: 45, eggType: "tropical" },
    { id: "egg_saltwater", name: "saltwater reef egg", desc: "reef fish", price: 60, eggType: "saltwater" },
    { id: "egg_ornamental", name: "ornamental egg", desc: "selectively bred fish", price: 120, eggType: "ornamental" },
    { id: "egg_deepsea", name: "deepsea egg", desc: "deep-sea fish", price: 150, eggType: "deepsea" },
    { id: "egg_mythical", name: "mythical egg", desc: "unique mythical fish", price: 190, eggType: "mythical" }
  ],
  decor: [
    {
      id: "decor_seaweed",
      kind: "decor",
      decorType: "seaweed",
      name: "seaweed",
      desc: "gentle seaweed",
      price: 25,
      url: "assets/decor/seaweed.glb"
    },
    {
      id: "decor_rock",
      kind: "decor",
      decorType: "rock",
      name: "rock",
      desc: "smooth rock",
      price: 40,
      url: "assets/decor/rock.glb"
    },
    {
      id: "decor_shell",
      kind: "decor",
      decorType: "shell",
      name: "shell",
      desc: "pretty shell",
      price: 30,
      url: "assets/decor/shell.glb"
    },
    {
      id: "decor_log",
      kind: "decor",
      decorType: "log",
      name: "log",
      desc: "drift log",
      price: 55,
      url: "assets/decor/log.glb"
    },
    {
      id: "decor_coral",
      kind: "decor",
      decorType: "coral",
      name: "coral",
      desc: "bright coral",
      price: 80,
      url: "assets/decor/coral.glb"
    },
    {
      id: "decor_sandcastle",
      kind: "decor",
      decorType: "sandcastle",
      name: "sandcastle",
      desc: "tiny sandcastle",
      price: 120,
      url: "assets/decor/sandcastle.glb"
    }
  ],
  sell: []
};

// SELL: selling prices (slightly higher than egg purchase price), so there's profit
function sellPriceForEggType(eggType) {
  const egg = (shopData.eggs || []).find((e) => e && e.eggType === eggType);
  const base = egg ? (egg.price || 0) : 0;
  if (base <= 0) return 5;
  return Math.ceil(base * 1.12);
}

// SELL: rebuild shopData.sell list from currently owned adult fish
function rebuildSellList(now) {
  const next = [];

  for (const hf of hatchFish) {
    if (!hf || !hf.obj) continue;

    // adult check
    const age = now - hf.bornAt;
    if (age < hf.growDur) continue;

    const price = sellPriceForEggType(hf.eggType);

    next.push({
      id: `sell_${hf.id}`,
      kind: "fish",
      fishId: hf.id,
      eggType: hf.eggType,
      name: hf.displayName || "adult fish",
      desc: (shopData.eggs || []).find((e) => e && e.eggType === hf.eggType)?.desc || "adult fish",
      price,
      modelUrl: hf.modelUrl,
      thumbYaw: hf.thumbYaw,

      // png filename key in assets/ui/fish/<thumbKey>.png
      // these should be: carp, sardine, bass, koi, nemo, dory, octo, angler, turtle, shark, sailfish
      thumbKey: (() => {
        const u = (hf.modelUrl || "");
        if (u.includes("carp.glb")) return "carp";
        if (u.includes("fish2.glb")) return "sardine";
        if (u.includes("bass.glb")) return "bass";
        if (u.includes("koi.glb")) return "koi";
        if (u.includes("nemo.glb")) return "nemo";
        if (u.includes("dory.glb")) return "dory";
        if (u.includes("octo.glb")) return "octo";
        if (u.includes("anglerfish.glb")) return "angler";
        if (u.includes("turtle.glb")) return "turtle";
        if (u.includes("shark.glb")) return "shark";
        if (u.includes("sailfish.glb")) return "sailfish";
        return "carp";
      })()
    });
  }

  shopData.sell = next;

  // returns tiny signature so callers can detect a change and refresh UI
  return next.map((it) => (it && typeof it.fishId === "number") ? it.fishId : "x").join(",");
}

/* ------------------------------------------------------------------ */
/* egg thumbs                                                           */
/* ------------------------------------------------------------------ */

function ensureEggThumbStyles() {
  if (document.getElementById("aq-eggthumb-styles")) return;

  const style = document.createElement("style");
  style.id = "aq-eggthumb-styles";
  style.textContent = `
    .aq-eggThumb{
      width: 92px;
      height: 92px;
      border-radius: 999px;
      position: relative;
      filter: drop-shadow(0 10px 18px rgba(0,0,0,0.24));
    }

    .aq-eggShell{
      position: absolute;
      inset: 12px 18px 12px 18px;
      border-radius: 999px;
      transform: rotate(-6deg);
      border: 1px solid rgba(255,255,255,0.22);
      background:
        radial-gradient(circle at 30% 25%, rgba(255,255,255,0.65), rgba(255,255,255,0.0) 42%),
        radial-gradient(circle at 65% 70%, rgba(255,255,255,0.20), rgba(255,255,255,0.0) 55%),
        rgba(255,255,255,0.18);
    }

    .aq-eggYolk{
      position: absolute;
      left: 50%;
      top: 56%;
      width: 34px;
      height: 32px;
      transform: translate(-50%, -50%) rotate(8deg);
      border-radius: 999px;
      opacity: 0.60;
    }

    .aq-eggGlint{
      position: absolute;
      left: 30px;
      top: 24px;
      width: 18px;
      height: 14px;
      border-radius: 999px;
      background: rgba(255,255,255,0.55);
      opacity: 0.22;
      transform: rotate(-16deg);
      filter: blur(0.2px);
    }

    .aq-eggMarble{
      position: absolute;
      inset: 12px 18px 12px 18px;
      border-radius: 999px;
      opacity: 0.35;
      mix-blend-mode: screen;
      background:
        radial-gradient(circle at 35% 40%, rgba(255,255,255,0.0), rgba(255,255,255,0.0) 40%, rgba(255,255,255,0.22) 65%, rgba(255,255,255,0.0) 80%),
        radial-gradient(circle at 70% 55%, rgba(255,120,100,0.0), rgba(255,120,100,0.25) 45%, rgba(255,255,255,0.0) 78%),
        radial-gradient(circle at 40% 72%, rgba(255,120,100,0.0), rgba(255,120,100,0.18) 42%, rgba(255,255,255,0.0) 75%);
      filter: blur(0.5px);
    }

    .aq-eggMythGlow{
      position: absolute;
      inset: 10px 16px 10px 16px;
      border-radius: 999px;
      opacity: 0.55;
      mix-blend-mode: screen;
      background:
        radial-gradient(circle at 35% 25%, rgba(255,255,255,0.30), rgba(255,255,255,0.0) 52%),
        radial-gradient(circle at 70% 65%, rgba(255,240,170,0.35), rgba(255,240,170,0.0) 58%),
        radial-gradient(circle at 45% 70%, rgba(170,240,255,0.22), rgba(170,240,255,0.0) 60%);
      filter: blur(0.5px);
    }
  `;
  document.head.appendChild(style);
}

function eggShellRGBA(eggType) {
  return {
    basic: "rgba(210, 238, 255, 0.58)",
    schooling: "rgba(205, 255, 220, 0.56)",
    tropical: "rgba(170, 235, 255, 0.56)",
    saltwater: "rgba(248, 195, 255, 0.52)",
    ornamental: "rgba(250, 245, 240, 0.52)",
    deepsea: "rgba(60, 70, 145, 0.58)",
    mythical: "rgba(255, 235, 160, 0.52)"
  }[eggType] || "rgba(210, 238, 255, 0.58)";
}

function eggInnerRGBA(eggType) {
  return {
    basic: "rgba(140, 205, 255, 0.70)",
    schooling: "rgba(110, 220, 160, 0.70)",
    tropical: "rgba(55, 175, 255, 0.72)",
    saltwater: "rgba(200, 105, 255, 0.72)",
    ornamental: "rgba(255, 150, 125, 0.68)",
    deepsea: "rgba(12, 18, 55, 0.78)",
    mythical: "rgba(255, 255, 255, 0.62)"
  }[eggType] || "rgba(140, 205, 255, 0.70)";
}

function retargetGrowthForMode(hf, now) {
  if (!hf || !hf.obj) return;

  hf.startF = 0.14;
  // full mode fish should be much larger (4x) than before.
  // Previously endF=0.25 made adults 4x smaller than their base scale.
  hf.endF = 1.0;

  // force recalculation of base scale in the new mode
  hf.adultRootScale = null;

  if (!hf.obj._root) return;

  const age = now - hf.bornAt;
  const f = THREE.MathUtils.clamp(age / hf.growDur, 0, 1);
  const eased = f * f * (3 - 2 * f);

  // base scale is whatever the fish class constructed (includes spec.scaleMul etc.)
  // use magnitude only; preserve facing/vertical flip via sx/sy.
  const sx = (hf.obj._root.scale.x < 0) ? -1 : 1;
  const sy = (hf.obj._root.scale.y < 0) ? -1 : 1;
  const baseScale = Math.abs(hf.obj._root.scale.x);

  const s = THREE.MathUtils.lerp(hf.startF, hf.endF, eased);
  hf.obj._root.scale.setScalar(baseScale * s);
  hf.obj._root.scale.x *= sx;
  hf.obj._root.scale.y *= sy;
}

function makeEggThumb(eggType) {
  ensureEggThumbStyles();

  const shellCol = eggShellRGBA(eggType);
  const yolkCol = eggInnerRGBA(eggType);

  const wrap = document.createElement("div");
  wrap.className = "aq-eggThumb";

  const shell = document.createElement("div");
  shell.className = "aq-eggShell";
  shell.style.background = `
    radial-gradient(circle at 30% 25%, rgba(255,255,255,0.72), rgba(255,255,255,0.0) 42%),
    radial-gradient(circle at 65% 70%, rgba(255,255,255,0.24), rgba(255,255,255,0.0) 55%),
    ${shellCol}
  `;

  const yolk = document.createElement("div");
  yolk.className = "aq-eggYolk";
  yolk.style.background = `
    radial-gradient(circle at 35% 35%, rgba(255,255,255,0.28), rgba(255,255,255,0.0) 55%),
    ${yolkCol}
  `;

  const glint = document.createElement("div");
  glint.className = "aq-eggGlint";

  wrap.appendChild(shell);
  wrap.appendChild(yolk);
  wrap.appendChild(glint);

  if (eggType === "ornamental") {
    const marble = document.createElement("div");
    marble.className = "aq-eggMarble";
    wrap.appendChild(marble);
  }

  if (eggType === "mythical") {
    const glow = document.createElement("div");
    glow.className = "aq-eggMythGlow";
    wrap.appendChild(glow);
  }

  return wrap;
}

/* ------------------------------------------------------------------ */
/* primitive shop thumbs (colour-matched to fancy mode)                 */
/* ------------------------------------------------------------------ */

function makePrimitiveEggThumb(eggType) {
  const shell = eggShellRGBA(eggType || "basic");
  const inner = eggInnerRGBA(eggType || "basic");

  const wrap = document.createElement("div");
  wrap.style.width = "92px";
  wrap.style.height = "92px";
  wrap.style.position = "relative";
  wrap.style.display = "block";
  wrap.style.filter = "drop-shadow(0 10px 18px rgba(0,0,0,0.24))";

  const outer = document.createElement("div");
  outer.style.position = "absolute";
  outer.style.left = "14px";
  outer.style.top = "14px";
  outer.style.right = "14px";
  outer.style.bottom = "14px";
  outer.style.borderRadius = "999px";
  outer.style.background = shell;
  outer.style.border = "1px solid rgba(255,255,255,0.22)";

  const innerDot = document.createElement("div");
  innerDot.style.position = "absolute";
  innerDot.style.width = "22px";
  innerDot.style.height = "22px";
  innerDot.style.left = "50%";
  innerDot.style.top = "58%";
  innerDot.style.transform = "translate(-50%, -50%)";
  innerDot.style.borderRadius = "999px";
  innerDot.style.background = inner;
  innerDot.style.opacity = "0.95";

  const glint = document.createElement("div");
  glint.style.position = "absolute";
  glint.style.left = "30px";
  glint.style.top = "26px";
  glint.style.width = "16px";
  glint.style.height = "12px";
  glint.style.borderRadius = "999px";
  glint.style.background = "rgba(255,255,255,0.55)";
  glint.style.opacity = "0.20";
  glint.style.transform = "rotate(-16deg)";

  wrap.appendChild(outer);
  wrap.appendChild(innerDot);
  wrap.appendChild(glint);
  return wrap;
}

function rgbaToRgbStyle(rgba) {
  const m = String(rgba).match(/rgba?\s*\(\s*([0-9]+)\s*,\s*([0-9]+)\s*,\s*([0-9]+)(?:\s*,\s*([0-9.]+))?\s*\)/i);
  if (!m) return "rgb(255,255,255)";
  return `rgb(${m[1]},${m[2]},${m[3]})`;
}

function makePrimitiveFishThumb(eggType) {
  const bodyCol = eggShellRGBA(eggType || "basic");
  const tailCol = eggInnerRGBA(eggType || "basic");

  const wrap = document.createElement("div");
  wrap.style.width = "100%";
  wrap.style.height = "100%";
  wrap.style.display = "grid";
  wrap.style.placeItems = "center";

  const fish = document.createElement("div");
  fish.style.width = "92px";
  fish.style.height = "44px";
  fish.style.position = "relative";
  fish.style.filter = "drop-shadow(0 10px 18px rgba(0,0,0,0.18))";

  const body = document.createElement("div");
  body.style.position = "absolute";
  body.style.left = "12px";
  body.style.top = "11px";
  body.style.width = "46px";
  body.style.height = "22px";
  body.style.borderRadius = "6px";
  body.style.background = bodyCol;
  body.style.border = "1px solid rgba(255,255,255,0.18)";

  const tail = document.createElement("div");
  tail.style.position = "absolute";
  tail.style.left = "58px";
  tail.style.top = "11px";
  tail.style.width = "0";
  tail.style.height = "0";
  tail.style.borderTop = "11px solid transparent";
  tail.style.borderBottom = "11px solid transparent";
  tail.style.borderRight = `18px solid ${tailCol}`;

  const eye = document.createElement("div");
  eye.style.position = "absolute";
  eye.style.left = "22px";
  eye.style.top = "18px";
  eye.style.width = "4px";
  eye.style.height = "4px";
  eye.style.borderRadius = "999px";
  eye.style.background = "rgba(10,14,20,0.65)";

  fish.appendChild(body);
  fish.appendChild(tail);
  fish.appendChild(eye);
  wrap.appendChild(fish);

  return wrap;
}

// primitive decor thumb = blob
function makePrimitiveDecorThumb(decorType) {
  const palette = {
    seaweed: { a: "rgba(120, 245, 170, 0.78)", b: "rgba(40, 185, 120, 0.72)" },
    rock: { a: "rgba(210, 220, 235, 0.72)", b: "rgba(140, 155, 175, 0.72)" },
    shell: { a: "rgba(255, 205, 225, 0.72)", b: "rgba(245, 150, 195, 0.68)" },
    log: { a: "rgba(195, 145, 105, 0.72)", b: "rgba(135, 95, 70, 0.70)" },
    coral: { a: "rgba(255, 170, 175, 0.72)", b: "rgba(255, 120, 145, 0.68)" },
    sandcastle: { a: "rgba(255, 235, 175, 0.72)", b: "rgba(235, 200, 135, 0.70)" }
  };

  const p = palette[decorType] || { a: "rgba(210,238,255,0.60)", b: "rgba(140,205,255,0.62)" };

  const wrap = document.createElement("div");
  wrap.style.width = "92px";
  wrap.style.height = "92px";
  wrap.style.position = "relative";
  wrap.style.display = "grid";
  wrap.style.placeItems = "center";
  wrap.style.filter = "drop-shadow(0 10px 18px rgba(0,0,0,0.20))";

  const blob = document.createElement("div");
  blob.style.width = "64px";
  blob.style.height = "58px";
  blob.style.borderRadius = "60% 40% 55% 45% / 45% 55% 45% 55%";
  blob.style.border = "1px solid rgba(255,255,255,0.18)";
  blob.style.transform = "rotate(-10deg)";
  blob.style.background = `
    radial-gradient(circle at 32% 28%, rgba(255,255,255,0.40), rgba(255,255,255,0.0) 45%),
    radial-gradient(circle at 70% 68%, ${p.a}, ${p.b})
  `;

  const dot = document.createElement("div");
  dot.style.position = "absolute";
  dot.style.width = "10px";
  dot.style.height = "10px";
  dot.style.left = "56px";
  dot.style.top = "30px";
  dot.style.borderRadius = "999px";
  dot.style.background = "rgba(255,255,255,0.50)";
  dot.style.opacity = "0.22";

  wrap.appendChild(blob);
  wrap.appendChild(dot);
  return wrap;
}


/* ------------------------------------------------------------------ */
/* prototype in-tank primitives (real entities, not shop previews)      */
/* ------------------------------------------------------------------ */

class PrimitiveFish {
  /**
   * @param {object} opts
   * @param {string} opts.eggType
   * @param {number} opts.width
   * @param {number} opts.height
   * @param {any} opts.aquarium
   * @param {number} [opts.zLayer]
   */
  constructor(opts) {
    this.eggType = opts.eggType || "basic";
    this.width = opts.width;
    this.height = opts.height;
    this.aquarium = opts.aquarium;
    this.group = new THREE.Group();

    const bodyCol = new THREE.Color().setStyle(rgbaToRgbStyle(eggShellRGBA(this.eggType))).convertSRGBToLinear();
    const tailCol = new THREE.Color().setStyle(rgbaToRgbStyle(eggInnerRGBA(this.eggType))).convertSRGBToLinear();

    const bodyGeo = new THREE.PlaneGeometry(0.22, 0.10);
    const bodyMat = new THREE.MeshBasicMaterial({ color: bodyCol, side: THREE.DoubleSide });
    const body = new THREE.Mesh(bodyGeo, bodyMat);

    const tailGeo = new THREE.BufferGeometry();
    const verts = new Float32Array([
      0.11,  0.00, 0,
      0.22,  0.05, 0,
      0.22, -0.05, 0
    ]);
    tailGeo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    tailGeo.computeVertexNormals();

    const tailMat = new THREE.MeshBasicMaterial({ color: tailCol, side: THREE.DoubleSide });
    const tail = new THREE.Mesh(tailGeo, tailMat);

    const eyeGeo = new THREE.CircleGeometry(0.010, 16);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x0b0f16, transparent: true, opacity: 0.80 });
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(-0.06, 0.005, 0.001);

    this._root = new THREE.Group();
    this._root.add(body);
    this._root.add(tail);
    this._root.add(eye);

    this._root.scale.y = -Math.abs(this._root.scale.y);

    this.group.add(this._root);

    this._x = 0;
    this._y = 0;
    this._vx = (Math.random() < 0.5 ? -1 : 1) * (0.12 + Math.random() * 0.10);
    this._vy = (Math.random() * 0.06) - 0.03;
    this._dir = (this._vx >= 0) ? 1 : -1;
    this._phase = Math.random() * Math.PI * 2;

    this._bobAmp = 0.020;
    this._yMin = (this.aquarium && typeof this.aquarium.innerBottom === "number") ? (this.aquarium.innerBottom + 0.18) : (-this.height / 2 + 0.20);
    this._yMax = (this.aquarium && typeof this.aquarium.innerTop === "number") ? (this.aquarium.innerTop - 0.12) : (this.height / 2 - 0.12);

    const z = (typeof opts.zLayer === "number") ? opts.zLayer : 0.0;

    // IMPORTANT: keep every fish in front of the sand (sand z is ~0.45).
    // zLayer is a tiny extra offset so fish can overlap each other.
    this.group.position.z = 1.15 + z;
    this.group.renderOrder = 3;
    this.group.traverse((o) => { if (o && o.isMesh) o.renderOrder = 3; });

    this._recalcHalfExtents();
    this._applyFacingNow();
  }

  _recalcHalfExtents() {
    const box = new THREE.Box3().setFromObject(this._root);
    const size = new THREE.Vector3();
    box.getSize(size);
    this._halfW = Math.max(0.001, size.x * 0.5);
    this._halfH = Math.max(0.001, size.y * 0.5);
  }

  setBounds(w, h, aquarium) {
    this.width = w;
    this.height = h;
    this.aquarium = aquarium || this.aquarium;
    this._yMin = (this.aquarium && typeof this.aquarium.innerBottom === "number") ? (this.aquarium.innerBottom + 0.18) : (-this.height / 2 + 0.20);
    this._yMax = (this.aquarium && typeof this.aquarium.innerTop === "number") ? (this.aquarium.innerTop - 0.12) : (this.height / 2 - 0.12);
    this._recalcHalfExtents();
  }

  _applyFacingNow() {
    const sign = (this._dir >= 0) ? -1 : 1;
    this._root.scale.x = Math.abs(this._root.scale.x) * sign;

    // keep the vertical flip no matter what
    this._root.scale.y = -Math.abs(this._root.scale.y);
  }


  update(dt, t) {
    if (!dt) return;

    this._phase += dt * 1.15;
    const bob = Math.sin(this._phase) * this._bobAmp;

    this._x += this._vx * dt;
    this._y += this._vy * dt + bob * dt * 0.35;

    const margin = 0.04; // small air-gap from glass
    const left = (this.aquarium && typeof this.aquarium.innerLeft === "number")
      ? (this.aquarium.innerLeft + this._halfW + margin)
      : (-this.width / 2 + this._halfW + margin);

    const right = (this.aquarium && typeof this.aquarium.innerRight === "number")
      ? (this.aquarium.innerRight - this._halfW - margin)
      : (this.width / 2 - this._halfW - margin);


    // IMPORTANT: force turn immediately on wall hit (your complaint: proto not turning)
    if (this._x < left) {
      this._x = left;
      this._vx = Math.abs(this._vx);
      this._dir = 1;
      this._applyFacingNow();
    }
    if (this._x > right) {
      this._x = right;
      this._vx = -Math.abs(this._vx);
      this._dir = -1;
      this._applyFacingNow();
    }

    if (this._y < this._yMin) { this._y = this._yMin; this._vy = Math.abs(this._vy); }
    if (this._y > this._yMax) { this._y = this._yMax; this._vy = -Math.abs(this._vy); }

    this.group.position.x = this._x;
    this.group.position.y = this._y;
  }

  dispose() {
    this.group.traverse((n) => {
      if (n && n.isMesh) {
        if (n.geometry) n.geometry.dispose();
        if (n.material) n.material.dispose();
      }
    });
  }
}

/* ------------------------------------------------------------------ */
/* fish thumbs (sell tab)                                               */
/* ------------------------------------------------------------------ */

const thumbLoader = new GLTFLoader();
const thumbCache = new Map(); // key: `${url}|${yaw}` -> { state:"ready"|"loading"|"error", canvas:HTMLCanvasElement }
const thumbInFlight = new Set();

/**
 * @param {string} url
 * @param {number} yaw
 * @returns {HTMLElement}
 */
function makeFishThumb(url, yaw) {
  const key = `${url}|${yaw}`;
  const cached = thumbCache.get(key);

  if (cached && cached.canvas) {
    // IMPORTANT: always style cached canvas too
    cached.canvas.style.width = "100%";
    cached.canvas.style.height = "100%";
    cached.canvas.style.display = "block";

    const wrap = document.createElement("div");
    wrap.style.width = "100%";
    wrap.style.height = "100%";
    wrap.style.display = "grid";
    wrap.style.placeItems = "center";
    wrap.appendChild(cached.canvas);
    return wrap;
  }

  const c = document.createElement("canvas");
  c.width = 360;
  c.height = 180;

  // IMPORTANT: fill the thumbnail slot
  c.style.width = "100%";
  c.style.height = "100%";
  c.style.display = "block";

  thumbCache.set(key, { state: "loading", canvas: c });

  if (!thumbInFlight.has(key)) {
    thumbInFlight.add(key);

    thumbLoader.load(
      url,
      (gltf) => {
        const r = new THREE.WebGLRenderer({ canvas: c, alpha: true, antialias: true });
        r.setPixelRatio(1);

        const s = new THREE.Scene();

        const model = gltf.scene || gltf.scenes?.[0];
        const root = model ? model.clone(true) : new THREE.Group();

        root.traverse((n) => {
          if (n && n.isMesh && n.material) n.material = n.material.clone();
        });

        // faces the correct way for the thumb
        root.rotation.set(0, yaw, 0);

        // compute bounds
        const box = new THREE.Box3().setFromObject(root);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);

        const maxDim = Math.max(0.0001, size.x, size.y, size.z);

        // centre to origin
        root.position.sub(center);

        // scale to fill
        const target = 1.45;
        const k = target / maxDim;
        root.scale.multiplyScalar(k);

        // final bounds after scaling
        const box2 = new THREE.Box3().setFromObject(root);
        const size2 = new THREE.Vector3();
        const center2 = new THREE.Vector3();
        box2.getSize(size2);
        box2.getCenter(center2);

        const pad = 1.14;
        const halfW = (size2.x * pad) / 2;
        const halfH = (size2.y * pad) / 2;

        const cam = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.01, 50);
        cam.position.set(0, 0, 6);
        cam.lookAt(0, 0, 0);

        // re-centre again
        root.position.sub(center2);
        root.position.y -= size2.y * 0.05;

        s.add(root);
        r.render(s, cam);

        r.dispose();
        thumbCache.set(key, { state: "ready", canvas: c });

        if (shopUI && typeof shopUI.refresh === "function") shopUI.refresh();
      },
      undefined,
      () => {
        thumbCache.set(key, { state: "error", canvas: c });
        const ctx = c.getContext("2d");
        if (ctx) {
          ctx.clearRect(0, 0, c.width, c.height);
          ctx.fillStyle = "rgba(255,255,255,0.65)";
          ctx.font = "bold 18px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("fish", c.width / 2, c.height / 2);
        }
        if (shopUI && typeof shopUI.refresh === "function") shopUI.refresh();
      }
    );
  }

  const wrap = document.createElement("div");
  wrap.style.width = "100%";
  wrap.style.height = "100%";
  wrap.style.display = "grid";
  wrap.style.placeItems = "center";
  wrap.appendChild(c);
  return wrap;
}

function thumbYawForUrl(url) {
  // only 0 or PI/2, per your rule
  if ((url || "").includes("fish2.glb")) return Math.PI / 2; // sardine
  return 0;
}

function displayNameForUrl(url) {
  if ((url || "").includes("carp.glb")) return "carp";
  if ((url || "").includes("fish2.glb")) return "sardine";
  if ((url || "").includes("bass.glb")) return "bass";
  if ((url || "").includes("koi.glb")) return "koi";
  if ((url || "").includes("nemo.glb")) return "clownfish";
  if ((url || "").includes("dory.glb")) return "blue tang";
  if ((url || "").includes("octo.glb")) return "octopus";
  if ((url || "").includes("anglerfish.glb")) return "anglerfish";
  if ((url || "").includes("turtle.glb")) return "sea turtle";
  if ((url || "").includes("shark.glb")) return "shark";
  if ((url || "").includes("sailfish.glb")) return "sailfish";
  return "fish";
}

/* ------------------------------------------------------------------ */
/* hatch mapping                                                        */
/* ------------------------------------------------------------------ */

function randPick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function growthDurationForEggType(eggType) {
  if (eggType === "basic") return 10.0;
  if (eggType === "schooling") return 30.0;
  if (eggType === "tropical") return 60.0;
  if (eggType === "saltwater") return 60.0;
  if (eggType === "ornamental") return 60.0;
  if (eggType === "deepsea") return 180.0;
  if (eggType === "mythical") return 300.0;
  return 60.0;
}

function normaliseFishToTank(obj) {
  if (!obj || !obj.group) return;

  const root = obj._root || obj.group;

  // compute size in world units
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);

  const maxDim = Math.max(0.0001, size.x, size.y, size.z);

  // target adult-ish max dimension in the tank
  // tune this if you want bigger/smaller across the board
  const targetMax = 0.42;

  // only scale down if too big, do not scale up tiny models
  if (maxDim > targetMax) {
    const k = targetMax / maxDim;
    root.scale.multiplyScalar(k);
  }

  root.rotation.z = Math.PI;
}

/**
 * spawns hatchling where egg was
 * @param {string} eggType
 * @param {number} x
 * @param {number} y
 */
function spawnHatchFish(eggType, x, y) {
  const specByType = {
    deepsea: [
      { kind: "deep", url: "assets/fish/anglerfish.glb", scaleMul: 0.95, facingFix: Math.PI, zLayer: 0.48, speedMul: 0.65 },
      { kind: "deep", url: "assets/fish/octo.glb", scaleMul: 0.84, facingFix: 0, zLayer: 0.36, speedMul: 1.0 }
    ],
    basic: [
      { kind: "common", url: "assets/fish/carp.glb", scaleMul: 0.5, facingFix: 0, zLayer: -0.36, addEye: true, eye: { mirrorX: 1.0 } }
    ],
    schooling: [
      { kind: "school", url: "assets/fish/fish2.glb", scaleMul: 2.0, facingFix: 0, zLayer: -0.24 },
      { kind: "school", url: "assets/fish/bass.glb", scaleMul: 1.5, facingFix: 0, zLayer: -0.12 }
    ],
    tropical: [
      { kind: "trop", url: "assets/fish/nemo.glb", scaleMul: 0.62, facingFix: 0, zLayer: 0.12, addEye: true, eye: { r: 0.016, x: 0.30, y: 0.023, z: 0.20, color: 0x221d1b } },
      { kind: "trop", url: "assets/fish/dory.glb", scaleMul: 0.6, facingFix: 0, zLayer: 0.00, addEye: true, eye: { r: 0.022, x: 0.28, y: 0.014, z: 0.22, color: 0x2b2422 } }
    ],
    ornamental: [
      { kind: "orn", url: "assets/fish/koi.glb", scaleMul: 1.38, facingFix: 0, zLayer: 0.24 }
    ],
    saltwater: [
      { kind: "reef", url: "assets/fish/turtle.glb", scaleMul: 1.6, facingFix: Math.PI, zLayer: 0.18, speedMul: 0.85 }
    ],
    mythical: [
      { kind: "myth", url: "assets/fish/shark.glb", scaleMul: 0.92, facingFix: 0, zLayer: 0.30, speedMul: 1.05 },
      { kind: "myth", url: "assets/fish/sailfish.glb", scaleMul: 0.95, facingFix: 0, zLayer: 0.36, speedMul: 1.18 }
    ]
  };

  const list = specByType[eggType] || [];
  if (!list.length) {
    console.log(`[egg hatch] ${eggType}: no fish model wired yet`);
    return null;
  }

  const spec = randPick(list);

  /** @type {any} */
  let obj = null;

  // PROTOTYPE: real in-tank primitive fish (rectangle + triangle), not the full glb
  if (mode === MODE_PROTO) {
    obj = new PrimitiveFish({
      eggType,
      width: worldW,
      height: worldH,
      aquarium,
      zLayer: (typeof spec.zLayer === "number") ? spec.zLayer : 0.0
    });
  } else if (spec.kind === "common") {
    obj = new CommonFish({
      width: worldW, height: worldH, depth: 6, mode,
      aquarium,
      url: spec.url,
      scaleMul: spec.scaleMul,
      facingFix: spec.facingFix || 0,
      zLayer: spec.zLayer,
      addEye: !!spec.addEye,
      eye: spec.eye || undefined
    });
  } else if (spec.kind === "school") {
    obj = new SchoolingFish({
      width: worldW, height: worldH, depth: 6, mode,
      aquarium,
      url: spec.url,
      scaleMul: spec.scaleMul,
      facingFix: spec.facingFix || 0,
      zLayer: spec.zLayer,
      schoolId: `hatch_${Math.random().toString(16).slice(2)}`,
      memberIndex: 0,
      schoolSize: 1
    });
  } else if (spec.kind === "trop") {
    obj = new TropicalFish({
      width: worldW, height: worldH, depth: 6, mode,
      url: spec.url,
      scaleMul: spec.scaleMul,
      facingFix: spec.facingFix || 0,
      zLayer: spec.zLayer,
      addEye: !!spec.addEye,
      eye: spec.eye || undefined
    });
  } else if (spec.kind === "reef") {
    obj = new ReefFish({
      width: worldW, height: worldH, depth: 6, mode,
      url: spec.url,
      scaleMul: spec.scaleMul,
      facingFix: spec.facingFix || 0,
      zLayer: spec.zLayer,
      speedMul: (typeof spec.speedMul === "number") ? spec.speedMul : 1.0
    });
  } else if (spec.kind === "orn") {
    obj = new OrnamentalFish({
      width: worldW, height: worldH, depth: 6, mode,
      url: spec.url,
      scaleMul: spec.scaleMul,
      facingFix: spec.facingFix || 0,
      zLayer: spec.zLayer,
      speedMul: 0.92
    });
  } else if (spec.kind === "deep") {
    obj = new DeepSeaCreature({
      width: worldW, height: worldH, depth: 6, mode,
      url: spec.url,
      scaleMul: spec.scaleMul,
      facingFix: spec.facingFix || 0,
      zLayer: spec.zLayer,
      speedMul: spec.speedMul || 1.0
    });
  } else if (spec.kind === "myth") {
    obj = new MythicalFish({
      width: worldW, height: worldH, depth: 6, mode,
      aquarium,
      url: spec.url,
      scaleMul: spec.scaleMul,
      facingFix: spec.facingFix || 0,
      zLayer: spec.zLayer,
      speedMul: (typeof spec.speedMul === "number") ? spec.speedMul : 1.0
    });
  }

  if (!obj) return null;

  scene.add(obj.group);

  // clamps spawn y immediately so never start above ceiling
  const baseX = x;
  const baseY = clampYForFish(obj, y);

  if (typeof obj._x === "number") obj._x = baseX;
  if (typeof obj._y === "number") obj._y = baseY;
  obj.group.position.x = baseX;
  obj.group.position.y = baseY;

  const now = clock.elapsedTime;

  // SELL: tags fish with an id so can pick it with a raycaster later
  const fishId = fishIdCounter++;
  if (!obj.group.userData) obj.group.userData = {};
  obj.group.userData.fishId = fishId;

  hatchFish.push({
    id: fishId,
    eggType,
    obj,
    spec: { ...spec },
    bornAt: now,
    growDur: growthDurationForEggType(eggType),
      startF: 0.14,
      // full mode fish should be 4x larger than before (endF used to be 0.25).
      endF: 1.0,
    adultRootScale: null,

    baseX,
    baseY,

    liftDur: 2.2,
    liftDist: 0.22,
    liftStart: null,
    liftDone: false,

    settleUntil: null,
    settleExtra: 0.35,

    modelUrl: spec.url,
    displayName: displayNameForUrl(spec.url),
    thumbYaw: thumbYawForUrl(spec.url)
  });

  return fishId;
}

function spawnEggFromPurchase(eggType) {
  const e = new Egg({
    eggType,
    mode, // MODE: pass mode into egg
    worldW,
    worldH,
    aquarium,
    sand,
    onHatch: (type, egg) => {
      const p = egg.getPosition();
      const fishId = spawnHatchFish(type, p.x, p.y);
      if (tutorial && typeof tutorial.onHatch === "function") tutorial.onHatch(type, fishId);

      const ei = eggs.indexOf(egg);
      if (ei >= 0) eggs.splice(ei, 1);
      if (egg && egg.group) scene.remove(egg.group);
      if (egg && typeof egg.dispose === "function") egg.dispose();
    }
  });

  eggs.push(e);
  scene.add(e.group);
}

/* ------------------------------------------------------------------ */
/* shop ui                                                              */
/* ------------------------------------------------------------------ */

let shopUI = null;

let lastSellSig = "";

function spawnDecorFromPurchase(decorType) {
  const it = (shopData.decor || []).find((d) => d && d.decorType === decorType);
  const url = it && it.url ? it.url : null;
  if (!url) return;

  const d = new Decor({
    decorType,
    url,
    mode,
    worldW,
    worldH,
    aquarium,
    sand
  });

  if (!d.group.userData) d.group.userData = {};
  d.group.userData.decor = d;

  decors.push(d);
  scene.add(d.group);
}

function buildShopUI() {
  shopUI = new ShopUI({
    state: gameState,
    data: shopData,
    onCoinsChanged: (c) => { gameState.coins = c; },

    onBuyItem: (item) => {
      if (!item) return;
      if (item.eggType) spawnEggFromPurchase(item.eggType);
      if (item.decorType) spawnDecorFromPurchase(item.decorType);
    },

    // FIX: when selling from shop list, actually remove fish
    onSellItem: (item) => {
      if (!item || item.kind !== "fish" || typeof item.fishId !== "number") return;

      const idx = hatchFish.findIndex((hf) => hf && hf.id === item.fishId);
      if (idx < 0) return;

      const hf = hatchFish[idx];
      if (!hf || !hf.obj || !hf.obj.group) return;

      scene.remove(hf.obj.group);
      if (typeof hf.obj.dispose === "function") hf.obj.dispose();
      hatchFish.splice(idx, 1);

      const now = clock.elapsedTime;
      lastSellSig = rebuildSellList(now);

      if (shopUI && typeof shopUI.refresh === "function") shopUI.refresh();
    },

    getThumbNode: (item) => {
      if (!item) return null;

      // PROTOTYPE: everything primitivey
      if (mode === MODE_PROTO) {
        if (item.eggType && item.kind !== "fish") {
          return makePrimitiveEggThumb(item.eggType);
        }
        if (item.kind === "fish") {
          return makePrimitiveFishThumb(item.eggType || "basic");
        }
        if (item.kind === "decor") {
          return makePrimitiveDecorThumb(item.decorType || item.id || "decor");
        }
        return null;
      }

      // FULL: existing fancy behaviour
      if (item.eggType && item.kind !== "fish") {
        return makeEggThumb(item.eggType);
      }

      if (item.kind === "decor" && item.url) {
        return makeFishThumb(item.url, 0);
      }

      if (item.kind === "fish") {
        // prefer your hand-made png thumbs in full mode (sell tab)
        if (item.thumbKey) {
          const wrap = document.createElement("div");
          wrap.style.width = "100%";
          wrap.style.height = "100%";
          wrap.style.display = "grid";
          wrap.style.placeItems = "center";
          wrap.style.overflow = "hidden";

          const img = document.createElement("img");
          img.alt = item.name || "fish";
          img.draggable = false;
          img.src = `assets/ui/fish/${item.thumbKey}.png`;
          img.style.width = "100%";
          img.style.height = "100%";
          img.style.objectFit = "contain";
          img.style.display = "block";
          img.style.filter = "drop-shadow(0 10px 18px rgba(0,0,0,0.24))";

          wrap.appendChild(img);
          return wrap;
        }

        // fallback: glb render thumb
        if (item.modelUrl) {
          const yaw = (typeof item.thumbYaw === "number") ? item.thumbYaw : thumbYawForUrl(item.modelUrl);
          return makeFishThumb(item.modelUrl, yaw);
        }
      }

      return null;
    },

    onUIEvent: (type, detail) => {
      if (tutorial && typeof tutorial.onUIEvent === "function") tutorial.onUIEvent(type, detail);
    }
  });

  shopUI.mount(document.body);
  if (shopUI && typeof shopUI.setOpen === "function") shopUI.setOpen(false);
}

/* ------------------------------------------------------------------ */
/* tutorial                                                             */
/* ------------------------------------------------------------------ */

function buildTutorialUI() {
  if (document.getElementById("aq-tutorial-style")) return;

  const style = document.createElement("style");
  style.id = "aq-tutorial-style";
  style.textContent = `
    .aq-tutBubble{
      position: fixed;
      left: 50%;
      bottom: 60px; /* moved up so it sits more in sand-middle-ish zone */
      transform: translateX(-50%);
      z-index: 60;
      pointer-events: auto;

      width: min(640px, calc(100vw - 28px)); /* less wide */
      padding: 12px 14px;
      border-radius: 22px;

      background: rgba(12, 18, 26, 0.72);
      border: 1px solid rgba(255,255,255,0.16);
      box-shadow: 0 22px 80px rgba(0,0,0,0.55);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);

      color: rgba(238,247,255,0.95);
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      font-weight: 800;
      letter-spacing: 0.1px;
      line-height: 1.25;
    }

    .aq-tutBubbleHidden{ display: none; }

    .aq-tutBubbleInner{
      display: flex;
      align-items: flex-start;
      gap: 12px;
    }

    .aq-tutDot{
      width: 14px;
      height: 14px;
      border-radius: 999px;
      margin-top: 3px;
      background: radial-gradient(circle at 35% 35%, rgba(255,255,255,0.92), rgba(160,235,255,0.75) 40%, rgba(80,180,255,0.20));
      box-shadow: 0 0 18px rgba(170, 235, 255, 0.55);
      flex: 0 0 auto;
    }

    .aq-tutText{
      font-size: 15px;
      white-space: pre-wrap;
    }

    .aq-tutSkip{
      margin-left: auto;
      flex: 0 0 auto;
      border-radius: 999px;
      padding: 7px 10px;
      font-size: 13px;
      font-weight: 900;
      border: 1px solid rgba(255,255,255,0.16);
      background: rgba(0,0,0,0.22);
      color: rgba(238,247,255,0.92);
      cursor: pointer;
    }

    .aq-tutSkip:hover{
      background: rgba(0,0,0,0.30);
      border-color: rgba(255,255,255,0.22);
    }
  `;
  document.head.appendChild(style);
}

function createTutorialController() {
  buildTutorialUI();

  const bubble = document.createElement("div");
  bubble.className = "aq-tutBubble aq-tutBubbleHidden";

  const inner = document.createElement("div");
  inner.className = "aq-tutBubbleInner";

  const dot = document.createElement("div");
  dot.className = "aq-tutDot";

  const text = document.createElement("div");
  text.className = "aq-tutText";

  const skip = document.createElement("button");
  skip.type = "button";
  skip.className = "aq-tutSkip";
  skip.textContent = "skip";

  inner.appendChild(dot);
  inner.appendChild(text);
  inner.appendChild(skip);
  bubble.appendChild(inner);
  document.body.appendChild(bubble);

  let active = true;
  let step = "welcome";

  /** @type {number|null} */
  let firstFishId = null;
  /** @type {number|null} */
  let secondFishId = null;

  /** @type {number} */
  let timer = 0;

  /** @type {HTMLElement|null} */
  let pulsing = null;

  // typewriter state
  let twFull = "";
  let twI = 0;
  let twOn = false;
  let twCarry = 0;

  function show(msg) {
    if (!active) return;
    bubble.classList.remove("aq-tutBubbleHidden");

    // letter-by-letter
    twFull = String(msg || "");
    twI = 0;
    twCarry = 0;
    twOn = true;
    text.textContent = "";
  }

  function hide() {
    bubble.classList.add("aq-tutBubbleHidden");
  }

  function clearPulse() {
    if (pulsing) pulsing.classList.remove("aq-tutPulse");
    pulsing = null;
  }

  function pulse(el) {
    clearPulse();
    if (!el) return;
    pulsing = el;
    pulsing.classList.add("aq-tutPulse");
  }

  function pulseShop() {
    if (!shopUI) return;
    pulse(shopUI.getTutorialElement("shop"));
  }

  function pulseClose() {
    if (!shopUI) return;
    pulse(shopUI.getTutorialElement("close"));
  }

  function pulseTabBuy() {
    if (!shopUI) return;
    pulse(shopUI.getTutorialElement("tab_buy"));
  }

  function pulseTabSell() {
    if (!shopUI) return;
    pulse(shopUI.getTutorialElement("tab_sell"));
  }

  function pulseBuyItem(itemId) {
    if (!shopUI) return;
    pulse(shopUI.getTutorialElement(`buy_item:${String(itemId)}`));
  }

  function pulseSellItem(itemId) {
    if (!shopUI) return;
    pulse(shopUI.getTutorialElement(`sell_item:${String(itemId)}`));
  }

  function finish() {
    clearPulse();
    show("that's it for the tutorial! buy eggs, sell fish, and have fun discovering new fish! don't forget to check out decorations in the shop as well!");
    step = "done";
    timer = 0;
  }

  skip.addEventListener("click", () => {
    active = false;
    clearPulse();
    hide();
  });

  // initial state
  show("welcome to your aquarium!\nstart by buying a basic egg!");
  pulseShop();

  return {
    get active() { return active; },
    get step() { return step; },
    onUIEvent: (type, detail) => {
      if (!active) return;

      if (step === "welcome") {
        if (type === "open" && detail && detail.open) {
          // shop opened
          pulseBuyItem("egg_basic");
          step = "buy_basic";
        }
        return;
      }

      if (step === "buy_basic") {
        if (type === "buy" && detail && detail.id === "egg_basic") {
          pulseClose();
          step = "close_after_basic";
        }
        return;
      }

      if (step === "close_after_basic") {
        if (type === "open" && detail && !detail.open) {
          clearPulse();
          show("look, it's hatching!\nlet's wait for your fish to grow...");
          step = "wait_hatch";
        }
        return;
      }

      if (step === "sell_intro") {
        if (type === "open" && detail && detail.open) {
          pulseTabSell();
          step = "go_sell_tab";
        }
        return;
      }

      if (step === "go_sell_tab") {
        if (type === "tab" && detail && detail.tab === "sell") {
          if (firstFishId !== null) pulseSellItem(`sell_${firstFishId}`);
          step = "sell_fish";
        }
        return;
      }

      if (step === "sell_fish") {
        if (type === "sell" && detail && typeof detail.id === "string" && detail.id === `sell_${firstFishId}`) {
          clearPulse();
          show("now we have enough to buy a new egg! let's try it out~");
          pulseTabBuy();
          step = "buy_schooling";
        }
        return;
      }

      if (step === "buy_schooling") {
        if (type === "tab" && detail && detail.tab === "buy") {
          pulseBuyItem("egg_schooling");
          return;
        }

        if (type === "buy" && detail && detail.id === "egg_schooling") {
          pulseClose();
          step = "close_after_schooling";
        }
        return;
      }

      if (step === "close_after_schooling") {
        if (type === "open" && detail && !detail.open) {
          clearPulse();
          show("i can't wait to see what our new fish will look like!");
          step = "wait_second_hatch";
        }
        return;
      }
    },
    onHatch: (eggType, fishId) => {
      if (!active) return;

      if (step === "wait_hatch" && eggType === "basic") {
        if (typeof fishId === "number") firstFishId = fishId;
        // keep message on screen, and move to waiting-for-adult
        step = "wait_adult";
        timer = 0;
        return;
      }

      if (step === "wait_second_hatch" && eggType === "schooling") {
        if (typeof fishId === "number") secondFishId = fishId;
        show("wow, it's so cute!");
        step = "wrap_up";
        timer = 0;
      }
    },
    update: (dt, t) => {
      if (!active) return;

      // typewriter tick
      if (twOn) {
        const cps = 55; // letters per second
        twCarry += dt * cps;
        const add = Math.floor(twCarry);
        if (add > 0) {
          twCarry -= add;
          twI = Math.min(twFull.length, twI + add);
          text.textContent = twFull.slice(0, twI);
          if (twI >= twFull.length) twOn = false;
        }
      }

      // auto-hides final bubble after a bit, but doesn't hide guidance ones
      if (step === "wrap_up") {
        timer += dt;
        if (timer > 2.2) {
          finish();
        }
        return;
      }

      if (step === "done") {
        timer += dt;
        if (timer > 6.0) {
          hide();
          active = false;
        }
        return;
      }

      // waits for first fish to become adult, then cues selling
      if (step === "wait_adult" && firstFishId !== null) {
        const hf = hatchFish.find((x) => x && x.id === firstFishId);
        if (!hf) return;
        const age = t - hf.bornAt;
        if (age >= hf.growDur) {
          show("your fish is all grown up! you can sell it for money now~");
          pulseShop();
          step = "sell_intro";
        }
        return;
      }
    }
  };
}

function computeWaterAnchorRect() {
  const r = canvas.getBoundingClientRect();
  const insetX = Math.max(18, r.width * 0.04);
  const insetTop = Math.max(16, r.height * 0.045);
  const insetBottom = Math.max(18, r.height * 0.10);
  return new DOMRect(
    r.left + insetX,
    r.top + insetTop,
    Math.max(0, r.width - insetX * 2),
    Math.max(0, r.height - insetTop - insetBottom)
  );
}

function syncShopAnchor() {
  if (!shopUI) return;
  const r = computeWaterAnchorRect();
  shopUI.setAnchorRect(r);
  if (feed && typeof feed.setAnchorRect === "function") feed.setAnchorRect(r);
}

/* ------------------------------------------------------------------ */
/* sizing                                                               */
/* ------------------------------------------------------------------ */

function resize() {
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  const prevH = _lastWorldH || worldH;
  renderer.setSize(w, h, false);

  const aspect = w / Math.max(1, h);
  const viewHeight = 2.2;
  const viewWidth = viewHeight * aspect;

  camera.left = -viewWidth / 2;
  camera.right = viewWidth / 2;
  camera.top = viewHeight / 2;
  camera.bottom = -viewHeight / 2;
  camera.updateProjectionMatrix();

  worldW = viewWidth;
  worldH = viewHeight;

  const scaleK = (prevH > 0.0001) ? (worldH / prevH) : 1.0;

  // rescale existing fish so they keep the same relative size in the tank
  for (const hf of hatchFish) {
    if (!hf || !hf.obj || !hf.obj._root) continue;

    hf.obj._root.scale.multiplyScalar(scaleK);

    // keep growth math consistent (so it doesn't snap bigger again)
    if (typeof hf.adultRootScale === "number" && hf.adultRootScale !== null) {
      hf.adultRootScale *= scaleK;
    }
  }

_lastWorldH = worldH;
  rebuildScene();
  syncShopAnchor();

  for (const e of eggs) {
    if (e && typeof e.setEnvironment === "function") e.setEnvironment(worldW, worldH, aquarium, sand);
  }
  for (const hf of hatchFish) {
    if (hf && hf.obj && typeof hf.obj.setBounds === "function") hf.obj.setBounds(worldW, worldH, aquarium);
  }

  if (feed && typeof feed.setEnvironment === "function") {
    feed.setEnvironment(worldW, worldH, aquarium, sand);
  }
}

window.addEventListener("resize", resize);
resize();

/* ------------------------------------------------------------------ */
/* loop                                                                 */
/* ------------------------------------------------------------------ */

buildModeToggle();
buildShopUI();
syncShopAnchor();

// feed (button sits left of shop button)
feed = new Feed({
  canvas,
  camera,
  scene,
  aquarium,
  sand
});
if (feed && shopUI && typeof feed.attachToShop === "function") {
  feed.attachToShop(shopUI);
  feed.setEnvironment(worldW, worldH, aquarium, sand);
  feed.setAnchorRect(computeWaterAnchorRect());
}

// tutorial
tutorial = createTutorialController();

// SELL: click-to-sell (raycast) while shop is open on sell tab
const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();

function isShopOpen() {
  return !!(shopUI && shopUI.open);
}

function pickFishUnderPointer(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = (clientX - rect.left) / Math.max(1, rect.width);
  const y = (clientY - rect.top) / Math.max(1, rect.height);

  pointerNDC.x = x * 2 - 1;
  pointerNDC.y = -(y * 2 - 1);

  raycaster.setFromCamera(pointerNDC, camera);

  const roots = [];
  for (const hf of hatchFish) {
    if (hf && hf.obj && hf.obj.group) roots.push(hf.obj.group);
  }

  const hits = raycaster.intersectObjects(roots, true);
  if (!hits || !hits.length) return null;

  // walks up until finds a group with a fishId
  let obj = hits[0].object;
  while (obj) {
    if (obj.userData && typeof obj.userData.fishId === "number") return obj.userData.fishId;
    obj = obj.parent;
  }
  return null;
}

function pointerToWorld(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = (clientX - rect.left) / Math.max(1, rect.width);
  const y = (clientY - rect.top) / Math.max(1, rect.height);

  pointerNDC.x = x * 2 - 1;
  pointerNDC.y = -(y * 2 - 1);

  const v = new THREE.Vector3(pointerNDC.x, pointerNDC.y, 0);
  v.unproject(camera);
  return { x: v.x, y: v.y };
}

function pickDecorUnderPointer(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = (clientX - rect.left) / Math.max(1, rect.width);
  const y = (clientY - rect.top) / Math.max(1, rect.height);

  pointerNDC.x = x * 2 - 1;
  pointerNDC.y = -(y * 2 - 1);

  raycaster.setFromCamera(pointerNDC, camera);

  const roots = [];
  for (const d of decors) {
    if (d && d.group) roots.push(d.group);
  }

  const hits = raycaster.intersectObjects(roots, true);
  if (!hits || !hits.length) return null;

  let obj = hits[0].object;
  while (obj) {
    if (obj.userData && obj.userData.decor) return obj.userData.decor;
    obj = obj.parent;
  }
  return null;
}

// DECOR DRAG: always-on dragging, constrained to the sand region
let dragState = null;

function dragEnabled() {
  // doesn't drag while feeding or while shop is open on sell tab (click-to-sell)
  if (feed && typeof feed.isOn === "function" && feed.isOn()) return false;
  if (isShopOpen() && shopUI && shopUI.tab === "sell") return false;
  return true;
}

canvas.addEventListener("pointerdown", (ev) => {
  if (!dragEnabled()) return;

  const decor = pickDecorUnderPointer(ev.clientX, ev.clientY);
  if (!decor || !decor.group) return;

  const p = pointerToWorld(ev.clientX, ev.clientY);
  const ox = decor.group.position.x - p.x;
  const oy = decor.group.position.y - p.y;

  dragState = {
    pointerId: ev.pointerId,
    decor,
    ox,
    oy
  };

  if (typeof decor.startDrag === "function") decor.startDrag();

  // keeps receiving move/up even if pointer leaves canvas
  try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }

  ev.preventDefault();
  ev.stopPropagation();
});

window.addEventListener("pointermove", (ev) => {
  if (!dragState) return;
  if (ev.pointerId !== dragState.pointerId) return;

  const decor = dragState.decor;
  if (!decor) return;

  const p = pointerToWorld(ev.clientX, ev.clientY);
  const tx = p.x + dragState.ox;
  const ty = p.y + dragState.oy;

  if (typeof decor.dragTo === "function") decor.dragTo(tx, ty);

  ev.preventDefault();
});

window.addEventListener("pointerup", (ev) => {
  if (!dragState) return;
  if (ev.pointerId !== dragState.pointerId) return;

  const decor = dragState.decor;
  if (decor && typeof decor.endDrag === "function") decor.endDrag();

  dragState = null;
});

window.addEventListener("pointercancel", (ev) => {
  if (!dragState) return;
  if (ev.pointerId !== dragState.pointerId) return;

  const decor = dragState.decor;
  if (decor && typeof decor.endDrag === "function") decor.endDrag();

  dragState = null;
});

// FEED: click to drop flakes (only when feed toggle is on and shop is closed)
canvas.addEventListener("pointerdown", (ev) => {
  if (!feed || typeof feed.isOn !== "function" || !feed.isOn()) return;
  if (isShopOpen()) return;
  if (typeof feed.onPointerDown === "function") feed.onPointerDown(ev);
});

// SELL: click to sell fish under pointer while shop sell tab is open
canvas.addEventListener("pointerdown", (ev) => {
  if (!isShopOpen()) return;
  if (!shopUI || shopUI.tab !== "sell") return;

  const fishId = pickFishUnderPointer(ev.clientX, ev.clientY);
  if (typeof fishId !== "number") return;

  const now = clock.elapsedTime;
  rebuildSellList(now);

  const item = (shopData.sell || []).find((it) => it && it.fishId === fishId);
  if (!item) return;

  // let shop handle transaction
  if (typeof shopUI.sellById === "function") {
    shopUI.sellById(item.id);
  }
});

/**
 * during hatch lift does NOT run fish movement update, because it fights lift animation
 * and makes hatchlings jitter/teleport
 * @param {any} obj
 * @param {number} dt
 */
function tickOnlyMixer(obj, dt) {
  if (!obj || !dt) return;
  if (obj._mixer && typeof obj._mixer.update === "function") {
    const sp = (typeof obj._animSpeed === "number") ? obj._animSpeed : 1.0;
    obj._mixer.update(dt * sp);
  }
}

function loop() {
  requestAnimationFrame(loop);

  const dt = clock.getDelta();
  const t = clock.elapsedTime;

  if (tutorial && typeof tutorial.update === "function") tutorial.update(dt, t);

  if (aquarium) aquarium.update(dt, t);
  if (sand) sand.update(dt, t);

  if (feed && typeof feed.update === "function") feed.update(dt, t);

  for (const e of eggs) {
    if (e) e.update(dt, t);
  }

  for (const d of decors) {
    if (d) d.update(dt, t);
  }

  // hatch lift owns position, so skips fish movement until lift is done
  for (const hf of hatchFish) {
    if (!hf || !hf.obj) continue;

    const settling = (hf.settleUntil !== null) && (t < hf.settleUntil);

    if (!hf.liftDone || settling) {
      tickOnlyMixer(hf.obj, dt);
      continue;
    }

    // FEED: attracts toward nearest flake (light touch, only if feed is on)
    if (feed && typeof feed.isOn === "function" && feed.isOn() && typeof feed.getNearestFlake === "function" && hf.obj.group) {
      const p = hf.obj.group.position;
      const nearest = feed.getNearestFlake(p.x, p.y);

      if (nearest) {
        // schooling fish: steer shared leader target if present
        if (hf.obj._school && hf.obj._school.target) {
          hf.obj._school.target.x = nearest.x;
          hf.obj._school.target.y = nearest.y;
          hf.obj._school.timer = 0.05;
        } else {
          // other fish: nudges their internal motion if those fields exist
          const fx = (typeof hf.obj._x === "number") ? hf.obj._x : p.x;
          const fy = (typeof hf.obj._y === "number") ? hf.obj._y : p.y;

          const dx = nearest.x - fx;
          const dy = nearest.y - fy;

          // encourages facing
          if (typeof hf.obj._dir === "number" && Math.abs(dx) > 0.04) {
            hf.obj._dir = (dx >= 0) ? 1 : -1;
            if (typeof hf.obj._applyFacingNow === "function") hf.obj._applyFacingNow();
            if (typeof hf.obj._applyFacing === "function") hf.obj._applyFacing();
          }

          // encourages motion via velocity when available
          if (typeof hf.obj._vx === "number") {
            hf.obj._vx += THREE.MathUtils.clamp(dx, -0.6, 0.6) * 0.75 * dt;
          }
          if (typeof hf.obj._vy === "number") {
            hf.obj._vy += THREE.MathUtils.clamp(dy, -0.6, 0.6) * 0.75 * dt;
          }

          // small y drift helper when class uses _y directly
          if (typeof hf.obj._y === "number") {
            hf.obj._y += THREE.MathUtils.clamp(dy, -0.25, 0.25) * 0.55 * dt;
          }
        }
      }
    }

    hf.obj.update(dt, t);

    // never allows fish to exceed aquarium top
    enforceTopCeiling(hf.obj);

    // eats flakes near fish
    if (feed && typeof feed.isOn === "function" && feed.isOn() && typeof feed.tryEatAt === "function" && hf.obj.group) {
      feed.tryEatAt(hf.obj.group.position.x, hf.obj.group.position.y, 0.16);
    }
  }

  // growth animation (scales up over time)
  for (const hf of hatchFish) {
    if (!hf || !hf.obj || !hf.obj.group) continue;

    const age = t - hf.bornAt;
    const f = THREE.MathUtils.clamp(age / hf.growDur, 0, 1);
    const eased = f * f * (3 - 2 * f);

    if (hf.adultRootScale === null && hf.obj._root) {
      hf.adultRootScale = Math.abs(hf.obj._root.scale.x);
    }

    const baseScale = (hf.adultRootScale !== null) ? hf.adultRootScale : 1;
    const s = THREE.MathUtils.lerp(hf.startF, hf.endF, eased);

    if (hf.obj._root) {
      const sx = (hf.obj._root.scale.x < 0) ? -1 : 1;
      const sy = (hf.obj._root.scale.y < 0) ? -1 : 1;

      hf.obj._root.scale.setScalar(baseScale * s);
      hf.obj._root.scale.x *= sx;
      hf.obj._root.scale.y *= sy;
    }

    // hatch lift animation
    if (!hf.liftDone) {
      if (hf.liftStart === null) hf.liftStart = t;

      const u = THREE.MathUtils.clamp((t - hf.liftStart) / hf.liftDur, 0, 1);
      const liftE = 1 - Math.pow(1 - u, 3);

      // IMPORTANT: clamp so NO fish ever crosses top boundary.
      const liftedY = hf.baseY + liftE * hf.liftDist;
      const clampedY = clampYForFish(hf.obj, liftedY);

      hf.obj.group.position.y = clampedY;
      if (typeof hf.obj._y === "number") hf.obj._y = clampedY;

      // keeps rendered mesh under top glass too
      enforceTopCeiling(hf.obj);

      hf.obj.group.position.x = hf.baseX;
      if (typeof hf.obj._x === "number") hf.obj._x = hf.baseX;

      if (u >= 1) {
        hf.liftDone = true;

        // ends lift at lifted position (doesnt snap back to original baseY)
        const finalLiftedY = clampYForFish(hf.obj, hf.baseY + hf.liftDist);

        // makes lifted position new "base"
        hf.baseY = finalLiftedY;

        hf.obj.group.position.y = finalLiftedY;
        if (typeof hf.obj._y === "number") hf.obj._y = finalLiftedY;

        // final safety clamp in case this fish model is tall
        enforceTopCeiling(hf.obj);

        // post-lift settle window
        hf.settleUntil = t + (hf.settleExtra || 0.35);

        // makes sure internal state starts from final placed position
        if (typeof hf.obj._x === "number") hf.obj._x = hf.baseX;
        if (typeof hf.obj._y === "number") hf.obj._y = finalLiftedY;
      }
    }
  }

  // keeps sell tab list up to date (and refresh immediately when a fish becomes adult)
  if (shopUI && shopUI.open && shopUI.tab === "sell") {
    const sig = rebuildSellList(t);
    if (sig !== lastSellSig) {
      lastSellSig = sig;
      if (typeof shopUI.refresh === "function") shopUI.refresh();
    }
  }

  renderer.render(scene, camera);
}
loop();
