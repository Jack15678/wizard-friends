# 开发记录

按完整任务保存行为变化、直接原因、验证与版本关系。长期设计理由引用 DECISIONS 中的条目。

<a id="h-001"></a>
## H-001 · 2026-10-20 · 悬浮主牌、随机名称和变体投票
- 状态：已完成；实现、规则测试、浏览器流程和三客户端联机均已验证。
- 目标：中央主牌、房内唯一随机昵称、每局真人分类投票和五种规则变体；详见 [D-001](DECISIONS.md#d-001)、[D-002](DECISIONS.md#d-002)。
- 基线：main / 17a18ac，任务开始时工作区与暂存区干净。更早设计历史未记录。
- 实现：中央真实主牌正反面、16 秒旋转与二维降级；会话随机名称及房主去重；分类投票、平票重投、五种变体、秘密信息过滤、机器人视图及旧局恢复。README 和界面规则同步更新。
- 验证对象：17a18ac 加本任务所有源码、测试及样式变更；工作目录为本仓库 wizard-friends。以下命令均为本轮实际运行，不是仅存在测试。
- `npm test`：85/85 通过；含标准 3–6 人、单色 3–4 人完整与快速局、允许组合、单色同数先出、预估/手牌/票面隔离、离线/重投/再开局、名称碰撞及旧快照恢复。
- `node scripts/browser-smoke.mjs`：标准 5 轮通关、投票、再开局、手机、聊天、二维降级；`node scripts/variant-browser-smoke.mjs`：单色＋秘密数字＋先见之明 5 轮通关（4–8 张）、随机名与刷新、手机投票滚动及减少动态效果；两者 errors=[]。
- `npm run test:network`：3 个独立 Chrome 会话经公网 PeerJS 信令验证手动重名拒绝、三种预估选项平票重投、其他结果保留、投票中刷新重连、隐藏预估揭晓、先见之明恢复、计分同步及下一轮重连；errors=[]，不代表所有异地 NAT 组合。
- 视觉复查：实际查看桌面、390px 手机、三张出牌、正反面及二维截图。发现先见之明面板遮挡主牌后，移动该阶段浮牌与文字；最终专项浏览器检查 4 人单色和 6 人标准手机布局均不相交、无横向溢出且 errors=[]；永久脚本已补相同矩形断言。截图在忽略上传的 `.local/trump-qa-*`、`.local/final-*-foresight-mobile.png`。
- `npm run build` 与 `git diff --check` 最终通过。Three.js 动态分包约 552 kB，Vite 有超过 500 kB 的体积提示，构建成功；未为该提示增加依赖或无关拆包。
- 开发记录在本子项目启用，本地 Hook 配置已生成但未确认宿主信任；不代表自动 Hook 已激活。
- 版本：随包含 H-001 的提交保存。本地提交，不推送或发布。

<a id="h-002"></a>
## H-002 · 2026-10-21 · 主牌动画开关、去环与圆心对齐
- 状态：已完成；当前内置浏览器视觉、动画专项、单元测试与构建已验证。
- 基线：5847b4b，开始时工作区与暂存区干净。
- 原因：用户当前对局中 `document.hidden=false`、WebGL 正常，但浏览器返回 `prefers-reduced-motion: reduce`；原代码将动画时间固定为 0，因而主牌静止。
- 实现：增加可持久保存的主牌动画开关，三维和二维共用。默认继续跟随系统；明确开启后只恢复主牌相关动画。按用户追加反馈移除围绕主牌的悬浮光环和二维对应装饰，并取消普通主牌向桌后偏移，使其位于实体圆心上方。设计见 [D-003](DECISIONS.md#d-003)。
- 当前预览：通过真实 UI 开启动画；开发热更新重新加载了练习页，随后开启新练习局。连续截图确认主牌从背面转到正面，控制台无错误；证据为本地忽略文件 `.local/trump-motion-enabled.png` 和 `.local/trump-motion-second-frame.png`。
- 追加视觉验收：查看当前内置浏览器中无悬浮环、圆心对齐及仍在旋转的牌局；最终截图 `.local/trump-centered-without-orbit.png`。此前旋转截图仍包含当时尚未删除的环，不作为最终样式证据。
- 测试排查：首次浏览器回归在关闭动画后的整块 canvas 截图相等断言失败，第二次在初始静止断言失败；独立关闭动画复现中连续 5 帧静止。检查截图发现 canvas 元素截图也包含其上方的在线人数等 DOM，遂把比较范围收窄到主牌区域，并允许异步纹理加载稳定后验证，不修改实际停转逻辑。
- 后续回归还发现二维显式开启动画被全局 `animation:none!important` 覆盖；修复仅显式开关的优先级。`npm run test:variants -- --motion-only` 最终通过，验证三维默认静止、开启后画面变化、关闭后静止、刷新保留，以及 390px 二维的启停与旋转，errors=[]。完整脚本的单色五轮、手机投票及名称阶段均执行完成；没有将后续动画断言失败的整轮运行记作通过。
- `npm test`：85/85 通过；最后仅调整出牌几何间距，随后检查当前牌桌并重新构建。联机规则没有修改，本次未重复三客户端联机测试。
- 验证对象：5847b4b 加本任务源码、样式及浏览器脚本修改，工作目录为 wizard-friends。`npm run build`、`git diff --check` 已通过；Three.js 分包的既有体积提示仍存在。
- 版本：随包含 H-002 的本地提交保存；不推送或发布。

<a id="h-003"></a>
## H-003 · 2026-10-21 · 合并上游更新并提交 PR
- 状态：兼容整合完成；109 项单元测试、构建和五组浏览器回归均通过。
- 来源：用户明确要求 commit、推送、提 PR，作者署名「坤的爹」。Fork 为 Jack15678/wizard-friends，目标为原仓库 xsk23/wizard-friends 的 main。
- 基线：本地 caa6392，工作区干净；原仓库 main 已前进至 1ef2648。将两笔未推送的功能提交作者改为「坤的爹」，对应新提交 ab54bad / 65d1a00，并在 feat/trump-variants-names 合并上游。
- 实现：保留上游音乐、自动恢复、可读性样式和 30 秒计时，整合投票、随机昵称及中央主牌；投票／先见之明恢复快照保持可见信息边界。菜单兼容、手机按钮与秘密预估文字同步调整。长期约定见 [D-004](DECISIONS.md#d-004)。
- 验证对象：65d1a00 与 1ef2648 的合并工作区，加本条记录对应的兼容修改；工作目录为 wizard-friends。
- `npm test`：109/109 通过，包含出牌超时、离线座位、投票和先见之明恢复、秘密预估过滤；`npm run build` 与 `git diff --check` 通过。既有 Three.js 分包大于 500 kB 提示保留。
- `node scripts/refresh-smoke.mjs`：大厅、规则投票、秘密数字＋先见之明、房主／访客／同时刷新、练习恢复、退出及移除通过；使用本地 BroadcastChannel 传输替身，errors=[]。
- `node scripts/music-smoke.mjs` 与 `node scripts/browser-smoke.mjs`：音乐设置／恢复、标准五轮练习、手机布局与二维降级通过，errors=[]。
- `node scripts/variant-browser-smoke.mjs`：三人 390px 投票及先见之明、单色秘密数字五轮（4–8 张）、名称／再开局、三维与二维动画启停和刷新保留通过，errors=[]。
- `node scripts/network-smoke.mjs`：真实公网 PeerJS 三个独立浏览器验证平票重投／保留已决项、投票刷新、重名拒绝、先见之明／隐藏预估、30 秒自动出牌、两轮同步得分，以及访客和房主刷新后继续第三轮；64.39 秒通过，errors=[]。不代表所有异地 NAT 组合。
- 视觉检查：390×844 六人两行座位、秘密预估和先见之明面板与主牌文字不相交；最终预估文字间距修改后重新验证六人手机布局，无覆盖、溢出或页面错误。设置菜单在 844×390 可滚动。截图 `.local/merge-style-*.png` 仅本地保存。横屏六人先见之明整体布局仍较拥挤，本次未扩展重构。
- 版本：随包含 H-003 的合并提交保存；按用户授权推送 feat/trump-variants-names 并向原仓库提 PR，不直接推送 main、合并 PR 或触发部署。

<a id="h-004"></a>
## H-004 · 2026-10-21 · 卡牌辨色、获胜提示与公开观战
- 状态：已完成实现和验证；提交及 PR 使用中文。
- 来源：用户要求稍增卡牌颜色对比度，追加加强巫师 W、小丑 J 与获胜提示，并新增正在对局房间列表和观战；用户明确只看公开信息。观战约定见 [D-005](DECISIONS.md#d-005)。
- 基线：原仓库 main / 46da31c；从干净工作区同步上次已合并的刷新恢复及最新玩法，再创建协作分支。
- 实现：共享 SVG 的六类配色和渐变更易区分，花色／特殊牌内框加粗；降低等待手牌的去色和压暗。获胜标签统一浅金底、深文字和亮边，三维获胜牌扩大并提亮实体边框，保留雕刻、烛光和原有动效。
- 实现：主页增加持久观战房间对话框。房主发布公开摘要，开局后显示、结束或离开后撤销；单人练习不发布。独立观众连接不占座，公开视图与刷新缓存采用白名单，私密手牌、预估与票面不下发；公开操作记录保留最近 100 条。房主在协议层拒绝观众伪造的玩家操作。
- `npm test`：135/135 通过，新增目录更新／撤销／换届、公开视图与缓存隐私、私密预估事件、非法操作与保留上限检查。生产构建通过，既有 Three.js 分包超过 500 kB 的提示保留。
- `node scripts/spectator-smoke.mjs`：本地传输验证目录、秘密数字＋先见之明隐私、三种伪造操作被拒、所有玩家公开出牌／获胜／计分／聊天、观众与房主刷新、退出不影响座位及目录撤销；390px 无横向溢出，日志与操作提示不相交，errors=[]。
- `REAL_PEER=1 node scripts/spectator-smoke.mjs`：真实 PeerJS/WebRTC 的相同观战流程通过，errors=[]；此运行后仅调整了成功提示的显示及获胜标签 CSS，并重新跑本地观战回归。公网结果不代表所有 NAT 组合。
- `node scripts/refresh-smoke.mjs`：大厅、规则投票、秘密数字／先见之明、访客／房主／同时刷新、练习及退出移除通过。`node scripts/browser-smoke.mjs`：标准五轮练习、手机与二维降级通过；均 errors=[]。
- 视觉验收：查看桌面六牌前后对比、390px 牌面、四花色 WebGL 牌桌及实际手机观战截图。发现旧 WebGL 选择器覆盖获胜背景后同步修复级联；移除会遮住手机玩家信息的常驻观战成功提示，最终截图 `.local/spectator-fixture-mobile.png` 已复查。经验见 KNOWLEDGE 的 K-001。
- 版本：代码、验证入口与本记录同批提交；按本会话协作流程推送分支并提 PR，不直接合并或发布。

<a id="h-005"></a>
## H-005 · 2026-10-21 · 省电切换立即移除投影
- 状态：已完成；来源：用户截图中已选择省电，旋转主牌仍在桌面留下投影。
- 基线：5b3c272，开始时工作区和暂存区干净；保留已有聊天预览提交。
- 原因与实现：仅设置 renderer.shadowMap.enabled 会停止阴影更新，但材质仍使用缓存的阴影着色器。setLow 切换时使场景材质重新编译，关闭／恢复投影立即生效，主牌动画开关保持独立。
- 验证对象：5b3c272 加本任务 src/table-scene.js、scripts/graphics-smoke.mjs 和 package.json 修改；工作目录为 wizard-friends。
- `npm run test:graphics` 实际通过，比较默认帧缓冲的像素：高画质和省电有差异；切换后的省电与首次省电渲染一致，切回高画质和再次省电也分别一致，errors=[]。先前已复现旧实现切换后保留阴影；测试初版的离屏目标会触发另一套着色器编译而掩盖该问题，因此最终直接读取默认帧缓冲，并统一测试上下文的抗锯齿设置。
- `npm run build`、`git diff --check` 通过；既有 Three.js 分包体积提示保留。未修改游戏规则，不重复整局规则或公网联机测试。
- 版本：随包含 H-005 的本地提交保存，作者「坤的爹」；尚未推送或部署。

<a id="h-006"></a>
## H-006 · 2026-10-21 · 每轮发牌前重新选择变体
- 状态：已完成；126 项单元测试、构建、四组浏览器／联机回归及后期手牌布局专项通过。
- 来源：用户更正“每一轮前都可以决定变体，不是一整把”，并确认牌库和局长开局固定，其他三项每轮选择。约定见 [D-006](DECISIONS.md#d-006)。
- 基线：47928b2，工作区与暂存区干净。保留之前独立的聊天预览和省电阴影修复。
- 实现：轮末进入下一轮投票，结果确认后再发牌并轮换庄家；后续轮仅重投预估方式、加减预估、先见之明。取消回上轮结算，分数／历史／成员／聊天保留；先见之明可在任何轮开启。同步视图、机器人和恢复快照按当轮规则过滤；旧局继续当前轮，下轮投票。
- 界面：投票标明将开始的轮次、固定的牌库／局长与累计分；完成摘要显示本轮新结果，草稿按游戏轮次和平票次数区分。轮末按钮改为「选择下一轮规则」，说明和 README 同步更新。先见之明面板采用 safe center，手牌多时从左侧开始滚动，避免居中溢出使首张牌无法到达。
- 验证对象：47928b2 加本任务源码、文档和测试修改，工作目录为 wizard-friends。`npm test`：126/126 通过；标准 3–6 人与单色 3–4 人完整／快速局、后续轮规则切换、固定项拒改、重投／取消／离线与庄家推进、第二轮隐私／快照和旧局迁移均已实际验证。
- `npm run build`、`git diff --check` 通过；既有 Three.js 分包体积提示保留。
- `node scripts/browser-smoke.mjs`：50.25 秒通过，标准快速局五轮均先投票再发牌；`node scripts/variant-browser-smoke.mjs`：87.42 秒通过，固定单色牌库／快速局，逐轮切换秘密、隐藏、公开加减及先见之明，五轮发 4–8 张，动画启停和名称／再开局检查保留，errors=[]。
- `node scripts/variant-browser-smoke.mjs --foresight-layout-only`：safe center 修改后 8.86 秒通过，用正式引擎操作生成四人单色第 5 轮，每人 8 张；桌面 1440px 和手机 390px 自己隐藏、其他三组共 24 张可滚到首尾。实际查看 `.local/variants-round5-foresight-1440.png`、`-390.png`，以及第二轮手机投票／先见之明截图，无遮挡；图片仅保存在本地忽略目录。
- `node scripts/refresh-smoke.mjs`：92.39 秒通过，使用本地 BroadcastChannel 传输替身，覆盖第二轮换规则、投票／先见之明／秘密数字、房主访客刷新和同时刷新、练习恢复、退出及移除；保留聊天预览已有验收，errors=[]。
- `node scripts/network-smoke.mjs`：68.58 秒通过，真实公网 PeerJS 三客户端从首轮隐藏预估＋先见之明切换为次轮秘密数字＋先见之明；已提交投票的访客刷新、秘密预估中房主刷新后，票面、分数、隐藏手牌和秘密数字保持，完成第二轮后重新投票进入第三轮，errors=[]。验证不代表所有异地 NAT 组合。
- 版本：随包含 H-006 的本地提交保存，作者「坤的爹」；未推送或部署。

<a id="h-007"></a>
## H-007 · 2026-10-21 · 提交逐轮变体与省电投影 PR
- 来源：用户在 H-006 完成后明确要求 commit、推送并提 PR；作者继续使用「坤的爹」。
- 初始上游状态：原 PR #2 已合并，xsk23/wizard-friends 的 main 为 46da31c。本次从该提交建立 fix/round-variants-power-saving，移入 H-005、H-006 两项改动；原开发分支保留。原开发分支 5b3c272 的独立聊天预览未纳入本次 PR。
- 移入时仅开发记录的追加位置有冲突，按任务保留 H-005、H-006、D-006；游戏源码与已验收的 00dd02a 一致。前两条记录描述原开发工作区验证，以下是本次 PR 分支的额外验证。
- 验证对象：a9dde5c，工作目录为 wizard-friends/.local/round-variants-pr。`npm test` 126/126、`npm run build`、`git diff --check` 通过；在独立 5174 预览执行 `GAME_URL=http://127.0.0.1:5174/ node scripts/refresh-smoke.mjs` 和 `scripts/graphics-smoke.mjs` 均通过，errors=[]。前者覆盖逐轮投票和刷新恢复，后者确认省电／高画质切换的像素分别与首次对应渲染一致。
- PR：已推送并创建 [PR #4](https://github.com/xsk23/wizard-friends/pull/4)。创建期间上游合并观战 PR #3 至 fc6820e，后续合并记录仍维护本条；保留上游 H-004／D-005 观战记录，其编号与原开发分支的聊天记录独立。
- 观战兼容：进入后续轮投票时，观众保留上轮已公开预估和历史，界面明确等待第 N 轮选择；活动流区分发起规则投票与下一墩开始。观众始终不获得手牌或未公开预估，恢复快照保留当轮投票轮次及经过白名单过滤的历史规则。第二轮标准／单色、隐藏／秘密及缓存隐私回归已补充。
- 合并后的验证对象：5eb854f 与 fc6820e 合并工作区加上述兼容修改，同一独立目录。`npm test` 158/158、`npm run build`、`git diff --check` 通过。
- 5174 预览上的 `spectator-smoke.mjs`（本地传输）29.86 秒、`refresh-smoke.mjs` 73.01 秒、`network-smoke.mjs`（真实公网三客户端）67.90 秒、`graphics-smoke.mjs` 4.27 秒均通过，errors=[]。观战覆盖第二轮投票／刷新／保留已公开成绩与预估、随后秘密数字＋先见之明不泄露手牌或数字；其余覆盖玩家恢复、逐轮更换规则和画质投影切换。
- 观战测试初次新增断言错误要求 vote 整体为 null，实际候选、已决规则与提交进度属于公开元数据；据此修正为检查 ownChoices=null、无 ballots、无投票操作控件，应用源码无需为该失败改动。
- 手机视觉检查发现观战投票时底栏覆盖部分设置入口，为观战等待阶段的顶部工具栏增加底部间距。仅重跑观战脚本 31.22 秒通过，设置边界不与底栏相交，菜单可打开且退出入口可见；查看更新后的 `.local/spectator-fixture-round2-vote-mobile.png`，重新构建通过。
- 版本：随包含 H-007 的兼容合并提交保存并更新 PR #4；未自动合并 PR 或部署。

<a id="h-008"></a>
## H-008 · 2026-10-21 · 主页常驻房间列表与等待时牌面亮度
- 状态：已完成；主页直接观战、移动端布局、等待手牌亮度与三维牌桌已验证。
- 目标：主页直接看到正在进行的房间并进入观战；用户追加要求非自己回合仍保持牌面高对比度，桌面颜色略调以突出卡牌。约定见 [D-007](DECISIONS.md#d-007)。
- 基线：main / fc6820e，已合并 H-004 的观战功能；从干净工作区创建 codex/home-room-list。
- 实现：目录由弹窗改为主页持久区域，桌面右侧、窄屏主菜单下方；实时更新保留房间节点、焦点与滚动位置，退出观战后重新挂载，窄屏设置移至页尾以避免覆盖按钮。
- 实现：移除卡牌禁用态及禁用悬停的亮度与饱和度滤镜，禁用操作和可出牌金边继续保留；二维桌面、三维毛毡及木材小幅压暗去饱和，光照、动画和卡牌材质保留。
- `npm test`：135/135 通过；`npm run build`：通过，既有 Three.js 分包超过 500 kB 的提示保留。
- `node scripts/spectator-smoke.mjs`：本地测试传输验证桌面及 390px 手机主页直接显示房间、一键观战、人数更新不丢焦点、退出返回目录、关房撤销；原有公开信息边界、伪造操作拒绝及观众／房主刷新回归通过，errors=[]。本任务没有重跑真实公网 WebRTC；H-004 的公网验证仅为既有传输能力的历史证据。
- `node scripts/browser-smoke.mjs`：检查真实等待手牌的 opacity=1、filter=none，完成标准五轮练习、手机入口及二维降级，errors=[]。主页手机允许纵向滚动，继续禁止横向溢出。
- 视觉验收：离线检查 1440、1024、900、390px 主页布局与列表焦点／滚动；查看实际主页桌面和手机截图、六类等待牌面及 WebGL 桌面截图，确认目录按钮可达、牌面与桌面区分清楚。
- 版本：代码、回归入口和记录同批中文提交，推送协作分支并提中文 PR，不直接合并或发布。

<a id="h-009"></a>
## H-009 · 2026-10-21 · PR #5 合并最新 main 并解决冲突
- 状态：冲突已解决；本次整合后的规则、观战、刷新恢复与画质回归通过。
- 来源：用户要求解决 [PR #5](https://github.com/xsk23/wizard-friends/pull/5) 与最新 main 的冲突；在 codex/home-room-list 合并 origin/main / 7f147ac，保留双方功能及开发记录。
- 整合范围：保留 [H-008](#h-008)／[D-007](DECISIONS.md#d-007) 的主页常驻目录、等待手牌亮度与桌面调整，同时兼容上游 [H-005](#h-005) 至 [H-007](#h-007) 的省电投影、逐轮变体投票及观战恢复要求；逐轮规则继续采用 [D-006](DECISIONS.md#d-006)。
- 记录冲突：上游 H-005、H-006、H-007 和 D-006 保留原编号；本分支主页列表与卡牌亮度记录由原 H-005／D-006 重编号为 H-008／D-007，保留原验证对象、命令和结果并修复相互引用。上游既有引用继续指向原记录。
- 语义复核：自动合并同时保留逐轮投票草稿键、观众投票等待页及设置避让、画质切换的材质更新，以及常驻目录、牌面常亮和桌面颜色。出牌文案由“亮起的手牌”统一改为“金边手牌”，与持续可读的牌面区分。
- 验证对象：0cb5550 与 origin/main / 7f147ac 的合并工作区，加本次冲突处理；`npm test`：158/158 通过，`npm run build` 通过，既有 Three.js 大分包提示保留。
- `node scripts/browser-smoke.mjs`：逐轮投票的标准五轮练习、等待牌面完整亮度、手机主页常驻目录和二维降级通过；`node scripts/graphics-smoke.mjs`：高／低画质往返的阴影像素误差均为 0；均 errors=[]。
- `node scripts/spectator-smoke.mjs`：桌面与 390px 手机主页一键观战、焦点保持、退出重挂、第二轮投票撤销目录／发牌恢复目录、投票期间观众刷新、手机设置避让，以及两轮先见之明／秘密预估隐私均通过，errors=[]。
- `node scripts/refresh-smoke.mjs`：大厅、投票、秘密预估与先见之明、访客／房主／同时刷新、退出与移除、练习恢复通过，errors=[]。观战与刷新使用本地传输替身，本次未重跑真实公网 WebRTC。
- 视觉复核：查看 390px 实际出牌页与第二轮观战投票页截图，金边出牌提示无横向溢出，观战设置按钮位于底部横幅上方；提示文案调整后再次生产构建通过。
- 版本：随本记录以中文合并提交保存，并推送现有 codex/home-room-list 分支更新 PR #5；保留双方提交历史，不直接合并 PR 或部署。

<a id="h-010"></a>
## H-010 · 2026-10-22 · 手机建房采用 Cloudflare WebSocket 中继
- 状态：已完成；本地与真实公网 Cloudflare 中继均通过三客户端验收，已部署并可访问。
- 来源：用户希望采用 Magical Athlete 的手机建房方法，随后允许实施并亲自完成 Wrangler OAuth 授权。新建独立 wizard-friends Worker，未修改其他服务。
- 基线：876b0e0（上游 main / PR #5 已合并），干净工作区创建 feat/cloudflare-relay；保留此前 feat/trump-variants-names 与既有 PR 工作树。约定见 [D-008](DECISIONS.md#d-008)。
- 实现：移除 PeerJS/TURN 与协调者选举，增加房间和目录 Durable Objects、WebSocket 自动恢复／心跳、房主归属认证及服务端路由 ID；规则、逐轮投票、名称、三维牌桌和观战隐私继续沿用既有引擎。发布同域静态网页，保留 GitHub Pages 通过公开 RELAY_URL 接入的配置入口。
- 验证对象：上述基线及本任务未提交工作区；Node 24.11.1，Wrangler 4.151.3，工作目录 wizard-friends。
- `npm test`：148/148 通过（替换旧 PeerJS 专用测试，新增中继认证、定向转发、越权拒绝、摘要过滤、过期、重连及心跳测试）；`npm run build`、`npx wrangler deploy --dry-run`、`git diff --check` 通过。既有 Three.js 大分包提示保留。
- `GAME_URL=http://127.0.0.1:8787/ node scripts/network-smoke.mjs`：真实本地 Workers/Durable Objects，三个独立浏览器禁用 WebRTC，390px 触控视口的房主建房成功；分类平票、逐轮换规则、两轮计分、先见之明／秘密预估、房主／访客刷新以及第三轮房主短暂 offline/online 恢复通过，errors=[]。
- 同地址 `refresh-smoke.mjs`：大厅、投票、秘密／先见之明、同时刷新、退出、移除与练习恢复通过；`spectator-smoke.mjs`：目录、390px 手机、两轮信息隔离、原始 WebSocket 伪造三种玩家操作被拒绝、观众／房主刷新通过；`presence-smoke.mjs`：两浏览器、多标签去重、退出、手机和练习通过；均 errors=[]。
- 有效失败记录：人数测试与三人联机并发时受同一目录人数干扰，改为独占站点后通过。手机脚本首次下一轮点击被自动展开的计分板遮挡，脚本按真实用户流程关闭计分板后通过，未用强制点击。Vite 重建 dist 时 Wrangler 短暂捕获空资源清单造成 404，重启本地中继后通过，并更新开发说明。
- 已查看 `.local/relay-mobile-host.png`，检查手机恢复后布局及可操作区域；此为浏览器模拟手机，不代表真实手机／运营商／锁屏验收。
- Cloudflare 部署：2026-10-22T05:25:12Z，版本 63e8e169-5ba5-4d39-b127-162c53bf0e2a，100% 流量；域名 https://wizard-friends.wizard-friends.workers.dev/ 。部署 API 确认子域启用；首次访问出现 TLS 握手失败，约两分钟后 HTTPS 自行恢复（未关闭证书校验或修改 TLS 安全设置）。随后健康检查与真实线上三客户端 `network-smoke.mjs` 完整通过，同样覆盖禁用 WebRTC、手机视口房主、两轮换规则／计分和第三轮断网恢复，errors=[]。
- 版本：实现保存为 f6bce26，作者「坤的爹」，并发布到用户授权的 Cloudflare。用户随后明确要求提 PR，已推送 feat/cloudflare-relay 并创建 [PR #6](https://github.com/xsk23/wizard-friends/pull/6)，目标为原仓库 main；已核验 OPEN、非草稿且可合并。未合并 PR，也未修改原 GitHub Pages 部署；PR 说明列明 Pages 需要设置 RELAY_URL。

<a id="h-011"></a>
## H-011 · 2026-10-22 · 接入用户提供的 54 张 SVG 卡牌插画
- 状态：已实现并完成本地验证；来源：用户提供 `WIZARD_FRIENDS_54_SVG_SOURCE.zip`，要求加入、检查并提 PR。基线为上游 main / c68480d（PR #6 已合并），分支 feat/svg-card-art。约定见 [D-009](DECISIONS.md#d-009)。
- 接入：54 个 SVG 原文保存到 `src/assets/cards/`，替换六种通用图案的运行时 SVG 拼接；通过 `cardImage` 同时更新手牌、二维主牌、三维出牌及悬浮主牌。标准牌库保持 60 张，特殊牌共用插画／纹理，原有牌背及手机点数提示保留。附素材说明和随包字体许可，未执行源包脚本。
- 素材核验：54 个文件与原包逐字节相同，共 3,303,147 字节，全部为 320 × 480；XML 解析、唯一 ID 和本地渐变／裁剪引用通过，无外部图片／字体引用、脚本或事件属性。查看源包总览及实际游戏桌面、390px 手机截图，牌面和点数清晰，无横向溢出；微小英文为装饰。
- `npm test`：150/150 通过，新增完整 60 张牌到 54 图的映射、特殊牌复用和 SVG 几何检查。`npm run build`：通过，输出 54 个带哈希的独立 SVG；既有 Three.js 超过 500 kB 的分包提示保留。
- Playwright CLI 对开发资源与本地 Worker 生产资源各 54 张执行实际 Image.decode，尺寸均正确；加载全部 60 张牌的 WebGL 纹理得到 54 个缓存项，主页 sample-wizard 与实际巫师共用纹理。通过公开引擎操作生成第六轮练习快照，查看 1440 × 1000 和 390 × 844 实际截图；本地证据保存在 `.local/card-art-review/`，不上传测试截图。
- `GAME_URL=http://127.0.0.1:8787/ npm run test:browser`：最终构建在本地 Workers 中完成五轮练习、逐轮投票、手机布局、等待手牌亮度及无 WebGL 的二维主牌，errors=[]。`npm run test:graphics`：省电／高画质往返投影像素误差均为 0，errors=[]。
- 修正及环境记录：最初动态资源表达式匹配目录内 README，改为显式 `.svg` 后，确认构建只映射 54 张牌，说明文件不进入 bundle。重建 dist 触发既有 Wrangler Windows watcher EPERM、首页 404，重启本地 Worker 后最终浏览器回归通过。
- 验证边界：手机为浏览器模拟视口，未测真实手机 GPU／移动网络性能；此任务未修改规则和联机协议，未重复公网多客户端测试，未部署线上服务。代码、素材、测试和记录同批提交，作者沿用用户要求的「坤的爹」，推送后向上游 main 提 PR。

<a id="h-012"></a>
## H-012 · 2026-10-22 · 新 SVG 牌面部署到 Cloudflare
- 来源：用户在 [PR #7](https://github.com/xsk23/wizard-friends/pull/7) 创建后明确要求“部署吧”；部署内容为干净提交 19cd0a3，即 [H-011](#h-011) 的牌面接入。没有合并 PR 或修改 GitHub Pages。
- `npm run deploy` 重新构建并发布现有 wizard-friends Worker；2026-10-22T10:14:13.551Z，Cloudflare 版本 `603d41f6-2c65-4766-806b-602351f90693` 接管 100% 流量。上一版本为 `63e8e169-5ba5-4d39-b127-162c53bf0e2a`；原房间／目录 Durable Object 绑定保留。
- 在线地址：https://wizard-friends.wizard-friends.workers.dev/ 。健康检查返回 cloudflare-websocket / version 1；首页引用本次构建的 `index-BodqOt1U.js`，54 个在线 SVG 均 HTTP 200、正确 image/svg+xml 类型，内容与本地构建逐字节一致。
- `GAME_URL=https://wizard-friends.wizard-friends.workers.dev/ npm run test:browser`：线上完成五轮练习、逐轮投票、桌面 WebGL、390px 手机布局及无 WebGL 的二维降级，errors=[]；查看线上实际牌桌截图，确认新牌面。此轮未重新进行多客户端或真实手机网络测试。
- 验证环境记录：Node 默认直连此域名超时，使用 `node --use-env-proxy` 沿用机器已有代理后全部资源检查通过；未修改系统代理或关闭 TLS 校验。发布状态由 Wrangler deployments list 复核。

<a id="h-013"></a>
## H-013 · 2026-10-22 · 修复手机三维出牌模糊
- 状态：实现、本地及线上验收完成，已部署；来源：用户提供线上手机截图，反馈出牌模糊，随后明确要求“修吧”。设计取舍见 [D-010](DECISIONS.md#d-010)。
- 基线：上游 main / a6e7a9f（已合并牌面 PR #7），干净工作区建立 fix/mobile-card-clarity。保留三维牌桌、原 SVG 素材和游戏规则，不改联机传输。
- 实现：高／低画质都保留抗锯齿和最高 2 倍像素比；省电继续关闭阴影、微粒并降低帧率。手机镜头拉近，出牌随张数调整大小及间距；三维牌面增加高对比点数／花色角标。六人手机截图发现装饰牌堆覆盖第一张出牌，将手机场景的牌堆左移，切回桌面恢复。
- 验证对象：a6e7a9f 加本任务工作区改动，目录 wizard-friends。`npm test` 150/150、`npm run build`、`git diff --check` 通过；既有 Three.js 大分包提示保留。
- `npm run test:graphics` 通过：DPR 3 模拟设备在 390×844、390×676、320×568 下逐项检查 3–6 张牌，共 12 种布局；画布实际 DPR 2、抗锯齿开启、省电阴影关闭，每张牌位于屏幕内且不被装饰牌堆覆盖。390px 三张出牌宽约 84–88px，六张宽约 51–54px；320px 六张仍超过 42px。桌面恢复原缩放／阴影，既有画质切换像素回归通过，errors=[]。
- `GAME_URL=http://127.0.0.1:5173/ npm run test:browser` 通过：完整五轮练习及逐轮投票、桌面 WebGL、手机无横向溢出、无 WebGL 二维降级，errors=[]。本地 Wrangler 8787 健康请求及浏览器初始导航超时，重启后仍未恢复；因此上述浏览器验收使用正常响应的 Vite 5173，不将本地 Worker 记为通过。
- 视觉检查：以实际引擎生成三人／六人第三轮出牌，检查 390×844、390×676 的真实应用截图，确认角标可辨、六张牌完整且牌堆不再遮挡。截图和测试日志仅存 `.local/card-art-review/`。验证为浏览器设备模拟，未测量真实 iPhone 性能或电池消耗。
- 版本：代码提交 0f752aa，作者「坤的爹」，已推送并创建 [PR #8](https://github.com/xsk23/wizard-friends/pull/8)，未自动合并。
- `npm run deploy` 发布干净提交 0f752aa 至现有 https://wizard-friends.wizard-friends.workers.dev/ 。2026-10-22T10:56:31.027Z，Cloudflare 版本 `44f15b8d-be03-4afe-a519-d11c613c7ed6` 接管 100% 流量，经 deployments list 复核；房间及目录绑定保持。首页与 `index-BqqeYQzK.js`、`table-scene-CyTj75SU.js` 和本地构建逐字节一致，健康检查 HTTP 200 / cloudflare-websocket / version 1。
- `GAME_URL=https://wizard-friends.wizard-friends.workers.dev/ npm run test:browser` 线上通过五轮练习、逐轮投票、桌面 WebGL、390px 手机布局及二维降级，errors=[]。仅检查既有流程，本任务不新增公网多人网络测试；真实手机性能／耗电仍未测量。

<a id="h-014"></a>
## H-014 · 2026-10-29 · 权威牌局、房间保留与桌面／手机手牌改造
- 来源：用户要求执行本地 `指令.md` 并向 xsk23/wizard-friends 提 PR；随后补充外部设计与手牌源码参考、突出对手目标／已赢、手机同框倒计时、收起手牌及桌面式横屏。约定与参考链接集中于 [D-011](DECISIONS.md#d-011)，不另建大型设计规范。
- 基线：执行时最新 main `fe6dfe5`；提交前再次 fetch 确认 main 未变，分支 `feat/authoritative-table-and-mobile-hand`。规则／随机数、后端／生命周期、界面三个子代理分工，主代理负责接口整合、浏览器验收、精简 CI 和交付；核心 main.js 仅由界面代理集中修改。
- 实现：真人房权威迁入原 Durable Object，保存私有随机流、座位和规则状态，浏览器含房主均使用权限视图；暂停／剩余时限、最后一个房主连接、30 分钟／固定 4 小时、60 秒到期续赛、离线代打、仅当前轮结算、有限结果确认及不可复活的关闭标记。原生 DO 恢复继续原随机流；旧浏览器迁移保留已发手牌，但未来随机流重新使用服务端安全熵，拒绝新房间伪造客户端牌库。
- 客户端：本人目标与行动常驻；对手 12px 标签配 16／18px 数字，秘密目标仅显示中性已锁定。手机行动提示与计时胶囊合并进个人状态框，可收起为 44px 手牌栏；竖屏原生横滑、选中预览及固定确认，展开 3–4 列滚动网格；横屏使用并排布局和触控浅扇形。稳定 cardId 保留选择和排序／滚动／焦点，明确提交中状态并按 requestId 关联错误。原浏览器新标签页可显式取回房间身份，返回记录不含手牌或随机流；练习离开后保留 10 分钟。
- 本地环境：macOS，Node 24.19.0、npm 10.9.2、系统 Chrome，真实本地 Wrangler Workers/Durable Objects 8787，Vite 5173；未部署生产。原 150 项测试在修改前全部通过；最终 `npm run check`、`npm test` **191/191**、`npm run build`、`npm run worker:check` 和 `git diff --check` 通过。保留既有 Three.js 超过 500 kB 分包提示，没有为消除提示而改变画质能力。
- `GAME_URL=http://127.0.0.1:8787/ npm run test:smoke`：三个独立真人客户端加只读观众，验证秘密目标／手牌隔离、房主缓存无权威随机状态、暂停冻结、暂停聊天、真实关闭房主标签页、新标签页显式返回、恢复剩余计时、房主刷新、同轮计分、解散通知及旧链接关闭标记；errors=[]。旧 network／refresh／spectator 脚本入口统一引用此场景，CI 仅运行一次。
- `npm run test:continuation`：隔离 Miniflare 8788，真实三浏览器／WebSocket；在仅测试脚本的内存包装器中缩短持久化截止时间，生产 Worker 不增加时钟接口。验证当时在线两名真人投票、房主返回不能取消、全员通过、房主离线席位代打、只结算一轮、关闭标记不被返回的房主解除、全部在线真人确认后关闭；errors=[]。30 分钟／4 小时及拒绝／不响应／结果上限由注入时钟的生命周期回归覆盖，未用实际等待冒充验证。
- `GAME_URL=http://127.0.0.1:5173/ npm run test:layout`：**15 项**实际布局／手势场景；桌面 1440px，手机竖屏 360×800、390×844 与横屏 844×390；少量、15 张、20 张及六人桌；CDP 原生触控横滑不误选，选中／取消／确认恰好出一张，排序／展开／收起保留 cardId，实际旋转后继续触控扇形。六人全六张出牌检查牌与座位、牌与牌不相交；零横向溢出，errors=[]。截图等待省电 20fps 画布追上 DOM 锚点后采集。
- `npm run test:offline`：在禁用 WebGL 的 390px 浏览器加载练习后断网，完成先见之明＋秘密数字一轮，显示个人结算，离开并从本机恢复；errors=[]。`test:graphics`：高／省电往返阴影误差为 0，DPR／抗锯齿及 3–6 牌独立场景回归通过；`test:presence` 的双浏览器／标签去重、目录连续性和手机练习通过；`test:music` 的手势启动、静音／音量持久化、跨场景单音频实例与有限音频样本通过。
- 完整标准五轮练习浏览器回归：每轮重投、显式确认、终局／再开局及无 WebGL 降级通过；完整单色五轮变体浏览器回归：逐轮变更、先见之明／秘密目标、再开局／取消与 3D／2D 动效切换／刷新通过，errors=[]。
- 有效修正记录：初版展开网格行高导致重叠，改为按内容行高滚动；全六张牌的窄屏布局与顶部席位冲突，改为中央两列三行、紧凑单行标签并保留来源身份；三维牌面抬高投影平面以避免下半张埋入桌面，仅牌面材质保持原插画亮度。最终实际截图见下方。全五轮练习回归还发现桌面计分关闭、手机设置关闭被常驻工具覆盖，面板统一移到工具下方，未使用强制点击绕过问题。
- 最终审查另修复：已提前断线的下一席位在轮到时立即冻结完整计时；旧客户端导入不能指定未来随机流；选项／投票嵌套字段及历史访客缓存同样白名单清洗。对应关键回归纳入 191 项测试。
- 与参考图的必要调整：沿用现有字头像与 54 张深色 SVG，不导入整张参考图或新角色图；桌面保留原三维桌面，手机六人出牌以稳定席位映射的两列三行取代围圈，以避免遮挡；横屏沿用桌面式并排手牌而不强制手机旋转。手机收起、浏览、预览与展开均为真实组件。
- 截图：[`桌面`](../screenshots/desktop.png)、[`手机浏览`](../screenshots/mobile-browse.png)、[`手机选中`](../screenshots/mobile-selected.png)、[`手机展开`](../screenshots/mobile-expanded.png)、[`收起手牌`](../screenshots/mobile-collapsed.png)、[`横屏`](../screenshots/mobile-landscape.png)、[`六人完整一墩`](../screenshots/six-card-trick.png)、[`续赛投票`](../screenshots/continuation-vote.png)。其余截图与日志在忽略提交的 output/playwright、.local。
- 边界：浏览器模拟视口／触控和本地 Workers 不代表真实手机 GPU、耗电、浏览器系统回收、运营商网络或生产 Cloudflare 故障验收；未自动部署或合并。首次离线练习仍需先成功加载网页资源。本次精简验证工作流不依赖生产凭据，部署保留为独立手动操作并复用成功产物。

<a id="h-015"></a>
## H-015 · 2026-10-29 · 修复 PR #9 联机冒烟的渲染依赖
- 来源：用户要求检查并修复 [PR #9](https://github.com/xsk23/wizard-friends/pull/9) 的远端 CI；基线为该 PR 实际远端头 `4926ebe`，开始时工作区与暂存区干净。本地旧分支 `5ea74c5` 的文件树与远端相同，但历史不同，本次从远端头另建 `fix/pr-9-ci`，保留旧分支。
- 远端证据：[失败任务](https://github.com/xsk23/wizard-friends/actions/runs/40804913955/job/123221432743) 的语法、191 项单测、构建及 Worker 预演均通过；三客户端冒烟在第三个页面填写 `#nickname` 时等待 15 秒超时。下载并查看失败产物的三张截图，第三页实际存在昵称输入框，不能将其判断为选择器已删除。
- 定位：同一代码在本机 Chrome 及冷缓存 Vite＋Chromium 156 正常通过；强制 Chromium 使用 SwiftShader 后，GPU 进程约占 760% CPU，并在新标签页返回房间时复现控件存在但 `#resume-room` 操作等待 15 秒超时。此复现不是完全相同的 `#nickname` 报错，但支持多客户端软件渲染阻塞自动化的判断。
- 修复：仅联机冒烟的浏览器启动参数增加 `--disable-webgl`，以真实二维界面继续全部三客户端＋只读观众流程，使用 DOM 就绪导航，并在成功输出中明确 `graphics: 2D`。生产画质不变，三维专项仍由既有 `test:graphics`／`test:layout` 和完整浏览器脚本负责。CI 退出时同时输出 Worker、Vite 日志，Worker 未就绪则在健康检查处明确失败；README 同步验证范围。
- 本地验证：macOS、Node 24.19.0、Chromium 156.0.8078.4；`node scripts/check-syntax.mjs`、`node --test tests/*.test.js`（191/191）、Vite 构建及 `scripts/build-info.mjs`、Wrangler `deploy --dry-run`、`git diff --check` 通过。修复后的真实本地 Durable Objects＋WebSocket 冒烟通过，包含秘密目标／手牌隔离、暂停聊天、关闭房主标签页、新标签返回、剩余计时、刷新、同轮计分、解散及旧链接关闭，errors=[]；原有 Three.js 大分包提示保留。
- 交付边界：修复提交回原 PR 分支并触发远端验证；本条写入时远端新提交尚未运行，不以本地通过代替远端结果。GitHub 连接直接重跑旧任务返回 Actions 写权限 403，因此通过代码推送触发正常 PR 流水线。未合并 PR 或发布生产服务。

<a id="h-016"></a>
## H-016 · 2026-10-29 · 同步个人仓库并恢复开始游戏入口
- 来源：用户要求把本次更新同步到个人同名仓库，并给两个仓库的 README 补上开始游戏链接。通过当前 GitHub 账号与仓库权限确认目标为 `qiuh23/wizard-friends`，不沿用早期记录中的旧账号名。
- 基线：上游 `main` 为 `fd92eee`，已由用户合并 PR #9，文件树与通过远端 CI 的 `b232f73` 相同；个人仓库的 `main` 及 `feat/authoritative-table-and-mobile-hand` 均为 `4926ebe`。同步采用保留历史的快进，完成后核对两个远端引用与文件树。
- README 在标题后直接提供 **[开始游戏](https://wizard-friends.wizard-friends.workers.dev/)**。本轮实际检查首页 HTTP 200、游戏 JavaScript HTTP 200，并确认包含创建房间与单人练习入口；健康接口返回 cloudflare-websocket / version 1，此地址仍是此前部署的线上版本。仓库同步与文档修改不等于发布新 Worker。
- 验证：文档补链使用既有线上地址，执行链接与资源检查及 `git diff --check`；规则和客户端源码不变，不重复既有 191 项测试及三客户端回归。CI 修复的实际成功任务为 [40807256207](https://github.com/xsk23/wizard-friends/actions/runs/40807256207)。

<a id="h-017"></a>
## H-017 · 2026-10-29 · 合并 main 后自动发布 Cloudflare
- 来源：用户要求增加现有 PR 合并后的 Cloudflare 自动部署。实时确认 PR #8 和 #9 均已合并、上游无开放 PR，因此从最新上游 main / 5502874 创建 ci/cloudflare-auto-deploy，另提发布配置 PR。原分支及工作区均干净。
- 实现：在已有 `verify.yml` 增加依赖验证成功的 `deploy-cloudflare` job，只允许上游 main 自动或手动运行；下载同一轮的 `verified-frontend`，核对提交与 relay，使用锁定的 Wrangler 发布同一提交的 Worker 并检查线上健康接口。main 串行且不取消正在执行的流水线，PR 保留旧任务取消；Pages 独立手动发布继续保留。取舍见 [D-012](DECISIONS.md#d-012)。
- 验证对象：5502874 加本任务工作流和文档改动，目录 wizard-friends。`npm ci`、`npm run check`、`npm test`（191/191）、`npm run build` 和 Worker dry-run 完成；actionlint 1.7.12 检查两个工作流无错误。执行工作流实际内嵌的产物校验代码，空 relay／正确地址／带末尾斜线地址通过，错误提交和错误 relay 均拒绝，共 5 项；`git diff --check` 通过。
- 凭据：Wrangler whoami 确认现有 Worker 账户；通过 GitHub CLI 将对应 `CLOUDFLARE_ACCOUNT_ID` 写入上游 Actions secret，并复查名称存在。原仓库无部署 secrets，`CLOUDFLARE_API_TOKEN` 尚待用户在 Cloudflare 创建并加入 GitHub；README 已写入官方创建说明及设置入口。凭据值不进入 Git，不能以本机 OAuth 登录代替 CI API Token。
- 环境记录：本机已有代理访问 GitHub 多次 TLS 超时，单次命令直连 GitHub 成功；仅对相关 CLI 进程调整 NO_PROXY／http.proxy，不修改系统代理。未复用已合并 PR 的旧代码，未将部署配置的本地检查称为生产发布成功。
- 交付：代码提交 d185d74，作者「坤的爹」，已推送并创建 [PR #10](https://github.com/xsk23/wizard-friends/pull/10)。实际生产自动部署需令牌到位且此配置合并 main 后执行。
- 远端验证：[Actions run 40812887074](https://github.com/xsk23/wizard-friends/actions/runs/40812887074) 成功，含语法、191 项测试、构建、Worker 打包及真实本地 Durable Objects 的三客户端冒烟；本次是 PR 事件，`deploy-cloudflare` 按条件正确跳过。未手动部署或合并 PR。
