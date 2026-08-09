/**
 * sampler.ts — 像素采样
 *
 * 把采样图（GIF 拆帧缩略图）画到离屏 canvas，读像素，过滤背景，
 * 抽稀到目标数量，输出角色像素点数组。
 *
 * 用法：
 *   const points = sampleFromImage(img, 8000);
 *   // points[i] => { x, y, r, g, b, a }
 */

export interface SamplePoint {
  /** 相对采样图左上角的 x（0..w） */
  x: number;
  /** 相对采样图左上角的 y（0..h） */
  y: number;
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * 从图片/画布采样角色像素点。
 *
 * @param img      HTMLImageElement 或 HTMLCanvasElement（画到离屏 canvas 读取）
 * @param maxCount 目标粒子数量（超过则随机抽稀）
 * @param bgThresh 背景阈值：RGB 三者都低于该值视为背景（黑底），跳过
 */
export function sampleFromImage(
  img: HTMLImageElement | HTMLCanvasElement,
  maxCount = 8000,
  bgThresh = 18,
): SamplePoint[] {
  const canvas = document.createElement('canvas');
  const w = typeof img === 'object' && 'naturalWidth' in img ? img.naturalWidth : img.width;
  const h = typeof img === 'object' && 'naturalHeight' in img ? img.naturalHeight : img.height;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];
  ctx.drawImage(img, 0, 0, w, h);

  const { data } = ctx.getImageData(0, 0, w, h);
  const points: SamplePoint[] = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      // 过滤全黑背景（alpha 也有值的）
      if (a < 24) continue;
      if (r < bgThresh && g < bgThresh && b < bgThresh) continue;
      points.push({ x, y, r, g, b, a });
    }
  }

  // 抽稀：超过 maxCount 就随机抽样（洗牌取前 N，保证密度均匀）
  if (points.length > maxCount) {
    for (let i = points.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [points[i], points[j]] = [points[j], points[i]];
    }
    return points.slice(0, maxCount);
  }
  return points;
}

/**
 * 加载图片（Promise 包装）
 */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`图片加载失败: ${src}`));
    img.src = src;
  });
}
