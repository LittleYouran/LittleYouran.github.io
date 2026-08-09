/**
 * hero.ts — 博客首页粒子角色动画主控（v2 全屏背景版）
 *
 * 双层结构：
 *   - 背景层（canvas）：亚克力磨砂背板 + 透明小方块粒子铺满整个屏幕，
 *     角色形状由粒子映照出来（马赛克像素风），固定不动，不跟随鼠标
 *   - 跟随层（DOM img）：透明小角色缩得很小，跟随鼠标移动（弹簧阻尼），
 *     鼠标停止 1.5s 或移出窗口就淡出，移动时留下夕阳红（红橙渐变）拖尾
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
interface Tile {
  x: number;
  y: number;
  size: number;
  color: string;
  alpha: number;
  targetAlpha: number;
  phase: number;
}

/** 拖尾轨迹点（屏幕坐标 + 时间戳） */
interface TrailPoint {
  x: number;
  y: number;
  t: number;
}

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

  /**
   * 把透明角色图 cover 铺满屏幕，按网格采样像素生成小方块。
   * 角色区域：彩色方块（半透明，保留原色）；背景区域：微弱暗色方块（亚克力网格感）。
   */
  function buildTiles() {
    tiles = [];
    if (!bgImage || W === 0 || H === 0) return;

    // cover 映射：角色图缩放铺满屏幕并居中
    const iw = bgImage.naturalWidth || 540;
    const ih = bgImage.naturalHeight || 540;
    const scale = Math.max(W / iw, H / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    const dx = (W - dw) / 2;
    const dy = (H - dh) / 2;

    // 离屏采样：把角色图按 cover 画好，逐格读像素
    const off = document.createElement('canvas');
    off.width = Math.max(1, Math.round(dw));
    off.height = Math.max(1, Math.round(dh));
    const octx = off.getContext('2d', { willReadFrequently: true });
    if (!octx) return;
    octx.drawImage(bgImage, 0, 0, off.width, off.height);
    const { data } = octx.getImageData(0, 0, off.width, off.height);

    const tileSize = grid * 0.82;
    for (let gy = 0; gy < H; gy += grid) {
      for (let gx = 0; gx < W; gx += grid) {
        // 采样格中心在离屏画布上的坐标
        const sx = Math.round((gx + grid / 2 - dx));
        const sy = Math.round((gy + grid / 2 - dy));
        const inRange = sx >= 0 && sy >= 0 && sx < off.width && sy < off.height;
        const i = inRange ? (sy * off.width + sx) * 4 : -1;
        const a = inRange ? data[i + 3] : 0;
        const r = inRange ? data[i] : 0;
        const g = inRange ? data[i + 1] : 0;
        const b = inRange ? data[i + 2] : 0;

        if (a > 40) {
          // 角色区域：彩色方块
          tiles.push({
            x: gx,
            y: gy,
            size: tileSize,
            color: `rgb(${r},${g},${b})`,
            alpha: 0,
            targetAlpha: 0.28 + (a / 255) * 0.55,
            phase: Math.random() * Math.PI * 2,
          });
        } else {
          // 背景区域：微弱暗色方块（亚克力网格）
          tiles.push({
            x: gx,
            y: gy,
            size: tileSize,
            color: 'rgb(150,140,180)',
            alpha: 0,
            targetAlpha: 0.05 + Math.random() * 0.04,
            phase: Math.random() * Math.PI * 2,
          });
        }
      }
    }
  }

  // ---------- 夕阳红拖尾 ----------
  const trailMs = opts.trailMs ?? 1100;
  const trail: TrailPoint[] = [];

  function drawTrail(now: number) {
    // 清理过期点
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

  // ---------- 状态机（简化版：淡入 -> 常驻背景 + 跟随） ----------
  let enterT = 0; // 入场时间（背景方块淡入）
  let raf = 0;
  let lastTs = 0;

  function loop(ts: number) {
    raf = requestAnimationFrame(loop);
    if (document.hidden) return;
    const now = performance.now();
    const dt = Math.min(ts - lastTs, 50);
    lastTs = ts;

    // 背景方块淡入
    enterT = Math.min(enterT + dt, 1200);
    const fadeIn = Math.min(1, enterT / 1200);
    const idle = Math.sin(now * 0.0006) * 0.02; // 整体呼吸
    for (const t of tiles) {
      t.alpha += (t.targetAlpha - t.alpha) * 0.045;
    }

    // 跟随层：弹簧阻尼
    const active = now - lastMove < 1500;
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

    // 背景方块（固定，不跟随鼠标）
    for (const t of tiles) {
      if (t.alpha <= 0.01) continue;
      const twinkle = 1 + Math.sin(now * 0.0008 + t.phase) * 0.08;
      ctx.globalAlpha = Math.min(1, t.alpha * fadeIn * twinkle + idle);
      ctx.fillStyle = t.color;
      ctx.fillRect(t.x, t.y, t.size, t.size);
    }

    // 夕阳红拖尾（画在背景之上）
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
