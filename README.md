# 巫师牌 · 好友桌

**[开始游戏](https://wizard-friends.wizard-friends.workers.dev/)**

3–6 人中文 Wizard 网页游戏，保留原 SVG 插画、暗绿三维牌桌、二维降级、省电模式、聊天、观战和离线练习。

## 对局与手机手牌

自己的身份、目标、已赢墩数、还差／暂时达标／超出和累计分常驻下方，其他玩家按相对座次围桌排列，规则行动顺序不变。秘密数字仅本人可见；未公开的目标不产生对手进度颜色或提示。对手的“已赢／目标”保留文字标签并适当放大数字；隐藏目标仍显示中性的“已锁定”。每轮结束直接展示本人的目标、实际、加减分和累计变化，再由房主开启下一轮规则投票。

手机使用紧凑横滑牌带：滑动浏览，点击选中及放大预览，再按固定「确认出牌」。不能出的牌也能查看原因。展开为 3–4 列纵向滚动网格，切换保留排序、滚动和选择；展开不会暂停游戏。手机可将手牌收成窄栏以看清棋盘；横屏采用类似桌面的并排布局与浅扇形手牌。倒计时嵌在个人状态框中，减少独立横框。等待手牌保持完整亮度，金边／「可出」和冰蓝选中边框表达不同状态。提供行动提示音开关，主牌旋转仍可单独控制并尊重减少动态效果偏好。

## 房间权威与保留

真人房的完整牌局、随机流、操作校验、出牌计时和机器人均在每房 Cloudflare Durable Object 中执行并持久化。包括房主在内的浏览器只接收自己的权限视图；观众始终只读。关闭房主标签页不会断开其他玩家的房间连接。网络恢复期间保留短暂操作宽限；主动暂停与单人离线、服务不可用分别处理。

「暂停／恢复」「离开」「解散房间」常驻独立操作区。只有房主可暂停和解散，解散需确认并通知所有成员。暂停冻结牌局、AI、动画和剩余时间；聊天、规则与离开仍可用。恢复继续原状态。

| 房型／状态 | 房主最后一个有效连接离线后的保留期限 |
| --- | --- |
| 普通真人房 | 30 分钟；房主返回取消计时 |
| 主动暂停的真人房 | 最多 4 小时；同次暂停首次离线固定截止，短暂重连不顺延 |
| 个人练习 | 离开后 10 分钟；暂停不延长 |

房主在线时不会因闲置过期，其他玩家、AI、观众活动不能续期。离开不会解散可恢复牌局。原浏览器首页提供明确的返回入口；真人房本机返回记录只包含身份与房间引用，不缓存权威手牌或随机流。个人练习保存在本机，10 分钟内可从原浏览器恢复。浏览器数据被清除后无法保证恢复。

到期时，如果房主仍不在、存在在线真人且当前轮未完成，向到期时在线的真人发起 60 秒续赛投票。机器人、观众不投票；任一拒绝或未全员确认则关闭。全员同意后仅完成当前轮，离线席位临时代打，展示计分并由在线真人确认；结果等待上限 60 秒，随后关闭。投票开始后房主返回不会撤销投票，通过后也不能取消本轮结束即关闭的标记。不具备续赛条件则直接关闭。关闭标记保留，旧链接不能复活房间。

旧版本已注册房间由原房主认证后一次性上传完整旧存档迁移，保留手牌、座位、已提交票与计分；不会覆盖已经存在的服务端牌局。旧客户端收到明确的刷新提示。没有原房主完整存档的旧中继房间不能凭空恢复。

## 规则与随机数

每轮发牌前真人独立投票，平票仅重投并列选项；牌库和局长整局固定，预估方式、加减预估、先见之明每轮选择。公开、隐藏、秘密数字、先见之明、3–4 人单色牌库及快速局继续保留。

基本规则依据 [AMIGO 官方规则](https://blog.amigo-spiele.de/content/ap/rule/06900-GB-AmigoRule.pdf)。巫师、小丑始终可出；数字牌须跟首攻花色，后出的巫师不解除已建立的跟色要求。最先巫师胜；否则最大主牌／首攻花色胜，全小丑先出者胜。猜中得 `20 + 10 × 赢墩数`，猜错扣 `10 × 偏差绝对值`。单色数字跨花色比较，同数字先出胜。

正式发牌采用参考项目的 ChaCha20 流、Web Crypto 安全种子、无偏拒绝采样与 Fisher–Yates，覆盖标准牌库、单色牌库和独占花色分配。每局新种子，恢复继续持久化流。随机密钥和流状态不下发真人房客户端、观众或公开记录。固定种子只出现在测试；离线练习的浏览器本身是本地权威端。AI 使用确定性、有预算的预期得分评估，不消耗发牌流，只读取规则允许的视图；大厅可选择策略或简单机器人。

编号的出牌、赢墩、回合与轮末事件驱动席位动效；重连仅恢复最终状态，聊天刷新不重复播放。新行动时限为完整 30 秒，并给入场动画留出时间。

## 本地开发和验证

Node.js 22 或更新版本：

```sh
npm ci
npm run check
npm test
npm run build
npm run worker:check
npm run dev:relay
```

生产构建通过本地 Worker 的 `http://127.0.0.1:8787/` 游玩。需要热更新时另开 `npm run dev`，Vite 的 `http://127.0.0.1:5173/` 将 `/api` 和 WebSocket 代理到 8787。重建 dist 后建议重启本地 Worker，避免资源清单处于重建中间状态。

```sh
GAME_URL=http://127.0.0.1:8787/ npm run test:smoke
# 本地／手动：完整布局和原生触控模拟，不加入远端截图矩阵
GAME_URL=http://127.0.0.1:5173/ npm run test:layout
```

默认使用本机 Google Chrome；CI 使用 `BROWSER_CHANNEL=chromium` 及 `npx playwright install --with-deps chromium`。`test:smoke` 固定使用二维界面，避免无 GPU 的 CI 同时软件渲染多张三维牌桌而阻塞输入；仍连接真实本地 Durable Objects，验证完整联机操作。三维画质另由 `test:graphics`、`test:layout` 及完整浏览器回归在本地／手动验证。浏览器证据输出至忽略提交的 `output/playwright/`。布局测试通过公开规则引擎生成三人 20 张和六人牌局，再恢复为本地练习，不增加生产测试接口。原 `test:network`、`test:refresh`、`test:spectator` 入口统一复用这组服务端权威回归，避免维护三份重复场景；CI 仅运行一次 `test:smoke`。完整练习／变体浏览器回归仍可用 `test:browser`、`test:variants` 本地手动运行。

`src/game.js` 是共享规则引擎，`src/random.js` 是权威随机流，`worker/room-authority.js` 是可控时钟的生命周期控制器，`worker/index.js` 处理 Durable Object 持久化、认证和同步。`src/main.js` 中的本地规则推进仅用于离线练习。

## CI 与发布

`verify.yml` 是唯一验证流程：缓存依赖、语法检查、规则／隐私／生命周期／随机数测试、一次前端构建、Worker 打包预演及一组小规模联机冒烟。PR 验证不需要生产授权；纯 Markdown／开发记录修改跳过无关检查，同一 PR 的旧验证自动取消。

PR 合并到 `xsk23/wizard-friends` 的 `main` 后，验证通过即自动部署 Cloudflare；也可在 Actions 手动运行 `Verify game` 的 `main` 分支重试。发布任务下载本次验证的前端产物，核对提交与 relay 地址，再使用锁文件中的 Wrangler 发布同一提交的 Worker，最后检查线上健康接口。main 流水线串行运行，避免中途取消发布；PR 和 fork 不发布生产站点。

首次启用前，在[上游仓库 Actions secrets](https://github.com/xsk23/wizard-friends/settings/secrets/actions) 配置：

- `CLOUDFLARE_ACCOUNT_ID`：现有 `wizard-friends` Worker 所在的 Cloudflare 账户 ID。
- `CLOUDFLARE_API_TOKEN`：该账户的部署令牌，按 [Cloudflare 官方说明](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) 创建 `Edit Cloudflare Workers` 令牌，账户范围只选实际部署账户。密钥仅保存在 GitHub Actions secrets。

生产地址保持 [wizard-friends.wizard-friends.workers.dev](https://wizard-friends.wizard-friends.workers.dev/)。`RELAY_URL` 留空时使用 Worker 同域接口；若配置该变量，必须指向上述生产地址。缺少密钥或验证失败时不会发布。首次合并前未配置好密钥，可补齐后重新运行 main 工作流。

Pages 部署仍为独立手动工作流，复用成功的 main 验证产物，不重新构建，并核对公开 relay 配置与当前 `RELAY_URL` 一致。本地手动发布仍可使用 `npm run deploy`。

## 素材与设计参考

保留用户提供的 54 张 SVG（60 张游戏牌共享特殊牌插画）；来源、尺寸与字体许可见 [卡牌说明](src/assets/cards/README.md)。现有主牌浮动旋转、三维／二维、省电和音乐入口继续保留。不上传用户桌面／手机整张参考图，不把参考图作为界面。

本次采用 [Anthropic frontend-design](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md) 的简短视觉方案与截图自检方法，[UI/UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) 的触控、状态反馈及响应式规范，并参考 [Kenney Fantasy UI Borders](https://kenney.nl/assets/fantasy-ui-borders) 的克制奇幻边框处理。具体配色、字阶和必要调整集中记录于 [D-011](docs/dev-memory/DECISIONS.md#d-011)，实际验收与限制见 [H-014](docs/dev-memory/HISTORY.md#h-014)。

本项目为非官方好友同乐实现，与原出版方无关联。手机验收为浏览器设备模拟；真实设备 GPU、耗电、运营商网络、长时间锁屏和生产 Cloudflare 故障仍需实际环境验证。
