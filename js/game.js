/**
 * 合成大西瓜 · 游戏主逻辑
 * 物理引擎：matter.js（vendored 在 vendor/matter.min.js）
 * 素材与规则：js/config.js
 *
 * 这个文件不需要为了换图片而改动。
 */
(function () {
  'use strict';

  const M = window.Matter;
  const { Engine, Bodies, Body, Composite, Events } = M;

  const CFG = window.GAME_CONFIG;
  const W = CFG.canvas.width;
  const H = CFG.canvas.height;
  const WALL = 20;                 // 墙厚
  const FLOOR_H = 40;              // 地板厚
  const PLAY_LEFT = WALL;          // 可玩区左边界
  const PLAY_RIGHT = W - WALL;     // 可玩区右边界
  const PLAY_BOTTOM = H - FLOOR_H; // 地板面
  const DEADLINE_Y = CFG.deadlineY;

  // ---------- 主题 ----------
  const THEMES = CFG.themes || { default: { name: '默认', levels: CFG.levels } };
  const THEME_IDS = Object.keys(THEMES);
  let themeId = (function () {
    const saved = localStorage.getItem('daxigua.theme');
    if (saved && THEMES[saved]) return saved;
    if (CFG.defaultTheme && THEMES[CFG.defaultTheme]) return CFG.defaultTheme;
    return THEME_IDS[0];
  })();
  let LEVELS = THEMES[themeId].levels;
  let MAX_LEVEL = LEVELS.length - 1;

  // ---------- 画布 ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const stage = canvas.parentElement;
  let dpr = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);

    // 按舞台可用空间等比缩放（CSS 尺寸），保持 480:720 比例
    const availW = Math.max(160, stage.clientWidth);
    const availH = Math.max(200, stage.clientHeight);
    const scale = Math.min(availW / W, availH / H);
    canvas.style.width = Math.floor(W * scale) + 'px';
    canvas.style.height = Math.floor(H * scale) + 'px';

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) {
    new ResizeObserver(resize).observe(stage);
  }

  // ---------- 图片 ----------
  let sprites = [];

  /**
   * 探测一张图是否有真正的透明通道。
   * 用户常常直接丢 JPG/截图进来（整张不透明），这种图要额外套圆形裁切，
   * 否则会画成一个方块贴图。这里用 canvas 采样四角判断。
   */
  function isOpaqueImage(img) {
    try {
      const c = document.createElement('canvas');
      const n = 24; // 采样网格
      c.width = n;
      c.height = n;
      const cx = c.getContext('2d', { willReadFrequently: true });
      cx.drawImage(img, 0, 0, n, n);
      const d = cx.getImageData(0, 0, n, n).data;
      let transparent = 0;
      for (let i = 3; i < d.length; i += 4) {
        if (d[i] < 250) transparent++;
      }
      return transparent < n * n * 0.02; // 几乎没有透明像素 -> 视为不透明图
    } catch (e) {
      return false; // 跨域等异常，当作有透明通道处理
    }
  }

  function loadSprites() {
    sprites = [];
    return Promise.all(
      LEVELS.map(
        (lv, i) =>
          new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
              img.__opaque = isOpaqueImage(img);
              sprites[i] = img;
              resolve();
            };
            img.onerror = () => {
              console.warn('图片加载失败，将用色块兜底：', lv.image);
              sprites[i] = null;
              resolve();
            };
            img.src = lv.image;
          })
      )
    );
  }

  // ---------- 引擎 ----------
  const engine = Engine.create({
    gravity: { x: 0, y: 1.15 },
    positionIterations: 8,
    velocityIterations: 6,
    constraintIterations: 3,
  });
  const world = engine.world;

  // ---------- 游戏状态 ----------
  const state = {
    phase: 'loading', // loading | ready | playing | over
    score: 0,
    best: Number(localStorage.getItem('daxigua.best') || 0),
    muted: localStorage.getItem('daxigua.muted') === '1',
    pointerX: W / 2,
    heldLevel: 0,
    nextLevel: 0,
    canDrop: true,
    lastDrop: 0,
    balls: [],
    effects: [],
    popups: [],
    danger: 0, // 0~1 危险度，用于死亡线闪红
    shake: 0,
  };

  // ---------- 音效（WebAudio 合成，无外部文件） ----------
  let audioCtx = null;
  function beep(freq, dur, type, gain) {
    if (state.muted) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const t = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.55), t + dur);
      g.gain.setValueAtTime(gain || 0.05, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g).connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    } catch (e) {
      /* 静音失败无所谓 */
    }
  }

  // ---------- 墙体 ----------
  function buildWalls() {
    const opts = { isStatic: true, friction: 0.4, restitution: 0.05, label: 'wall' };
    const walls = [
      Bodies.rectangle(PLAY_LEFT - WALL / 2, H / 2, WALL, H * 2, opts),
      Bodies.rectangle(PLAY_RIGHT + WALL / 2, H / 2, WALL, H * 2, opts),
      Bodies.rectangle(W / 2, PLAY_BOTTOM + FLOOR_H / 2, W * 2, FLOOR_H, opts),
    ];
    Composite.add(world, walls);
    return walls;
  }
  let walls = buildWalls();

  // ---------- 生成球 ----------
  function randomLevel() {
    const max = Math.min(CFG.spawnRange, MAX_LEVEL);
    return Math.floor(Math.random() * (max + 1));
  }

  function heldY(radius) {
    return Math.max(radius + 10, 62);
  }

  function makeBall(level, x, y) {
    const lv = LEVELS[level];
    const body = Bodies.circle(x, y, lv.radius, {
      label: 'ball',
      restitution: 0.14,
      friction: 0.28,
      frictionStatic: 0.6,
      frictionAir: 0.002,
      density: 0.0012,
      slop: 0.02,
    });
    body.level = level;
    body.age = 0;
    body.deathTimer = 0;
    body.spawnScale = 0.6;
    return body;
  }

  function clampX(x, radius) {
    return Math.max(PLAY_LEFT + radius + 1, Math.min(PLAY_RIGHT - radius - 1, x));
  }

  function drop() {
    if (state.phase !== 'playing' || !state.canDrop) return;
    const now = performance.now();
    if (now - state.lastDrop < CFG.dropInterval) return;

    const level = state.heldLevel;
    const lv = LEVELS[level];
    const x = clampX(state.pointerX, lv.radius);
    const body = makeBall(level, x, heldY(lv.radius));
    Body.setVelocity(body, { x: 0, y: 2 });
    Composite.add(world, body);
    state.balls.push(body);

    beep(320, 0.07, 'triangle', 0.035);
    state.lastDrop = now;
    state.canDrop = false;

    state.heldLevel = state.nextLevel;
    state.nextLevel = randomLevel();
    updateHud();

    setTimeout(() => {
      state.canDrop = true;
    }, CFG.dropInterval);
  }

  // ---------- 合成 ----------
  const mergeQueue = [];

  function onCollisionStart(event) {
    if (state.phase !== 'playing') return;
    for (const pair of event.pairs) {
      const a = pair.bodyA;
      const b = pair.bodyB;
      if (a.label !== 'ball' || b.label !== 'ball') continue;
      if (a.merged || b.merged) continue;
      if (a.level !== b.level) continue;

      a.merged = true;
      b.merged = true;
      mergeQueue.push([a, b]);
    }
  }

  function processMerges() {
    while (mergeQueue.length) {
      const [a, b] = mergeQueue.shift();
      if (!a.position || !b.position) continue;

      const level = a.level;
      const mx = (a.position.x + b.position.x) / 2;
      const my = (a.position.y + b.position.y) / 2;

      Composite.remove(world, a);
      Composite.remove(world, b);
      state.balls = state.balls.filter((x) => x !== a && x !== b);

      if (level >= MAX_LEVEL) {
        // 最高级相撞：一起消失，给一笔大分
        addScore(LEVELS[MAX_LEVEL].score * 2, mx, my);
        burst(mx, my, LEVELS[MAX_LEVEL].color, 26);
        beep(880, 0.3, 'sine', 0.07);
        state.shake = 8;
        continue;
      }

      const newLevel = level + 1;
      const nl = LEVELS[newLevel];
      const body = makeBall(newLevel, clampX(mx, nl.radius), Math.min(my, PLAY_BOTTOM - nl.radius - 1));
      body.spawnScale = 0.45;
      Composite.add(world, body);
      state.balls.push(body);

      addScore(nl.score, mx, my);
      burst(mx, my, nl.color, 14 + newLevel);
      beep(420 + newLevel * 55, 0.14, 'sine', 0.05);
      state.shake = Math.min(10, 2 + newLevel);
    }
  }

  function addScore(n, x, y) {
    state.score += n;
    state.popups.push({
      x: clampX(x === undefined ? state.pointerX : x, 40),
      y: (y === undefined ? DEADLINE_Y + 40 : y) - 10,
      text: '+' + n,
      life: 1,
    });
    if (state.score > state.best) {
      state.best = state.score;
      localStorage.setItem('daxigua.best', String(state.best));
    }
    updateHud();
  }

  // ---------- 粒子 ----------
  function burst(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = 1.5 + Math.random() * 4.5;
      state.effects.push({
        x,
        y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp - 1,
        r: 2 + Math.random() * 4,
        color,
        life: 1,
      });
    }
  }

  // ---------- 结束判定 ----------
  function checkGameOver(dt) {
    let danger = 0;
    for (const b of state.balls) {
      b.age += dt;
      if (b.age < 900) continue;
      const top = b.position.y - LEVELS[b.level].radius;
      if (top < DEADLINE_Y) {
        const speed = Math.hypot(b.velocity.x, b.velocity.y);
        if (speed < 3.2) {
          b.deathTimer += dt;
        } else {
          b.deathTimer = Math.max(0, b.deathTimer - dt * 0.5);
        }
        danger = Math.max(danger, Math.min(1, (DEADLINE_Y - top) / 60));
      } else {
        b.deathTimer = Math.max(0, b.deathTimer - dt * 0.6);
      }
      if (b.deathTimer > 1100) {
        gameOver();
        return;
      }
    }
    state.danger += (danger - state.danger) * Math.min(1, dt / 120);
  }

  function gameOver() {
    if (state.phase === 'over') return;
    state.phase = 'over';
    beep(180, 0.5, 'sawtooth', 0.05);
    document.getElementById('overlay').classList.add('show');
    document.getElementById('finalScore').textContent = state.score;
    document.getElementById('finalBest').textContent = state.best;
  }

  // ---------- 重开 ----------
  function restart() {
    document.getElementById('overlay').classList.remove('show');
    Composite.clear(world, false, true);
    walls = buildWalls();
    state.balls = [];
    state.effects = [];
    state.popups = [];
    mergeQueue.length = 0;
    state.score = 0;
    state.danger = 0;
    state.shake = 0;
    state.heldLevel = randomLevel();
    state.nextLevel = randomLevel();
    state.canDrop = true;
    state.phase = 'playing';
    updateHud();
  }

  // ---------- 绘制 ----------
  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function drawBall(b, scale) {
    const lv = LEVELS[b.level];
    const r = lv.radius * (scale === undefined ? 1 : scale);
    ctx.save();
    ctx.translate(b.position.x, b.position.y);
    ctx.rotate(b.angle || 0);

    // 阴影
    ctx.shadowColor = 'rgba(24, 42, 66, 0.22)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 6;

    const img = sprites[b.level];
    if (img) {
      // 图片按"等比填充"画进圆里：不会因为原图不是正方形而被拉扁。
      // 不透明的图（JPG/截图）额外套一个圆形裁切，让它看起来还是球。
      if (img.__opaque) {
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.clip();
      }
      const iw = img.naturalWidth || img.width;
      const ih = img.naturalHeight || img.height;
      // cover：取短边做正方形源区域，居中裁掉长出来的部分，
      // 这样原图不管是横的、竖的还是正方形，都不会被拉变形。
      const side = Math.min(iw, ih);
      const sx = (iw - side) / 2;
      const sy = (ih - side) / 2;
      ctx.drawImage(img, sx, sy, side, side, -r, -r, r * 2, r * 2);
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = lv.color;
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = '#fff';
      ctx.font = `600 ${Math.max(11, r * 0.55)}px "Microsoft YaHei", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(lv.name.charAt(0), 0, 1);
    }
    ctx.restore();
  }

  function draw() {
    const t = performance.now();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // 背景
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#fff9ec');
    bg.addColorStop(0.55, '#fff4dc');
    bg.addColorStop(1, '#ffe9c4');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // 抖动
    ctx.save();
    if (state.shake > 0.2) {
      ctx.translate((Math.random() - 0.5) * state.shake, (Math.random() - 0.5) * state.shake);
      state.shake *= 0.86;
    }

    // 罐体
    ctx.save();
    const tankX = PLAY_LEFT;
    const tankY = DEADLINE_Y;
    const tankW = PLAY_RIGHT - PLAY_LEFT;
    const tankH = PLAY_BOTTOM - DEADLINE_Y;
    roundRect(ctx, tankX, tankY, tankW, tankH, 18);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(232, 178, 92, 0.85)';
    ctx.stroke();
    ctx.clip();

    // 罐内底部渐变
    const fg = ctx.createLinearGradient(0, PLAY_BOTTOM - 160, 0, PLAY_BOTTOM);
    fg.addColorStop(0, 'rgba(255, 226, 168, 0)');
    fg.addColorStop(1, 'rgba(255, 214, 140, 0.55)');
    ctx.fillStyle = fg;
    ctx.fillRect(tankX, PLAY_BOTTOM - 160, tankW, 160);

    // 球
    for (const b of state.balls) {
      let s = 1;
      if (b.spawnScale !== undefined && b.spawnScale < 1) {
        b.spawnScale += 0.12;
        if (b.spawnScale > 1) b.spawnScale = 1;
        s = 1 + Math.sin(b.spawnScale * Math.PI) * 0.16;
      }
      drawBall(b, s);
    }

    // 粒子
    for (const p of state.effects) {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // 死亡线
    const danger = state.danger;
    ctx.save();
    ctx.setLineDash([9, 8]);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = danger > 0.05
      ? `rgba(${Math.round(210 + 45 * danger)}, ${Math.round(90 - 60 * danger)}, ${Math.round(90 - 60 * danger)}, ${0.55 + 0.45 * danger})`
      : 'rgba(226, 160, 96, 0.65)';
    if (danger > 0.35) {
      ctx.shadowColor = 'rgba(255, 70, 70, 0.75)';
      ctx.shadowBlur = 14;
    }
    ctx.beginPath();
    ctx.moveTo(PLAY_LEFT + 4, DEADLINE_Y);
    ctx.lineTo(PLAY_RIGHT - 4, DEADLINE_Y);
    ctx.stroke();
    ctx.restore();

    // 待落球 + 落点辅助线
    if (state.phase === 'playing') {
      const lv = LEVELS[state.heldLevel];
      const hx = clampX(state.pointerX, lv.radius);
      const hy = heldY(lv.radius);

      ctx.save();
      ctx.setLineDash([6, 10]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(210, 150, 80, 0.35)';
      ctx.beginPath();
      ctx.moveTo(hx, hy + lv.radius + 6);
      ctx.lineTo(hx, PLAY_BOTTOM - 6);
      ctx.stroke();
      ctx.restore();

      // 落点地面标记
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(hx, PLAY_BOTTOM - 4, lv.radius * 0.75, 7, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(226, 160, 96, 0.22)';
      ctx.fill();
      ctx.restore();

      drawBall({ position: { x: hx, y: hy }, angle: Math.sin(t / 420) * 0.08, level: state.heldLevel }, 1);
    }

    // 飘分
    for (const p of state.popups) {
      p.life -= 0.018;
      p.y -= 0.9;
      if (p.life <= 0) continue;
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.font = '700 26px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.strokeText(p.text, p.x, p.y);
      ctx.fillStyle = '#e0703a';
      ctx.fillText(p.text, p.x, p.y);
      ctx.restore();
    }
    ctx.restore(); // shake
  }

  // ---------- HUD ----------
  function updateHud() {
    document.getElementById('score').textContent = state.score;
    document.getElementById('best').textContent = state.best;
    const nextImg = document.getElementById('nextImg');
    const lv = LEVELS[state.nextLevel];
    if (nextImg && lv) {
      if (nextImg.getAttribute('src') !== lv.image) nextImg.setAttribute('src', lv.image);
      nextImg.alt = lv.name;
      nextImg.title = lv.name;
    }
  }

  // ---------- 输入 ----------
  function pointerToX(clientX) {
    const rect = canvas.getBoundingClientRect();
    return ((clientX - rect.left) / rect.width) * W;
  }

  canvas.addEventListener('pointermove', (e) => {
    state.pointerX = pointerToX(e.clientX);
  });

  canvas.addEventListener('pointerdown', (e) => {
    state.pointerX = pointerToX(e.clientX);
    if (state.phase === 'over') return;
    drop();
  });

  window.addEventListener('keydown', (e) => {
    if (state.phase !== 'playing') {
      if (e.code === 'Space' || e.code === 'Enter') {
        if (state.phase === 'over') restart();
      }
      return;
    }
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
      state.pointerX = clampX(state.pointerX - 26, 20);
      e.preventDefault();
    } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
      state.pointerX = clampX(state.pointerX + 26, 20);
      e.preventDefault();
    } else if (e.code === 'Space' || e.code === 'ArrowDown' || e.code === 'KeyS') {
      drop();
      e.preventDefault();
    }
  });

  document.getElementById('restart').addEventListener('click', restart);
  document.getElementById('again').addEventListener('click', restart);

  // ---------- 主题切换（只有一个主题时自动隐藏下拉框） ----------
  const themeSelect = document.getElementById('theme');
  if (themeSelect) {
    if (THEME_IDS.length <= 1) {
      themeSelect.hidden = true;
      themeSelect.style.display = 'none';
    } else {
      themeSelect.innerHTML = '';
      for (const id of THEME_IDS) {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = THEMES[id].name || id;
        themeSelect.appendChild(opt);
      }
      themeSelect.value = themeId;
      themeSelect.addEventListener('change', async () => {
        const next = themeSelect.value;
        if (!THEMES[next] || next === themeId) return;
        themeId = next;
        LEVELS = THEMES[themeId].levels;
        MAX_LEVEL = LEVELS.length - 1;
        localStorage.setItem('daxigua.theme', themeId);
        document.title = CFG.title + (THEMES[themeId].name ? ' · ' + THEMES[themeId].name : '');
        await loadSprites();
        restart();
      });
    }
  }
  document.title = CFG.title + (THEMES[themeId].name ? ' · ' + THEMES[themeId].name : '');

  const muteBtn = document.getElementById('mute');
  function syncMute() {
    muteBtn.textContent = state.muted ? '🔇' : '🔊';
    muteBtn.setAttribute('aria-label', state.muted ? '开启音效' : '关闭音效');
  }
  muteBtn.addEventListener('click', () => {
    state.muted = !state.muted;
    localStorage.setItem('daxigua.muted', state.muted ? '1' : '0');
    syncMute();
  });
  syncMute();

  // ---------- 主循环 ----------
  let lastT = performance.now();
  function loop(now) {
    const dt = Math.min(48, now - lastT);
    lastT = now;

    Engine.update(engine, dt);
    processMerges();

    if (state.phase === 'playing') checkGameOver(dt);

    // 粒子推进
    for (const p of state.effects) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.22;
      p.vx *= 0.985;
      p.life -= 0.026;
    }
    state.effects = state.effects.filter((p) => p.life > 0);
    state.popups = state.popups.filter((p) => p.life > 0);

    draw();
    requestAnimationFrame(loop);
  }

  // ---------- 启动 ----------
  Events.on(engine, 'collisionStart', onCollisionStart);

  loadSprites().then(() => {
    state.phase = 'playing';
    state.heldLevel = randomLevel();
    state.nextLevel = randomLevel();
    updateHud();
    document.getElementById('loading').classList.add('hide');
    requestAnimationFrame(loop);
  });

  // 调试接口：控制台可用
  window.__daxigua = {
    state,
    restart,
    drop,
    engine,
    get LEVELS() { return LEVELS; },
    get sprites() { return sprites; },
    get themeId() { return themeId; },
  };
})();
