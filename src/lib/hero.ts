/**
 * hero.ts — 博客首页粒子角色动画主控（v3：开场动画 + 全屏粒子 + 完整角色）
 *
 * 双层结构：
 *   - 背景层（canvas）：亚克力磨砂背板 + 透明小方块粒子铺满整个屏幕，
 *     角色完整显示在 hero 上部（contain 不裁剪），由粒子映照出来（马赛克像素风）
 *   - 跟随层（DOM img）：透明小角色缩得很小，跟随鼠标移动（弹簧阻尼），
 *     鼠标停止 1.5s 或移出窗口就淡出，移动时留下夕阳红（红橙渐变）拖尾
 *
 * 开场动画（状态机）：
 *   ENTER（滑入）→ BURST（炸开）→ REASSEMBLE（重组显现）→ DONE（常驻）
 *   - 滑入：方块从屏幕左侧分批进入
 *   - 炸开：角色方块以质心为中心向外爆散
 *   - 重组：从中心向外一圈圈聚拢，"照射出人物"
 *
 * 适配：
 *   - 全屏铺满（100dvh），自适应比例
 *   - 手机端横屏适配：竖屏触屏设备显示"请横屏浏览"提示，横屏自动铺满
 *   - dpr 适配、页面隐藏暂停、弱设备粒子减半、prefers-reduced-motion 降级
 */

import { loadImage } from './sampler';

export interface HeroOptions {
  /** 背景采样图 URL（透明背景角色大图，用于粒子映照） */
  bgSrc: string;
  /** 跟随小角色图 URL（透明背景角色小图） */
  followSrc: string;
  /** 粒子网格步长 px（默认 12，弱设备自动加大） */
  gridSize?: number;
  /** 跟随小角色尺寸 px（默认 110） */
  followSize?: number;
  /** 夕阳红拖尾持续时间 ms（默认 1100） */
  trailMs?: number;
}

export interface HeroController {
  destroy: () => void;
}

const prefersReducedMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const isWeakDevice = () =>
  (navigator.hardwareConcurrency ?? 8) <= 4 ||
  ((navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8) <= 4;

/** 背景网格方块 */
type TileKind = 'role' | 'bg';

interface Tile {
  homeX: number;
  homeY: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  targetAlpha: number;
  phase: number;
  kind: TileKind;
  /** 滑入延迟 ms（按行波浪） */
  slideDelay: number;
  /** 重组延迟 ms（离中心越远越久） */
  delay: number;
  arrived: boolean;
}

/** 拖尾轨迹点（屏幕坐标 + 时间戳） */
interface TrailPoint {
  x: number;
  y: number;
  t: number;
}

type Phase = 'ENTER' | 'BURST' | 'REASSEMBLE' | 'DONE';

export function initHero(container: HTMLElement, opts: HeroOptions): HeroController {
  // ---------- DOM ----------
  const canvas = document.createElement('canvas');
  canvas.className = 'hero-canvas';
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;

  const follow = document.createElement('img');
  follow.className = 'hero-follow';
  follow.alt = '';
  follow.draggable = false;
  follow.src = opts.followSrc;
  follow.style.opacity = '0';
  container.appendChild(follow);

  const rotateTip = document.createElement('div');
  rotateTip.className = 'hero-rotate-tip';
  rotateTip.textContent = '请横屏浏览 ↻';
  rotateTip.style.display = 'none';
  container.appendChild(rotateTip);

  // ---------- 尺寸 ----------
  let W = 0;
  let H = 0;
  let dpr = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = container.clientWidth || window.innerWidth;
    H = container.clientHeight || window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildTiles();
    checkOrientation();
  }

  // ---------- 背景网格方块 ----------
  const grid = opts.gridSize ?? (isWeakDevice() ? 18 : 12);
  let tiles: Tile[] = [];
  let bgImage: HTMLImageElement | null = null;
  let roleCx = 0;
  let roleCy = 0;

  /**
   * 把透明角色图 contain 显示在 hero 上部（完整不裁剪），按网格采样像素生成小方块。
   * 角色区域：彩色方块（半透明，保留原色）；背景区域：微弱暗色方块（亚克力网格感）。
   * 初始位置在屏幕左侧外，供开场动画滑入。
   */
  function buildTiles() {
    const wasDone = phase === 'DONE';
    tiles = [];
    if (!bgImage || W === 0 || H === 0) return;

    // contain 映射：角色完整显示，高度占视口 55%，水平居中，偏上
    const iw = bgImage.naturalWidth || 540;
    const ih = bgImage.naturalHeight || 540;
    const targetH = H * 0.55;
    const scale = targetH / ih;
    const dw = iw * scale;
    const dh = ih * scale;
    const dx = (W - dw) / 2;
    const dy = H * 0.05;

    // 离屏采样：把角色图按 contain 画好，逐格读像素
    const off = document.createElement('canvas');
    off.width = Math.max(1, Math.round(dw));
    off.height = Math.max(1, Math.round(dh));
    const octx = off.getContext('2d', { willReadFrequently: true });
    if (!octx) return;
    octx.drawImage(bgImage, 0, 0, off.width, off.height);
    const { data } = octx.getImageData(0, 0, off.width, off.height);

    const tileSize = grid * 0.82;
    const rolePoints: { x: number; y: number }[] = [];
    for (let gy = 0; gy < H; gy += grid) {
      for (let gx = 0; gx < W; gx += grid) {
        // 采样格中心在离屏画布上的坐标
        const sx = Math.round(gx + grid / 2 - dx);
        const sy = Math.round(gy + grid / 2 - dy);
        const inRange = sx >= 0 && sy >= 0 && sx < off.width && sy < off.height;
        const i = inRange ? (sy * off.width + sx) * 4 : -1;
        const a = inRange ? data[i + 3] : 0;
        const r = inRange ? data[i] : 0;
        const g = inRange ? data[i + 1] : 0;
        const b = inRange ? data[i + 2] : 0;
        const kind: TileKind = a > 40 ? 'role' : 'bg';
        const slideDelay = (gy / grid) * 30 + Math.random() * 90;

        tiles.push({
          homeX: gx,
          homeY: gy,
          // 初始位置：屏幕左侧外（同高），供滑入
          x: -30 - Math.random() * 120,
          y: gy + (Math.random() - 0.5) * 30,
          vx: 0,
          vy: 0,
          size: tileSize,
          color: kind === 'role' ? `rgb(${r},${g},${b})` : 'rgb(150,140,180)',
          alpha: 0,
          targetAlpha: kind === 'role' ? 0.28 + (a / 255) * 0.55 : 0.05 + Math.random() * 0.04,
          phase: Math.random() * Math.PI * 2,
          kind,
          slideDelay,
          delay: 0,
          arrived: false,
        });
        if (kind === 'role') rolePoints.push({ x: gx, y: gy });
      }
    }

    // 角色质心 + 重组延迟（离中心越远越久，中心先聚"照射出人物"）
    let sumX = 0;
    let sumY = 0;
    for (const p of rolePoints) {
      sumX += p.x;
      sumY += p.y;
    }
    roleCx = rolePoints.length ? sumX / rolePoints.length : W / 2;
    roleCy = rolePoints.length ? sumY / rolePoints.length : H / 2;
    let maxDist = 1;
    for (const t of tiles) {
      const d = Math.hypot(t.homeX - roleCx, t.homeY - roleCy);
      maxDist = Math.max(maxDist, d);
    }
    for (const t of tiles) {
      const d = Math.hypot(t.homeX - roleCx, t.homeY - roleCy);
      t.delay = (d / maxDist) * 650 + 60;
    }

    // 已进入常驻状态后 resize：新方块直接到位，不重播开场动画
    if (wasDone) {
      for (const t of tiles) {
        t.x = t.homeX;
        t.y = t.homeY;
        t.alpha = t.targetAlpha;
        t.arrived = true;
      }
    }
  }

  // ---------- 夕阳红拖尾 ----------
  const trailMs = opts.trailMs ?? 1100;
  const trail: TrailPoint[] = [];

  function drawTrail(now: number) {
    while (trail.length && now - trail[0].t > trailMs) trail.shift();
    if (!trail.length) return;
    ctx.save();
    for (let k = 0; k < trail.length; k++) {
      const p = trail[k];
      const f = 1 - (now - p.t) / trailMs; // 0..1 新->旧
      if (f <= 0) continue;
      // 夕阳红渐变：深红 → 橙 → 金黄
      const hue = 8 + f * 38;
      const sat = 85 + f * 10;
      const lit = 48 + f * 18;
      ctx.globalAlpha = f * 0.5;
      ctx.fillStyle = `hsl(${hue},${sat}%,${lit}%)`;
      const s = 6 + f * 10;
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }
    ctx.restore();
  }

  // ---------- 跟随小角色 ----------
  const followSize = opts.followSize ?? 110;
  let followX = -999;
  let followY = -999;
  let vx = 0;
  let vy = 0;
  let mouseX = 0;
  let mouseY = 0;
  let lastMove = 0;
  let followAlpha = 0;

  follow.style.width = `${followSize}px`;
  follow.style.height = `${followSize}px`;

  function applyFollow() {
    follow.style.transform = `translate(${followX - followSize / 2}px, ${followY - followSize / 2}px)`;
    follow.style.opacity = String(followAlpha);
  }

  // ---------- 状态机 ----------
  let phase: Phase = 'ENTER';
  let phaseT = 0;

  function setPhase(p: Phase) {
    phase = p;
    phaseT = 0;
    if (p === 'BURST') {
      // 角色方块以质心为中心向外爆散
      for (const t of tiles) {
        if (t.kind !== 'role') continue;
        const dx = t.x - roleCx;
        const dy = t.y - roleCy;
        const d = Math.hypot(dx, dy) || 1;
        const speed = 8 + Math.random() * 14;
        t.vx = (dx / d) * speed;
        t.vy = (dy / d) * speed;
      }
    }
  }

  /** 弹簧阻尼移动到目标，返回是否到位 */
  function easeTo(t: Tile, tx: number, ty: number, stiff: number, damp: number, eps: number): boolean {
    t.vx += (tx - t.x) * stiff;
    t.vy += (ty - t.y) * stiff;
    t.vx *= damp;
    t.vy *= damp;
    t.x += t.vx;
    t.y += t.vy;
    return (
      Math.abs(t.x - tx) < eps &&
      Math.abs(t.y - ty) < eps &&
      Math.abs(t.vx) < 0.4 &&
      Math.abs(t.vy) < 0.4
    );
  }

  function updateTiles(dt: number) {
    phaseT += dt;

    if (phase === 'ENTER') {
      // 方块从左侧分批滑入目标位，alpha 渐显
      let arrivedAll = 0;
      let total = 0;
      for (const t of tiles) {
        total++;
        if (phaseT < t.slideDelay) continue;
        if (easeTo(t, t.homeX, t.homeY, 0.12, 0.78, 1.2)) {
          t.arrived = true;
          arrivedAll++;
        }
        t.alpha += (t.targetAlpha - t.alpha) * 0.08;
      }
      if (arrivedAll / total > 0.97) setPhase('BURST');
    } else if (phase === 'BURST') {
      // 爆散后自然衰减
      for (const t of tiles) {
        if (t.kind !== 'role') continue;
        t.vx *= 0.94;
        t.vy *= 0.94;
        t.x += t.vx;
        t.y += t.vy;
      }
      if (phaseT > 620) setPhase('REASSEMBLE');
    } else if (phase === 'REASSEMBLE') {
      // 从中心向外一圈圈聚拢，照射出人物
      let done = 0;
      let total = 0;
      for (const t of tiles) {
        if (t.kind !== 'role') continue;
        total++;
        if (phaseT < t.delay) continue;
        if (easeTo(t, t.homeX, t.homeY, 0.09, 0.82, 1.5)) done++;
        t.alpha += (t.targetAlpha - t.alpha) * 0.06;
      }
      if (done / total > 0.95) setPhase('DONE');
    } else {
      // DONE：常驻，alpha 缓慢到位，无位移（背景固定）
      for (const t of tiles) {
        t.alpha += (t.targetAlpha - t.alpha) * 0.04;
      }
    }
  }

  // ---------- 主循环 ----------
  let raf = 0;
  let lastTs = 0;

  function loop(ts: number) {
    raf = requestAnimationFrame(loop);
    if (document.hidden) return;
    const now = performance.now();
    const dt = Math.min(ts - lastTs, 50);
    lastTs = ts;

    updateTiles(dt);

    // 跟随层：开场动画结束后才出现
    const introDone = phase === 'DONE';
    const active = introDone && now - lastMove < 1500;
    const targetX = active ? mouseX : followX;
    const targetY = active ? mouseY : followY;
    vx += (targetX - followX) * 0.14;
    vy += (targetY - followY) * 0.14;
    vx *= 0.8;
    vy *= 0.8;
    followX += vx;
    followY += vy;
    followAlpha += ((active ? 1 : 0) - followAlpha) * 0.08;
    applyFollow();

    // 移动时记录拖尾
    if (active && Math.hypot(vx, vy) > 0.4) {
      trail.push({ x: followX, y: followY, t: now });
    }

    // ---------- 绘制 ----------
    ctx.clearRect(0, 0, W, H);
    for (const t of tiles) {
      if (t.alpha <= 0.01) continue;
      const twinkle = 1 + Math.sin(now * 0.0008 + t.phase) * 0.08;
      ctx.globalAlpha = Math.min(1, t.alpha * twinkle);
      ctx.fillStyle = t.color;
      ctx.fillRect(t.x, t.y, t.size, t.size);
    }
    drawTrail(now);
    ctx.globalAlpha = 1;
  }

  // ---------- 鼠标 / 触摸 ----------
  const onMove = (clientX: number, clientY: number) => {
    const rect = container.getBoundingClientRect();
    mouseX = clientX - rect.left;
    mouseY = clientY - rect.top;
    lastMove = performance.now();
  };
  const onMouseMove = (e: MouseEvent) => onMove(e.clientX, e.clientY);
  const onTouchMove = (e: TouchEvent) => {
    if (e.touches[0]) onMove(e.touches[0].clientX, e.touches[0].clientY);
  };
  const onMouseLeave = () => {
    lastMove = 0;
  };
  window.addEventListener('mousemove', onMouseMove, { passive: true });
  window.addEventListener('touchmove', onTouchMove, { passive: true });
  container.addEventListener('mouseleave', onMouseLeave);

  // ---------- 手机横屏提示 ----------
  function checkOrientation() {
    const portrait = matchMedia('(orientation: portrait)').matches;
    const touch = matchMedia('(pointer: coarse)').matches;
    rotateTip.style.display = portrait && touch ? 'flex' : 'none';
  }
  window.addEventListener('resize', resize);

  // ---------- 启动 ----------
  async function start() {
    // reduced-motion：直接显示静态背景图，跳过粒子动画
    if (prefersReducedMotion()) {
      const staticImg = document.createElement('img');
      staticImg.className = 'hero-fallback';
      staticImg.alt = '';
      staticImg.src = opts.bgSrc;
      container.appendChild(staticImg);
      rotateTip.style.display = 'none';
      return;
    }

    bgImage = await loadImage(opts.bgSrc);
    resize();

    followX = W / 2;
    followY = H * 0.5;
    mouseX = W / 2;
    mouseY = H * 0.5;
    lastMove = performance.now();

    lastTs = performance.now();
    raf = requestAnimationFrame(loop);
  }

  start().catch((err) => {
    console.error('[hero] 初始化失败，降级为直接显示背景图', err);
    const staticImg = document.createElement('img');
    staticImg.className = 'hero-fallback';
    staticImg.alt = '';
    staticImg.src = opts.bgSrc;
    container.appendChild(staticImg);
  });

  return {
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('resize', resize);
      container.removeEventListener('mouseleave', onMouseLeave);
      container.removeChild(canvas);
      container.removeChild(follow);
      container.removeChild(rotateTip);
    },
  };
}
