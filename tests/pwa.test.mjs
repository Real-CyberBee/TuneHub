// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 Real-CyberBee
/**
 * PWA 结构性测试。
 * 运行：node --test tests/
 *
 * Service Worker 的预缓存列表是最容易悄悄写错的东西：漏一个模块，离线打开就是白屏，
 * 而且只有在真机断网时才暴露。这里做三件不需要浏览器的事：
 *   1. 从三个 HTML 入口出发遍历 import 图，确认 sw.js 的 PRECACHE 覆盖了每一个文件；
 *   2. 确认 PRECACHE 里的每个路径在仓库里真实存在；
 *   3. 确认 manifest 可解析、图标文件是尺寸正确的真 PNG。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PAGES = ["index.html", "handpan.html", "handpan-guide.html"];

const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const toPosix = (p) => p.split("\\").join("/");

/** 从 sw.js 里抠出 PRECACHE 数组。 */
function precacheList() {
  const source = read("sw.js");
  const match = source.match(/const PRECACHE = \[([\s\S]*?)\];/);
  assert.ok(match, "sw.js 里找不到 PRECACHE 数组");
  const entries = [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(entries.length > 0, "PRECACHE 是空的");
  return entries;
}

/** 归一化：./a/../b.mjs -> a/b.mjs，用于集合比较。 */
function normalizeWebPath(path) {
  const parts = [];
  for (const part of path.replace(/^\.\//, "").split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

/** 页面里引用的模块入口与样式表。 */
function pageAssets(htmlPath) {
  const html = read(htmlPath);
  const found = new Set();
  const pattern = /(?:src|href)\s*=\s*"([^"]+)"/g;
  for (const [, url] of html.matchAll(pattern)) {
    if (/^(https?:|data:|#|\/\/)/.test(url)) continue;
    if (/\.(mjs|css|json|webmanifest|png|svg)$/.test(url)) found.add(url);
  }
  return [...found];
}

/** 从一个模块出发，递归收集它 import 的所有本地模块。 */
function moduleClosure(entry) {
  const seen = new Set();
  const queue = [toPosix(entry)];
  while (queue.length) {
    const current = queue.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    const absolute = join(ROOT, current);
    if (!existsSync(absolute)) continue;
    const source = readFileSync(absolute, "utf8");
    const dir = dirname(current);
    for (const match of source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
      const spec = match[1];
      if (!spec.startsWith(".")) continue;
      queue.push(normalizeWebPath(toPosix(join(dir, spec))));
    }
  }
  return seen;
}

test("service worker 预缓存覆盖三个页面的全部本地依赖", () => {
  const precached = new Set(precacheList().map(normalizeWebPath));
  const required = new Set();

  for (const page of PAGES) {
    required.add(page);
    for (const asset of pageAssets(page)) {
      const normalized = normalizeWebPath(toPosix(asset));
      required.add(normalized);
      if (normalized.endsWith(".mjs")) {
        for (const dep of moduleClosure(normalized)) required.add(dep);
      }
    }
  }

  const missing = [...required].filter((path) => !precached.has(path)).sort();
  assert.deepEqual(missing, [], `这些文件被页面引用但没写进 sw.js 的 PRECACHE：\n  ${missing.join("\n  ")}`);
});

test("service worker 预缓存里的文件都真实存在", () => {
  const missing = precacheList()
    .map((entry) => (entry === "./" ? "index.html" : normalizeWebPath(entry)))
    .filter((rel) => !existsSync(join(ROOT, rel)));
  assert.deepEqual(missing, [], `PRECACHE 里存在仓库中不存在的路径：${missing.join(", ")}`);
});

test("sw.js 保留发布时才替换的版本占位符", () => {
  const source = read("sw.js");
  assert.match(source, /__TUNEHUB_VERSION__/, "版本占位符被改掉了，发布脚本将无法让浏览器更新缓存");
  assert.match(source, /CACHE_PREFIX/, "缓存名前缀缺失");
});

test("manifest 可解析且指向真实存在的图标", () => {
  const manifest = JSON.parse(read("manifest.webmanifest"));
  assert.equal(typeof manifest.name, "string");
  assert.equal(typeof manifest.short_name, "string");
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.start_url.startsWith("./"), "start_url 必须是相对路径，才能部署在任意子路径");
  assert.ok(manifest.scope.startsWith("./"), "scope 必须是相对路径");
  assert.ok(manifest.theme_color, "缺少 theme_color");

  const icons = manifest.icons ?? [];
  assert.ok(icons.some((icon) => icon.sizes === "192x192"), "缺少 192x192 图标");
  assert.ok(icons.some((icon) => icon.sizes === "512x512"), "缺少 512x512 图标");
  assert.ok(icons.some((icon) => icon.purpose === "maskable"), "缺少 maskable 图标");

  for (const icon of icons) {
    const rel = normalizeWebPath(icon.src);
    assert.ok(existsSync(join(ROOT, rel)), `图标不存在：${rel}`);
    if (icon.type !== "image/png") continue;
    const buffer = readFileSync(join(ROOT, rel));
    assert.equal(buffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${rel} 不是 PNG`);
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    assert.equal(`${width}x${height}`, icon.sizes, `${rel} 实际尺寸 ${width}x${height} 与 manifest 声明不符`);
  }
});

test("三个页面都声明了 manifest 与 Apple 移动端 meta", () => {
  for (const page of PAGES) {
    const html = read(page);
    assert.match(html, /rel="manifest"/, `${page} 缺少 manifest 链接`);
    assert.match(html, /rel="apple-touch-icon"/, `${page} 缺少 apple-touch-icon`);
    assert.match(html, /name="theme-color"/, `${page} 缺少 theme-color`);
  }
});

test("部署密钥文件被 .gitignore 排除", () => {
  const ignore = read(".gitignore");
  for (const pattern of [".env", ".env.deploy.local", "*.pem"]) {
    assert.ok(ignore.includes(pattern), `.gitignore 没有排除 ${pattern}`);
  }
});

test("仓库里没有把部署脚本硬编码进密钥", () => {
  const suspicious = [read("deploy/deploy.sh"), read("deploy/infra.py")].join("\n");
  assert.doesNotMatch(suspicious, /AKID[A-Za-z0-9]{10,}/, "看起来有腾讯云 SecretId 被写进了脚本");
  assert.match(suspicious, /TENCENTCLOUD_SECRET_ID/, "部署脚本应当从环境变量读取密钥");
});
