/**
 * hero.ts — 博客首页粒子角色动画主控 v5
 *
 * 入场流程（用户定制版）：
 *   BOOT（空屏）→ CHARGE（格里德利从左/中向右冲刺，GIF 播放）
 *   → CRASH（撞右墙，粒子向右释放 + 向左扩散到 3/10 处）
 *   → TSUNAMI（海啸式椭圆波浪从右往左滚动，扫过处铺亚克力背板）
 *   → WAVE2（第二次波浪从右往左，扫过处铺贴纸图片）
 *   → WAVE3（第三次收尾波浪）
 *   → TITLE（全部映射完成后标题浮现）→ SETTLE（常驻：背景粒子 + 鼠标跟随）
 *
 * 层结构（页面背景 fixed 铺满全屏，内容在正常流中滚动）：
 *   .hero-bg        背景容器（贴纸墙 + 亚克力背板，两个子层各自 clip-path 控制波浪显现）
 *   canvas          粒子层（爆炸方块 + 背景浮动方块 + 夕阳红拖尾）
 *   .hero-runner    入场大 GIF（从中间冲向右，撞墙后消失）
 *   .hero-follow    跟随小 GIF（鼠标跟随 + 拖尾，静止/移出消失）
 *   .hero-title     大标题（文字图 + 翘腿角色装饰，入场完成后由 onTitleReady 通知显示）
 */

import { Particle, createParticle, springTo, floatBg } from './particle';
import { StateMachine } from './stateMachine';

export interface HeroOptions {
  /** 格里德利 GIF URL（入场大角色用） */
  gifSrc: string;
  /** 格里德利小 GIF URL（鼠标跟随用） */
  followGifSrc?: string;
  /** 贴纸墙 URL 数组（已抠图的透明 PNG） */
  stickers: string[];
  /** 标题文字图 URL（大标题，如"直到大地变成一颗酸橙"） */
  titleSrc?: string;
  /** 标题装饰角色图 URL（翘腿角色，放在标题上面） */
  titleDecoSrc?: string;
  /** 目标粒子数量（默认 7000，弱设备自动减半） */
  maxParticles?: number;
  /** 跟随小角色尺寸 px（默认 96，缩得很小但要看得清） */
  followSize?: number;
  /** 入场完成后回调（页面据此显示标题/隐藏加载态） */
  onTitleReady?: () => void;
}

export interface HeroController {
  destroy: () => void;
}

const prefersReducedMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const isWeakDevice = () =>
  (navigator.hardwareConcurrency ?? 8) <= 4 ||
  ((navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8) <= 4;

/** 夕阳红渐变调色板（拖尾/爆炸用）：深红 → 橙 → 金黄 */
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

  // 亚克力背板层（先铺）
  const acrylic = document.createElement('div');
  acrylic.className = 'hero-acrylic';
  bg.appendChild(acrylic);

  // 贴纸墙层（后铺）
  const stickerLayer = document.createElement('div');
  stickerLayer.className = 'hero-sticker-layer';
  bg.appendChild(stickerLayer);

  const wave = document.createElement('div');
  wave.className = 'hero-reveal-wave';
  bg.appendChild(wave);

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

  // 大标题容器（内容流之外由页面控制，这里只负责入场完成时通知）
  let titleEl: HTMLDivElement | null = null;
  if (opts.titleSrc) {
    titleEl = document.createElement('div');
    titleEl.className = 'hero-title';
    titleEl.style.opacity = '0';
    titleEl.style.visibility = 'hidden';
    if (opts.titleDecoSrc) {
      const deco = document.createElement('img');
      deco.className = 'hero-title-deco';
      deco.src = opts.titleDecoSrc;
      deco.alt = '';
      deco.draggable = false;
      titleEl.appendChild(deco);
    }
    const titleImg = document.createElement('img');
    titleImg.className = 'hero-title-img';
    titleImg.src = opts.titleSrc;
    titleImg.alt = '';
    titleImg.draggable = false;
    titleEl.appendChild(titleImg);
    container.appendChild(titleEl);
  }

  const ctx = canvas.getContext('2d')!;

  // ---------- 贴纸墙 ----------
  const stickerEls: HTMLImageElement[] = [];
  for (const src of opts.stickers) {
    const img = document.createElement('img');
      img.className = 'hero-sticker hero-sticker--single';
    img.src = src;
    img.alt = '';
    img.draggable = false;
    stickerLayer.appendChild(img);
    stickerEls.push(img);
  }

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
  // Stable grid layout keeps every character readable and away from the title.
  function layoutStickers() {
    const n = stickerEls.length;
    const cols = width > height ? 6 : 4;
    const rows = Math.ceil(n / cols);
    const cellW = width / cols;
    const cellH = height / rows;
    for (let i = 0; i < n; i++) {
      const img = stickerEls[i];
      // 固定网格加小幅抖动，避免角色堆在标题附近。
      const gx = i % cols;
      const gy = Math.floor(i / cols);
      const phase = (i * 2.399963229728653) % 1;
      const jx = (phase - 0.5) * cellW * 0.18;
      const jy = (((i * 7) % 11) / 10 - 0.5) * cellH * 0.14;
      const size = Math.min(width, height) * 0.19;
      const x = width * 0.77 - size / 2 + jx;
      const y = height * 0.62 - size / 2 + jy;
      // 中央标题区留白，角色向四周排，不再挤成一团。
      const centerX = x + size / 2;
      const centerY = y + size / 2;
      const inTitleSafeZone = false;
      const spreadX = inTitleSafeZone ? (centerX < width / 2 ? -cellW * 0.62 : cellW * 0.62) : 0;
      const spreadY = inTitleSafeZone ? (centerY < height / 2 ? -cellH * 0.38 : cellH * 0.38) : 0;
      const rot = ((i * 11) % 17) - 8;
      const z = i % 3 === 0 ? 12 : 8;
      // Source image 15 remains the right-side accent after sticker-3 is removed.
      img.style.cssText = `left:${x + spreadX}px;top:${y + spreadY}px;width:${size}px;height:auto;z-index:${z};transform:rotate(-5deg);opacity:0;`;
    }
  }

  // ---------- 状态 ----------
  const maxParticles = opts.maxParticles ?? 7000;
  const weak = isWeakDevice();
  const followSize = opts.followSize ?? 96;
  const bgCount = weak ? 900 : 1700;

  let boomParticles: Particle[] = [];
  let bgParticles: Particle[] = [];
  let trailParticles: { x: number; y: number; vx: number; vy: number; life: number; max: number; c: string }[] = [];
  let crashX = 0;
  let crashY = 0;
  let runnerSize = 0;

  // 鼠标状态
  let mouseX = 0;
  let mouseY = 0;
  let mouseActive = false;
  let lastMove = 0;
  let followX = 0;
  let followY = 0;
  let followVX = 0;
  let followVY = 0;
  let followAngle = 0;
  let followVisible = false;

  // ---------- 波浪工具 ----------
  /** 椭圆波浪 clip-path：中心 cx（0~100%）从左往右移动，扫过区域显示 */
  function setEllipseClip(el: HTMLElement, cxPct: number, ryPct: number, rxPct = 60) {
    el.style.clipPath = `ellipse(${rxPct}% ${ryPct}% at ${cxPct}% 50%)`;
  }
  function clearClip(el: HTMLElement) {
    el.style.clipPath = 'none';
  }
  /** Cumulative right-to-left reveal with a softly undulating leading edge. */
  function setWaveClip(el: HTMLElement, edgePct: number) {
    const pts: string[] = [];
    const steps = 20;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const y = 100 - t * 100;
      const wobble = Math.sin(t * Math.PI * 2.4 + performance.now() * 0.004) * 2.6;
      pts.push(`${(edgePct + wobble).toFixed(2)}% ${y.toFixed(2)}%`);
    }
    el.style.clipPath = `polygon(100% 0%, 100% 100%, ${pts.join(', ')})`;
  }

  function positionWave(edgePct: number, opacity: number) {
    wave.style.opacity = String(opacity);
    wave.style.transform = `translate3d(calc(${edgePct}vw - 50%), -50%, 0)`;
  }

  function setStickerOpacity(opacity: number) {
    for (const img of stickerEls) img.style.opacity = String(opacity);
  }

  // ---------- 粒子生成 ----------
  function spawnBoom(x: number, y: number) {
    const colors = ['255,120,60', '255,180,80', '255,90,120', '255,220,140', '180,120,255', '120,200,255'];
    boomParticles = [];
    const count = weak ? 125 : 210;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 16;
      const size = 2 + Math.random() * 6;
      boomParticles.push(
        createParticle({
          x,
          y,
          homeX: Math.cos(angle) * (60 + Math.random() * 220),
          homeY: Math.sin(angle) * (60 + Math.random() * 220),
          size,
          color: `rgb(${colors[i % colors.length]})`,
          delay: 0,
          layer: 'bg',
        }),
      );
      const p = boomParticles[boomParticles.length - 1];
      // 主体向右释放 + 部分向左扩散
      const dir = Math.random() < 0.62 ? 1 : -1;
      p.vx = dir * Math.abs(Math.cos(angle)) * speed * (dir > 0 ? 1 : 0.55);
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
    BOOT: {
      enter() {
        // 空屏：什么都不展现
        setStickerOpacity(0);
        clearClip(acrylic);
        clearClip(stickerLayer);
        acrylic.style.opacity = '0';
        stickerLayer.style.opacity = '0';
        wave.style.opacity = '0';
        bg.style.opacity = '0';
        runner.style.opacity = '0';
        follow.style.opacity = '0';
      },
      update() {
        // v6: 图片已预加载完，立即进入冲刺，不等
        if (sm.time > 0) sm.setState('CHARGE');
      },
    },
    CHARGE: {
      enter() {
        // 入场角色从中间偏左立刻向右冲刺。
        runner.style.width = `${runnerSize}px`;
        runner.style.height = `${runnerSize}px`;
        runner.style.opacity = '1';
        runner.style.transform = `translate(${width * 0.25 - runnerSize / 2}px, ${height / 2 - runnerSize / 2}px)`;
      },
      update() {
        const t = Math.min(1, sm.time / 760);
        const ease = t * t * t;
        const x = width * 0.25 - runnerSize / 2 + (width * 0.75) * ease;
        runner.style.transform = `translate(${x}px, ${height / 2 - runnerSize / 2}px)`;
        if (t >= 1) {
          crashX = width - runnerSize * 0.45;
          crashY = height / 2;
          sm.setState('CRASH');
        }
      },
    },
    CRASH: {
      enter() {
        runner.style.opacity = '0';
        spawnBoom(crashX, crashY);
        // The impact reveals only the neutral base. Acrylic arrives with wave one.
        bg.style.opacity = '1';
      },
      update() {
        let alive = 0;
        for (const p of boomParticles) {
          p.vx *= 0.955;
          p.vy = p.vy * 0.955 + 0.12;
          p.x += p.vx;
          p.y += p.vy;
          p.alpha *= 0.988;
          if (p.alpha > 0.03) alive++;
        }
        if (sm.time > 620) sm.setState('TSUNAMI');
      },
    },
    TSUNAMI: {
      enter() {
        acrylic.style.opacity = '1';
        setWaveClip(acrylic, 104);
      },
      update() {
        const t = Math.min(1, sm.time / 920);
        const edge = 104 - t * 110;
        setWaveClip(acrylic, edge);
        positionWave(edge, Math.sin(t * Math.PI) * 0.9);
        // 爆炸粒子继续飞散
        for (const p of boomParticles) {
          p.x += p.vx;
          p.y += p.vy;
          p.alpha *= 0.975;
        }
        if (t >= 1) {
          clearClip(acrylic);
          wave.style.opacity = '0';
          sm.setState('WAVE2');
        }
      },
    },
    WAVE2: {
      enter() {
        // 第二次波浪：从右往左铺贴纸
        stickerLayer.style.opacity = '1';
      },
      update() {
        const t = Math.min(1, sm.time / 980);
        const edge = 104 - t * 110;
        setWaveClip(stickerLayer, edge);
        positionWave(edge, Math.sin(t * Math.PI) * 0.72);
        setStickerOpacity(Math.min(1, t * 1.5));
        for (const p of boomParticles) {
          p.x += p.vx;
          p.y += p.vy;
          p.alpha *= 0.97;
        }
        if (t >= 1) {
          clearClip(stickerLayer);
          wave.style.opacity = '0';
          setStickerOpacity(1);
          sm.setState('WAVE3');
        }
      },
    },
    WAVE3: {
      enter() {
        // 收尾波浪：整体再扫一次
      },
      update() {
        const t = Math.min(1, sm.time / 900);
        // 不裁切 bg 本身，否则会把未铺满的区域变成黑色。
        // 这一段只让残余粒子自然消散，背板和贴纸已经完整显示。
        for (const p of boomParticles) {
          p.x += p.vx;
          p.y += p.vy;
          p.alpha *= 0.96;
        }
        if (t >= 1) {
          clearClip(bg);
          sm.setState('TITLE');
        }
      },
    },
    TITLE: {
      enter() {
        boomParticles = [];
        spawnBgParticles();
        // 标题浮现
        if (titleEl) {
          titleEl.style.visibility = 'visible';
          titleEl.style.transition = 'opacity 0.9s ease';
          titleEl.style.opacity = '1';
        }
        opts.onTitleReady?.();
        // 跟随小角色准备
        follow.style.width = `${followSize}px`;
        follow.style.height = `${followSize}px`;
        followX = width / 2;
        followY = height / 2;
        followVisible = false;
        runner.style.display = 'none';
        sm.setState('SETTLE');
      },
      update() {
        // 直接进入常驻
      },
    },
    SETTLE: {
      enter() {},
      update() {
        if (mouseActive) {
          const targetX = mouseX - followSize / 2;
          const targetY = mouseY - followSize / 2;
          // Critically damped-ish spring: responsive without visible jitter.
          followVX += (targetX - followX) * 0.31;
          followVY += (targetY - followY) * 0.31;
          followVX *= 0.68;
          followVY *= 0.68;
          followX += followVX;
          followY += followVY;
          const speed = Math.hypot(followVX, followVY);
          if (speed > 0.12) {
            const targetAngle = Math.atan2(followVY, followVX) * 180 / Math.PI;
            let delta = targetAngle - followAngle;
            delta = ((delta + 180) % 360) - 180;
            followAngle += delta * 0.18;
          }
          follow.style.transform = `translate(${followX}px, ${followY}px) rotate(${followAngle.toFixed(2)}deg)`;
          if (performance.now() - lastMove < 600) {
            spawnTrail(followX + followSize / 2, followY + followSize / 2);
          }
        }
        if (performance.now() - lastMove > 1600 || !mouseActive) {
          if (followVisible) {
            followVisible = false;
            follow.style.opacity = '0';
          }
        } else if (!followVisible && mouseActive) {
          followVisible = true;
          follow.style.opacity = '1';
        }
        const now = performance.now();
        for (const p of bgParticles) floatBg(p, now, 3);
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

    ctx.clearRect(0, 0, width, height);
    ctx.save();
    drawBoom();
    drawBg();
    drawTrail();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // ---------- 启动 ----------
  function start() {
    runner.src = opts.gifSrc;
    follow.src = opts.followGifSrc || opts.gifSrc;
    // v6: 贴纸后台预加载（不阻塞入场动画，冲刺立即开始）
    // 贴纸 opacity 由 WAVE2 动画统一控制，这里只确保它们加载中
    for (const img of stickerEls) {
      if (!img.complete) {
        img.addEventListener('load', () => {}, { once: true });
        img.addEventListener('error', () => {}, { once: true });
      }
    }
    resize();
    runnerSize = Math.min(width, height) * 0.265;
    layoutStickers();

    // reduced-motion：直接显示背景贴纸墙 + 标题，跳过动画
    if (prefersReducedMotion()) {
      bg.style.opacity = '1';
      clearClip(bg);
      clearClip(acrylic);
      clearClip(stickerLayer);
      acrylic.style.opacity = '1';
      stickerLayer.style.opacity = '1';
      setStickerOpacity(1);
      spawnBgParticles();
      follow.style.display = 'block';
      follow.style.width = `${followSize}px`;
      follow.style.height = `${followSize}px`;
      follow.style.opacity = '1';
      runner.style.display = 'none';
      if (titleEl) {
        titleEl.style.visibility = 'visible';
        titleEl.style.opacity = '1';
      }
      opts.onTitleReady?.();
      lastTs = performance.now();
      raf = requestAnimationFrame(loop);
      return;
    }

    window.addEventListener('resize', resize);
    lastTs = performance.now();
    raf = requestAnimationFrame(loop);
  }

  start();

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
      if (titleEl) container.removeChild(titleEl);
    },
  };
}
