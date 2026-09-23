# TASKS · Coding Agent 执行清单

**v1.5 · 2026-09-23 · 网页端 / 本地 Agent 可接续，单次顺序执行**

输入：[PRD.md](PRD.md)、[SPEC.md](SPEC.md)、[AGENTS.md](../AGENTS.md)、[视觉参考](../assets/reference/README.md)。发布方式见 [DEPLOY.md](DEPLOY.md)。本文件既是任务清单，也是唯一进度/接续记录，不再维护人工排期或另一份状态文档。

## 0. 当前真实状态

**当前轮：微信地点入口直达（2026-09-23，本地通过待真机；未发布）。** 从实际干净 Windows / 远端 HEAD `5d9348edd8371758cd334000f6aa4e453ddb8224` 接续 `feat/a1-wechat-scan`。提交前回读 main 仍为 `cc411965dd384e9608a80abf87a9e883eea8294d`，PR #1 Draft/Open、未合并、Review 为空，未在旧 SHA 上覆盖他人提交。最终 HEAD 以 Git/PR 回读为准，不写自引用 SHA。

微信内有效 `/q/:pointKey` 在会话前校验地点后复用原 snsapi_base，重新识别当前微信用户一次；服务端 oauth 保存 entryPointKey/returnTo/state。回调先捕获已校验地点、消费 state，经真实 code 交换流程 findOrCreateUser，再 regenerateSession 写 userId/有效地点，等待 saveSession 后跳 `/#point/:key`。不依赖入口共享 Cookie，不接受旧 A 会话代替本次 B 授权。既有随机 state 的公开地点提示只供 Cookie 缺失时生成经配置校验的手动重试链接，不作为身份/资格；失败停留错误页，不自动重试或回首页。微信外游客首页/地点引导即使带旧 Cookie 也不显示个人记录/上传，`/q/` 在访问会话存储前返回；`/r/` 匿名、`/stats` 固定凭据、API JSON 401 不变。

`/api/me.scannedPointKey` 只来自当前会话及有效配置，活动关闭返回 null；App 集中恢复，同用户上传/领取响应不含该字段时不误清空，切换用户清除旧照片/资格，迟到的 `/api/me` 不覆盖后来的扫码。直达原生 file input 不等待 wx.ready，SDK 失败不清空身份或阻塞已有资格的上传。地图/列表/hash 不增加资格，保存照片前进度不增加；原未知结果锁、最后一站 #claim、两路首次领取与照片隔离保留。

**本轮验证：**`npm run check` 配置/HTTP + 58/58 Node、`npm run build`、`npm run test:a4:mysql` 45/45 分组检查与 `git diff --check` 通过。显式 TEST_DB_HOST=127.0.0.1 / TEST_DB_PORT=3321 / TEST_DB_USER=root / TEST_DB_PASSWORD=''，使用全新独立 MySQL 8.4.9 datadir 并校验自身 UUID/绑定/端口；实际 Chrome 与 SQL、文件上传、应用重启，未连接生产数据库。冷启动/无共享 Cookie、2/N→保存后3/N、同 OpenID 原用户/领取码/首图、A→B、会话过期、关闭活动、重复 code/state、微信与会话读写故障、拒绝 Cookie、迟到状态、SDK 故障及原 A1–A4 回归均覆盖。故障注入日志中的预期错误不计为业务成功；生成照片夹具不是现场照片。

**本轮证据：**最终日志 `tmp/mysql-entry-3321-fDZ6O2/suite.log`；独立启动器 `tmp/run-entry-local-20260923.mjs`。156 个实时状态/宽度组合通过，54 条所选新截图记录、共 66 PNG，覆盖 320/390/430px 引导、读取中/失败、直达上传、SDK 故障上传、已完成/已领取等；`tmp/changqi_a1_test_5403af373bd4/{index.html,a4-screenshots.json,a4-regression.json}`。运行时/图片指纹 `9cf32c619340444a5610aa30cae434086991d2f7b13a8874ea8154eced8bb754`，逐文件回读一致；截图记录基准 HEAD 加本轮源文件哈希，不改写为提交后截图。当前聊天导出接口只返回元数据，未冒称网页端逐图目视或客户已确认新页面。首轮旧引导断言和 Chrome 模拟 UA 后同文档 hash 导航的测试假设已修正；失败日志 `tmp/mysql-entry-3321-AsshRm/suite.log` 与中间通过日志均保留，不改写历史结果。

**边界：**六图母版/派生、地图比例/热点、CQ 范围、锁文件/依赖和数据库结构未改。五处固定正式二维码载荷/码图不变，生成器的离线页和印刷说明已同步，可给旧包附 `docs/point-qr-entry-correction.md`，不要求重印码图。本次镜像冒烟预期已更新但未运行云构建；没有本次发布授权，不触发 Actions、不转 Ready、不合并、不替换线上。iOS/Android 微信真实授权（包括已关注/未关注、原菜单换入口、同设备换账号）、五地点拍照/相册/复扫/领取与真实纸样仍待验，不把本地模拟等同真机，不恢复强制关注规则。

### 六图接入及先前发布记录（历史边界）

以下六图/A1–A6 与 guide-only 测试保留发生时的结果，不再作为新入口验收规则；本轮状态以上方记录为准。

- 仓库：`Jonoka/changqi-checkin-h5`；本轮六图接入先从干净 Windows `66003bea…` 安全 fast-forward 到远端 handoff `be60f540b404ba677eefef087b4278fb3e48cdbb`。最新 `main` 为 `cc411965dd384e9608a80abf87a9e883eea8294d`；原 PR #1 Draft/OPEN、未合并、Review 为空，无其他开放 PR，继续 `feat/a1-wechat-scan`。六张真实 PNG 已在 `6889e359515f84ce9b910017871d097d213b37e4` 提交推送；最终接入 HEAD 以 Git/PR 回读为准，不写自引用 SHA。
- 初始化历史：`c5bd5888d993984e8d7cfcbd42e5c92416070d6f` 建立仓库；文档基线随后提交；`5e0a67d` 已补入五张视觉原图。当前 HEAD 以工具或 Git 实际读取为准，不写自引用 SHA。
- 素材：本轮直接导入根目录六图 ZIP，六张 PNG 共 19,182,073 B，尺寸/SHA/完整解码与导入清单一致；未生图、未裁旧效果图。地图 1334×1179、五处详情母版各 1536×1024，原字节保留；地图/p03 为用户确认，另四张只标接入预览。既有原图、历史裁图/SVG 与 source-manifest 均保留。新 WebP 地图保持 1334×1179，详情各 960×640，quality 86，总 1,840,696 B；独立母版与派生哈希可追溯。
- 接入：完整图片地图替代旧环境图/矢量路线/五张叠卡，HTML 标签按配置 key 与百分比锚点叠加；缺锚点仅进既有折叠列表，N 仍动态。PointArt 按实际宽高显示，详情/列表使用相同 key 图片。App、IdentityStatus、照片/授权/扫码/领取逻辑未改；首页/地点隐藏 CQ、凭证/派发编号、地图上方主操作、身份互斥、未知结果锁及最后一站 #claim 均保留。server/config 只补图片宽高校验，不修改数据库。
- 本轮验证：check 配置/HTTP + 56/56 Node、build、独立 MySQL 8.4.9:3320/Chrome 完整回归 39/39 通过；135 个 320/390/430 状态组合，56 条所选截图记录，共 75 PNG（含首屏、地图局部及 A2/A3 必要图）。最终证据 `tmp/changqi_a1_test_232bffccbccc`，runtime 指纹 `bf73d23ac9663c86846d399a0e23088ca5d7e448b27276c39eb4f47a14bc66a1`，未复用旧图。实际目视地图三宽、五处详情、展开列表和首页主操作；最终客户页面确认/微信真机仍待验。
- 执行入口：ChatGPT 网页端或电脑本地 Agent 开发均可；Actions 统一构建，有 SSH 权限的本地 Agent 默认负责下载、上传和部署。
- 服务器核验与运行时：`root@100.95.32.56` 可通过 Tailscale 连接；Alibaba Cloud Linux 3.2104 LTS 内核 `5.10.134-18.al8.x86_64`，`x86_64`，约 0.94 GiB RAM，根盘 40G/可用约 18G。Nginx 1.26.2、MySQL 服务 active，项目库建表成功；配置端口 3306、socket `/tmp/mysql.sock`、数据目录 `/www/server/data`。现有 Node 应用占用 3000，本项目 app 绑定 `127.0.0.1:3002`；Docker CE 26.1.3、containerd 1.6.32、Compose v2.27.0 已从阿里云镜像安装并设为开机启动，`docker version`、`docker info`、`docker ps` 已通过。发布 artifact 已上传至 `/opt/changqi-checkin-h5/releases/35750893371`，归档 SHA-256 校验为 `e29d9e85c1f0509b46c59bb02c74033c0a9cf18176a224a429fb06af9ddbe929`，镜像已 `docker load`。`cq.fsxinhuo.cn` 已由宝塔 Nginx 反代到本项目并强制 HTTP→HTTPS，HTTPS 健康检查与静态插画资源通过，证书有效期至 2026-12-20；未改其他站点、未清理生产数据。
- Windows 工作区已实际核对并开发，保留忽略文件、照片、二维码、根目录 ZIP 及历史截图。本轮只做本地图片接入与回归，不触发 Actions、不更新生产；下列服务器结果为既往只读记录，不冒称本轮重新上线或验证微信。真实照片、微信真机和领取操作仍待验。
- A6.3：正式 origin `https://cq.fsxinhuo.cn` 与 p01–p05 绑定已定版；10 张码、清单、约 5cm 离线打印页和警示 ZIP 已生成并自动解码。仍为“正式地址已定，待真机/纸样试扫，不可直接批量印刷。”地址不再缺项；原图插画恢复需新素材验收，不影响已定版地点码。
- 当前接续：A5 本地回归通过、微信真机未验；A6.1 已完成 schema/建表脚本进镜像、`linux/amd64` 固定、临时 MySQL 冒烟、artifact 上传和本地下载核对。成功 run `35750893371` 在源码 `f14430b7039d2a810d13d08098da43f2b8734612` 上通过全部检查并产出可下载 artifact；A6.3 样张和自动解码完成、真实纸样未验；A6.2 已完成服务器核验、Docker/Compose 安装、artifact 上传与镜像加载、项目建表、容器启动和 Nginx 反代。当前生产容器/HTTPS 已实测，微信 iOS/Android 真机、真实照片和纸样仍待验。
- 2026-09-23 线上只读：独立普通 Chrome profile，以 GET-only 检查首页、沉香古井查看页、五条 `/q/` 和无效 `/r/invalid`，共 24 个 320/390/430px 组合。页面及图片正常，无脚本异常/横向溢出；匿名 `/api/me` 的 401 是预期，未当成宕机。列表默认折叠、展开 5 项；首页禁用的扫一扫在 568px 高首屏可见；旧版普通浏览器地点页因身份提示重复，按钮在此短视窗下需下滑。线上报告 `tmp/ui-public-z04NLz/report.json`。旧默认页/404 结果属于首次部署之前，不是当前状态。

## 1. 执行顺序与完成规则

| 任务 | 目标 | 依赖 | 当前状态 |
| --- | --- | --- | --- |
| A0 | 最小工程、配置、MySQL | 明确目标仓库 | 完成 |
| A1 | 微信身份、两类扫码入口 | A0；真实账号/域名用于真机 | 本地通过待真机 |
| A2 | 一处照片打卡与进度恢复 | A0、扫码接口；本地可用开发模拟 | 本地通过待真机 |
| A3 | 两种领取与人数 | A2 | 本地通过待真机 |
| A4 | 保留布局/UI，接入六张独立 PNG 插画 | A2、A3 | 本地接入/回归/目视通过；待用户页面确认与真机，未发布 |
| A5 | 必要回归、问题修复 | A1–A4 | 本地通过待真机 |
| A6 | 双入口构建、本地中转、授权部署与二维码 | 构建/部署依各自授权；纸样不等镜像发布 | 进行中：A6.1 构建/冒烟/导出/下载完成；A6.2 服务器部署与 HTTPS 检查完成，微信真机待验；A6.3 样张/解码完成，微信/纸样待验 |

状态使用“未开始 / 进行中 / 本地通过待真机 / 阻塞 / 完成”。按实际依赖顺序继续，不每个小步骤都要求批准；外部条件缺失只阻塞对应检查，本地可实现部分继续。开发环境模拟与微信真机结果严格分开。

一个任务只有实现和对应检查都满足才算完成；没有 MySQL 不得用 SQLite 测试代替 MySQL 通过；没有真机不得用模拟扫码冒称微信通过。默认用轻量测试脚本；可在同一 Actions 工作流执行，不另搭 CI 平台或覆盖率指标。Actions 中的临时 MySQL 测试注明环境，不冒称已验证宝塔数据库。

## 2. 可执行任务

A0–A6 下的既往实现/测试记录保留其发生时的边界；当前部署和本轮 UI 结果以第 0 节、下方 UI 小修记录和第 3 节为准，历史“未部署”不能当成当前结论。

### [x] A0 · 初始化可运行的最小工程

**输入：**目标仓库实际内容、SPEC S01/S08、环境样例。

**动作：**检查远端实际分支/HEAD 与文件；本地模式另查全部未跟踪文件，保留已有内容。网页端无本地访问时明确标记。空工程按默认栈建立 web、server、配置、db、scripts 等必要目录，优先根 npm 项目和单锁文件；已有工程复用。核对官方支持与依赖兼容版本，实际安装并锁定。实现配置校验、公开活动接口、MySQL 建表与连接。只有 users/checkins 两张业务表及会话组件必要技术表。

**产出：**真实可用的安装/开发/构建命令；锁文件；`config/activity.json`；`db/schema.sql`；`.env.example` 与 README 的运行说明。不提交真实凭据。

**检查：**已在本地 Agent 实际执行 `npm ci`、`npm run check`、`npm run build`、`npm start`、`GET /api/activity`、`npm run db:schema`。新终端未预设 `DB_*` 时，仅通过项目 `.env` 在独立临时 MySQL 8.4.9（3309）创建 `users` 与 `checkins`，Node 应用通过 `GET /health` 返回 `database: connected`；外部环境变量覆盖未被 dotenv 改写。未使用 SQLite；生产宝塔 MySQL 尚未连接。

### [ ] A1 · 微信授权与扫码入口

**输入：**A0；SPEC S02/S03/S08；实际公众号与域名条件。

**动作：**先核对实际账号网页授权/JS-SDK 能力及必要域名配置；实现授权、普通会话、JS-SDK 配置、引导页、扫码解析与普通会话 scannedPointKey。两用户隔离；重进恢复身份；微信内直接 /q/ 重新 OAuth 后直达上传、微信外引导；页内取得结果再进入上传。

**产出：**授权与扫码接口、公众号引导页、错误提示；必要的开发模拟入口（仅显式开发模式，不能生产开放）。

**检查：**AC-02～AC-04。缺凭据/域名/真机时列一次最小缺项，状态记“本地通过待真机”或“阻塞”，继续 A2–A4；不修改用户已有公众号消息服务或菜单。

**本轮实现与本地证据：**`GET /auth/wechat`、`GET /auth/callback` 使用服务端 code 交换、snsapi_base 和一次性 state；成功必须等待会话落库。`express-session@1.19.0` + `express-mysql-session@3.0.3` 复用 MySQL，适配器驱动以 npm override 复用根 `mysql2@3.24.4`；npm 正常重装解析并维护单一锁文件，最终安装检查无漏洞。`GET /api/me` 返回 SPEC 最小字段与实际 checkins/config key 交集；`GET /q/:pointKey` 不加载会话、始终引导；`GET /api/wechat/js-config` 校验本应用 URL、按有效期复用 token/ticket；`POST /api/scan` 只保存普通会话地点、不写 checkins。生产不挂载 `POST /api/dev/login`，也不接受旧开发身份会话。该段为 A1 历史实现记录；照片已在 A2 接入，领取在 A3 接入。

**页面与测试边界：**基础 Vue 页面已接身份加载/401/重试、真实进度、SDK ready/扫码/取消/失败/返回恢复、地点查看和上传占位；开发演示显式标注。独立 MySQL 8.4.9（127.0.0.1:3311）随机测试库验证同身份幂等/并发与两用户隔离、会话落库/过期/实际应用进程重启、引导页无扫码资格、二维码边界、活动关闭、扫码不增记录、授权失败；测试完成记录只是隔离库夹具，没有照片文件保存或领奖派发。真实 Vite 5173→3000 代理和 Chrome DOM/交互均执行，390/430px 无横向溢出。Chrome 注入的微信 SDK 与网络响应明确模拟，不能替代真机或 A4 视觉验收。

**历史外部边界及本轮补核：**A1 当时没有联调域名及可读的微信协议正文；这些不能继续当作当前缺项。A5 已确认正式域名，并从微信当前服务号官方文档读取网页授权与 JS-SDK 正文，更新入口见 SPEC/DEPLOY；旧 stable-token 入口已重定向为开发指南，不冒称据此核验了该接口全部条件。实际公众号权限/后台域名配置、服务端凭据与出口白名单、菜单入口和 iOS/Android 真实操作仍未核验。未改消息服务、菜单或第三方托管。

### [ ] A2 · 先跑通一处照片打卡

**输入：**A0 的 MySQL 和配置、A1 扫码接口（本地允许开发模拟）；SPEC S04/S05。

**动作：**实现一张图片选择、预览、重选、提交、处理和持久保存；数据库确认后更新进度。重复不覆盖、失败不计数、超时先查状态。本人图片仅本人读取。先用一处完整跑通，再覆盖全部配置地点，不新增另一种打卡方式。

**产出：**上传页、本人进度接口、照片读取接口和实际保存逻辑。

**检查：**AC-05～AC-08 中可本地验证项；真机拍照/相册另记。至少有一张实际照片保存到 MySQL 对应的持久文件，并能刷新恢复。

**本轮实现：**`POST /api/checkins`、`GET /api/me/photos/:pointKey` 复用 A1 的统一会话鉴权及真实进度。`multer@2.4.0` 磁盘临时上传与 `sharp@0.35.4` 正常 npm 安装、同一个 lockfile；15 MiB 上限、实际类型与可解码性校验、方向纠正、1600px 不放大、JPEG quality 80、去元数据。文件先保存再写参数化 SQL；唯一约束解决并发，重复不覆盖首张照片。本人照片 no-store/会话鉴权，无公共文件映射；已清理照片返回明确 410 而不丢历史进度。原生文件选择/预览/重选、提交禁用、失败后读取本人状态、刷新重选、身份切换释放旧预览已接入。

**本地证据：**独立回环 MySQL 8.4.9（3312）随机库，不替代现有或生产库；实际 multipart 上传公开 Sharp 仓库的 `320x240.jpg` 测试照片（非长岐现场照片），并实际生成 PNG/WebP/损坏/超大夹具。验证落盘+MySQL、两人同地点照片隔离、2/N 扫码仍为 2/N/保存才为 3/N、四请求并发仅一行/一文件、活动关闭、真实磁盘写入失败、MySQL trigger 拒绝 INSERT、HTTP 上传中断、缺图保持历史、实际 Node 进程重启后原 Cookie/照片字节/进度恢复。真实 Chrome/Vite 执行文件选择和重选、失败重试、提交锁定、响应丢失后查状态、刷新恢复及切换身份；390/430px 无横向溢出。截图保留在本次忽略的 `tmp/changqi_a1_test_*/a2-browser-*.png`，未当作 A4 完整视觉验收。

**已修复与验证边界：**修复 Windows 图片处理文件句柄缓存导致临时文件清理失败；修复 multipart 提前返回 401 在 Vite 代理变成空 502（流式丢弃未读取请求体后返回 JSON）；修复上传前旧进度响应覆盖新状态。实际 Chrome 已注入上传与 `/api/me` 连续网络失败，确认“核对保存结果”保留、提交持续禁用、进度不变且不显示成功；恢复网络确认未保存后才允许重新提交，随后真实保存成功。iOS/Android 微信真实拍照/相册、权限、HEIC 提示及真实现场图片仍未验证。

**资料与边界：**已查阅 [Multer 官方文档](https://expressjs.com/en/resources/middleware/multer/)、Sharp 的 [输入](https://sharp.pixelplumbing.com/api-constructor/)、[缩放](https://sharp.pixelplumbing.com/api-resize/)、[输出](https://sharp.pixelplumbing.com/api-output/) 与 [缓存](https://sharp.pixelplumbing.com/api-utility/) 约定。已知数据库失败清理本次新文件；若 INSERT 结果不明且回读也失败，保留可能已提交的照片待核对并返回失败，不误删有效照片、不假成功。没有新增后台、库存、图片审核、微信媒体备用上传或清理平台。


### [ ] A3 · 领取闭环和人数

**输入：**A2 完成判断；SPEC S06/S07/S08。

**动作：**完成后展示游客领取码与自行确认按钮；派发页扫码打开只读，点击才提交。两个入口调用同一 markClaimed，保留首次时间/渠道。人数页直接 COUNT，由现成固定凭据保护；没有后台、库存或员工账号。

**产出：**本人领取、公开持码派发、只读人数，以及接口级重复确认测试。

**检查：**AC-09～AC-11。两个独立测试用户全部完成后分别通过不同路径领取；同一用户并发两路请求，计数只增加 1。先在隔离测试库检查，不清空生产数据库。

**本轮实现与证据：**`server/claims.js` 的 `markClaimed` 供本人和持码两路调用；新领取要求活动开启且配置 key 全部完成，已领取直接返回原结果，条件 UPDATE 只写首次时间与服务端固定渠道。`/api/r/:claimCode` 在会话中间件之前提供最小公开字段；直接 `/r/` 由同一前端渲染，不登录、不显示照片。`/stats` 用 `express-basic-auth@1.2.1` 固定凭据保护并直接 COUNT；未配置则关闭查询、数据库失败不显示 0。`qrcode@1.5.4` 在浏览器从本人链接生成黑白二维码，四模块空白区，无第三方二维码请求；依赖正常 npm 安装并保留单锁文件。

**实际本地验证：**新建独立回环 MySQL 8.4.9（3313）及随机库；用于领取的完成记录通过实际图片上传产生，而非直接伪造完成状态。分别 self/staff 后 COUNT=2；12 个并发两路请求只新增一位已领取用户，首次时间/渠道不变。关闭活动拒绝首次领取、原领取可重复查询；真实 trigger 拒绝 UPDATE 不计数，已关闭 MySQL 连接的统计显示 503/错误而非 0。Chrome 验证未完成无领取按钮/码、二次确认可取消、结果不明与再次核对失败保持锁定、真实保存后模拟响应丢失能恢复、匿名普通浏览器派发和本人重进恢复；实际 Node 进程重启后领取仍在。390/430px 派发页无横向溢出，截图在忽略的 tmp 测试目录，不算 A4 完整视觉验收。

**资料与未验证：**本轮查阅 [Basic Auth 组件文档](https://github.com/LionC/express-basic-auth)、[node-qrcode 文档](https://github.com/soldair/node-qrcode) 和 [MySQL UPDATE](https://dev.mysql.com/doc/refman/8.4/en/update.html)。持码即能确认是既定简化，并非员工身份认证或实物交付证明。微信 OAuth/SDK 与设备相机仍为模拟，无 iOS/Android 真机领取码扫码或现场实物派发结果；无生产 HTTPS、容器更新或生产统计验证。

### [ ] A4 · 应用视觉与完整页面状态

**输入：**A2/A3 接口；SPEC S09；assets/reference/README.md 及五张参考图。

**动作：**复用认可风格，不重新探索。首页/示意地图可合并，成功可用弹层；实现真实文字、动态数字和按钮，去除手机框与小程序胶囊。替换图中旧装置文案、错误地名、错误进度和假二维码。缺独立插画可先用局部素材，不阻塞业务实现。

**产出：**首页/进度、地点上传、完成领取、引导、派发、人数页面的可交互版本及关键状态。

**检查：**AC-12；本地检查至少两种手机宽度，无横向溢出、按钮可用。用真实接口数据，不把整张截图铺成所谓完成页面。

**历史实现与素材（新图尚未接入）：**`VillageMap.vue` 使用环境底图、五张 key 独立地标图、SVG 曲线路线与同坐标点击目标；`map-layout.js` 读取配置位置，缺失时仅用简单交错兜底。地图、折叠列表和详情共用 points 配置及 completedKeys，不按数组下标或完成数量映射。`PointArt.vue` 图片失败只显示无误导的不可用状态，不串用其他地标。详情/首页/本人领取拆成 hash 视图；上传仍保留原生 file input、预览、重选、大小限制和未知结果锁定；真实 QR、两次确认、匿名派发与统计凭据保护保持。插画和路线明确为概念/游览示意，不当作实景测绘。

**实际画面证据：**本轮最终目录 `tmp/changqi_a1_test_577fd68e4b36/`：`index.html` 汇总 129 张整页图，`a4-screenshots.json` 记录实际源码/素材指纹与首屏按钮坐标；额外 `a4-home-first-screen-{320,390,430}.png` 和未登录首屏共 6 张。已在 Windows Chrome 打开 `a4-compact-review.jpg` 目视核对本轮 390px 首页首屏、沉香古井上传页及 guide：扫一扫在地图上方，地点名没有边框、拍照提示已移除，入口显示“上传现场照片”，guide 显示“参与方式”。其他状态继续自动核对图片/触控尺寸/溢出/文案/地图坐标；旧截图目录原样保留，不能作为本轮画面。测试照片仍为生成夹具。

**验证与边界：**复用现有 Chrome CDP 和独立 MySQL 8.4.9（3316）；最终 A1–A4 39 项通过，无第二套测试平台或重型地图依赖。320/390/430 均检查横向溢出、触控尺寸、图片加载和地图坐标；减少动画、配置增删/重排、连续核对失败、真实进程重启、两路领取并发均保留。`.env.example` 已补空 `STATS_USER/STATS_PASSWORD` 并修正旧 Nginx-only 注释，不含真实凭据。微信授权、相机、相册、物理领取码扫码、现场实物派发及服务器仍未实测；本地通过和人工截图复核不冒充真机验收。

**资料：**已核对 [Vite public 静态资源](https://vite.dev/guide/assets)、[Vue 可访问性](https://vuejs.org/guide/best-practices/accessibility)、[MDN 减少动画](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion) 与 [安全区 env](https://developer.mozilla.org/en-US/docs/Web/CSS/env)。安全区样式已实现，不能据此声称已测 iOS 刘海设备。


### [ ] A5 · 回归、修复和真实记录

**输入：**A1–A4；SPEC AC-01～AC-14。

**动作：**运行项目已有测试或轻量冒烟脚本，覆盖配置、用户隔离、照片失败、重复打卡、完成判定、两路领取和统计；逐项修复主流程问题并复测。网页端无可用执行环境时使用 A6.1 提前准备的同一 Actions 工作流运行检查，本地模式也可使用它，不另造一套发布链。微信返回页面再次扫码、权限/取消、真实相册和纸样用真机检查。

**产出：**必要测试脚本、修复代码，以及本文件中的真实检查结果。记录实际命令、环境、结果，不以“测试已编写”当通过。

**本轮本地结果：**配置/HTTP + 41 项 Node 测试、前端构建及完整 A1–A4 MySQL/Chrome 39 项全部通过；未复现业务缺陷，没有改身份、扫码、上传、领取或统计运行时代码。`TEST_DB_HOST=127.0.0.1`、`TEST_DB_PORT=3317` 明确指向本次新建实例，实际 `TEST_BROWSER_EXECUTABLE=C:/Program Files/Google/Chrome/Application/chrome.exe`；无生产 DB_* 回退、无 SQLite。库内两名实际上传完成的测试用户分别 self/staff 后人数=2，12 个并发两路请求只首次计数；写盘/INSERT/UPDATE/统计故障、连续核对失败锁、照片/身份隔离、非顺序/动态 N、最终 /#claim 和真实进程重启全部覆盖。生成夹具不冒称现场照片。

**真实失败与修复边界：**正式回归前，临时启动器两次未等到 MySQL 监听；改用 Windows `--no-monitor` 后，第三次因 MySQL 返回中文 datadir 为乱码，被隔离断言拒绝。此三次均未进入业务回归。仅修正忽略目录内的本地启动器：从本次初始化的 auto.cnf 读取 server_uuid，与连接结果及 127.0.0.1:3317 核对后才运行测试，不删目标保护。随后完整入口一次运行 39 项通过，正常定向停止本次实例；原 3308、历史数据/截图与 env 未改。

**证据：**启动器 `tmp/run-a5-local.mjs`；成功日志 `tmp/mysql-a5-3317-NEqc0T/suite.log`；失败预检目录 `tmp/mysql-a5-3317-{7sLCzo,jhhvw9,5VjBRA}` 保留。实时 320/390/430px 结果 `tmp/changqi_a1_test_695566bf3c64/a4-regression.json`，以 `TEST_A4_REUSE_EVIDENCE=tmp/changqi_a1_test_577fd68e4b36` 复用已确认 A4 视觉。运行时指纹仍为 `e44424a068e9df2af09357ff8f60b1ebd8f7494e47aecb58cf6ebdb02dc27fdb`；不重做 129 张整页图，不冒称本轮又逐图人工审阅。新增复用保护测试拒绝不同指纹、缺图和非法文件名。

**公网/微信边界：**Windows 只读报告 `tmp/a5-public-check-i2eCjb/report.json`，2026-09-22 13:07 UTC；公共 DoH/官方文档补核 `tmp/a5-external-check-76lqsJ/report.json`。本机 DNS 返回的 198.18.* 与公共结果不同，不把该本机地址当公网服务器；Google/Cloudflare DoH 均为 112.74.27.188。证书校验通过，但默认首页和六条 404 证明当前对外未提供项目链路，未验证运行镜像/source SHA。没有授权的服务器 SSH 会话或真实微信操作，MySQL/会话 Cookie/宝塔反代/上传持久目录只能核对代码和操作约定，不能写生产已验。

**阻塞交付：**无法进入/扫码/上传/领取、串用户、重复计数、失败假成功、重进丢数据、部署覆盖照片。装饰和动画可简化；基础检查不能删。生产相关 AC-13/AC-14 在 A6 补完，缺外部条件保持未验证。

### [x] 上线后轻量 UI 小修 · 2026-09-23（本地通过，待发布）

仅展示层变化，SPEC 已简短同步。两名游客的首页/地点/成功/失败与待核对区无 CQ；两人的 `/#claim` 与对应 `/r/` 真实编号一致，领取后仍保留，GET 查看不写领取。同页切换身份能清除旧照片与扫码状态；扫码→地图→同地点继续上传，其他未扫地点无上传入口；加载不混入失败/按钮，实际读取失败后手动重试恢复。关闭活动拒绝首次领取但已领取记录可看，上传/领取结果未知及连续核对失败继续锁定，重复并发只计首次均回归。

显式 `TEST_DB_HOST=127.0.0.1`、`TEST_DB_PORT=3318`、`TEST_DB_USER=root` 与隔离实例专用 `TEST_DB_PASSWORD`；实际 `TEST_BROWSER_EXECUTABLE=C:/Program Files/Google/Chrome/Application/chrome.exe`。启动器 `tmp/run-ui-local-20260923.mjs` 每次新建 datadir 并核对本实例 UUID/回环绑定/端口；不回退生产 DB_*，仅停止/清理本次独立实例和随机测试库。第一次完整运行在“活动关闭+已领取”320×568 首页记录按钮首屏断言失败，日志 `tmp/mysql-ui-3318-Ew6bY3/suite.log` 保留；将刷新移入进度同一行、压缩状态留白后完整重跑 39/39 通过，第二次成功日志 `tmp/mysql-ui-3318-x501Nk/suite.log` 保留；补充两位游客各自地点成功区的实际照片/无 CQ 对照后，再次完整 39/39 通过，最终日志 `tmp/mysql-ui-3318-ydA6bA/suite.log`。最终 `npm run check` 42/42、`npm run build`、`git diff --check` 通过。

新证据：`tmp/changqi_a1_test_69c9874b22b0/index.html`、`a4-screenshots.json`、`a4-regression.json`。运行时/素材指纹 `5a3e3b27f63fd0f1648666dd6c72957b9c290d6975537b55e4902784ed79f5c2`，记录基准 HEAD 加本轮 dirty 文件实际哈希，不伪造提交后截图。`TEST_A4_CAPTURE` 只选择截图，不跳过其余实时断言，且不得和旧证据复用模式并用；新增 1 项选择器保护测试。135 个状态/宽度组合通过，23 整页 + 10 首屏 + 6 A2/A3 图均为新文件；原有上百张历史图未动。320/390/430×568 首页扫一扫、领取凭证和关闭活动后的领取记录均在地图前、完整可见且无遮挡。只生成受影响图和自动核验 DOM/图片/触控/布局；当前传输接口仅返回导出元数据，未冒称在网页端逐图目视或用户确认本轮画面。

发布边界：未发现本次 UI 更新的明确生产发布授权，默认只提交推送，不触发镜像构建或覆盖生产。SSH 只读确认容器 `changqi-checkin-h5-app-1` 正运行 `changqi-checkin-h5:f14430b7039d-35750893371-1`，发布目录 `build-info.json` 对应 source SHA `f14430b7039d2a810d13d08098da43f2b8734612` / run `35750893371` attempt 1；OCI revision label 为空，SHA 来源明确为配套发布元数据，不冒称容器标签自证。最终容器与镜像标签的 image ID 均为 `sha256:801d77be41a261d636e4d60903cb1200f195064fdb339dbe09342849f4360c08`，容器仍 running；回环 `/health` 返回 database connected。服务器自身 curl HTTPS 域名时退出 6（解析失败），与 Windows 浏览器可访问的结果分开记录，不据此判定网站宕机。未改环境、公众号、菜单、数据库、地点二维码或真实游客记录；普通 Chrome 与模拟 SDK 不是微信真机结果。

### 原 PNG 插画恢复历史 · 2026-09-23（当时素材关阻塞；现由下方六图接入接续）

已核对并实际查看五张原图。聊天图像接口未产出合格的原图局部修补母版；返回的示意板不采用、不入库，不是实际页面截图。Runner 的 Plugin/MCP 列表为空。当前仅完成原生裁切，不将涂白、模糊或插值冒充修补/高清，不要求用户重交已有原图。

`assets/illustrations/restoration/recipe.json` 记录来源与裁切，`source-manifest.json` 记录原文件 SHA、尺寸、输出 SHA/字节，`index.html` 提供真实原图→编辑输入对照。已逐张目视：地图 739×653 / 1,353,479 B，古井 307×302 / 266,587 B，无字井身 266×168 / 128,853 B，p01 229×236 / 154,909 B，p02 330×252 / 228,883 B，p04 252×274 / 192,062 B，p05 425×241 / 289,936 B。井身片段无字但缺屋顶；其余仍有标签/错字/状态或遮挡，均不是完整母版。p01 原葫芦、p02 镬耳祠堂、p03 古井棚亭、p04 榕树气根、p05 观景台/村落/山林的来源已定位，不添加人物或无来源建筑。

新脚本 `--extract-sources` 只提取原生 PNG；默认命令只读独立图片母版，当前因 6 张 master 缺项而停止，实测现有 runtime 字节未变。拒绝 SVG 假后缀、哈希/尺寸不符、缺目视记录、未知或被手改的输出；整批预检后才写入，预留 restored-v1 新文件名，不改 key/域名/地点码。旧素材测试保留 key/字节校验，撤掉 SVG 指纹与统一尺寸/50KB/200KB 门槛，新增来源/像素/母版/体积/保护测试。页面未改，旧坐标测试仍对应旧 runtime，不冒称新热点通过。

验证：`tmp/run-art-gate-local-20260923.mjs`；日志 `tmp/mysql-art-gate-3319-iA8HTz/suite.log`；新检查/截图 `tmp/changqi_a1_test_a175c836cb89/{index.html,a4-screenshots.json,a4-regression.json}`。显式 TEST_DB_HOST=127.0.0.1 / PORT=3319 / USER=root / 独立测试密码，验证全新 datadir UUID/回环绑定后运行，只停止本实例；未用生产 DB_* 或真实照片。runtime 指纹仍为 `5a3e3b27f63fd0f1648666dd6c72957b9c290d6975537b55e4902784ed79f5c2` 是源文件未改的结果，不是复用旧图；扫码门禁、动态 N、两用户隔离、未知锁、首次领取、CQ 和最后一站 #claim 回归通过。

最小接续缺项：先完成无 UI 地图（至少保留 739×653 有效像素/比例，清除标签错字并恢复中性步道）和完整古井详情（建议经真实局部修补/扩图到 768×512，去牌匾字、补屋檐/人物边缘）。两张目视通过后再做另外四处与图片/HTML 热点接入，不上线占位版。其余目标尺寸见 recipe，只是编辑建议，不是已存在高清素材；实际编辑结果另存母版与哈希/方法，不承诺模型重跑像素相同。

只读生产核对仍为 `changqi-checkin-h5:f14430b7039d-35750893371-1`，image ID `sha256:801d77be41a261d636e4d60903cb1200f195064fdb339dbe09342849f4360c08`；build-info source `f14430b7039d2a810d13d08098da43f2b8734612` / run 35750893371 attempt 1，OCI revision label 为空，回环 health=database connected。本轮仅普通提交推送，未触发 Actions、未构建/替换生产、未清库或修改微信/正式地点码；真机仍待验。

### [x] 六张独立 PNG 接入 · 2026-09-23（本地通过，待用户页面确认；未发布）

根目录 ZIP SHA256 `fb73dba8e2cb83ebe93fc29f07dac65b00e957dd6c3ec93fa93537d250b25d77`，安全解压先核对路径、大小、PNG 完整解码及六个 SHA，再导入 masters；不覆盖相同 handoff 或已有文件。清单保留生成来源及地图/p03 已确认、其他四图预览的区别，不称其为旧图逐像素裁切。prepare 脚本新增导入清单校验并沿用整批写入前保护；缺文件、哈希/尺寸/来源不符、未知手工输出仍失败，SVG 源不进入生成链。

地图完整按 1334:1179 显示；p01/p02/p03/p04/p05 锚点依次为 (22,12)/(75,16)/(31,65)/(75,87)/(25,88)，仅对应现有五处。重排/删除不移动其他锚点，新增无位置仅列表可达。详情/缩略图按配置 key 使用对应 WebP，图片失败仍不串图；未改正式域名、地点 key、印刷码、锁文件、环境、微信或数据库/业务实现。

显式 TEST_DB_HOST=127.0.0.1、TEST_DB_PORT=3320、TEST_DB_USER=root、TEST_DB_PASSWORD=''（本次新建独立回环实例），校验自身 UUID/端口/监听；实际 Chrome、真实 SQL/文件/子进程重启，微信网络/SDK 与照片夹具明确模拟。首轮 `tmp/mysql-raster-3320-xhFcoI/suite.log` 在 home-claimed 将关闭列表内未加载懒图误判；改为等待/断言实际可见图片，展开列表仍强制核验，完整重跑 `tmp/mysql-raster-3320-BHR6Oe/suite.log` 39/39。新证据记录实际 `6889e359…` 加 dirty 源文件哈希，不改写成提交后截图；扫码门禁、五 key 点击、动态 N、两用户隔离、连续未知锁、领取首次计数、CQ 范围和 #claim 全部回归。

实际在独立 Chrome 打开最终 PNG 复核拼页 `tmp/raster-final-review/{map,points-a,points-b,home,list-actions}.html`，通过精确窗口截图逐张目视：三宽地图无标签重叠/拉伸，五处详情主体完整、名称/图片一致，上传区仍可见；展开列表图文对应，扫一扫/领取凭证/领取记录均在首屏地图上方。未发现烘焙编号、假进度或明显文字残留。75 PNG 留在原证据目录，聊天交付五张真实截图复核拼页；素材加载/自动断言与人工目视分别记录，不称客户已确认另四张或微信真机已验。本轮无 Actions/生产/二维码写入。

### [ ] A6 · 同一镜像构建、本地中转、授权部署与物料

**输入：**A0 的可运行工程；A5 的测试与缺项；SPEC S10、DEPLOY；服务器架构及正式域名/SSH/发布授权。A6.1 可提前做以支持网页开发验证，A6.2–A6.3 按实际条件接续，不形成 A5 必须等 A6 全部完成的循环。

**A6.1 构建准备与实际运行：**实现一个多阶段 Dockerfile、`.dockerignore`、只含 `app` 的生产 Compose、必要环境样例，以及 `.github/workflows/build-image.yml`。按 DEPLOY 支持 dispatch 和仅构建请求文件变化的 push；两者共用检查、构建与 artifact 步骤。普通提交不请求打包。先核对服务器架构再固定单平台；未知时可做明确标记的测试镜像，不能称为可部署的生产包。

**本轮实现：**`Dockerfile` 运行镜像已包含 `db/schema.sql` 与 `scripts/apply-schema.mjs`，不包含测试、参考图或真实环境文件；基础镜像固定为已核对的 `node:24-bookworm-slim` amd64 digest `sha256:5cbc7caba8c2c0f0bca675d1b61b9f2857e1cf1853c6164ee9dd409501a936e7`（Node 24.21.0），工作流固定 `linux/amd64`，并在导出前用临时 MySQL 启动同一镜像检查 `db:schema`、`/health`、`/api/activity`、首页、`/q/p01`、无效 `/r/` 和生产误开模拟；`build-info.json` 记录镜像内实际 Node/npm 版本，artifact 另带归档 SHA-256。普通提交仍不触发 push 构建。

在已授权构建范围内，网页端用实际可用的 dispatch 或构建请求提交；本地用 CLI/同一请求机制。检出运行对应的提交，执行检查后导出镜像。artifact 带归档、构建元数据和同版本 Compose，默认保留 3 天。首次配置验证两条触发入口，失败如实修复；以后单次发布只触发一种。产出实际 run ID、attempt、源码 SHA、artifact 和镜像标签，不把只提交 YAML 算成功。

**A6.2 本地接手与生产更新：**有权限的本地 Agent 核对 run/提交/平台，下载并检查同一 artifact，不在本地或 1GB 服务器重新构建。初次只读核对资源、宝塔/Docker/MySQL、端口和持久目录；取得目标发布授权后 SCP 上传、load、Compose 更新。复用宝塔数据库与 Nginx，不另开生产 MySQL 容器，不让 runner SSH 生产。保留环境文件、照片和已有记录，记录原镜像并做简短上线检查。

**A6.3 物料与交接：**使用已安装的 qrcode 从唯一配置生成，正式模式严格核对 origin、五组 key/name 和现有 parsePointQr；黑白 M、margin 4、scale 24，每张 PNG 888×888。`npm run qr:points -- --origin https://cq.fsxinhuo.cn --out tmp/point-qrs-cq-fsxinhuo-cn` 已执行。输出 10 张独立 PNG/SVG、manifest、UTF-8 CSV、index.html 与印刷说明；已有目录拒绝覆盖，测试地址需 --test 且分目录。生成不依赖 DB、密钥、Docker 或 Actions。

**A6.3 自动解码与交付：**OpenCV QRCodeDetector 4.13.0 回读 5 张 PNG；现有 sharp 将 5 张 SVG 直接按整数模块栅格化后同样回读，10/10 文本与 S03 最终网址逐字一致。`自动解码结果.json` 带逐文件 SHA 与实际文本，生成器没有预先宣称解码通过。Windows 文件目录 `D:\外包\changqi-checkin-h5\tmp\point-qrs-cq-fsxinhuo-cn`；ZIP `D:\外包\changqi-checkin-h5\tmp\point-qrs-cq-fsxinhuo-cn-待验证纸样.zip`，15 文件、16,264 字节、SHA256 `1dd40cf100b50c953e68d3169573be01e8abaec386832301a8a9b27b4f2e17c2`。已调用原生 artifact 导出；若传输层只返回元数据，以实际 Windows 路径交接，不虚构沙箱下载链接。ZIP 不含个人领取码、照片或凭据。

**核对页实际打开：**使用新建临时 Chrome profile 离线打开 index.html，在 print CSS 下验证五张 SVG 均加载成功、五个 URL 完整一致、地名和 URL 均在码面外，二维码元素约 50mm（188.96875 CSS px）。报告 `tmp/qr-proof-browser-sdKUv1/report.json`；该检查不是打印机输出、实物测量、微信或现场试扫。

**A6.3 版本与印前状态：**包在 A4 基线 581fb42728ecb28bebd3025305deea24207af21c 加本轮未提交二维码脚本时优先生成；manifest 如实记录 dirty 标记及生成脚本/配置/解析器/锁文件 SHA，可与本轮提交追溯，未冒称来自干净最终 HEAD。地址定版、文件生成和自动解码已完成；iOS/Android 微信直接扫/H5 页内扫、实际约 5cm 纸样均未操作，bulkPrintApproved=false，不可批量印刷。index.html 及包内说明均标“正式地址已定，待真机/纸样试扫，不可直接批量印刷。”纸样标签、URL、说明在码外且保留四模块白边。

**检查：**AC-13/AC-14 与上线核心闭环。分开记录“工作流已实现”“构建请求已发出”“产物可下载”“服务器已更新”“微信真机已验证”。缺权限、产物失败/过期或没有实际部署时保持对应未完成状态，继续不受影响的开发。已有明确发布授权的连续操作不逐条再问；公众号菜单、消息服务或生产数据清理不隐含在构建授权内。

## 3. 验收结果表（执行时更新，不凭推测勾选）

| 验收项 | 当前结果 | 证据 / 未验证原因 |
| --- | --- | --- |
| AC-01 | 本地通过 | 配置/N 与关闭活动拒绝新扫码、新上传、首次领取均已实测；已有进度/照片/人数可读，已领取重复确认保持原状态。 |
| AC-02 | 本地子项通过，待真机 | 真实 MySQL 验证身份/会话/进度与本人照片隔离、实际进程重启后恢复照片；微信 OAuth 网络为模拟。公众号进入与关闭重进仍待真机。 |
| AC-03 | 新入口本地通过，待微信真机 | 微信有效 /q 经模拟提供方、真实服务端会话/SQL直达并实际上传；微信外旧 Cookie 引导、两入口同 OpenID、A→B 隔离、SDK 故障与迟到状态已回归。列表/hash 不授新资格；历史 guide-only 规则已替换。 |
| AC-04 | 本地通过待真机 | 本地解析、Node 模拟 SDK 与实际 Chrome 注入模拟 SDK 验证未就绪、取消、拒绝/失败、错误码、初始化重试和返回后再扫；无真实相机/微信结果。 |
| AC-05 | 本地选图通过，真机未验 | Chrome 实际原生 file input 选择/预览/重选/提交通过；不冒称 iOS/Android 微信相机和相册验证。 |
| AC-06 | 本地通过 | 超大/损坏/不支持格式、实际磁盘失败、MySQL INSERT 拒绝与 HTTP 上传中断不增加完成进度；请求临时文件/无效新文件清理已核对。 |
| AC-07 | 本地通过，待真机 | 刷新/真实进程重启恢复、重复/四请求并发只一条记录且保留首图、真实保存后模拟响应丢失先查状态均通过；实际 Chrome 已验证上传与手动核对连续失败时保持提交禁用，恢复网络确认未保存后才允许重试。 |
| AC-08 | 本地通过 | 真实照片提交后 2/5→3/5、扫码不增加进度、旧无关 key 不计入完成均通过；A3 两路接口均拒绝未完成用户首次领取。 |
| AC-09 | 本地通过待真机 | Chrome 本人/派发二次确认可取消、GET 不写、实际确认后显示首次时间；本人刷新/重进恢复。现场实物派发与手机扫码待验。 |
| AC-10 | 本地通过 | 实际 MySQL 两路重复/12 请求并发只计首次且时间/渠道不覆盖；非法领取码及伪造身份/渠道请求拒绝。 |
| AC-11 | 本地通过 | 两位实际上传完成的测试游客分别领取后只读 COUNT=2；正确凭据可读，未授权不可读，统计连接失败不显示 0。生产人数尚未验证。 |
| AC-12 | 六图接入本地/目视通过；待用户最终页面确认与真机 | 六个真实母版与 WebP 已接入；135 状态/宽度组合、三宽热点/首屏、五处查看/扫码、折叠列表与动态 N 均通过。新截图目录 232bffccbccc，56 条记录/75 PNG，已目视最终地图、五详情、列表与三类主操作；不冒称客户确认或已发布。 |
| AC-13 | 构建/冒烟/下载/服务器部署通过，微信真机未验 | 生产禁模拟、开发身份不可转正式、MySQL 会话/照片/领取实际进程重启恢复已回归。Actions run `35750893371` / attempt 1、源码 `f14430b7039d2a810d13d08098da43f2b8734612`：linux/amd64 镜像构建、临时 MySQL schema、`/health`、`/api/activity`、首页、`/q/p01`、无效领取 API 和生产模拟拒绝均通过；镜像内 Node `v24.21.0`、npm `11.19.0`，基础 digest 为 `sha256:5cbc7caba8c2c0f0bca675d1b61b9f2857e1cf1853c6164ee9dd409501a936e7`。artifact `changqi-image-f14430b7039d-35750893371-1` 已下载到 `tmp/release-35750893371`；镜像归档 SHA-256 为 `e29d9e85c1f0509b46c59bb02c74033c0a9cf18176a224a429fb06af9ddbe929`，已上传并在服务器 `docker load` 成功。项目库建表成功；容器 `changqi-checkin-h5:f14430b7039d-35750893371-1` 运行于 `127.0.0.1:3002`，重启后 `/health` 返回数据库 connected；Nginx HTTPS 反代、HTTP 301、活动接口、地点引导、插画、未登录 401 和 `/stats` Basic Auth 均通过。微信真机、真实照片/领取和纸样仍未验证。 |
| AC-14 | 原载荷/码图保留，说明已更新；微信与纸样未验 | 五个最终网址和10张 PNG/SVG不变，旧样张与解码结果保留；本轮二维码测试通过，离线页/印刷说明及旧包更正说明已更新。真实微信两种入口、iOS/Android与约5cm纸样仍待验，不因说明更改重印码图。 |

可分开写“Actions API 检查已通过；宝塔数据库/微信真机未验证”。本地命令、Actions 日志、服务器结果与真机用户反馈标明来源，不将它们混为一个“全绿”。

## 4. 接续记录（只维护此处）

每个执行任务结束时更新顶部状态、任务表、验收表和下面的当前摘要。避免重复长篇历史；需要的命令输出可放不含敏感数据的测试报告，并在此引用。

**当前接续（2026-09-23）：**六图 PNG 已实际提交，原 Draft PR #1 / feat/a1-wechat-scan 继续；新地图/五处详情/列表已接入，check 56/56、build、隔离 MySQL/Chrome 39/39、最终页面目视通过。新证据 `tmp/changqi_a1_test_232bffccbccc`，详细范围见本轮六图记录；不再列母版缺失，不再生图或裁旧效果图。下一步是用户实际页面确认及单独授权发布，微信真机仍待验；本轮没有 Actions/生产变更，保留已有 f14430b7039d… 发布历史，不更换地点码。

<details>
<summary>A5/A6 与首次部署历史（保留原记录，不是本轮 UI 状态）</summary>

```text
实际日期：2026-09-22
仓库 / 分支：Jonoka/changqi-checkin-h5 / feat/a1-wechat-scan
A5/A6.3 实际起点：581fb42728ecb28bebd3025305deea24207af21c；main 为 cc411965dd384e9608a80abf87a9e883eea8294d。开工 Windows 全量 porcelain 干净；PR #1 Draft/OPEN、Review/评论为空，无其他开放 PR。沿用原分支/PR，不转 Ready、不合并；最终提交以 Git/PR 回读为准。
已确认：A1–A3 本地业务、A2 连续失败专项、A4 本地与用户视觉，以及正式域名/五处 key 绑定；这些不是接续缺项。
本轮范围：新增 qr:points 导出及六项测试；新增 A4 视觉证据复用保护及一项测试；同步正式地址、印前流程和当前记录。A1–A4 运行时、配置、页面和素材未改，未复现需修复的业务缺陷；未改依赖或单一 lockfile，复用已安装依赖，未重复 npm ci。
实际检查：npm run check（配置/HTTP + 41/41 Node）；npm run build；node tmp/run-a5-local.mjs 内实际 npm run test:a4:mysql（39/39）；git diff --check；最终地址二维码生成和 PNG/SVG 栅格图 10/10 实际解码通过。
环境：Windows Node.js 24.12.0 / npm 11.6.2 / 新建独立 MySQL 8.4.9（127.0.0.1:3317）；显式 TEST_DB_*，TEST_BROWSER_EXECUTABLE=C:/Program Files/Google/Chrome/Application/chrome.exe。微信网络/SDK 明确模拟，图片为生成夹具，SQL/文件/Chrome/进程重启真实。
隔离预检：前三次未进入业务回归，分别为两次监听未就绪及一次中文 datadir 回显乱码；只修临时启动器 --no-monitor，并用本次新建实例 UUID + 回环绑定 + 端口确认目标，未放宽为任意库。第四次完整回归一次通过；本次实例定向正常停止，3308、历史证据、环境文件未改。
成功日志：tmp/mysql-a5-3317-NEqc0T/suite.log；实时布局结果 tmp/changqi_a1_test_695566bf3c64/a4-regression.json，129 个状态/宽度组合全部通过。两名实际上传完成游客 self/staff 领取后人数=2、12 请求并发只首次、连续核对失败锁、失败不假成功、重启恢复均回归。
A4 证据：TEST_A4_REUSE_EVIDENCE=tmp/changqi_a1_test_577fd68e4b36；指纹 e44424a068e9df2af09357ff8f60b1ebd8f7494e47aecb58cf6ebdb02dc27fdb 未变。复用已确认 129 整页+6首屏+3地图图，不冒称重截或本轮逐图人工审阅；所有实时布局/业务断言保留。
A6.3：tmp/point-qrs-cq-fsxinhuo-cn/ 含 10 张 PNG/SVG、manifest、UTF-8 CSV、index.html、印刷说明和自动解码报告；ZIP 为 tmp/point-qrs-cq-fsxinhuo-cn-待验证纸样.zip（16,264 字节，SHA256 1dd40cf100b50c953e68d3169573be01e8abaec386832301a8a9b27b4f2e17c2）。包优先生成于 A4 基线+本轮脚本，manifest 如实记录 dirty 标记和源文件哈希，不伪造最终干净 HEAD。
公网/服务器：公共 DoH 两家均为 112.74.27.188；HTTPS 证书匹配且有效。首页仍默认“恭喜，站点创建成功！”，HTTP 未跳 HTTPS，`/api/activity` 和五条 `/q/` 均404；未提供项目链路。已通过 Tailscale 只读登录 root@100.95.32.56，确认 x86_64、约 1GB RAM、根盘可用 19G、宝塔静态站点、MySQL 5.7 系列客户端/3306 服务与既有 Node 端口；未发现 Docker/Compose，未访问个人领取码、未写库、未改服务器。
微信/纸样：实际公众号能力、后台域名/校验文件/出口白名单、运行凭据、菜单、iOS/Android 两类扫码入口、现场照片/领取和约5cm真实纸样尚未验证。当前官方 OAuth/JS-SDK 正文已读取，协议说明不等于账号配置成功；生产 MySQL/Cookie/照片目录和反代仍未实测。
印刷状态：正式地址已定，待真机/纸样试扫，不可直接批量印刷。文件和自动解码完成不代替真机/纸样；无用户批量印刷批准。
历史构建：源码 ca5f5b7f08bcaf1133bc162a05a60307747ec379；run 35587927134 / attempt 1；镜像标签 changqi-checkin-h5:ca5f5b7f08bc-35587927134-1；linux/amd64 测试平台，platformVerified=false；当时 artifact 上传额度失败。当前额度未知，未删其他项目产物、未调整付费或忽略上传错误。
A6.1 本轮：Dockerfile 加入一次性建表所需 schema/脚本，固定 Node 24.21.0 amd64 基础镜像 digest；Actions 平台按服务器实测改为 linux/amd64、platformVerified=true，增加临时 MySQL 的真实镜像启动冒烟、镜像内 Node/npm 版本记录和归档 SHA-256。Windows `npm run check` 41/41、`npm run build`、`git diff --check` 通过；run `35750893371` / attempt 1 在源码 `f14430b7039d2a810d13d08098da43f2b8734612` 上构建/冒烟/导出/上传通过，artifact `changqi-image-f14430b7039d-35750893371-1` 已下载到 `tmp/release-35750893371`，镜像归档 SHA-256 `e29d9e85c1f0509b46c59bb02c74033c0a9cf18176a224a429fb06af9ddbe929`。
下一步：在运行密钥与生产变更范围明确后，使用同一 artifact 在现有 1GB 服务器加载镜像、选择未占用回环端口、创建本项目目录/库/账号、配置 Nginx 并部署；不能复用现有 3000/3001 或默认站点。之后由用户操作 iOS/Android 微信及真实纸样。
2026-09-23 服务器接续：通过 Tailscale 安装 Docker CE 26.1.3、containerd 1.6.32、Compose v2.27.0，启用 `docker.service`/`containerd.service` 并实际通过 `docker version`、`docker info`、`docker ps`。为解决服务器 DNS，保留 Aliyun repo 的本地 hosts 映射并新增 Docker CE Aliyun repo；已上传并校验指定 artifact `e29d9e85c1f0509b46c59bb02c74033c0a9cf18176a224a429fb06af9ddbe929`，服务器已加载镜像 `changqi-checkin-h5:f14430b7039d-35750893371-1`。已创建并填充 `/opt/changqi-checkin-h5/.env.runtime`（root-only），容器 DB 地址改为 Docker 网关 `172.17.0.1`；执行镜像内 `db:schema` 创建 2 张项目表，容器重启后健康检查仍为数据库 connected；仅修改 `cq.fsxinhuo.cn` Nginx，加入反代、20 MiB 请求上限、原始 HTTPS 头和 HTTP→HTTPS 301。未清理生产数据、未修改其他站点/公众号菜单。二维码已生成交付待验证样张，不依赖 Actions artifact。
```

</details>

A1–A5 本地业务与已确认布局/UI 保留；本轮六张独立母版已接入并完成本地回归及实际目视，等待用户最终页面确认，不沿用历史视觉结论。系统已有部署，本轮仅本地换图与提交推送，未发布；真实微信、现场照片/领取及纸样仍需单独验证。
