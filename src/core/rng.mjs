// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 Real-CyberBee
/**
 * 确定性随机源。
 *
 * 设计要点（见 docs/ARCHITECTURE.md §2.4）：
 * 1. 内核中禁止出现裸 Math.random()——所有随机必须经过这里，否则"保存种子"无法实现。
 * 2. 每个声部/每个算子派生子流，避免"调 A 参数导致 B 声部也变"的玩具生成器通病。
 */

/** 32-bit mulberry32：短小、质量足够、快。 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** splitmix32：用于把单一种子扩展成多个独立子流。 */
export function splitmix32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

/** 把一个字符串种子转成 32-bit 整数（分享码友好：可读的短字符串）。 */
export function hashSeed(str) {
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 生成一个人类可读的短种子，如 "k7f3q9"（避免易混淆的 0/O/1/l）。 */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export function randomSeedString(rng, len = 6) {
  let s = '';
  for (let i = 0; i < len; i++) {
    s += ALPHABET[Math.floor(rng() * ALPHABET.length)];
  }
  return s;
}

export function isSeedStringValid(s) {
  return typeof s === 'string' && s.length > 0 && s.length <= 24 && /^[a-z0-9]+$/.test(s);
}

/**
 * 从主种子派生一个带标签的子流。
 * 同一 (seed, label) 永远得到同一条序列，且不同 label 互不干扰。
 */
export function deriveRng(seed, label) {
  return mulberry32(splitmix32(hashSeed(`${seed}::${label}`))());
}

/** 加权随机选择。weights 与 items 等长，权重为相对值（不必归一）。 */
export function weightedChoice(rng, items, weights) {
  let total = 0;
  for (let i = 0; i < weights.length; i++) total += Math.max(0, weights[i]);
  if (total <= 0) return items[Math.floor(rng() * items.length)];
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= Math.max(0, weights[i]);
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

/** 按权重乘数扰动一个基础权重表，用于"情绪"等参数。 */
export function scaleWeights(weights, factors) {
  return weights.map((w, i) => w * (factors[i] ?? 1));
}

/**
 * 生成一个**全新**的随机种子字符串。
 *
 * 注意与内核内部随机的区别：这里需要的是**真正的熵**（用户点了"换一个"），
 * 而不是可复现的伪随机序列，所以用 crypto 而非 mulberry32。
 * 一旦生成，它就固定下来成为作品的一部分，之后的一切都从它确定性派生。
 *
 * 环境无关：浏览器用 crypto.getRandomValues，Node 用 globalThis.crypto（同样存在）。
 */
export function newSeedString(len = 6) {
  const bytes = new Uint8Array(len);
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < len; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s;
}
