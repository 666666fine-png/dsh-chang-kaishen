# 素材来源与许可（PROVENANCE）

本仓库的**代码**（`index.js`、`client.js`、`cordis.patch.yml`、`package.json` 与文档）按 MIT 许可，见 [LICENSE](LICENSE)。

## assets/

`assets/` 下的图片不适用 MIT 代码许可：

| 文件 | 来源 / 说明 |
|---|---|
| `assets/qban-cutout.png` | Q 版凯申形象，由插件作者提供（原始文件 `qban.jpg`，1080×1286）；使用 macOS Vision 前台蒙版做透明底处理，并裁边/缩放。用于挂件与大乱目标图。 |
| `assets/gold-yuan-front.png` | 金圆券正面图像，由插件作者提供的图片裁切、缩放而来，仅用于“飘金圆券”事件。 |
| `assets/target-meme.png` | 终极大乱的目标人脸图，来自作者自己的《介石显示器》项目素材；仅用于本插件的显影效果。 |
| `assets/target-meme-weights.png` | 与 `target-meme.png` 配套的权重蒙版，来自同上项目。 |
| `assets/reward-qr.png` | 插件作者的微信赞赏码，由作者提供。仅用于本插件的“支持作者”入口。 |
| `assets/html2canvas.min.js` | 第三方库 [html2canvas-pro](https://github.com/yorickshan/html2canvas-pro) 2.6.0（MIT License，Copyright © 2024-present yorickshan and html2canvas-pro contributors），用于在页面内把 DSH 窗口渲染成画布，供像素重排使用。 |

如果你要 fork 并公开发布本插件，请自行替换 `assets/` 中的作者形象与赞赏码，避免冒用作者身份或收款码。

## 明确没有使用的素材

- 没有使用任何电影/电视剧截图（包括《大决战》），台词仅以纯文本短语形式引用。
- 没有使用真实雕像、历史照片或他人表情包。
- 没有使用任何“混淆/隐藏图片”相关素材或算法。

## 权利主张

如果 `assets/` 中有素材侵犯了你的权利，请通过仓库 issue 联系，我们会在核实后替换或移除。
