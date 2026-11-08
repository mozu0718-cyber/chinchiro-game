import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HAND, evaluateDice, judge, settle, menashi, shonben, maxBet, canBet, rollOrder,
} from '../src/rules.js';

const pin = { type: HAND.PINZORO, value: 1 };
const arashi = (v) => ({ type: HAND.ARASHI, value: v });
const shigoro = { type: HAND.SHIGORO, value: 0 };
const deme = (v) => ({ type: HAND.DEME, value: v });
const hifumi = { type: HAND.HIFUMI, value: 0 };

test('役判定', () => {
  assert.deepEqual(evaluateDice([1, 1, 1]), pin);
  assert.deepEqual(evaluateDice([4, 4, 4]), arashi(4));
  assert.deepEqual(evaluateDice([6, 5, 4]), shigoro);
  assert.deepEqual(evaluateDice([3, 1, 2]), hifumi);
  assert.deepEqual(evaluateDice([6, 6, 2]), deme(2));
  assert.deepEqual(evaluateDice([1, 5, 1]), deme(5));
  assert.equal(evaluateDice([1, 3, 5]), null);
  assert.equal(evaluateDice([2, 4, 6]), null);
  assert.throws(() => evaluateDice([0, 1, 2]));
  assert.throws(() => evaluateDice([1, 2]));
});

test('役判定：216通りすべてで役の出現数が理論値と一致する', () => {
  const count = {};
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) for (let c = 1; c <= 6; c++) {
    const h = evaluateDice([a, b, c]);
    const k = h ? h.type : 'none';
    count[k] = (count[k] ?? 0) + 1;
  }
  assert.deepEqual(count, { pinzoro: 1, arashi: 5, shigoro: 6, hifumi: 6, deme: 90, none: 108 });
});

test('勝敗：順位', () => {
  const order = [pin, arashi(2), shigoro, deme(1), menashi(), hifumi, shonben()];
  for (let i = 0; i < order.length; i++) {
    for (let j = i + 1; j < order.length; j++) {
      assert.equal(judge(order[i], order[j]).winner, 'parent', `${order[i].type} vs ${order[j].type}`);
      assert.equal(judge(order[j], order[i]).winner, 'child', `${order[j].type} vs ${order[i].type}`);
    }
  }
});

test('勝敗：同順位', () => {
  assert.equal(judge(deme(3), deme(5)).winner, 'child');
  assert.equal(judge(deme(5), deme(3)).winner, 'parent');
  assert.equal(judge(deme(4), deme(4)).winner, 'parent');
  assert.equal(judge(arashi(2), arashi(6)).winner, 'parent', 'アラシどうしは数字に関係なく親勝ち');
  assert.equal(judge(menashi(), menashi()).winner, 'parent');
  assert.equal(judge(shonben(), shonben()).winner, 'parent');
});

test('倍率', () => {
  assert.equal(judge(pin, deme(6)).multiplier, 5);
  assert.equal(judge(pin, arashi(6)).multiplier, 5, '敗者アラシの倍率は掛けない');
  assert.equal(judge(pin, hifumi).multiplier, 10);
  assert.equal(judge(shigoro, hifumi).multiplier, 4);
  assert.equal(judge(arashi(3), hifumi).multiplier, 6);
  assert.equal(judge(deme(5), hifumi).multiplier, 2);
  assert.equal(judge(menashi(), hifumi).multiplier, 2);
  assert.equal(judge(hifumi, deme(2)).multiplier, 2, '親ヒフミで子が勝つ');
  assert.equal(judge(hifumi, shonben()).multiplier, 1, 'ヒフミがションベンに勝つ');
  assert.equal(judge(shonben(), deme(1)).multiplier, 1);
  assert.equal(judge(deme(1), menashi()).multiplier, 1);
  // 同じ役どうしは1倍
  assert.equal(judge(arashi(2), arashi(5)).multiplier, 1);
  assert.equal(judge(shigoro, shigoro).multiplier, 1);
  assert.equal(judge(pin, pin).multiplier, 1);
  assert.equal(judge(hifumi, hifumi).multiplier, 1);
});

test('精算：通常', () => {
  const r = settle({
    parentMoney: 100000,
    parentHand: deme(4),
    children: [
      { id: 'a', bet: 1000, money: 100000, hand: deme(5) },
      { id: 'b', bet: 2000, money: 100000, hand: hifumi },
      { id: 'c', bet: 3000, money: 100000, hand: shigoro },
    ],
  });
  assert.deepEqual(r.results.map((x) => x.delta), [1000, -4000, 6000]);
  assert.equal(r.parentDelta, -3000);
});

test('精算：子が払いきれない場合は持っている分だけ', () => {
  const r = settle({
    parentMoney: 50000,
    parentHand: pin,
    children: [{ id: 'a', bet: 2000, money: 6000, hand: hifumi }],
  });
  assert.equal(r.results[0].owed, 20000);
  assert.equal(r.results[0].delta, -6000);
  assert.equal(r.parentDelta, 6000);
});

test('精算：親が払いきれない場合は按分（負けた子から先に受け取る）', () => {
  const r = settle({
    parentMoney: 5000,
    parentHand: hifumi,
    children: [
      { id: 'a', bet: 3000, money: 100000, hand: shigoro }, // 3000*2*2=12000
      { id: 'b', bet: 2000, money: 100000, hand: deme(1) }, // 2000*2=4000
      { id: 'c', bet: 1000, money: 100000, hand: shonben() }, // 親の勝ち 1000
    ],
  });
  // 親は c から1000受け取って6000。支払総額16000を 12000:4000 で按分
  // 6000*12000/16000=4500→4000、6000*4000/16000=1500→1000
  assert.deepEqual(r.results.map((x) => x.delta), [4000, 1000, -1000]);
  assert.equal(r.parentDelta, -4000);
});

test('精算：按分の端数は1,000円未満切り捨て、合計は親の所持金を超えない', () => {
  const r = settle({
    parentMoney: 5000,
    parentHand: shonben(),
    children: [
      { id: 'a', bet: 1000, money: 10000, hand: deme(1) },
      { id: 'b', bet: 1000, money: 10000, hand: deme(2) },
      { id: 'c', bet: 1000, money: 10000, hand: deme(3) },
    ],
  });
  // 5000円を3人で等分すると1666円ずつ → 1000円単位で切り捨て
  assert.deepEqual(r.results.map((x) => x.delta), [1000, 1000, 1000]);
  assert.equal(r.parentDelta, -3000);
});

test('賭け金の上限', () => {
  assert.equal(maxBet(100000), 20000);
  assert.equal(maxBet(12999), 2000);
  assert.equal(maxBet(4000), 1000);
  assert.equal(maxBet(999), 0);
  assert.equal(canBet(1000), true);
  assert.equal(canBet(999), false);
});

test('子が振る順番：賭け金が少ない順、同額は席順', () => {
  const order = rollOrder([
    { id: 'a', seat: 0, bet: 3000 },
    { id: 'b', seat: 1, bet: 1000 },
    { id: 'c', seat: 2, bet: 3000 },
    { id: 'd', seat: 3, bet: 2000 },
  ]);
  assert.deepEqual(order.map((x) => x.id), ['b', 'd', 'a', 'c']);
});
