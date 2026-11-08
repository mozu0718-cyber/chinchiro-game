// 試作：プレイヤーがドラッグで投げて、役が出るまでを確認する画面。
import { DiceWorld } from './physics.js';
import { TableScene } from './scene.js';
import { Sfx } from './audio.js';
import { Roller, HAND_HEIGHT, RELEASE_RADIUS, HAND_MAX_RADIUS, cpuThrow as cpuThrowParams } from './roller.js';
import { HAND, handLabel } from './rules.js';

const MAX_SPEED = 18;
const MIN_SPEED = 3; // これより遅いと投げたことにしない

const $ = (id) => document.getElementById(id);
const world = new DiceWorld();
const scene = new TableScene($('stage'));
const sfx = new Sfx();
const roller = new Roller(world);
world.onImpact = (s, kind) => sfx.hit(s, kind);

// ---- 演出 ----
const EFFECT = {
  [HAND.PINZORO]: { level: 'great', cls: 'fx-great', burst: ['#ffd54a', '#ff3b30', '#ffffff'], shake: 0.5 },
  [HAND.ARASHI]: { level: 'great', cls: 'fx-great', burst: ['#ffd54a', '#5ac8fa', '#ffffff'], shake: 0.35 },
  [HAND.SHIGORO]: { level: 'good', cls: 'fx-good', burst: ['#ffd54a', '#ff9500'], shake: 0.15 },
  [HAND.DEME]: { level: 'normal', cls: 'fx-normal' },
  [HAND.MENASHI]: { level: 'bad', cls: 'fx-bad' },
  [HAND.HIFUMI]: { level: 'bad', cls: 'fx-awful', shake: 0.2 },
  [HAND.SHONBEN]: { level: 'bad', cls: 'fx-awful', shake: 0.25 },
};

function showBanner(text, cls, sub = '') {
  const el = $('banner');
  el.className = '';
  void el.offsetWidth; // アニメーションをやり直す
  el.innerHTML = `<div class="main">${text}</div>${sub ? `<div class="sub">${sub}</div>` : ''}`;
  el.className = `show ${cls}`;
}

function playEffect(hand) {
  const fx = EFFECT[hand.type];
  sfx.jingle(fx.level);
  if (fx.burst) scene.burst(fx.burst);
  if (fx.shake) scene.addShake(fx.shake);
  const sub = { [HAND.PINZORO]: '5倍づけ', [HAND.ARASHI]: '3倍づけ', [HAND.SHIGORO]: '2倍づけ', [HAND.HIFUMI]: '2倍払い' }[hand.type] ?? '';
  showBanner(handLabel(hand), fx.cls, sub);
}

// ---- ドラッグで投げる ----
let waitingThrow = null; // プレイヤーが投げるのを待っている resolve
let samples = [];
let holding = false;

const HAND_START = { x: 0, y: HAND_HEIGHT, z: RELEASE_RADIUS + 1.0 }; // 最初にサイコロを置く位置（手前）
const THROW_GAIN = 4.5; // 指の速さ（画面の高さ/秒）→ 投げる速さ

// 指の位置は丼の中ほどの高さの面で読み取る。手の高さ（縁より上）で読むと、
// 画面で丼の横に見える点が実際には手前寄りになり、狙いが見た目とずれるため。
const POINTER_PLANE_Y = 1.0;

/** 指の位置を水平面に写す（丼の内側も含めてそのまま） */
function pointerOnPlane(e) {
  return scene.screenToPlane(e.clientX, e.clientY, POINTER_PLANE_Y);
}

/** 手は丼の周りの輪（縁の外側）の中だけを動く */
function clampHand(p) {
  const r = Math.hypot(p.x, p.z);
  if (r < 1e-3) return { ...HAND_START };
  const rr = Math.max(RELEASE_RADIUS, Math.min(HAND_MAX_RADIUS, r));
  return { x: (p.x / r) * rr, y: HAND_HEIGHT, z: (p.z / r) * rr };
}

/**
 * 直近の指の動きから投げる速度を求める。
 * 向きは卓の上での指の動き、速さは画面上の指の速さで決める（画面の奥と手前で感覚が変わらないように）。
 */
function throwVelocity() {
  const H = canvas.clientHeight;
  const now = performance.now();
  const recent = samples.filter((s) => now - s.t < 120);
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

function releaseThrow() {
  holding = false;
  const tv = throwVelocity();
  if (!tv || tv.speed < MIN_SPEED) {
    // 勢いが足りない：サイコロは手に持ったまま、もう一度
    $('hint').textContent = 'もっと勢いよく、丼に向かってはじくように投げてください';
    return;
  }
  let { x, z, speed } = tv;
  if (speed > MAX_SPEED) { x *= MAX_SPEED / speed; z *= MAX_SPEED / speed; speed = MAX_SPEED; }
  const v = { x, y: 1.5 + speed * 0.12, z };
  window.__lastThrow = { speed, v };
  const r = waitingThrow;
  waitingThrow = null;
  r(v);
}

const canvas = scene.renderer.domElement;
canvas.addEventListener('pointerdown', (e) => {
  sfx.unlock();
  if (!waitingThrow || holding) return;
  const p = pointerOnPlane(e);
  if (!p) return;
  holding = true;
  canvas.setPointerCapture(e.pointerId);
  samples = [{ t: performance.now(), sx: e.clientX, sy: e.clientY, wx: p.x, wz: p.z }];
  world.hold(clampHand(p));
});
canvas.addEventListener('pointermove', (e) => {
  if (!holding) return;
  const p = pointerOnPlane(e);
  if (!p) return;
  samples.push({ t: performance.now(), sx: e.clientX, sy: e.clientY, wx: p.x, wz: p.z });
  if (samples.length > 40) samples.shift();
  world.hold(clampHand(p));
  // 指が丼の縁を越えたら手から離れる（勢いが足りなければ縁の外で止まる）
  if (Math.hypot(p.x, p.z) < RELEASE_RADIUS) {
    const tv = throwVelocity();
    if (tv && tv.speed >= MIN_SPEED) releaseThrow();
  }
});
const onUp = () => { if (holding) releaseThrow(); };
canvas.addEventListener('pointerup', onUp);
canvas.addEventListener('pointercancel', onUp);

function playerThrow(attempt) {
  $('hint').textContent = `${attempt}投目：丼の周りでサイコロをつかんで、丼に向かってはじいてください`;
  world.hold(HAND_START);
  return new Promise((resolve) => { waitingThrow = resolve; });
}

function cpuThrow(spread) {
  return async (attempt) => {
    $('hint').textContent = `CPU ${attempt}投目`;
    // 試作では、投げる方向を毎回ランダムにする
    const t = cpuThrowParams(spread, Math.random() * Math.PI * 2);
    world.hold(t.from);
    await new Promise((r) => setTimeout(r, 500));
    return t.velocity;
  };
}

async function startTurn(getThrow) {
  $('controls').hidden = true;
  $('banner').className = '';
  const log = $('log');
  log.innerHTML = '';
  const result = await roller.playTurn(getThrow, (ev) => {
    if (ev.type === 'miss') {
      log.insertAdjacentHTML('beforeend', `<li>${ev.attempt}投目：${ev.values.join('・')}　役なし</li>`);
      showBanner('役なし', 'fx-miss', `あと${3 - ev.attempt}回`);
    } else if (ev.type === 'cocked') {
      log.insertAdjacentHTML('beforeend', '<li>斜めに引っかかったので振り直し（回数に数えない）</li>');
    } else if (ev.type === 'final') {
      const dice = ev.values ? `${ev.values.join('・')}　` : '';
      log.insertAdjacentHTML('beforeend', `<li><b>${ev.attempt}投目：${dice}${handLabel(ev.hand)}</b></li>`);
      playEffect(ev.hand);
    }
  });
  $('hint').textContent = '';
  $('controls').hidden = false;
  return result;
}

$('btn-player').addEventListener('click', () => { sfx.unlock(); startTurn(playerThrow); });
$('btn-cpu').addEventListener('click', () => { sfx.unlock(); startTurn(cpuThrow(Number($('cpu-spread').value))); });

// 自動テスト用
window.__chinchiro = { world, roller, startTurn, playerThrow, cpuThrow };

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  roller.update(dt);
  scene.render(world.dice, dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
