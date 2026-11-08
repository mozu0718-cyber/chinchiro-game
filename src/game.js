// 対戦の進行（親の順番・賭け・振る順番・精算・終了判定）。画面と物理演算に依存しない。
import { INITIAL_MONEY, canBet, maxBet, MIN_BET, BET_UNIT, settle, rollOrder } from './rules.js';
import { randomPersonalities } from './cpu.js';

// 席の方向（丼から見た角度、ラジアン）。0 が画面手前（プレイヤー）で、反時計回りに右・奥・左
export const SEAT_ANGLES = [0, Math.PI / 2, Math.PI, -Math.PI / 2];

export function shuffle(arr, rand = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 新しい対戦を作る。
 * @param {{playerName?: string, cpuNames?: string[], rand?: () => number}} opts
 */
export function createGame({ playerName = 'あなた', cpuNames = ['CPU 右', 'CPU 奥', 'CPU 左'], rand = Math.random } = {}) {
  const personalities = randomPersonalities(3, rand);
  const players = [
    { id: 'p0', name: playerName, isHuman: true, personality: null, seat: 0 },
    ...cpuNames.map((name, i) => ({ id: `p${i + 1}`, name, isHuman: false, personality: personalities[i], seat: i + 1 })),
  ].map((p) => ({ ...p, money: INITIAL_MONEY, lossStreak: 0, lostLast: false }));
  return {
    players,
    parentOrder: shuffle(players.map((p) => p.id), rand),
    roundIndex: 0, // 親の順番の何番目か（0〜3）
    rounds: [], // 終わった勝負の記録
  };
}

export const playerById = (game, id) => game.players.find((p) => p.id === id);

/** 所持金が足りず観戦している人か */
export const isSpectator = (p) => !canBet(p.money);

/**
 * 次の勝負の親を決める。観戦中の人の親番は飛ばす。
 * 子として賭けられる人が誰もいない場合も、その親番は飛ばす。
 * @returns {{parent: object, children: object[]} | null} null なら対戦終了
 */
export function nextRound(game) {
  while (game.roundIndex < game.parentOrder.length) {
    const parent = playerById(game, game.parentOrder[game.roundIndex]);
    const children = game.players.filter((p) => p.id !== parent.id && !isSpectator(p));
    if (!isSpectator(parent) && children.length > 0) return { parent, children };
    game.rounds.push({ parentId: parent.id, skipped: true });
    game.roundIndex++;
  }
  return null;
}

/** 賭け金を検証して丸める */
export function normalizeBet(money, bet) {
  const cap = maxBet(money);
  const b = Math.floor(bet / BET_UNIT) * BET_UNIT;
  return Math.max(MIN_BET, Math.min(cap, b));
}

/** 子の振る順番（賭け金が少ない順、同額は席順） */
export function childRollOrder(children, bets) {
  return rollOrder(children.map((c) => ({ ...c, bet: bets[c.id] }))).map((c) => c.id);
}

/**
 * 勝負を精算して所持金に反映する。
 * @param {object} game
 * @param {object} parent
 * @param {object[]} children
 * @param {Record<string, number>} bets
 * @param {Record<string, object>} hands 役（親を含む全員分）
 * @returns 精算結果（settle の戻り値に id ごとの情報を足したもの）
 */
export function applyRound(game, parent, children, bets, hands) {
  const result = settle({
    parentMoney: parent.money,
    parentHand: hands[parent.id],
    children: children.map((c) => ({ id: c.id, bet: bets[c.id], money: c.money, hand: hands[c.id] })),
  });
  parent.money += result.parentDelta;
  for (const r of result.results) {
    const c = playerById(game, r.id);
    c.money += r.delta;
    updateStreak(c, r.delta);
  }
  updateStreak(parent, result.parentDelta);
  game.rounds.push({ parentId: parent.id, bets: { ...bets }, hands: { ...hands }, result });
  game.roundIndex++;
  return result;
}

function updateStreak(p, delta) {
  if (delta < 0) {
    p.lostLast = true;
    p.lossStreak++;
  } else if (delta > 0) {
    p.lostLast = false;
    p.lossStreak = 0;
  }
}

/** 最終順位（所持金の多い順。同額は同順位） */
export function ranking(game) {
  const sorted = [...game.players].sort((a, b) => b.money - a.money || a.seat - b.seat);
  let rank = 0;
  let prev = null;
  return sorted.map((p, i) => {
    if (p.money !== prev) rank = i + 1;
    prev = p.money;
    return { ...p, rank, diff: p.money - INITIAL_MONEY };
  });
}
