/**
 * hero.ts — 博客首页粒子角色动画主控
 *
 * 流程：SLIDE_IN（滑入）→ BURST（炸开）→ REASSEMBLE（重组）→ GIF_FADE_IN（GIF 淡入）→ FOLLOW（鼠标跟随）
 * 双层：canvas 背景粒子层（固定）+ GIF 角色层（跟随鼠标）
 */

import { SamplePoint, loadImage, sampleFromImage } from './sampler';
import { Particle, createParticle, springTo, floatBg } from './particle';
import { StateMachine } from './stateMachine';
import { MouseTrail } from './mouseTrail';

export interface HeroOptions {
  /** 采样图 URL（角色静态帧缩略图） */
  sampleSrc: string;
  /** 原 GIF URL（入场完成后淡入） */
  gifSrc: string;
  /** 目标粒子数量（默认 8000，弱设备自动减半） */
  maxParticles?: number;
}

export interface HeroController {
  destroy: () => void;
}

const prefersReducedMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const isWeakDevice = () =>
  (navigator.hardwareConcurrency ?? 8) <= 4 ||
  ((navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8) <= 4;

export function initHero(container: HTMLElement, opts: HeroOptions): HeroController {
  // ---------- DOM ----------
  const canvas = document.createElement('canvas');
  canvas.className = 'hero-canvas';
  container.appendChild(canvas);

  const gif = document.createElement('img');
  gif.className = 'hero-gif';
  gif.alt = '';
  gif.draggable = false;
  gif.style.opacity = '0';
  container.appendChild(gif);

  const ctx = canvas.getContext('2d')!;

  // ---------- 尺寸 ----------
  let width = 0;
  let height = 0;
  let dpr = 1;
  let cx = 0;
  let cy = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = container.clientWidth || window.innerWidth;
    height = container.clientHeight || window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = width / 2;
    cy = height / 2;
    trail.setAnchor(0, 0);
    trail.reset(0, 0);
    applyGifTransform();
  }

  // ---------- 状态 ----------
  const maxParticles = opts.maxParticles ?? 8000;
  const weak = isWeakDevice();
  const targetCount = weak ? Math.round(maxParticles / 2) : maxParticles;

  let roleParticles: Particle[] = [];
  let bgParticles: Particle[] = [];
  let roleCenterX = 0;
  let roleCenterY = 0;
  let gifSize = 0;

  const trail = new MouseTrail();

  // ---------- 工具 ----------
  const gifScreenPos = () => ({
    left: cx + trail.x - gifSize / 2,
    top: cy + trail.y - gifSize / 2,
  });

  function applyGifTransform() {
    const { left, top } = gifScreenPos();
    gif.style.transform = `translate(${left}px, ${top}px)`;
  }

  function createRoleParticles(points: SamplePoint[]): Particle[] {
    // 计算质心（角色中心）
    let sumX = 0;
    let sumY = 0;
    for (const p of points) {
      sumX += p.x;
      sumY += p.y;
    }
    const centroidX = sumX / points.length;
    const centroidY = sumY / points.length;

    // 采样图坐标 → 世界坐标比例
    const scale = gifSize / 270; // sample.png 是 270x270
    let maxDist = 1;
    const homes = points.map((p) => {
      const hx = (p.x - centroidX) * scale;
      const hy = (p.y - centroidY) * scale;
      maxDist = Math.max(maxDist, Math.hypot(hx, hy));
      return { hx, hy, r: p.r, g: p.g, b: p.b };
    });

    return homes.map((h) => {
      const dist = Math.hypot(h.hx, h.hy);
      const depth = 1 - dist / maxDist; // 0=边缘 1=中心
      const size = 0.6 + depth * 1.7 + Math.random() * 0.4;
      const delay = dist / maxDist * 520 + 80; // 离中心越远重组越慢
      // 初始在屏幕左侧外
      const x = -width / 2 - 120 - Math.random() * 200;
      const y = (Math.random() - 0.5) * height * 0.6;
      return createParticle({
        x,
        y,
        homeX: h.hx,
        homeY: h.hy,
        size,
        color: `rgb(${h.r},${h.g},${h.b})`,
        delay,
        layer: 'role',
      });
    });
  }

  function spawnBgParticles(from: Particle[]) {
    // 从入场粒子中保留一部分当背景光点（提亮、漂白）
    const keep = Math.max(8, Math.round(from.length * (weak ? 0.08 : 0.12)));
    const picked = [...from].sort(() => Math.random() - 0.5).slice(0, keep);
    bgParticles = picked.map((p) => {
      const spread = Math.min(width, height) * (0.2 + Math.random() * 0.3);
      const angle = Math.random() * Math.PI * 2;
      const rgb = p.color.match(/\d+/g)?.map(Number) ?? [];
      const r = rgb[0] ?? 255;
      const g = rgb[1] ?? 200;
      const b = rgb[2] ?? 220;
      return createParticle({
        x: p.x,
        y: p.y,
        homeX: Math.cos(angle) * spread,
        homeY: Math.sin(angle) * spread * 0.8,
        size: 0.8 + Math.random() * 1.6,
        color: `rgba(${Math.min(255, r + 60)},${Math.min(255, g + 50)},${Math.min(255, b + 40)})`,
        delay: 0,
        layer: 'bg',
      });
    });
  }

  function miniBurstBg() {
    // 快速划过彩蛋：背景光点向外爆一下再回位
    for (const p of bgParticles) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 6;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.arrived = false;
    }
    // 0.8s 后靠 floatBg 自然拉回
    setTimeout(() => {
      for (const p of bgParticles) p.arrived = false;
    }, 800);
  }

  // ---------- 状态机 ----------
  const sm = new StateMachine({
    SLIDE_IN: {
      enter() {
        // 初始：粒子已在左侧外（createRoleParticles 时设定）
      },
      update() {
        let arrived = 0;
        for (const p of roleParticles) {
          const waveDelay = (roleParticles.indexOf(p) % 12) * 30;
          if (sm.time < waveDelay) {
            // 未启动：保持初始速度缓慢漂移
            p.x += 1.2;
            continue;
          }
          if (springTo(p, roleCenterX + p.homeX, roleCenterY + p.homeY, 0.13, 0.8)) {
            p.arrived = true;
            arrived++;
          }
        }
        if (arrived / roleParticles.length > 0.95) sm.setState('BURST');
      },
    },
    BURST: {
      enter() {
        for (const p of roleParticles) {
          const dx = p.x - roleCenterX;
          const dy = p.y - roleCenterY;
          const dist = Math.hypot(dx, dy) || 1;
          const speed = 10 + Math.random() * 16;
          p.vx = (dx / dist) * speed;
          p.vy = (dy / dist) * speed;
          p.arrived = false;
        }
      },
      update() {
        for (const p of roleParticles) {
          p.vx *= 0.96;
          p.vy *= 0.96;
          p.x += p.vx;
          p.y += p.vy;
        }
        if (sm.time > 650) sm.setState('REASSEMBLE');
      },
    },
    REASSEMBLE: {
      update() {
        let arrived = 0;
        for (const p of roleParticles) {
          if (sm.time < p.delay) continue; // 离中心越远等待越久
          if (springTo(p, roleCenterX + p.homeX, roleCenterY + p.homeY, 0.085, 0.82, 0.8)) {
            p.arrived = true;
            arrived++;
          }
        }
        if (arrived / roleParticles.length > 0.95) sm.setState('GIF_FADE_IN');
      },
    },
    GIF_FADE_IN: {
      enter() {
        spawnBgParticles(roleParticles);
        for (const p of roleParticles) p.targetAlpha = 0;
        gif.style.display = 'block';
      },
      update() {
        const t = Math.min(1, sm.time / 1400);
        gif.style.opacity = String(t);
        for (const p of roleParticles) {
          p.alpha += (p.targetAlpha - p.alpha) * 0.06;
        }
        for (const p of bgParticles) floatBg(p, sm.time + performance.now());
        if (sm.time > 2200) sm.setState('FOLLOW');
      },
    },
    FOLLOW: {
      update() {
        const burst = trail.update(performance.now(), mouseX, mouseY, cx, cy);
        if (burst) miniBurstBg();
        for (const p of bgParticles) floatBg(p, performance.now());
        applyGifTransform();
      },
    },
  });

  // ---------- 鼠标 ----------
  let mouseX = 0;
  let mouseY = 0;
  const onMouseMove = (e: MouseEvent) => {
    const rect = container.getBoundingClientRect();
    mouseX = e.clientX - rect.left - cx;
    mouseY = e.clientY - rect.top - cy;
  };
  window.addEventListener('mousemove', onMouseMove, { passive: true });

  // ---------- 主循环 ----------
  let raf = 0;
  let lastTs = 0;
  function loop(ts: number) {
    raf = requestAnimationFrame(loop);
    if (document.hidden) return;
    const dt = Math.min(ts - lastTs, 50);
    lastTs = ts;

    if (sm.state !== 'FOLLOW') {
      sm.update(dt);
      // 非 FOLLOW 状态角色层不动（GIF 还没淡入，不用 transform）
    } else {
      sm.update(dt);
    }

    // 绘制
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.globalCompositeOperation = 'lighter';

    // 背景粒子（固定，浮动闪烁）
    for (const p of bgParticles) {
      const tw = 0.55 + 0.45 * Math.sin(performance.now() * 0.002 + p.phase);
      ctx.globalAlpha = p.alpha * tw * 0.55;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }

    // 角色粒子（入场阶段）
    for (const p of roleParticles) {
      if (p.alpha <= 0.01) continue;
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // ---------- 启动 ----------
  async function start() {
    gif.src = opts.gifSrc;
    await new Promise<void>((resolve) => {
      if (gif.complete) resolve();
      else gif.addEventListener('load', () => resolve(), { once: true });
    });

    // reduced-motion：直接显示 GIF，跳过动画
    if (prefersReducedMotion()) {
      gif.style.opacity = '1';
      return;
    }

    const sample = await loadImage(opts.sampleSrc);
    const points = sampleFromImage(sample, targetCount);

    resize();
    gifSize = Math.min(width, height) * 0.55;
    roleCenterX = 0;
    roleCenterY = height * 0.02;

    gif.style.width = `${gifSize}px`;
    gif.style.height = `${gifSize}px`;

    roleParticles = createRoleParticles(points);
    applyGifTransform();
    trail.setAnchor(0, height * 0.02);

    window.addEventListener('resize', resize);
    lastTs = performance.now();
    raf = requestAnimationFrame(loop);
  }

  start().catch((err) => {
    console.error('[hero] 初始化失败，降级为直接显示 GIF', err);
    gif.style.opacity = '1';
  });

  return {
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('resize', resize);
      container.removeChild(canvas);
      container.removeChild(gif);
    },
  };
}
