// チンチロのルール（役判定・勝敗・精算）。画面や物理演算に依存しない純粋な関数だけを置く。

export const HAND = Object.freeze({
  PINZORO: 'pinzoro',
  ARASHI: 'arashi',
  SHIGORO: 'shigoro',
  DEME: 'deme',
  MENASHI: 'menashi',
  HIFUMI: 'hifumi',
  SHONBEN: 'shonben',
});

// 強さの順位。数字が大きいほど強い。
const RANK = {
  [HAND.PINZORO]: 7,
  [HAND.ARASHI]: 6,
  [HAND.SHIGORO]: 5,
  [HAND.DEME]: 4,
  [HAND.MENASHI]: 3,
  [HAND.HIFUMI]: 2,
  [HAND.SHONBEN]: 1,
};

// 勝ったときの倍率
const WIN_MULTIPLIER = {
  [HAND.PINZORO]: 5,
  [HAND.ARASHI]: 3,
  [HAND.SHIGORO]: 2,
};

// 負けたときの倍率（敗者側で掛けるのはヒフミだけ）
const LOSE_MULTIPLIER = {
  [HAND.HIFUMI]: 2,
};

export const HAND_LABEL = {
  [HAND.PINZORO]: 'ピンゾロ',
  [HAND.ARASHI]: 'アラシ',
  [HAND.SHIGORO]: 'シゴロ',
  [HAND.DEME]: '出目',
  [HAND.MENASHI]: '目無し',
  [HAND.HIFUMI]: 'ヒフミ',
  [HAND.SHONBEN]: 'ションベン',
};

/**
 * サイコロ3個の目から役を判定する。
 * 役にならない場合は null を返す（振り直し）。
 * @param {number[]} dice 1〜6 の整数3個
 * @returns {{type: string, value: number} | null}
 */
export function evaluateDice(dice) {
  if (!Array.isArray(dice) || dice.length !== 3 || dice.some((d) => !Number.isInteger(d) || d < 1 || d > 6)) {
    throw new Error(`サイコロの目が不正です: ${JSON.stringify(dice)}`);
  }
  const [a, b, c] = [...dice].sort((x, y) => x - y);
  if (a === b && b === c) {
    return a === 1 ? { type: HAND.PINZORO, value: 1 } : { type: HAND.ARASHI, value: a };
  }
  if (a === 4 && b === 5 && c === 6) return { type: HAND.SHIGORO, value: 0 };
  if (a === 1 && b === 2 && c === 3) return { type: HAND.HIFUMI, value: 0 };
  if (a === b) return { type: HAND.DEME, value: c };
  if (b === c) return { type: HAND.DEME, value: a };
  return null;
}

export const menashi = () => ({ type: HAND.MENASHI, value: 0 });
export const shonben = () => ({ type: HAND.SHONBEN, value: 0 });

export function handLabel(hand) {
  if (hand.type === HAND.DEME) return `${hand.value}の目`;
  if (hand.type === HAND.ARASHI) return `アラシ（${hand.value}）`;
  return HAND_LABEL[hand.type];
}

/**
 * 親と子1人の勝負を判定する。
 * 順位が高いほうが勝ち。出目どうしは数字が大きいほうが勝ち。
 * それ以外の同順位（同じ数字の出目、アラシどうし等）はすべて親の勝ち。
 * @returns {{winner: 'parent'|'child', multiplier: number}}
 */
export function judge(parentHand, childHand) {
  const pr = RANK[parentHand.type];
  const cr = RANK[childHand.type];
  let winner;
  if (pr !== cr) {
    winner = pr > cr ? 'parent' : 'child';
  } else if (parentHand.type === HAND.DEME && childHand.value > parentHand.value) {
    winner = 'child';
  } else {
    winner = 'parent';
  }

  // 同じ役どうしは1倍
  if (parentHand.type === childHand.type) return { winner, multiplier: 1 };

  const [w, l] = winner === 'parent' ? [parentHand, childHand] : [childHand, parentHand];
  const multiplier = (WIN_MULTIPLIER[w.type] ?? 1) * (LOSE_MULTIPLIER[l.type] ?? 1);
  return { winner, multiplier };
}

/**
 * 1勝負の精算。
 * 1. 負けた子から親が受け取る（子は持っている分だけ払う）。
 * 2. 親は受け取った後の所持金から、勝った子に払う。払いきれなければ支払額に応じて按分する（1,000円未満切り捨て）。
 *
 * @param {object} args
 * @param {number} args.parentMoney 親の所持金
 * @param {{id: string, bet: number, money: number, hand: object}[]} args.children 子（money は賭け金を含む所持金）
 * @param {object} args.parentHand 親の役
 * @returns {{parentDelta: number, results: {id: string, winner: string, multiplier: number, owed: number, delta: number}[]}}
 *   delta は所持金の増減（子視点）。owed は本来の移動額。
 */
export function settle({ parentMoney, children, parentHand }) {
  const results = children.map((c) => {
    const { winner, multiplier } = judge(parentHand, c.hand);
    return { id: c.id, winner, multiplier, owed: c.bet * multiplier, delta: 0 };
  });

  let parent = parentMoney;
  results.forEach((r, i) => {
    if (r.winner !== 'parent') return;
    const paid = Math.min(r.owed, children[i].money);
    r.delta = -paid;
    parent += paid;
  });

  const winners = results.filter((r) => r.winner === 'child');
  const totalOwed = winners.reduce((s, r) => s + r.owed, 0);
  if (totalOwed <= parent) {
    winners.forEach((r) => { r.delta = r.owed; });
    parent -= totalOwed;
  } else {
    let paidTotal = 0;
    winners.forEach((r) => {
      r.delta = Math.floor((parent * r.owed) / totalOwed / BET_UNIT) * BET_UNIT;
      paidTotal += r.delta;
    });
    parent -= paidTotal;
  }

  return { parentDelta: parent - parentMoney, results };
}

export const MIN_BET = 1000;
export const BET_UNIT = 1000;
export const INITIAL_MONEY = 100000;

/** 賭け金の上限：所持金の1/5（1,000円単位）。ただし所持金が1,000円以上あれば最低1,000円は賭けられる。 */
export function maxBet(money) {
  if (money < MIN_BET) return 0;
  return Math.max(MIN_BET, Math.floor(money / 5 / BET_UNIT) * BET_UNIT);
}

export function canBet(money) {
  return money >= MIN_BET;
}

/** 子が振る順番：賭け金が少ない順、同額なら席順 */
export function rollOrder(children) {
  return [...children].sort((a, b) => a.bet - b.bet || a.seat - b.seat);
}
