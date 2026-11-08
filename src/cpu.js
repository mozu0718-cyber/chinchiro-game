// CPU の性格：賭け方と投げ方のブレ。画面に依存しない。
import { BET_UNIT, MIN_BET, INITIAL_MONEY, maxBet } from './rules.js';

/**
 * 性格の定義。
 * - bet(ctx, rand): 所持金に対する賭け金の割合を返す（あとで上限・下限・1,000円単位に丸める）
 * - spread: 投げの強さのブレ（標準偏差）。大きいほどションベンしやすい
 * ctx = { money, ratio（所持金 / 初期所持金）, lostLast（前の勝負で負けたか）, lossStreak（連敗数） }
 */
export const PERSONALITIES = {
  cautious: {
    label: '慎重派',
    description: '基本は少額。所持金が減るとさらに守る',
    spread: 0.8,
    bet({ ratio }, rand) {
      const base = ratio < 0.7 ? 0.02 : 0.035;
      return base * (0.8 + rand() * 0.4);
    },
  },
  steady: {
    label: '堅実派',
    description: '所持金の一定割合を賭ける',
    spread: 1.0,
    bet(_ctx, rand) {
      return 0.08 * (0.85 + rand() * 0.3);
    },
  },
  bold: {
    label: '強気派',
    description: '大きく賭ける。負けが込むと取り返しにいく',
    spread: 1.6,
    bet({ lossStreak }, rand) {
      const base = 0.13 * (0.8 + rand() * 0.4);
      return base * (1 + 0.5 * Math.min(lossStreak, 2)); // 連敗するほど上乗せ
    },
  },
  whimsical: {
    label: '気まぐれ',
    description: '賭け額のブレが大きい',
    spread: 1.4,
    bet(_ctx, rand) {
      return 0.01 + rand() * 0.19;
    },
  },
};

export const PERSONALITY_KEYS = Object.keys(PERSONALITIES);

/** CPU の賭け金を決める。1,000円単位で、下限 1,000円・上限 maxBet(money) に収める */
export function decideBet(personalityKey, { money, lostLast = false, lossStreak = 0 }, rand = Math.random) {
  const cap = maxBet(money);
  if (cap < MIN_BET) return 0;
  const p = PERSONALITIES[personalityKey];
  const ratio = money / INITIAL_MONEY;
  const share = p.bet({ money, ratio, lostLast, lossStreak }, rand);
  const raw = Math.round((money * share) / BET_UNIT) * BET_UNIT;
  return Math.max(MIN_BET, Math.min(cap, raw));
}

/** CPU 3人分の性格をランダムに割り当てる（重複してもよい） */
export function randomPersonalities(n, rand = Math.random) {
  return Array.from({ length: n }, () => PERSONALITY_KEYS[Math.floor(rand() * PERSONALITY_KEYS.length)]);
}
