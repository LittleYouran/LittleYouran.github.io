/**
 * stateMachine.ts — 轻量状态机
 *
 * 5 个状态：SLIDE_IN → BURST → REASSEMBLE → GIF_FADE_IN → FOLLOW
 * 状态切换事件驱动，方便以后加别的触发（例如快速划过彩蛋）
 */

export type HeroState =
  | 'SLIDE_IN'
  | 'BURST'
  | 'REASSEMBLE'
  | 'GIF_FADE_IN'
  | 'FOLLOW';

export interface StateHandlers {
  enter?: () => void;
  update: (dt: number) => void;
  exit?: () => void;
}

export class StateMachine {
  private current: HeroState = 'SLIDE_IN';
  private handlers: Record<HeroState, StateHandlers>;
  private elapsed = 0;

  constructor(handlers: Record<HeroState, StateHandlers>) {
    this.handlers = handlers;
  }

  get state(): HeroState {
    return this.current;
  }

  get time(): number {
    return this.elapsed;
  }

  setState(next: HeroState) {
    if (next === this.current) return;
    this.handlers[this.current]?.exit?.();
    this.current = next;
    this.elapsed = 0;
    this.handlers[this.current]?.enter?.();
  }

  update(dt: number) {
    this.elapsed += dt;
    this.handlers[this.current].update(dt);
  }
}

/** 常用缓动 */
export const ease = {
  easeOutCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  easeOutQuad: (t: number) => 1 - (1 - t) * (1 - t),
  easeOutBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};
