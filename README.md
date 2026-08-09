# blog — 个人技术博客（Astro）

首页带粒子角色 hero 动画的 Astro 静态博客。部署到 GitHub Pages。

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
│       ├── hero.gif        # 角色动图
│       └── sample.png      # 粒子采样图
└── package.json
```

## 部署到 GitHub Pages

1. GitHub 建仓库，名字用 `youran.github.io`（用户名一致才能用裸域名）
2. 推送代码后，在 GitHub Actions 里用官方 `actions/deploy-pages` 构建部署（或本地 `npm run build` 后把 `dist/` 推到 `gh-pages` 分支）
3. `astro.config.mjs` 里的 `site` 改成你的地址

## 换角色素材

替换 `public/hero/hero.gif` 和 `public/hero/sample.png` 即可，粒子动画无需改代码。采样图生成方法见 `../blog-hero/README.md`。

## 动画组件说明

组件本身独立于博客，源码在 `../blog-hero/`，这里只是拷贝集成。改动画逻辑去 blog-hero 改，改完同步过来。
