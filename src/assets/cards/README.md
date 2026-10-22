# 卡牌插画

来源：用户提供的 `WIZARD_FRIENDS_54_SVG_SOURCE.zip`（2026-10-22）。本目录的 54 个 SVG 保留原始内容，统一为 320 × 480、2:3 比例。

- 四种花色各 13 张：`blue/red/green/yellow-01.svg` 至 `-13.svg`。
- `wizard.svg`、`jester.svg`：游戏中的四张巫师及四张小丑分别共用一种插画，完整牌库仍为 60 张。
- 通过 `src/card-art.js` 统一供手牌、二维主牌与三维牌面使用；构建时输出带内容哈希的独立文件。
- 保留原有牌背及手牌的大号点数／花色提示。微小英文副标题是装饰，不承载规则信息。

源包中的字形已转为路径，无需加载字体。随包的 DejaVu Serif 字体许可保存在 [`public/card-art/FONT-LICENSE.txt`](../../../public/card-art/FONT-LICENSE.txt)，也会随网站发布。未导入生成脚本、字体二进制、预览图及源包的自检报告；接入验证记录见 `docs/dev-memory/HISTORY.md`。
