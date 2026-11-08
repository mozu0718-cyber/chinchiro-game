// 1人分の手番（最大3回振る）を物理演算で進める。プレイヤーとCPUで共通。
import { evaluateDice, menashi, shonben } from './rules.js';

import { BOWL } from './physics.js';

export const HAND_HEIGHT = 3.0;
// 手がこの半径の内側に入ったら、サイコロが手から離れる（丼の縁の少し外側）
export const RELEASE_RADIUS = BOWL.topRadius + 0.55;
export const HAND_MAX_RADIUS = 6;
const MAX_NUDGES = 5;
const TIMEOUT = 9; // 秒。これを過ぎても止まらなければ、その時点の目で判定する

export class Roller {
  constructor(world) {
    this.world = world;
    this.pending = null;
  }

  /** 物理演算を進める。毎フレーム呼ぶ */
  update(dt) {
    this.world.step(dt);
    const p = this.pending;
    if (!p) return;
    const w = this.world;
    const timedOut = w.elapsed() > TIMEOUT;
    if (!w.isSettled() && !timedOut) return;
    if (!w.fellOut() && w.readFaces().cocked && p.nudges < MAX_NUDGES && !timedOut) {
      p.nudges++;
      w.nudgeCocked();
      return;
    }
    this.pending = null;
    const faces = w.readFaces();
    p.resolve({ fellOut: w.fellOut(), values: faces.values, cocked: faces.cocked });
  }

  /** 投げて、止まるまで待つ */
  throwAndWait(velocity) {
    this.world.release(velocity);
    return new Promise((resolve) => {
      this.pending = { resolve, nudges: 0 };
    });
  }

  /**
   * 1人分の手番。
   * @param {(attempt: number) => Promise<{x:number,y:number,z:number}>} getThrow 何投目かを受け取り、投げる速度を返す
   * @param {(event: object) => void} onEvent 途中経過の通知
   * @returns {Promise<{hand: object, values: number[]|null, attempts: number}>}
   */
  async playTurn(getThrow, onEvent = () => {}) {
    let attempt = 1;
    let cockedRetries = 0;
    while (attempt <= 3) {
      const v = await getThrow(attempt);
      const r = await this.throwAndWait(v);
      if (r.fellOut) {
        const hand = shonben();
        onEvent({ type: 'final', hand, values: null, attempt });
        return { hand, values: null, attempts: attempt };
      }
      if (r.cocked && cockedRetries < 5) {
        cockedRetries++;
        // 斜めに引っかかったまま揺らしても直らなかった：回数に数えず振り直し
        onEvent({ type: 'cocked', attempt });
        continue;
      }
      const hand = evaluateDice(r.values);
      if (hand) {
        onEvent({ type: 'final', hand, values: r.values, attempt });
        return { hand, values: r.values, attempts: attempt };
      }
      onEvent({ type: 'miss', values: r.values, attempt });
      attempt++;
    }
    const hand = menashi();
    onEvent({ type: 'final', hand, values: null, attempt: 3 });
    return { hand, values: null, attempts: 3 };
  }
}

/**
 * CPU の投げ方。席の方向（angle、ラジアン。0 が画面手前）から丼の中心に向かって投げる。
 * 狙いの速度に、性格ごとのブレ（標準偏差）を足す。ブレが大きいほどションベンになりやすい。
 * @returns {{from: {x,y,z}, velocity: {x,y,z}}}
 */
export function cpuThrow(spread, angle = 0, rand = Math.random) {
  const gauss = () => {
    let u = 0;
    let v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  // 手前（angle=0, +z 側）から投げる場合の値を、席の方向に回転させる
  const r = RELEASE_RADIUS + 0.3;
  const forward = -CPU_AIM_SPEED + gauss() * spread; // 丼へ向かう速さ（負が丼の方向）
  const side = gauss() * spread * 0.5;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return {
    from: { x: s * r, y: HAND_HEIGHT, z: c * r },
    velocity: { x: side * c + forward * s, y: 1.5 + gauss() * 0.3, z: -side * s + forward * c },
  };
}

export const CPU_AIM_SPEED = 6.5;
