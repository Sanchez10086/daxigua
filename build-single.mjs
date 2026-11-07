#!/usr/bin/env node
/**
 * 打包成单个 HTML 文件（所有 JS/CSS/图片全部内联）。
 *
 * 用法：node build-single.mjs
 * 输出：dist/合成游戏.html
 *
 * 这个文件可以直接发微信/QQ 给朋友，双击就能玩，不需要服务器、不需要联网。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFile(path.join(HERE, p), 'utf8');

// ---------- 读配置，拿到所有要内联的图片 ----------
const configSrc = await read('js/config.js');
const sandbox = {};
new Function('window', configSrc)(sandbox);
const CFG = sandbox.GAME_CONFIG;

const images = new Map();
for (const theme of Object.values(CFG.themes)) {
  for (const lv of theme.levels) {
    if (!images.has(lv.image)) {
      const buf = await readFile(path.join(HERE, lv.image));
      images.set(lv.image, 'data:image/png;base64,' + buf.toString('base64'));
    }
  }
}

// 把 config.js 里的 image 路径换成 data URI
let configInline = configSrc;
for (const [rel, dataUri] of images) {
  configInline = configInline.split(`'${rel}'`).join(`'${dataUri}'`);
}

// ---------- 读其他资源 ----------
const [matter, game, css, html] = await Promise.all([
  read('vendor/matter.min.js'),
  read('js/game.js'),
  read('css/style.css'),
  read('index.html'),
]);

// ---------- 组装 ----------
let out = html;

// 1. 去掉外链 CSS，换成内联
out = out.replace(
  /<link rel="stylesheet" href="css\/style\.css"\s*\/?>/,
  `<style>\n${css}\n</style>`
);

// 2. favicon 换成内联（用第一套主题的最高级图）
const faviconKey = CFG.themes[CFG.defaultTheme].levels.at(-1).image;
out = out.replace(
  /<link rel="icon" href="[^"]*"\s*\/?>/,
  `<link rel="icon" href="${images.get(faviconKey)}" />`
);

// 3. 三个 script 换成内联
out = out.replace(
  /<script src="vendor\/matter\.min\.js"><\/script>\s*<script src="js\/config\.js"><\/script>\s*<script src="js\/game\.js"><\/script>/,
  `<script>${matter}</script>\n<script>${configInline}</script>\n<script>${game}</script>`
);

// 4. 标题用配置里的（game.js 也会动态设置，这里烘焙进去让文件本身更好认）
const themeName = CFG.themes[CFG.defaultTheme]?.name;
const fullTitle = themeName ? `${CFG.title} · ${themeName}` : CFG.title;
out = out.replace(/<title>[^<]*<\/title>/, `<title>${fullTitle}</title>`);

await mkdir(path.join(HERE, 'dist'), { recursive: true });
const outPath = path.join(HERE, 'dist', '合成游戏.html');
await writeFile(outPath, out, 'utf8');

const kb = (Buffer.byteLength(out) / 1024).toFixed(0);
console.log(`✓ 打包完成：dist/合成游戏.html（${kb} KB，内联 ${images.size} 张图）`);
console.log('  直接发给朋友，双击即可玩，不需要服务器。');
