/**
 * particle.ts — 粒子系统
 *
 * 粒子分两层：
 *   - role: 角色粒子（入场滑入/炸开/重组用，GIF 淡入后淡出）
 *   - bg:   背景光点（入场后保留，固定在背景浮动闪烁，不跟随鼠标）
 *
 * 物理：弹簧阻尼（v += (target - pos) * stiffness; v *= damping）
 */

export interface Particle {
  /** 当前显示位置（世界坐标，相对 hero 容器中心） */
  x: number;
  y: number;
  /** 速度 */
  vx: number;
  vy: number;
  /** 家：目标位置（相对角色中心/容器中心） */
  homeX: number;
  homeY: number;
  /** 粒子大小 */
  size: number;
  /** 颜色 rgb(r,g,b) */
  color: string;
  /** 重组延迟（离中心越远延迟越久，毫秒） */
  delay: number;
  /** 当前 alpha */
  alpha: number;
  /** 目标 alpha（用于淡入淡出） */
  targetAlpha: number;
  /** 浮动相位（背景粒子用） */
  phase: number;
  /** 层标记 */
  layer: 'role' | 'bg';
  /** 是否已到达目标（背景粒子用） */
  arrived: boolean;
}

export interface ParticleOptions {
  /** 初始位置（世界坐标） */
  x: number;
  y: number;
  /** 家位置（相对中心） */
  homeX: number;
  homeY: number;
  size: number;
  color: string;
  delay: number;
  layer: 'role' | 'bg';
}

export function createParticle(opts: ParticleOptions): Particle {
  return {
    x: opts.x,
    y: opts.y,
    vx: 0,
    vy: 0,
    homeX: opts.homeX,
    homeY: opts.homeY,
    size: opts.size,
    color: opts.color,
    delay: opts.delay,
    alpha: 1,
    targetAlpha: 1,
    phase: Math.random() * Math.PI * 2,
    layer: opts.layer,
    arrived: false,
  };
}

/** 把粒子拉向目标（弹簧阻尼），返回是否基本到位 */
export function springTo(
  p: Particle,
  tx: number,
  ty: number,
  stiffness = 0.09,
  damping = 0.82,
  eps = 0.5,
): boolean {
  p.vx += (tx - p.x) * stiffness;
  p.vy += (ty - p.y) * stiffness;
  p.vx *= damping;
  p.vy *= damping;
  p.x += p.vx;
  p.y += p.vy;
  const dist = Math.hypot(tx - p.x, ty - p.y);
  if (dist < eps) {
    p.x = tx;
    p.y = ty;
    p.vx = 0;
    p.vy = 0;
    return true;
  }
  return false;
}

/** 背景粒子缓慢浮动（以 home 为锚点，小幅正弦摆动） */
export function floatBg(p: Particle, t: number, amplitude = 6) {
  const tx = p.homeX + Math.sin(t * 0.001 + p.phase) * amplitude;
  const ty = p.homeY + Math.cos(t * 0.0013 + p.phase * 1.7) * amplitude;
  p.arrived = springTo(p, tx, ty, 0.02, 0.85, 1.2);
}
