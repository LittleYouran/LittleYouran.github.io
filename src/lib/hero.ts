/**
 * hero.ts — 博客首页粒子角色动画主控 v4
 *
 * 流程：CHARGE（左→右冲刺，GIF 播放）→ CRASH（撞右墙破碎）→ WAVE（波浪从右往左扫过，背景贴纸墙显现）→ SETTLE（常驻）
 *
 * 层结构：
 *   .hero-bg      背景贴纸墙（亚克力背板 + 15 张贴纸，clip-path 波浪控制显现）
 *   canvas        粒子层（爆炸方块 + 背景方块 + 夕阳红拖尾）
 *   .hero-runner  入场大 GIF（从左冲向右，撞墙后消失）
 *   .hero-follow  跟随小 GIF（缩小版，鼠标跟随 + 拖尾，静止/移出消失）
 */

import { Particle, createParticle, springTo, floatBg } from './particle';
import { StateMachine } from './stateMachine';

export interface HeroOptions {
  /** 格里德利 GIF URL（入场大角色 + 跟随小角色用同一张） */
  gifSrc: string;
  /** 贴纸墙 URL 数组（已抠图的透明 PNG，15 张） */
  stickers: string[];
  /** 目标粒子数量（默认 7000，弱设备自动减半） */
  maxParticles?: number;
  /** 跟随小角色尺寸 px（默认 90，缩得很小但要看得清） */
  followSize?: number;
}

export interface HeroController {
  destroy: () => void;
}

const prefersReducedMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const isWeakDevice = () =>
  (navigator.hardwareConcurrency ?? 8) <= 4 ||
  ((navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8) <= 4;

/** 夕阳红渐变调色板（拖尾用）：深红 → 橙 → 金黄 */
const SUNSET_COLORS = [
  '255, 60, 40',
  '255, 92, 40',
  '255, 128, 50',
  '255, 168, 66',
  '255, 200, 90',
];

export function initHero(container: HTMLElement, opts: HeroOptions): HeroController {
  // ---------- DOM ----------
  const bg = document.createElement('div');
  bg.className = 'hero-bg';
  container.appendChild(bg);

  const canvas = document.createElement('canvas');
  canvas.className = 'hero-canvas';
  container.appendChild(canvas);

  const runner = document.createElement('img');
  runner.className = 'hero-runner';
  runner.alt = '';
  runner.draggable = false;
  container.appendChild(runner);

  const follow = document.createElement('img');
  follow.className = 'hero-follow';
  follow.alt = '';
  follow.draggable = false;
  follow.style.opacity = '0';
  container.appendChild(follow);

  const ctx = canvas.getContext('2d')!;

  // ---------- 贴纸墙 ----------
  const stickerEls: HTMLImageElement[] = [];
  for (const src of opts.stickers) {
    const img = document.createElement('img');
    img.className = 'hero-sticker';
    img.src = src;
    img.alt = '';
    img.draggable = false;
    bg.appendChild(img);
    stickerEls.push(img);
  }

  // 亚克力板覆盖层（磨砂玻璃质感，贴纸有在它上面有在它下面）
  const acrylic = document.createElement('div');
  acrylic.className = 'hero-acrylic';
  bg.appendChild(acrylic);

  // ---------- 尺寸 ----------
  let width = 0;
  let height = 0;
  let dpr = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = container.clientWidth || window.innerWidth;
    height = container.clientHeight || window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    layoutStickers();
  }

  // ---------- 贴纸布局 ----------
  function layoutStickers() {
    const n = stickerEls.length;
    for (let i = 0; i < n; i++) {
      const img = stickerEls[i];
      const size = Math.min(width, height) * (0.14 + Math.random() * 0.12); // 14% ~ 26% 视口
      const x = Math.random() * (width - size);
      const y = Math.random() * (height - size);
      const rot = (Math.random() - 0.5) * 24; // -12° ~ 12°
      const z = Math.random() > 0.45 ? 3 : 1; // 部分在亚克力之上，部分在之下
      img.style.cssText = `left:${x}px;top:${y}px;width:${size}px;height:auto;z-index:${z};transform:rotate(${rot}deg);opacity:0;`;
    }
  }

  // ---------- 状态 ----------
  const maxParticles = opts.maxParticles ?? 7000;
  const weak = isWeakDevice();
  const followSize = opts.followSize ?? 90;
  const bgCount = weak ? 900 : 1700;

  let boomParticles: Particle[] = [];
  let bgParticles: Particle[] = [];
  let trailParticles: { x: number; y: number; vx: number; vy: number; life: number; max: number; c: string }[] = [];
  let crashX = 0;
  let crashY = 0;
  let runnerSize = 0;
  let waveEdge = 100; // 背景 clip-path 右边界 %（100 → 0）

  // 鼠标状态
  let mouseX = 0;
  let mouseY = 0;
  let mouseActive = false;
  let lastMove = 0;
  let followX = 0;
  let followY = 0;
  let followVX = 0;
  let followVY = 0;
  let followVisible = false;

  // ---------- 工具 ----------
  function setWaveClip(edgePct: number) {
    // 波浪形 clip-path：保留区域 = 波浪线 → 右边缘，波浪线从 100% 往左扫到 0%（展现从右往左）
    const pts: string[] = [];
    const steps = 14;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const y = 100 - t * 100; // 从底到顶
      const wobble = Math.sin(t * Math.PI * 3 + performance.now() * 0.003) * 3;
      pts.push(`${(edgePct + wobble).toFixed(2)}% ${y.toFixed(2)}%`);
    }
    bg.style.clipPath = `polygon(100% 0%, 100% 100%, 0% 100%, ${pts.join(', ')}, 0% 0%)`;
  }

  function setStickerOpacity(opacity: number) {
    for (const img of stickerEls) img.style.opacity = String(opacity);
  }

  function spawnBoom(x: number, y: number) {
    const colors = ['255,120,60', '255,180,80', '255,90,120', '255,220,140', '180,120,255', '120,200,255'];
    boomParticles = [];
    const count = weak ? 70 : 120;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 14;
      const size = 2 + Math.random() * 5;
      boomParticles.push(
        createParticle({
          x,
          y,
          homeX: Math.cos(angle) * (60 + Math.random() * 160),
          homeY: Math.sin(angle) * (60 + Math.random() * 160),
          size,
          color: `rgb(${colors[i % colors.length]})`,
          delay: 0,
          layer: 'bg',
        }),
      );
      const p = boomParticles[boomParticles.length - 1];
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed - 3;
      p.phase = Math.random() * Math.PI * 2;
    }
  }

  function spawnBgParticles() {
    bgParticles = [];
    for (let i = 0; i < bgCount; i++) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      bgParticles.push(
        createParticle({
          x,
          y,
          homeX: x,
          homeY: y,
          size: 1.5 + Math.random() * 2.5,
          color: `rgba(255,235,255,${0.25 + Math.random() * 0.35})`,
          delay: 0,
          layer: 'bg',
        }),
      );
    }
  }

  function spawnTrail(x: number, y: number) {
    if (trailParticles.length > 260) trailParticles.splice(0, trailParticles.length - 260);
    const c = SUNSET_COLORS[Math.floor(Math.random() * SUNSET_COLORS.length)];
    trailParticles.push({
      x: x + (Math.random() - 0.5) * followSize * 0.6,
      y: y + (Math.random() - 0.5) * followSize * 0.6,
      vx: (Math.random() - 0.5) * 0.8,
      vy: (Math.random() - 0.5) * 0.8,
      life: 1,
      max: 1,
      c,
    });
  }

  // ---------- 状态机 ----------
  const sm = new StateMachine({
    CHARGE: {
      enter() {
        runner.style.opacity = '1';
        runner.style.width = `${runnerSize}px`;
        runner.style.height = `${runnerSize}px`;
        runner.style.transform = `translate(${-runnerSize}px, ${height / 2 - runnerSize / 2}px)`;
        // 初始完全隐藏背景（贴纸墙等待波浪显现）
        setWaveClip(100);
        setStickerOpacity(0);
        bg.style.opacity = '0';
      },
      update() {
        const t = Math.min(1, sm.time / 950); // 加速冲向右
        const ease = t * t * t; // easeIn cubic
        const x = -runnerSize + (width - runnerSize * 0.4) * ease;
        runner.style.transform = `translate(${x}px, ${height / 2 - runnerSize / 2}px)`;
        if (t >= 1) {
          crashX = width - runnerSize * 0.4 + runnerSize / 2;
          crashY = height / 2;
          sm.setState('CRASH');
        }
      },
    },
    CRASH: {
      enter() {
        // 撞墙：隐藏入场角色，粒子破碎
        runner.style.opacity = '0';
        spawnBoom(crashX, crashY);
      },
      update() {
        let alive = 0;
        for (const p of boomParticles) {
          p.vx *= 0.955;
          p.vy = p.vy * 0.955 + 0.12; // 轻微重力
          p.x += p.vx;
          p.y += p.vy;
          p.alpha *= 0.985;
          if (p.alpha > 0.03) alive++;
        }
        if (sm.time > 550) sm.setState('WAVE');
      },
    },
    WAVE: {
      enter() {
        // 背景开始显现：从右往左波浪扫过
        bg.style.opacity = '1';
      },
      update() {
        const t = Math.min(1, sm.time / 1700);
        waveEdge = 100 - t * 100;
        setWaveClip(waveEdge);
        setStickerOpacity(Math.min(1, t * 1.3));
        // 爆炸粒子继续飞散渐隐
        for (const p of boomParticles) {
          p.x += p.vx;
          p.y += p.vy;
          p.alpha *= 0.97;
        }
        if (t >= 1) sm.setState('SETTLE');
      },
    },
    SETTLE: {
      enter() {
        bg.style.clipPath = 'none';
        setStickerOpacity(1);
        boomParticles = [];
        spawnBgParticles();
        // 跟随小角色淡入
        follow.style.width = `${followSize}px`;
        follow.style.height = `${followSize}px`;
        followX = width / 2;
        followY = height / 2;
        followVisible = true;
        follow.style.opacity = '1';
        // 入场角色移除
        runner.style.display = 'none';
      },
      update() {
        // 鼠标跟随（弹簧阻尼）
        if (mouseActive) {
          const targetX = mouseX - followSize / 2;
          const targetY = mouseY - followSize / 2;
          followVX += (targetX - followX) * 0.09;
          followVY += (targetY - followY) * 0.09;
          followVX *= 0.82;
          followVY *= 0.82;
          followX += followVX;
          followY += followVY;
          follow.style.transform = `translate(${followX}px, ${followY}px)`;

          // 拖尾（移动时才有）
          if (performance.now() - lastMove < 600) {
            spawnTrail(followX + followSize / 2, followY + followSize / 2);
          }
        }
        // 鼠标静止/移出窗口 → 小角色淡出
        if (performance.now() - lastMove > 1600 || !mouseActive) {
          if (followVisible) {
            followVisible = false;
            follow.style.opacity = '0';
          }
        } else if (!followVisible && mouseActive) {
          followVisible = true;
          follow.style.opacity = '1';
        }
        // 背景粒子浮动
        const now = performance.now();
        for (const p of bgParticles) floatBg(p, now, 3);
        // 拖尾更新
        for (const tp of trailParticles) {
          tp.x += tp.vx;
          tp.y += tp.vy;
          tp.vx *= 0.96;
          tp.vy *= 0.96;
          tp.life -= 0.016;
        }
        trailParticles = trailParticles.filter((tp) => tp.life > 0);
      },
    },
  });

  // ---------- 鼠标 ----------
  const onMouseMove = (e: MouseEvent) => {
    const rect = container.getBoundingClientRect();
    mouseX = e.clientX - rect.left;
    mouseY = e.clientY - rect.top;
    mouseActive = true;
    lastMove = performance.now();
  };
  const onMouseLeave = () => {
    mouseActive = false;
    lastMove = 0;
  };
  window.addEventListener('mousemove', onMouseMove, { passive: true });
  container.addEventListener('mouseleave', onMouseLeave);

  // ---------- 绘制 ----------
  function drawBoom() {
    for (const p of boomParticles) {
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
  }

  function drawBg() {
    const now = performance.now();
    for (const p of bgParticles) {
      const tw = 0.5 + 0.5 * Math.sin(now * 0.0015 + p.phase);
      ctx.globalAlpha = p.alpha * tw * 0.5;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
  }

  function drawTrail() {
    for (const tp of trailParticles) {
      const a = tp.life * 0.85;
      const size = followSize * 0.045 * tp.life;
      ctx.globalAlpha = a;
      ctx.fillStyle = `rgb(${tp.c})`;
      ctx.fillRect(tp.x - size / 2, tp.y - size / 2, size, size);
    }
  }

  // ---------- 主循环 ----------
  let raf = 0;
  let lastTs = 0;
  function loop(ts: number) {
    raf = requestAnimationFrame(loop);
    if (document.hidden) return;
    const dt = Math.min(ts - lastTs, 50);
    lastTs = ts;

    sm.update(dt);

    // 绘制
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    drawBoom();
    drawBg();
    drawTrail();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // ---------- 启动 ----------
  async function start() {
    runner.src = opts.gifSrc;
    follow.src = opts.gifSrc;
    await new Promise<void>((resolve) => {
      if (runner.complete) resolve();
      else runner.addEventListener('load', () => resolve(), { once: true });
    });

    resize();
    runnerSize = Math.min(width, height) * 0.3;
    layoutStickers();

    // reduced-motion：直接显示背景贴纸墙 + 小角色，跳过动画
    if (prefersReducedMotion()) {
      bg.style.opacity = '1';
      bg.style.clipPath = 'none';
      setStickerOpacity(1);
      spawnBgParticles();
      follow.style.display = 'block';
      follow.style.width = `${followSize}px`;
      follow.style.height = `${followSize}px`;
      follow.style.opacity = '1';
      runner.style.display = 'none';
      lastTs = performance.now();
      raf = requestAnimationFrame(loop);
      return;
    }

    window.addEventListener('resize', resize);
    lastTs = performance.now();
    raf = requestAnimationFrame(loop);
  }

  start().catch((err) => {
    console.error('[hero] 初始化失败，降级为直接显示贴纸墙', err);
    bg.style.opacity = '1';
    bg.style.clipPath = 'none';
    setStickerOpacity(1);
    follow.style.opacity = '1';
    follow.style.width = `${followSize}px`;
    follow.style.height = `${followSize}px`;
    runner.style.display = 'none';
  });

  return {
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener('mousemove', onMouseMove);
      container.removeEventListener('mouseleave', onMouseLeave);
      window.removeEventListener('resize', resize);
      container.removeChild(bg);
      container.removeChild(canvas);
      container.removeChild(runner);
      container.removeChild(follow);
    },
  };
}
