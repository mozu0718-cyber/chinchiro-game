// ドラッグ（スワイプ）でサイコロを投げる操作。
import { HAND_HEIGHT, RELEASE_RADIUS, HAND_MAX_RADIUS } from './roller.js';

const MAX_SPEED = 18;
const MIN_SPEED = 3; // これより遅いと投げたことにしない
const THROW_GAIN = 4.5; // 指の速さ（画面の高さ/秒）→ 投げる速さ
// 指の位置は丼の中ほどの高さの面で読み取る。手の高さ（縁より上）で読むと、
// 画面で丼の横に見える点が実際には手前寄りになり、狙いが見た目とずれるため。
const POINTER_PLANE_Y = 1.0;

export const HAND_START = { x: 0, y: HAND_HEIGHT, z: RELEASE_RADIUS + 1.0 };

export class DragThrower {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('./scene.js').TableScene} scene
   * @param {import('./physics.js').DiceWorld} world
   * @param {{onFirstTouch?: () => void, onTooWeak?: () => void}} hooks
   */
  constructor(canvas, scene, world, hooks = {}) {
    this.canvas = canvas;
    this.scene = scene;
    this.world = world;
    this.hooks = hooks;
    this.waiting = null;
    this.holding = false;
    this.samples = [];

    canvas.addEventListener('pointerdown', (e) => this.#down(e));
    canvas.addEventListener('pointermove', (e) => this.#move(e));
    const up = () => { if (this.holding) this.#release(); };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
  }

  /** プレイヤーが投げるのを待つ。投げる速度で resolve する */
  waitThrow() {
    this.world.hold(HAND_START);
    return new Promise((resolve) => { this.waiting = resolve; });
  }

  #onPlane(e) {
    return this.scene.screenToPlane(e.clientX, e.clientY, POINTER_PLANE_Y);
  }

  /** 手は丼の周りの輪（縁の外側）の中だけを動く */
  #clamp(p) {
    const r = Math.hypot(p.x, p.z);
    if (r < 1e-3) return { ...HAND_START };
    const rr = Math.max(RELEASE_RADIUS, Math.min(HAND_MAX_RADIUS, r));
    return { x: (p.x / r) * rr, y: HAND_HEIGHT, z: (p.z / r) * rr };
  }

  /**
   * 直近の指の動きから投げる速度を求める。
   * 向きは卓の上での指の動き、速さは画面上の指の速さで決める（画面の奥と手前で感覚が変わらないように）。
   */
  #velocity() {
    const H = this.canvas.clientHeight;
    const now = performance.now();
    const recent = this.samples.filter((s) => now - s.t < 120);
    if (recent.length < 2) return null;
    const a = recent[0];
    const b = recent[recent.length - 1];
    const dt = Math.max(0.016, (b.t - a.t) / 1000);
    const speed = (Math.hypot(b.sx - a.sx, b.sy - a.sy) / H / dt) * THROW_GAIN;
    const dx = b.wx - a.wx;
    const dz = b.wz - a.wz;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return null;
    return { x: (dx / len) * speed, z: (dz / len) * speed, speed };
  }

  #down(e) {
    this.hooks.onFirstTouch?.();
    if (!this.waiting || this.holding) return;
    const p = this.#onPlane(e);
    if (!p) return;
    this.holding = true;
    this.canvas.setPointerCapture(e.pointerId);
    this.samples = [{ t: performance.now(), sx: e.clientX, sy: e.clientY, wx: p.x, wz: p.z }];
    this.world.hold(this.#clamp(p));
  }

  #move(e) {
    if (!this.holding) return;
    const p = this.#onPlane(e);
    if (!p) return;
    this.samples.push({ t: performance.now(), sx: e.clientX, sy: e.clientY, wx: p.x, wz: p.z });
    if (this.samples.length > 40) this.samples.shift();
    this.world.hold(this.#clamp(p));
    // 指が丼の縁を越えたら手から離れる（勢いが足りなければ縁の外で止まる）
    if (Math.hypot(p.x, p.z) < RELEASE_RADIUS) {
      const tv = this.#velocity();
      if (tv && tv.speed >= MIN_SPEED) this.#release();
    }
  }

  #release() {
    this.holding = false;
    const tv = this.#velocity();
    if (!tv || tv.speed < MIN_SPEED) {
      this.hooks.onTooWeak?.();
      return;
    }
    let { x, z, speed } = tv;
    if (speed > MAX_SPEED) { x *= MAX_SPEED / speed; z *= MAX_SPEED / speed; speed = MAX_SPEED; }
    const v = { x, y: 1.5 + speed * 0.12, z };
    window.__lastThrow = { speed, v }; // 自動テスト用
    const r = this.waiting;
    this.waiting = null;
    r(v);
  }
}
