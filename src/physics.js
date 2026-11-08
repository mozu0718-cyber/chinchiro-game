// 物理演算：卓・丼・サイコロ。描画には依存しない。
import * as CANNON from 'cannon-es';

// 丼の内側の断面（半径, 高さ）。底から縁へ向かって、だんだん立ち上がる曲線にする。
export const BOWL = {
  profile: [[1.7, 0.16], [1.95, 0.27], [2.1, 0.5], [2.22, 0.95], [2.3, 1.5], [2.35, 2.05]],
  segments: 32,
  wallThickness: 0.14,
  get topRadius() { return this.profile[this.profile.length - 1][0]; },
  get height() { return this.profile[this.profile.length - 1][1]; },
};
export const DIE_SIZE = 0.5;

// サイコロの各面の目（ローカル軸方向）。向かい合う面の和が7になる。
// three.js の BoxGeometry の面の順番（+x, -x, +y, -y, +z, -z）と合わせる。
export const FACE_VALUES = [2, 5, 1, 6, 3, 4];
const FACE_AXES = [
  new CANNON.Vec3(1, 0, 0), new CANNON.Vec3(-1, 0, 0),
  new CANNON.Vec3(0, 1, 0), new CANNON.Vec3(0, -1, 0),
  new CANNON.Vec3(0, 0, 1), new CANNON.Vec3(0, 0, -1),
];

export class DiceWorld {
  constructor() {
    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82 * 2.2, 0) });
    world.allowSleep = false;
    world.broadphase = new CANNON.NaiveBroadphase();
    world.solver.iterations = 20;
    this.world = world;

    this.matDie = new CANNON.Material('die');
    this.matBowl = new CANNON.Material('bowl');
    this.matTable = new CANNON.Material('table');
    world.addContactMaterial(new CANNON.ContactMaterial(this.matDie, this.matBowl, { friction: 0.12, restitution: 0.45 }));
    world.addContactMaterial(new CANNON.ContactMaterial(this.matDie, this.matDie, { friction: 0.2, restitution: 0.4 }));
    world.addContactMaterial(new CANNON.ContactMaterial(this.matDie, this.matTable, { friction: 0.5, restitution: 0.2 }));

    this.table = new CANNON.Body({ mass: 0, material: this.matTable });
    this.table.addShape(new CANNON.Plane());
    this.table.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    world.addBody(this.table);

    this.bowl = this.#buildBowl();
    world.addBody(this.bowl);

    this.dice = [];
    for (let i = 0; i < 3; i++) {
      const body = new CANNON.Body({
        mass: 1,
        material: this.matDie,
        shape: new CANNON.Box(new CANNON.Vec3(DIE_SIZE / 2, DIE_SIZE / 2, DIE_SIZE / 2)),
        linearDamping: 0.05,
        angularDamping: 0.08,
      });
      body.userData = { index: i, fellOut: false };
      body.addEventListener('collide', (e) => this.#onCollide(body, e));
      world.addBody(body);
      this.dice.push(body);
    }
    this.onImpact = null; // (strength, kind) => void  効果音用
    this.time = 0;
    this.park();
  }

  #buildBowl() {
    const { profile, segments: n, wallThickness: t } = BOWL;
    const body = new CANNON.Body({ mass: 0, material: this.matBowl });
    const r0 = profile[0][0];
    // 底
    body.addShape(new CANNON.Cylinder(r0 + 0.05, r0 + 0.05, 0.16, 32), new CANNON.Vec3(0, 0.08, 0));
    // 側面：断面の各区間ごとに、傾けた薄い板を円周に並べる
    for (let k = 0; k < profile.length - 1; k++) {
      const [ra, ya] = profile[k];
      const [rb, yb] = profile[k + 1];
      const slope = Math.atan2(rb - ra, yb - ya); // 鉛直からの傾き
      const len = Math.hypot(rb - ra, yb - ya) + 0.06;
      const midR = (ra + rb) / 2;
      const midY = (ya + yb) / 2;
      const width = ((2 * Math.PI * rb) / n) * 1.12;
      // 板の中心を、内側の面が断面上に来るよう法線方向に t/2 ずらす
      const nr = Math.cos(slope), ny = -Math.sin(slope);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const shape = new CANNON.Box(new CANNON.Vec3(width / 2, len / 2, t / 2));
        const rr = midR + nr * t / 2;
        const offset = new CANNON.Vec3(Math.sin(a) * rr, midY + ny * t / 2, Math.cos(a) * rr);
        const q = new CANNON.Quaternion();
        q.setFromEuler(slope, a, 0, 'YXZ');
        body.addShape(shape, offset, q);
      }
    }
    return body;
  }

  #onCollide(body, e) {
    const other = e.body;
    if (other === this.table) body.userData.fellOut = true;
    const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
    if (this.onImpact && v > 0.6) {
      const kind = other === this.table ? 'table' : other === this.bowl ? 'bowl' : 'die';
      this.onImpact(Math.min(1, v / 12), kind);
    }
  }

  /** サイコロを画面外に片付ける */
  park() {
    this.dice.forEach((d, i) => {
      d.type = CANNON.Body.KINEMATIC;
      d.position.set(-10 + i, -5, 0);
      d.velocity.setZero();
      d.angularVelocity.setZero();
    });
  }

  /** 手の中にサイコロを持つ（物理を止めて位置だけ追従させる） */
  hold(center) {
    this.dice.forEach((d, i) => {
      d.type = CANNON.Body.KINEMATIC;
      d.velocity.setZero();
      d.angularVelocity.setZero();
      const a = (i / 3) * Math.PI * 2;
      d.position.set(center.x + Math.cos(a) * 0.36, center.y + (i === 2 ? 0.3 : 0), center.z + Math.sin(a) * 0.36);
      d.userData.fellOut = false;
    });
  }

  /**
   * 投げる。
   * @param {{x:number,y:number,z:number}} velocity 手の速度
   * @param {() => number} rand 0〜1 の乱数
   */
  release(velocity, rand = Math.random) {
    this.dice.forEach((d) => {
      d.type = CANNON.Body.DYNAMIC;
      d.wakeUp();
      const jitter = () => (rand() - 0.5) * 0.8;
      d.velocity.set(velocity.x + jitter(), velocity.y + jitter(), velocity.z + jitter());
      d.angularVelocity.set((rand() - 0.5) * 30, (rand() - 0.5) * 30, (rand() - 0.5) * 30);
      d.quaternion.setFromEuler(rand() * 6.28, rand() * 6.28, rand() * 6.28);
      d.userData.fellOut = false;
    });
    this.throwTime = this.time;
  }

  step(dt) {
    this.world.step(1 / 120, dt, 10);
    this.time += dt;
    // 丼の外まで飛んで落ちた場合も、念のため判定する
    for (const d of this.dice) {
      if (d.type !== CANNON.Body.DYNAMIC) continue;
      const rr = Math.hypot(d.position.x, d.position.z);
      if (rr > BOWL.topRadius + 0.3 && d.position.y < BOWL.height * 0.5) d.userData.fellOut = true;
      if (d.position.y < -2) d.userData.fellOut = true;
    }
  }

  isSettled() {
    if (this.time - this.throwTime < 0.4) return false;
    return this.dice.every((d) => d.velocity.length() < 0.08 && d.angularVelocity.length() < 0.15);
  }

  /** 斜めに引っかかったサイコロを、丼を軽く揺らしたように小突く */
  nudgeCocked(rand = Math.random) {
    const up = new CANNON.Vec3(0, 1, 0);
    let any = false;
    for (const d of this.dice) {
      if (d.userData.fellOut) continue;
      if (faceUp(d, up).dot >= COCKED_DOT) continue;
      any = true;
      const toCenter = new CANNON.Vec3(-d.position.x, 0, -d.position.z);
      toCenter.normalize();
      d.velocity.set(toCenter.x * 1.4, 2.4 + rand() * 0.6, toCenter.z * 1.4);
      d.angularVelocity.set((rand() - 0.5) * 10, (rand() - 0.5) * 10, (rand() - 0.5) * 10);
    }
    if (any) this.throwTime = this.time;
    return any;
  }

  /** 経過時間（投げてから） */
  elapsed() {
    return this.time - this.throwTime;
  }

  /** 丼の中に止まっているサイコロの中心（カメラを寄せる先）。外に落ちたものは除く */
  restingCenter() {
    const inside = this.dice.filter((d) => !d.userData.fellOut && d.position.y > -1);
    if (!inside.length) return null;
    const c = { x: 0, y: 0, z: 0 };
    for (const d of inside) { c.x += d.position.x; c.y += d.position.y; c.z += d.position.z; }
    c.x /= inside.length; c.y /= inside.length; c.z /= inside.length;
    // 中心からいちばん遠いサイコロまでの距離（カメラをどこまで寄せるかに使う）
    c.spread = Math.max(...inside.map((d) => Math.hypot(d.position.x - c.x, d.position.z - c.z)));
    return c;
  }

  fellOut() {
    return this.dice.some((d) => d.userData.fellOut);
  }

  /**
   * 上を向いている目を読む。
   * @returns {{values: number[], cocked: boolean}} cocked はどれかが斜めに引っかかっている
   */
  readFaces() {
    const up = new CANNON.Vec3(0, 1, 0);
    let cocked = false;
    const values = this.dice.map((d) => {
      const f = faceUp(d, up);
      if (f.dot < COCKED_DOT) cocked = true;
      return f.value;
    });
    return { values, cocked };
  }
}

// 上向きの面と、その面がどれだけ真上を向いているか（1 で真上）
const COCKED_DOT = 0.9;
function faceUp(body, up) {
  const localUp = body.quaternion.inverse().vmult(up);
  let dot = -Infinity;
  let value = 1;
  FACE_AXES.forEach((ax, i) => {
    const v = ax.dot(localUp);
    if (v > dot) { dot = v; value = FACE_VALUES[i]; }
  });
  return { dot, value };
}
