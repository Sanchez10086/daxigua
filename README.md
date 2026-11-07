# 合成游戏（4 级 · 可换图）

一个纯静态的合成类网页游戏：**一个网址就能打开，换图只改一个配置、或者直接覆盖 4 张图。**

- 物理引擎：[matter.js](https://github.com/liabru/matter-js)（已内置在 `vendor/`，不联网也能跑）
- 无框架、无构建、无后端：HTML + CSS + 原生 JS
- 打开 `index.html` 就能玩，也可以丢到任意静态托管上得到网址

**当前配置：4 级合成链**（01 → 02 → 03 → 04），两个同级撞在一起就升一级，两个最高级相撞则一起消失并给大分。

---

## 一、先跑起来

### 方式 A：直接双击打开（最简单）

双击 `index.html`。整个游戏可以走 `file://` 协议运行，不需要服务器。

> 某些浏览器对 `file://` 下的 `localStorage` 有限制，最高分可能记不住，但游戏本身完全正常。

### 方式 B：起一个本地服务器（推荐）

在 `daxigua-game/` 目录里执行：

```bash
node serve.cjs          # 默认 8123 端口
```

或：

```bash
python -m http.server 8123
```

然后浏览器打开 <http://127.0.0.1:8123/>。

### 方式 C：变成一个真正的网址

把整个 `daxigua-game/` 目录原样上传到任意静态托管：

| 平台 | 做法 |
| --- | --- |
| GitHub Pages | 推仓库 → Settings → Pages → 选分支根目录 |
| Vercel / Netlify | 拖文件夹上传，构建命令留空，输出目录填 `.` |
| 腾讯云 / 阿里云 OSS | 开静态网站托管，上传后绑定域名 |
| 自己服务器 | 丢进 Nginx 的 `root` 目录即可 |

没有任何构建步骤，**上传什么就是什么**。

---

## 一.5、怎么分享给别人（重点看这里）

有 4 种方式，按"对方离你多远"选：

### ① 同一个 WiFi（最快，朋友在旁边）

```bash
node share.cjs
```

终端会打印一个地址和一个二维码：

```
     http://10.120.173.22:8123/
     ✓ 二维码已生成：share-qr.png
```

**对方手机连同一个 WiFi，扫 `share-qr.png` 或直接输地址就能玩。**
前提：你电脑上这个服务开着（关掉窗口就没了）。

> 如果你和对方**不在同一个 WiFi**，这个地址打不开 —— 用下面的 ②③④。

### ② 发一个文件给他（微信/QQ 直接传，不用联网）

```bash
node build-single.mjs
```

生成 **`dist/合成游戏.html`**（约 2 MB，图片全部内联）。

这一个文件就是完整游戏：**微信/QQ 发过去，对方双击就能玩**，不需要服务器、不需要联网。

> 缺点：微信里直接点开可能被识别成"文件"，让对方先保存到手机/电脑再打开；
> 电脑上双击是能直接玩的。

### ③ 部署成公网网址（一劳永逸，谁都能访问）

把 `daxigua-game/` 整个文件夹拖到 [Vercel](https://vercel.com) 或 [Netlify](https://app.netlify.com/drop)：

- 构建命令：**留空**
- 输出目录：`.`
- 几秒钟后得到一个 `https://xxx.vercel.app` 的网址，发给谁都能打开

这是**最推荐**的方式：对方不用装任何东西，手机点开就玩。

### ④ 丢到自己服务器

`daxigua-game/` 里全是静态文件，扔进 Nginx 的 `root` 目录、或任何静态托管，绑个域名即可。

---

## 二、怎么换图片（重点）

### 2.1 最简单：直接覆盖 4 个文件

把你自己的 4 张图命名成 `01.png`、`02.png`、`03.png`、`04.png`，
覆盖 `assets/theme/` 里的同名文件，刷新页面 —— **完成，不用改任何代码。**

> 顺序就是合成顺序：`01` 是最小的、`04` 是最大的。

### 2.2 推荐：用工具自动处理

手工裁图很烦，跑一条命令更省事。把 4 张图放进任意文件夹（文件名顺序即等级顺序）：

```bash
python tools/make_theme.py D:\我的图 theme 默认 --write
```

它会：

1. 统一转成 512×512 透明 PNG，裁成圆形
2. 自动算好 `radius`（从小到大）和 `score`
3. 自动写进 `js/config.js`（原文件备份为 `config.js.bak`）

不加 `--write` 就只打印配置片段，你自己粘贴。

**图片要求**：

- 透明背景 PNG 最理想（圆球边缘 = 图自己的 alpha）
- JPG / 不透明图也行，工具会自动裁成圆形
- 非正方形会居中裁成正方形
- 4 张够用；想加级也可以，见 2.3

### 2.3 想改等级数量 / 名字 / 手感

打开 `js/config.js`，改 `levels` 数组即可：

```js
main: {
  name: '默认',
  levels: [
    { name: '一级', image: 'assets/theme/01.png', radius: 24, score: 1,  color: '#4a90d9' },
    { name: '二级', image: 'assets/theme/02.png', radius: 38, score: 4,  color: '#5cb85c' },
    { name: '三级', image: 'assets/theme/03.png', radius: 56, score: 12, color: '#f0a030' },
    { name: '四级', image: 'assets/theme/04.png', radius: 78, score: 30, color: '#d9534f' },
  ],
},
```

| 字段 | 作用 |
| --- | --- |
| `name` | 名字（图片加载失败时兜底显示） |
| `image` | 图片路径（相对 `index.html`） |
| `radius` | 球多大，**必须从小到大递增** |
| `score` | 合成到这一级时加的分 |
| `color` | 粒子特效色 / 图片缺失时的兜底色 |

**加等级**：往 `levels` 里再加一项，并把 `spawnRange` 保持在 1~2（只出最小的一两级，否则合不动）。

**注意**：`spawnRange: 1` 表示只随机出「第 1 级」和「第 2 级」。4 级链最合适；如果你加到 8 级，可以调到 2 或 3。

---

## 三、可调参数

全都在 `js/config.js` 顶部：

| 参数 | 说明 |
| --- | --- |
| `title` | 页面标题 |
| `defaultTheme` | 打开时用哪套主题 |
| `canvas.width/height` | 画布逻辑尺寸，比例影响手感 |
| `deadlineY` | 顶部死亡线高度，**越小越难** |
| `spawnRange` | 每次随机出 0~N 级（0 = 最低级）。调小 = 更简单 |
| `dropInterval` | 两次掉落的最小间隔（毫秒） |

---

## 四、玩法与操作

- **移动鼠标 / 手指**：瞄准落点，画面里有虚线和地面标记
- **点击 / 空格 / ↓**：投放
- **← →**（或 A / D）：左右微调
- 两个**相同等级**的撞在一起 → 合成为下一级
- 两个**最高级**撞在一起 → 一起消失，给双倍大分
- 堆过顶部虚线并静止约 1 秒 → 游戏结束
- 最高分存在浏览器 `localStorage`

---

## 五、目录结构

```
daxigua-game/
├── index.html              # 页面骨架
├── serve.cjs               # 本地预览 / 局域网分享的静态服务器
├── share.cjs               # ★ 一键分享：起服务 + 打印地址 + 生成二维码
├── build-single.mjs        # ★ 打包成单个 HTML（发给朋友双击就能玩）
├── share-qr.png            # 分享二维码（由 share.cjs 生成）
├── css/style.css           # 样式（HUD、弹窗、自适应）
├── js/
│   ├── config.js           # ★ 素材与规则，换图只改这里
│   └── game.js             # 游戏逻辑（不用改）
├── assets/
│   └── theme/              # ★ 你的 4 张图：01.png ~ 04.png
│       └── original/       # 原图备份（优化前）
├── dist/
│   └── 合成游戏.html        # 单文件版（由 build-single.mjs 生成）
├── tools/
│   ├── qr.cjs              # 二维码生成（纯 Node，无依赖）
│   ├── optimize_images.py  # 把图片压成 512x512 并瘦身
│   ├── make_theme.py       # 一键把一堆图变成主题
│   └── make_theme_assets.py# 重新生成 4 张默认占位图
└── vendor/
    └── matter.min.js       # 物理引擎，已内置
```

---

## 六、小工具

```bash
# 分享（同一个 WiFi）
node share.cjs

# 打包成单个 HTML（发给朋友）
node build-single.mjs

# 生成二维码
node tools/qr.cjs "http://10.0.0.5:8123/" share-qr.png
```

需要 Pillow 的（`pip install Pillow`）：

```bash
# 压缩图片到 512x512，体积能小 3~4 倍
python tools/optimize_images.py

# 一键生成主题
python tools/make_theme.py <图片文件夹> <主题id> [主题名] [--write]

# 重新生成 4 张默认占位图
python tools/make_theme_assets.py
```

这些脚本都只是辅助，**你换好自己的图之后可以直接删掉**，不影响游戏运行。

---

## 七、说明

- 物理引擎 matter.js 使用 MIT 协议，已随包内置，无需 `npm install`
- 音效由 WebAudio 实时合成，没有音频文件
- 这个项目是为了学习和自用，不要拿去做大规模传播或商用
