# blog — 个人技术博客（Astro）

首页带全屏粒子角色 hero 动画的 Astro 静态博客。部署到 GitHub Pages。

## Hero 效果（v2 全屏背景版）

- **背景层**：亚克力磨砂背板 + 透明小方块粒子铺满整个屏幕，角色形状由粒子映照出来（马赛克像素风），固定不动
- **跟随层**：透明小角色缩得很小，跟随鼠标移动（弹簧阻尼），鼠标停止 1.5s 或移出窗口就淡出，移动时留下夕阳红（红橙渐变）拖尾
- **适配**：全屏铺满（100dvh），手机横屏适配（竖屏触屏设备显示"请横屏浏览"提示），dpr 适配，弱设备粒子减半，prefers-reduced-motion 降级

## 快速开始

```bash
npm install
npm run dev       # 本地开发 http://localhost:4321
npm run build     # 构建到 dist/
npm run preview   # 预览构建产物
```

## 目录结构

```
blog/
├── astro.config.mjs        # Astro 配置（site 指向 GitHub Pages 地址）
├── src/
│   ├── pages/
│   │   └── index.astro     # 首页
│   ├── components/
│   │   └── HeroCanvas.astro  # 粒子 hero 组件（调用 src/lib/hero.ts）
│   └── lib/                # 粒子动画核心库（来自 ../blog-hero/src/lib/）
├── public/
│   └── hero/
│       ├── bg.png          # 背景采样图（透明角色大图，粒子映照用）
│       └── follow.png      # 跟随小角色图（透明角色小图，跟随鼠标用）
└── package.json
```

## 部署到 GitHub Pages

1. GitHub 建仓库，名字用 `youran.github.io`（用户名一致才能用裸域名）
2. 推送代码后，在 GitHub Actions 里用官方 `actions/deploy-pages` 构建部署（或本地 `npm run build` 后把 `dist/` 推到 `gh-pages` 分支）
3. `astro.config.mjs` 里的 `site` 改成你的地址

## 换角色素材

替换 `public/hero/bg.png` 和 `public/hero/follow.png` 即可，粒子动画无需改代码。素材要求：**透明背景的角色 PNG**（黑底图先用 ffmpeg colorkey 抠掉，见 `../blog-hero/README.md`）。

## 动画组件说明

组件本身独立于博客，源码在 `../blog-hero/`，这里只是拷贝集成。改动画逻辑去 blog-hero 改，改完同步过来。
