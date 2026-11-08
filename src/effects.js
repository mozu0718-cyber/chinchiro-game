// 役が出たときの演出（文字・紙吹雪・画面の揺れ・効果音）。
import { HAND, handLabel } from './rules.js';

const EFFECT = {
  [HAND.PINZORO]: { level: 'great', cls: 'fx-great', burst: ['#ffd54a', '#ff3b30', '#ffffff'], shake: 0.5 },
  [HAND.ARASHI]: { level: 'great', cls: 'fx-great', burst: ['#ffd54a', '#5ac8fa', '#ffffff'], shake: 0.35 },
  [HAND.SHIGORO]: { level: 'good', cls: 'fx-good', burst: ['#ffd54a', '#ff9500'], shake: 0.15 },
  [HAND.DEME]: { level: 'normal', cls: 'fx-normal' },
  [HAND.MENASHI]: { level: 'bad', cls: 'fx-bad' },
  [HAND.HIFUMI]: { level: 'bad', cls: 'fx-awful', shake: 0.2 },
  [HAND.SHONBEN]: { level: 'bad', cls: 'fx-awful', shake: 0.25 },
};

const SUB = { [HAND.PINZORO]: '5倍づけ', [HAND.ARASHI]: '3倍づけ', [HAND.SHIGORO]: '2倍づけ', [HAND.HIFUMI]: '2倍払い' };

/** 役のランクを見た目の分類にする（パネルの色分け用） */
export function handTone(hand) {
  return EFFECT[hand.type].level;
}

export class Effects {
  constructor(bannerEl, scene, sfx) {
    this.el = bannerEl;
    this.scene = scene;
    this.sfx = sfx;
  }

  banner(text, cls, sub = '', who = '') {
    const el = this.el;
    el.className = '';
    void el.offsetWidth; // アニメーションをやり直す
    el.innerHTML = `${who ? `<div class="who">${escapeHtml(who)}</div>` : ''}<div class="main">${escapeHtml(text)}</div>${sub ? `<div class="sub">${escapeHtml(sub)}</div>` : ''}`;
    el.className = `show ${cls}`;
  }

  clear() {
    this.el.className = '';
  }

  hand(hand, who = '') {
    const fx = EFFECT[hand.type];
    this.sfx.jingle(fx.level);
    if (fx.burst) this.scene.burst(fx.burst);
    if (fx.shake) this.scene.addShake(fx.shake);
    this.banner(handLabel(hand), fx.cls, SUB[hand.type] ?? '', who);
  }

  miss(attempt, who = '') {
    this.banner('役なし', 'fx-miss', attempt < 3 ? `あと${3 - attempt}回` : '', who);
  }
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
