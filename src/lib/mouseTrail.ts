/**
 * mouseTrail.ts — 鼠标轨迹与弹簧跟随
 *
 * - 维护鼠标轨迹环形缓冲（最近 N 个点）
 * - 角色层中心沿轨迹移动：弹簧阻尼 + 拖尾延迟
 * - 鼠标停止 1.5s 后缓缓回到中心静止点
 * - 鼠标快速划过（速度 > 阈值）触发一次 mini-burst 彩蛋
 */

export interface MouseTrailOptions {
  /** 轨迹缓冲长度 */
  bufferSize?: number;
  /** 跟随刚度 */
  stiffness?: number;
  /** 阻尼 */
  damping?: number;
  /** 停止后回到中心的时间（ms） */
  returnAfterMs?: number;
  /** 触发彩蛋的速度阈值（px/ms） */
  burstSpeed?: number;
}

export class MouseTrail {
  private buffer: { x: number; y: number }[] = [];
  private readonly bufferSize: number;
  private stiffness: number;
  private damping: number;
  private returnAfterMs: number;
  private burstSpeed: number;

  /** 角色层当前位置 */
  x = 0;
  y = 0;
  private vx = 0;
  private vy = 0;

  /** 静止锚点（初始为中心） */
  private anchorX = 0;
  private anchorY = 0;

  /** 上次鼠标移动时间 */
  private lastMove = 0;
  /** 上次鼠标位置 */
  private lastMouseX = 0;
  private lastMouseY = 0;

  /** 是否触发过彩蛋（冷却用） */
  private burstCooldownUntil = 0;

  constructor(opts: MouseTrailOptions = {}) {
    this.bufferSize = opts.bufferSize ?? 20;
    this.stiffness = opts.stiffness ?? 0.08;
    this.damping = opts.damping ?? 0.84;
    this.returnAfterMs = opts.returnAfterMs ?? 1500;
    this.burstSpeed = opts.burstSpeed ?? 0.8;
  }

  /** 每帧调用：更新鼠标目标，返回是否触发彩蛋 */
  update(now: number, mouseX: number, mouseY: number, _centerX: number, _centerY: number): boolean {
    // 记录轨迹
    this.buffer.push({ x: mouseX, y: mouseY });
    if (this.buffer.length > this.bufferSize) this.buffer.shift();

    // 鼠标速度检测
    let burst = false;
    if (this.lastMove > 0) {
      const dt = Math.max(now - this.lastMove, 1);
      const dist = Math.hypot(mouseX - this.lastMouseX, mouseY - this.lastMouseY);
      const speed = dist / dt; // px/ms
      if (speed > this.burstSpeed && now > this.burstCooldownUntil) {
        this.burstCooldownUntil = now + 3000;
        burst = true;
      }
    }
    this.lastMove = now;
    this.lastMouseX = mouseX;
    this.lastMouseY = mouseY;

    // 目标：最近移动过就跟随鼠标，否则回锚点
    const targetX = now - this.lastMove < this.returnAfterMs ? mouseX : this.anchorX;
    const targetY = now - this.lastMove < this.returnAfterMs ? mouseY : this.anchorY;

    // 弹簧阻尼
    this.vx += (targetX - this.x) * this.stiffness;
    this.vy += (targetY - this.y) * this.stiffness;
    this.vx *= this.damping;
    this.vy *= this.damping;
    this.x += this.vx;
    this.y += this.vy;

    return burst;
  }

  setAnchor(x: number, y: number) {
    this.anchorX = x;
    this.anchorY = y;
  }

  /** 重置到指定位置 */
  reset(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.buffer.length = 0;
  }
}
