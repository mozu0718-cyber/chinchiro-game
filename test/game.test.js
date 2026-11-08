import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HAND, menashi, shonben } from '../src/rules.js';
import { decideBet, PERSONALITY_KEYS } from '../src/cpu.js';
import { createGame, nextRound, applyRound, childRollOrder, normalizeBet, ranking, playerById } from '../src/game.js';

function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

test('CPU の賭け金は常に 1,000円単位で、下限と上限の間に収まる', () => {
  const rand = seeded(42);
  for (const key of PERSONALITY_KEYS) {
    for (const money of [1000, 3000, 4999 - 999, 7000, 12000, 50000, 100000, 260000]) {
      for (let i = 0; i < 200; i++) {
        const bet = decideBet(key, { money, lossStreak: i % 4 }, rand);
        assert.equal(bet % 1000, 0, `${key} ${money} ${bet}`);
        assert.ok(bet >= 1000, `${key} ${money} ${bet}`);
        assert.ok(bet <= Math.max(1000, Math.floor(money / 5 / 1000) * 1000), `${key} ${money} ${bet}`);
      }
    }
    assert.equal(decideBet(key, { money: 999 }, rand), 0);
  }
});

test('CPU の性格ごとの平均賭け金：慎重派 < 堅実派 < 強気派', () => {
  const rand = seeded(7);
  const avg = (key) => {
    let s = 0;
    for (let i = 0; i < 2000; i++) s += decideBet(key, { money: 100000, lossStreak: 0 }, rand);
    return s / 2000;
  };
  const c = avg('cautious');
  const st = avg('steady');
  const b = avg('bold');
  assert.ok(c < st && st < b, `${c} ${st} ${b}`);
});

test('強気派は連敗すると賭け金を上げる', () => {
  const rand = seeded(9);
  let s0 = 0;
  let s2 = 0;
  for (let i = 0; i < 2000; i++) {
    s0 += decideBet('bold', { money: 100000, lossStreak: 0 }, rand);
    s2 += decideBet('bold', { money: 100000, lossStreak: 2 }, rand);
  }
  assert.ok(s2 > s0 * 1.4);
});

test('対戦の作成：4人、全員10万円、親の順番は4人の並べ替え', () => {
  const g = createGame({ rand: seeded(1) });
  assert.equal(g.players.length, 4);
  assert.ok(g.players.every((p) => p.money === 100000));
  assert.deepEqual([...g.parentOrder].sort(), ['p0', 'p1', 'p2', 'p3']);
  assert.ok(g.players.slice(1).every((p) => PERSONALITY_KEYS.includes(p.personality)));
});

test('4勝負で終わり、お金の総額は変わらない', () => {
  const g = createGame({ rand: seeded(3) });
  const hands = [{ type: HAND.DEME, value: 3 }, { type: HAND.SHIGORO, value: 0 }, { type: HAND.HIFUMI, value: 0 }, menashi(), shonben(), { type: HAND.PINZORO, value: 1 }];
  let k = 0;
  let n = 0;
  for (let round; (round = nextRound(g)); ) {
    const bets = Object.fromEntries(round.children.map((c) => [c.id, normalizeBet(c.money, 5000)]));
    const h = { [round.parent.id]: hands[k++ % hands.length] };
    round.children.forEach((c) => { h[c.id] = hands[k++ % hands.length]; });
    applyRound(g, round.parent, round.children, bets, h);
    n++;
    assert.equal(g.players.reduce((s, p) => s + p.money, 0), 400000);
    assert.ok(g.players.every((p) => p.money >= 0 && p.money % 1000 === 0));
  }
  assert.equal(n, 4);
  assert.equal(nextRound(g), null);
});

test('観戦中の人の親番は飛ばす', () => {
  const g = createGame({ rand: seeded(5) });
  const first = playerById(g, g.parentOrder[0]);
  first.money = 0;
  const round = nextRound(g);
  assert.notEqual(round.parent.id, first.id);
  assert.equal(g.rounds[0].skipped, true);
  assert.ok(round.children.every((c) => c.id !== first.id), '観戦中の人は子にもならない');
});

test('子の振る順番は賭け金が少ない順', () => {
  const children = [{ id: 'a', seat: 1 }, { id: 'b', seat: 2 }, { id: 'c', seat: 3 }];
  assert.deepEqual(childRollOrder(children, { a: 5000, b: 1000, c: 5000 }), ['b', 'a', 'c']);
});

test('賭け金の丸め', () => {
  assert.equal(normalizeBet(100000, 23500), 20000);
  assert.equal(normalizeBet(100000, 500), 1000);
  assert.equal(normalizeBet(3000, 2000), 1000);
});

test('順位：同額は同順位', () => {
  const g = createGame({ rand: seeded(2) });
  g.players[0].money = 120000;
  g.players[1].money = 120000;
  g.players[2].money = 100000;
  g.players[3].money = 60000;
  assert.deepEqual(ranking(g).map((p) => p.rank), [1, 1, 3, 4]);
});
