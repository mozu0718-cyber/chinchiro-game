// フリー対戦：プレイヤー1人と CPU 3人で、全員が1回ずつ親をやったら終わり。
import { DiceWorld } from './physics.js';
import { TableScene } from './scene.js';
import { Sfx } from './audio.js';
import { Roller, cpuThrow } from './roller.js';
import { DragThrower, AimThrower, POWER } from './input.js';
import { Effects, handTone, escapeHtml, diceFacesHtml } from './effects.js';
import { handLabel, maxBet, MIN_BET, BET_UNIT } from './rules.js';
import { PERSONALITIES, decideBet } from './cpu.js';
import {
  createGame, nextRound, applyRound, childRollOrder, normalizeBet, ranking, playerById, isSpectator, SEAT_ANGLES,
} from './game.js';

const $ = (id) => document.getElementById(id);
const yen = (n) => `${n.toLocaleString('ja-JP')}円`;
const signedYen = (n) => (n > 0 ? `+${yen(n)}` : n < 0 ? `−${yen(-n)}` : '±0円');
// noFast: プレイヤー自身の番など、早送りの対象にしない待ち
const sleep = (ms, noFast = false) => new Promise((r) => setTimeout(r, noFast ? ms : ms * speedFactor()));
const speedFactor = () => ($('fast').checked ? 0.35 : 1);

const world = new DiceWorld();
const scene = new TableScene($('stage'));
const sfx = new Sfx();
const roller = new Roller(world);
const fx = new Effects($('banner'), scene, sfx);
world.onImpact = (s, kind) => sfx.hit(s, kind);
const canvas = scene.renderer.domElement;
const flickThrower = new DragThrower(canvas, scene, world, {
  onFirstTouch: () => sfx.unlock(),
  onTooWeak: () => setHint('もっと勢いよく、丼に向かってはじくように投げてください'),
});
const aimThrower = new AimThrower(canvas, scene, world, {
  onFirstTouch: () => sfx.unlock(),
  onAim: (a) => showGauge(a),
  onCancel: () => setHint('引きが弱すぎたので、投げませんでした。もう一度どうぞ'),
});

// 投げ方：'aim'（引っぱって離す）か 'flick'（はじく）。選んだものはこの端末に覚えておく
let throwMode = 'aim';
try { throwMode = localStorage.getItem('chinchiro.throwMode') === 'flick' ? 'flick' : 'aim'; } catch { /* 保存できない環境では既定のまま */ }
function setThrowMode(mode) {
  throwMode = mode;
  flickThrower.enabled = mode === 'flick';
  aimThrower.enabled = mode === 'aim';
  $('mode').textContent = mode === 'aim' ? '投げ方：引っぱる' : '投げ方：はじく';
  try { localStorage.setItem('chinchiro.throwMode', mode); } catch { /* 無視 */ }
}
$('mode').addEventListener('click', () => {
  if (aimThrower.active || flickThrower.holding) return;
  const waiting = currentThrower().waiting;
  const prev = currentThrower();
  setThrowMode(throwMode === 'aim' ? 'flick' : 'aim');
  // 投げを待っている最中に切り替えたら、待ちを新しい方式へ引き継ぐ
  if (waiting) {
    prev.waiting = null;
    scene.showGrabRing(false);
    currentThrower().waitThrow().then(waiting);
    setHint(throwHint(currentAttempt, currentRole));
  }
});
const currentThrower = () => (throwMode === 'aim' ? aimThrower : flickThrower);
setThrowMode(throwMode);

let currentAttempt = 1;
let currentRole = '子';
function throwHint(attempt, role) {
  return throwMode === 'aim'
    ? `あなたの番（${role}）　${attempt}投目：丼の縁の近くに触れて、投げたい方向と反対へ引っぱって離してください`
    : `あなたの番（${role}）　${attempt}投目：丼の周りでサイコロをつかんで、丼に向かってはじいてください`;
}

// 強さのゲージ
const G_ZONES = `linear-gradient(to right,
  var(--danger) 0%, var(--danger) ${pct(POWER.warnLow)}%,
  var(--warn) ${pct(POWER.warnLow)}%, var(--warn) ${pct(POWER.safeLow)}%,
  var(--safe) ${pct(POWER.safeLow)}%, var(--safe) ${pct(POWER.safeHigh)}%,
  var(--warn) ${pct(POWER.safeHigh)}%, var(--warn) ${pct(POWER.warnHigh)}%,
  var(--danger) ${pct(POWER.warnHigh)}%, var(--danger) 100%)`;
function pct(v) { return ((v / POWER.max) * 100).toFixed(1); }
function showGauge(a) {
  const g = $('gauge');
  if (!a) { g.hidden = true; return; }
  g.hidden = false;
  $('gauge-bar').style.background = G_ZONES;
  $('gauge-mark').style.left = `${pct(a.power)}%`;
  $('gauge-label').textContent = { safe: 'ちょうどいい', warn: 'ぎりぎり', danger: a.power < POWER.safeLow ? '弱すぎ' : '強すぎ' }[a.zone];
  $('gauge-label').className = `zone-${a.zone}`;
}

document.addEventListener('pointerdown', () => sfx.unlock());

let game = null;
// 今の勝負の表示用の状態
let view = { parentId: null, bets: {}, hands: {}, deltas: {}, faces: {}, turnId: null };

// ---------- 表示 ----------

function setHint(text) {
  $('hint').textContent = text;
}

function renderPlayers() {
  const el = $('players');
  el.innerHTML = game.players.map((p) => {
    const role = !view.parentId ? (isSpectator(p) ? '観戦' : '')
      : p.id === view.parentId ? '親' : view.childIds.includes(p.id) ? '子' : '観戦';
    const pers = p.personality ? PERSONALITIES[p.personality].label : '';
    const bet = view.bets[p.id] ? `賭け ${yen(view.bets[p.id])}` : '';
    const hand = view.hands[p.id];
    const faces = view.faces[p.id] ? `<span class="faces-mini">${diceFacesHtml(view.faces[p.id])}</span>` : '';
    const handHtml = hand ? `${faces}<span class="hand tone-${handTone(hand)}">${escapeHtml(handLabel(hand))}</span>` : '';
    const d = view.deltas[p.id];
    const deltaHtml = d !== undefined ? `<span class="delta ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${signedYen(d)}</span>` : '';
    return `<li class="seat seat-${p.seat}${p.id === view.turnId ? ' active' : ''}${p.isHuman ? ' me' : ''}">
      <div class="row1"><span class="name">${escapeHtml(p.name)}</span>${role ? `<span class="role role-${role}">${role}</span>` : ''}</div>
      <div class="money">${yen(p.money)}</div>
      <div class="row3">${pers ? `<span class="pers">${pers}</span>` : ''}${bet ? `<span class="bet">${bet}</span>` : ''}</div>
      <div class="row4">${handHtml}${deltaHtml}</div>
    </li>`;
  }).join('');
}

function setRoundTitle(text) {
  $('round').textContent = text;
}

function showPanel(html) {
  const el = $('panel');
  el.innerHTML = html;
  el.hidden = false;
}

function hidePanel() {
  $('panel').hidden = true;
  $('panel').innerHTML = '';
}

/** パネルのボタンが押されるまで待つ */
function waitButton(id) {
  return new Promise((resolve) => {
    $(id).addEventListener('click', () => { sfx.unlock(); resolve(); }, { once: true });
  });
}

// ---------- 賭け ----------

function askPlayerBet(player) {
  const cap = maxBet(player.money);
  let bet = Math.min(cap, Math.max(MIN_BET, Math.round(player.money * 0.05 / BET_UNIT) * BET_UNIT));
  showPanel(`
    <h2>いくら賭けますか</h2>
    <p class="muted">1,000円から ${yen(cap)} まで（所持金の1/5まで）。1,000円単位です。</p>
    <div class="bet-row">
      <button id="bet-minus" class="small" aria-label="1,000円減らす">−</button>
      <output id="bet-value" class="bet-value"></output>
      <button id="bet-plus" class="small" aria-label="1,000円増やす">＋</button>
    </div>
    <input id="bet-range" type="range" min="${MIN_BET}" max="${cap}" step="${BET_UNIT}" aria-label="賭け金">
    <div class="bet-presets">
      <button id="bet-min" class="small">最小</button>
      <button id="bet-half" class="small">上限の半分</button>
      <button id="bet-max" class="small">上限</button>
    </div>
    <button id="bet-ok" class="primary">この額で賭ける</button>
  `);
  const range = $('bet-range');
  const update = (v) => {
    bet = normalizeBet(player.money, v);
    range.value = bet;
    $('bet-value').textContent = yen(bet);
  };
  update(bet);
  range.addEventListener('input', () => update(Number(range.value)));
  $('bet-minus').addEventListener('click', () => update(bet - BET_UNIT));
  $('bet-plus').addEventListener('click', () => update(bet + BET_UNIT));
  $('bet-min').addEventListener('click', () => update(MIN_BET));
  $('bet-half').addEventListener('click', () => update(Math.floor(cap / 2 / BET_UNIT) * BET_UNIT));
  $('bet-max').addEventListener('click', () => update(cap));
  return waitButton('bet-ok').then(() => { hidePanel(); return bet; });
}

// ---------- 振る ----------

async function playTurn(player) {
  view.turnId = player.id;
  renderPlayers();
  const role = player.id === view.parentId ? '親' : '子';
  const getThrow = player.isHuman
    ? async (attempt) => {
      if (attempt > 1) await sleep(1500, true); // 前の投げの目を見せる
      // カメラが元の位置に戻ってから操作を受け付ける（指の位置の読み取りがずれないように）
      scene.focusOn(null);
      while (!scene.isAtBase()) await new Promise((r) => setTimeout(r, 50));
      currentAttempt = attempt;
      currentRole = role;
      setHint(throwHint(attempt, role));
      const v = await currentThrower().waitThrow();
      scene.showGrabRing(false);
      return v;
    }
    : async (attempt) => {
      if (attempt > 1) await sleep(1500);
      scene.focusOn(null);
      setHint(`${player.name}（${role}）　${attempt}投目`);
      const t = cpuThrow(PERSONALITIES[player.personality].spread, SEAT_ANGLES[player.seat]);
      world.hold(t.from);
      await sleep(attempt === 1 ? 900 : 650);
      return t.velocity;
    };

  const result = await roller.playTurn(getThrow, (ev) => {
    if (ev.type === 'miss') {
      scene.focusOn(world.restingCenter());
      fx.miss(ev.attempt, player.name, ev.values);
    } else if (ev.type === 'cocked') {
      setHint('斜めに引っかかったので振り直し（回数に数えません）');
    }
  });
  if (result.values) scene.focusOn(world.restingCenter());
  // 役が決まった投げの目は、目無しでも表示する（最後の投げの目）
  const shown = result.values ?? result.lastValues ?? null;
  setHint('');
  fx.hand(result.hand, player.name, shown);
  view.hands[player.id] = result.hand;
  view.faces[player.id] = shown;
  renderPlayers();
  await sleep(result.values ? 2200 : 1800);
  scene.focusOn(null);
  return result.hand;
}

// ---------- 勝負 ----------

async function playRound(round, roundNo, totalRounds) {
  const { parent, children } = round;
  view = { parentId: parent.id, childIds: children.map((c) => c.id), bets: {}, hands: {}, deltas: {}, faces: {}, turnId: null };
  world.park();
  setRoundTitle(`第${roundNo}局 / 全${totalRounds}局　親：${parent.name}`);
  renderPlayers();
  fx.banner(`第${roundNo}局`, 'fx-normal', `親は ${parent.name}`);
  await sleep(1600);

  // 子が賭ける（CPU が先に決めて表示し、プレイヤーはそれを見て決める）
  for (const c of children.filter((c) => !c.isHuman)) {
    view.bets[c.id] = decideBet(c.personality, c);
    renderPlayers();
    await sleep(350);
  }
  const me = children.find((c) => c.isHuman);
  if (me) {
    view.bets[me.id] = await askPlayerBet(me);
    renderPlayers();
  }

  // 子が賭け金の少ない順に振り、最後に親が振る
  const order = childRollOrder(children, view.bets);
  for (const id of order) await playTurn(playerById(game, id));
  await playTurn(parent);
  view.turnId = null;

  // 精算
  const result = applyRound(game, parent, children, view.bets, view.hands);
  view.deltas = { [parent.id]: result.parentDelta };
  result.results.forEach((r) => { view.deltas[r.id] = r.delta; });
  sfx.coin();
  renderPlayers();
  showSettlement(parent, result);
  await waitButton('next');
  hidePanel();
}

function showSettlement(parent, result) {
  const ph = view.hands[parent.id];
  const rows = result.results.map((r) => {
    const c = playerById(game, r.id);
    const win = r.winner === 'child';
    const short = Math.abs(r.delta) < r.owed ? `<span class="short">（本来 ${yen(r.owed)}）</span>` : '';
    return `<tr>
      <td>${escapeHtml(c.name)}</td>
      <td>${escapeHtml(handLabel(view.hands[r.id]))}</td>
      <td class="${win ? 'up' : 'down'}">${win ? '子の勝ち' : '親の勝ち'}</td>
      <td class="num">${yen(view.bets[r.id])} × ${r.multiplier}</td>
      <td class="num ${r.delta > 0 ? 'up' : r.delta < 0 ? 'down' : ''}">${signedYen(r.delta)}${short}</td>
    </tr>`;
  }).join('');
  const last = !nextRoundPreview();
  showPanel(`
    <h2>精算</h2>
    <p>親 ${escapeHtml(parent.name)}：<b>${escapeHtml(handLabel(ph))}</b>　<span class="${result.parentDelta > 0 ? 'up' : result.parentDelta < 0 ? 'down' : ''}">${signedYen(result.parentDelta)}</span></p>
    <div class="table-wrap"><table>
      <thead><tr><th>子</th><th>役</th><th>勝敗</th><th>賭け × 倍率</th><th>子の増減</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <button id="next" class="primary">${last ? '結果を見る' : '次の勝負へ'}</button>
  `);
}

/** 次の勝負があるかどうか（状態は変えずに調べる） */
function nextRoundPreview() {
  const copy = { ...game, rounds: [...game.rounds] };
  return nextRound(copy);
}

function showResult() {
  view = { parentId: null, bets: {}, hands: {}, deltas: {}, faces: {}, turnId: null };
  renderPlayers();
  setRoundTitle('対戦終了');
  const rows = ranking(game).map((p) => `<tr class="${p.isHuman ? 'me' : ''}">
      <td class="num">${p.rank}位</td>
      <td>${escapeHtml(p.name)}${p.personality ? `<span class="pers">${PERSONALITIES[p.personality].label}</span>` : ''}</td>
      <td class="num">${yen(p.money)}</td>
      <td class="num ${p.diff > 0 ? 'up' : p.diff < 0 ? 'down' : ''}">${signedYen(p.diff)}</td>
    </tr>`).join('');
  const meRank = ranking(game).find((p) => p.isHuman).rank;
  fx.banner(meRank === 1 ? '優勝' : `${meRank}位`, meRank === 1 ? 'fx-great' : 'fx-normal');
  if (meRank === 1) { sfx.jingle('great'); scene.burst(); }
  showPanel(`
    <h2>最終結果</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>順位</th><th>名前</th><th>所持金</th><th>増減</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <button id="again" class="primary">もう一度遊ぶ</button>
  `);
  return waitButton('again');
}

// ---------- 全体の流れ ----------

async function playGame() {
  game = createGame();
  window.__chinchiro.game = game;
  const total = game.parentOrder.length;
  renderPlayers();
  let no = 0;
  for (let round; (round = nextRound(game)); ) {
    no = game.roundIndex + 1;
    await playRound(round, no, total);
  }
  await showResult();
}

async function titleScreen() {
  view = { parentId: null, bets: {}, hands: {}, deltas: {}, faces: {}, turnId: null };
  setRoundTitle('');
  showPanel(`
    <h2 class="title">丼チンチロ</h2>
    <p>CPU 3人と卓を囲みます。全員が1回ずつ親をやったら終わりです。持ち金は全員10万円から。</p>
    <ul class="rules">
      <li>子が賭け金の少ない順に振り、最後に親が振ります。1人3回まで。</li>
      <li>強い順に、ピンゾロ（5倍づけ）、アラシ（3倍づけ）、シゴロ（2倍づけ）、出目、目無し、ヒフミ（2倍払い）、ションベン。</li>
      <li>同じ強さなら親の勝ち。サイコロが丼から落ちたらションベンです。</li>
    </ul>
    <button id="start" class="primary">対戦を始める</button>
  `);
  await waitButton('start');
  hidePanel();
}

async function loop() {
  for (;;) {
    await titleScreen();
    await playGame();
    hidePanel();
  }
}

// 自動テスト用
window.__chinchiro = { world, roller, aimThrower, flickThrower, get thrower() { return currentThrower(); } };

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  roller.update(dt);
  scene.render(world.dice, dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
loop();
