# SPEC · 长岐村漫游打卡

**v1.4 · 2026-09-21 · 两种开发入口与轻量容器发布；业务合同不变**

本文件承接 [PRD.md](PRD.md)，替代旧 TSD。它规定必须发生的行为和最低技术约定，不新增管理平台或防刷模块。示例不代表代码已经存在；真实微信权限尚未核验。

## S01 · 配置与活动开关

一个服务端 `config/activity.json` 为唯一活动配置来源。至少含 `activityName`、`enabled`、`rules`、`claimLocationText`、公众号名称/引导资源、`points`。每个地点含 `key`、`name`、`image`、`displayOrder`；当前 key/name 按 PRD 表格。

`points` 必须非空、key 唯一；错误配置启动时报错，不能把 0/0 判为全部完成。所有地点必达，N 从配置得出。活动前可调整；活动中不变更必达 key 集合。只改名称不会丢记录，不开发规则迁移。

`enabled=false` 时仍可读取已有进度、已领取状态及人数，禁止新扫码打卡、新上传和首次领取；已领取者重复确认返回原状态。前端提示“活动暂未开放或已结束”。不另做活动日期调度系统。

## S02 · 身份与入口

拟采用微信公众号网页授权 `snsapi_base` 获取 OpenID，服务器创建/读取同一用户并建立普通会话；不请求昵称、头像或手机号。回调保留常规 `state` 校验与固定回调地址。身份取自微信服务器，不能由浏览器自行指定 OpenID。

同一个 OpenID 重进对应同一行 `users`，业务记录在 MySQL 中；不以 localStorage 的临时游客 ID 作为生产身份。会话过期后重新授权恢复记录。API 会话失效返回 `NEED_LOGIN`，不能跳转一串 HTML 被前端当成上传成功。

使用成熟会话中间件及 MySQL 持久化适配器；可由组件额外维护 `sessions` 技术表。HTTPS、HttpOnly 和普通同源 Cookie 设置沿用组件，不自研认证系统，不新增 Redis。密钥只在服务端。

普通浏览器访问游客活动页可提示“请在微信内打开”；不影响公开引导页、派发页和人数页的正常访问。真实公众号不支持拟定能力时报告具体阻塞，不擅自更换成手机号注册或新增一套认证。

开发模拟身份/扫码仅限显式开发模式，界面标“开发演示”；生产模式下禁用，配置错误时不能悄悄退回模拟。模拟通过不能替代微信真机验证。

## S03 · 两类二维码与页面内扫码

### 地点二维码

固定 URL：`${PUBLIC_ORIGIN}/q/:pointKey`，例如 `/q/p01`。只允许配置中的 key。

直接打开合法 `/q/:pointKey` **始终显示公众号/菜单引导**，即使游客已登录也不直接跳上传。无效 key 提示“地点不存在，请扫描现场活动二维码”。GET 不写打卡状态，也不设置扫码资格。

活动页内“扫一扫打卡”拟通过 `wx.scanQRCode({needResult: 1, scanType: ['qrCode']})` 获得结果，再提交 `POST /api/scan`，不是直接访问扫描出的链接。服务器解析 URL，匹配实际活动域名、`/q/` 路径和有效 key，保存普通会话的 `scannedPointKey` 并返回地点信息；会话保存完成才返回成功。前端进入对应上传页。

地图点击只查看，不设置 `scannedPointKey`。错误码、取消扫描、SDK 未就绪或权限失败应提示并允许重试，不能当成已完成或开放绕过扫码按钮。已完成地点返回原完成状态，不再要求上传。

这个会话字段只维持正常业务流程，不证明摄像头实际扫描、没有转发或已经到场。不做动态票据、额外点位签名或到场校验。

### 微信接入必要步骤

服务器提供当前同域页面的 JS-SDK 配置；拟按不含 `#` 的页面 URL 签名，前端等待 `wx.ready` 才启用扫码。尽量使用稳定外层 URL 的路由方式，减少返回页面时的签名差异。

`access_token`、`jsapi_ticket` 按微信返回的有效期复用；不每次扫码重新申请。不未经授权修改现有公众号消息服务；若已有第三方托管，先核对凭据管理方式。正式实现前按官方文档和实际账号验证，不能认为有 AppID 就一定可用。

### 游客领取二维码

每用户一个固定随机 `claimCode`，例如随机 16 字节编码为 32 位十六进制字符；保存后不频繁变化。链接为 `${PUBLIC_ORIGIN}/r/:claimCode`，全部完成后展示，不提前印刷。

该链接直接打开派发确认页，不要求关注、登录或员工账号。持码即能确认是本期接受的简化；码不动态刷新、不设过期票据或新增核销系统。无效码只显示凭证不存在。读取页面不更新领取状态。

## S04 · 单照片上传

原生文件选择、预览和重选，允许现场拍照或相册选择。只实现一条 multipart 上传链路，不再做微信媒体下载等备用系统。

输入为 `pointKey` 和 `photo`；用户身份从会话取得。支持经实测可解码的 JPEG/PNG/WebP；源文件上限 15 MiB。服务端检查实际图片类型、可解码性与大小，不能只信扩展名。使用成熟图片库纠正方向、最长边不超过 1600 px（小图不放大）、输出 JPEG 质量约 80。不能解码的格式明确提示重新拍照或转换为 JPG/PNG，不自研 HEIC 转换。

首次保存检查活动开启、地点有效、`scannedPointKey` 与地点一致。先写临时文件并处理，再移入部署包外的持久目录，最后插入 `checkins`。全部成功才返回完成。数据库失败清理本次新文件；重复写入保留首张成功照片和原记录，清理本次多余文件。随机文件名由服务器生成。

上传中禁用重复提交；失败不点亮。超时先重新查询本人记录：已成功则展示完成，确实未成功才让游客重试。刷新导致本地未上传文件丢失时提示重选，不承诺断点续传。

成功记录不提供修改、删除或覆盖。已完成地点的重复请求返回已有结果，不报成系统故障。普通会话失效时先重新登录恢复进度；尚未完成且扫码信息丢失，则提示重新扫码。

本人照片通过会话鉴权接口读取，不直接暴露磁盘路径，不让其他游客或派发页查看。照片用途提示：“照片用于本次活动打卡记录，不公开展示。”结束后的清理由运营通知后人工安排；照片已清理不能使历史打卡失效，也不建设自动清理模块。

## S05 · 进度和页面状态

`completedKeys = 已保存的地点 key ∩ 当前配置地点 key`；`completedCount = completedKeys.length`；`totalCount = points.length`；只有 `totalCount > 0` 且两数相等才 `allCompleted=true`。

不另存可发生漂移的累计进度字段，不单纯按 checkins 总行数判断全部完成。第三处尚未成功提交时仍显示 2/5，不能把“当前第 3 处”混为已完成 3 处。

上传成功、重新进入、页面恢复可见或点击刷新时读取服务器状态。不做 WebSocket 或高频轮询。地图状态和首页数字使用同一返回数据。

## S06 · 领取确认

| 场景 | 必须发生的行为 |
| --- | --- |
| 尚未全部完成 | 可查看进度，不展示可操作的首次领取按钮；服务端也拒绝首次领取 |
| 全部完成且未领取 | 显示本人领取码、“我已领取礼品”和领取地点说明 |
| 游客点击 | 弹出“请在实际拿到礼品后确认。确认后将标记为已领取。”；取消不写入 |
| 派发页打开 | 仅展示游客编号、X/N、是否完成、领取状态；无照片和 OpenID，不修改数据 |
| 持码者点击派发 | 交付礼品后点击“已完成奖品派发”，服务器确认领取 |
| 任意方式成功 | 记录首次领取时间和渠道；显示已领取，禁用再次操作 |
| 重复或两边同时确认 | 返回同一领取结果，计数只增加 1，不覆盖首次时间/渠道 |
| 网络或保存失败 | 不显示假成功；先查询最新状态，再决定是否重试 |

两条接口复用 `markClaimed(userId, source)`。用户已领取直接返回原结果；否则确认活动开启且全部完成，再执行一次条件更新并重新读取数据库结果：

```sql
UPDATE users
SET claimed_at = NOW(), claim_source = ?
WHERE id = ? AND claimed_at IS NULL;
```

`source` 由服务器接口固定为 `self` 或 `staff`，不采信客户端任意值。无需库存事务、派发流水或幂等请求账本。活动中不删除已完成记录、不改变必达集合。

“staff”只表示从派发页提交，不代表认证过操作者的员工身份。首期不提供撤销领取或管理修正功能。

## S07 · 领取人数

只读 `/stats` 展示“已标记领取人数”、查询时间和刷新按钮；使用 Nginx Basic Auth 或等价现成固定凭据保护，不开发登录界面或账号管理。若实现独立数据接口，必须一并保护，不能只保护 HTML。

```sql
SELECT COUNT(*) AS claimed_user_count
FROM users WHERE claimed_at IS NOT NULL;
```

错误显示“暂时无法读取，请刷新重试”，不能用 0 代替失败。只统计当前部署的一场活动、当前公众号内的微信身份；不按扫描/点击量累加，不管理库存、报表、用户列表或导出。

## S08 · 最小技术、数据与接口

### 架构

空仓库默认 Vue 3 + Vite / Node.js + Express / MySQL / Nginx，同域 HTTPS，单个应用服务。`web/` 放界面，`server/` 放接口；优先一个根 npm 项目、一个锁文件，不为此建立复杂 monorepo。已有可运行模板可等价复用。

版本由 A0 核对当前官方支持与兼容性后锁定。仅两张业务表，InnoDB、utf8mb4；会话组件可另建技术表。服务器文件存持久目录，数据库只保存路径。不引入 Redis、对象存储、消息队列、微服务或复杂 CI；允许一个按需 Actions 构建工作流。

生产采用一个应用镜像承载构建后的前端和 Node.js 后端，Compose 只运行 `app`；复用宝塔管理的 MySQL，宝塔 Nginx 提供 HTTPS 与反向代理。具体约定见 S10 和 [DEPLOY.md](DEPLOY.md)。网页端与本地开发使用同一套工程，不各建一个项目或一套发布脚本。

### 数据合同

| 表 | 必需字段与约束 |
| --- | --- |
| users | `id BIGINT UNSIGNED` 主键；`openid VARCHAR(64)` 唯一且区分大小写；`claim_code CHAR(32)` 唯一；`claimed_at DATETIME NULL`；`claim_source VARCHAR(8) NULL`；`created_at DATETIME` |
| checkins | `id BIGINT UNSIGNED` 主键；`user_id BIGINT UNSIGNED` 关联 users；`point_key VARCHAR(32)`；`photo_path VARCHAR(255)`；`created_at DATETIME`；`UNIQUE(user_id, point_key)` |

领取码区分大小写并由安全随机函数生成；无需加密业务表。SQL 使用参数化查询。外部只输出显示编号，例如 CQ000123；不返回 OpenID、数据库口令或服务器路径。时间在本项目统一按中国标准时间 UTC+8，API 输出含 `+08:00` 的时间串。

### 接口合同

JSON 正常结果统一 `{ok:true,data:{...}}`；错误统一 `{ok:false,error:{code,message}}`。图片、HTML 与 OAuth 跳转除外。已完成/已领取的重复操作返回正常已有状态，而不是再次累加或 500。

`/api/me` 的最小状态：`userLabel`、`completedKeys`、`completedCount`、`totalCount`、`allCompleted`、`claimedAt`、`claimUrl`。`claimUrl` 在未全部完成时为 null；`claimedAt` 未领取为 null。提交打卡/本人领取后返回更新后的同类状态。

| 方法 / 路由 | 约定 |
| --- | --- |
| GET /auth/wechat；GET /auth/callback | 发起/回调授权，建立会话后回活动页；回跳只允许本应用路径 |
| GET /api/activity | 公开配置，含活动开关、地点、说明；无密钥 |
| GET /api/me | 本人状态；依赖会话 |
| GET /api/wechat/js-config?url=... | 校验同域页面 URL 后生成配置，不输出 AppSecret |
| POST /api/scan | JSON `{result:扫描原始文本}`；返回 `{point,alreadyCompleted}`，保存扫码地点到会话 |
| POST /api/checkins | multipart：`pointKey`、`photo`；保存后返回本人状态 |
| GET /api/me/photos/:pointKey | 仅本人读取已保存图片；清理后返回明确无图状态 |
| POST /api/me/claim | 本人确认，渠道 self；返回本人最新状态 |
| GET /q/:pointKey | 地点引导页，不设置扫码资格 |
| GET /r/:claimCode | 派发页，只读打开，不要求员工登录 |
| GET /api/r/:claimCode | 仅返回对应游客显示编号、X/N、allCompleted、claimedAt；无照片、OpenID |
| POST /api/r/:claimCode/claim | 对该游客确认派发，渠道 staff；返回同一公开状态 |
| GET /stats | 固定凭据保护的只读人数页；可直接服务端渲染，不强制多写一个 API |

常见错误：`NEED_LOGIN` 401；`PLEASE_SCAN` 403；`INVALID_POINT`/`INVALID_CLAIM_CODE` 404；`INVALID_QR` 400；`IMAGE_TOO_LARGE` 413；`UNSUPPORTED_IMAGE` 415；`NOT_COMPLETED`/`ACTIVITY_DISABLED` 409；保存失败 `UPLOAD_FAILED` 或 `SAVE_FAILED` 500。前端显示可理解提示与重试路径，服务端记录异常，不向游客泄露堆栈或凭据。

### 必要环境配置

见根目录 [.env.example](../.env.example)。至少有 `PUBLIC_ORIGIN`、微信 AppID/AppSecret、数据库连接、`SESSION_SECRET`、`UPLOAD_DIR`、开发模拟开关。生产必须校验必需项，不能无声降级到演示。文件中所有值均为占位，不代表可运行环境。

## S09 · 视觉与页面实现

参考 [视觉说明](../assets/reference/README.md)。主色与插画方向不重设计；当前参考稿不构成精确地理位置或真实建筑形态的证据。

首页/示意地图可合并；打卡成功可用弹层。必须有真实上传预览、提交中、失败、已完成、未达标不可领取、待领取、已领取及无效二维码状态。去掉参考图的手机边框和小程序胶囊。

名称与数量不烘焙进插画。首页说明只写“上传现场照片”，不出现装置选项；不得宣称“非现场绝对无法打卡”。地点文字与 PRD 一致。两张不同手机宽度截图即可作本地视觉检查，不增加全量视觉回归平台。

## S10 · 两种开发入口、构建、部署与二维码交付

### 开发与构建合同

允许 ChatGPT 网页端通过已授权 GitHub 工具开发，也允许电脑本地 Coding Agent 开发。共用一份 TASKS；切换时读取实际最新提交，保留本地修改，按安全 fast-forward 同步。网页端没有本地/SSH 工具时，不声称检查或同步了用户电脑和服务器。

一个 `.github/workflows/build-image.yml` 承担按需检查与构建：支持 `workflow_dispatch`；同时支持 `main` 上仅 `.github/build-request.txt` 变化的 `push` 触发，供没有 dispatch 工具但能提交文件的网页端使用。请求文件只是一行本次请求标识，不是脚本或另一个任务系统。普通代码/文档提交不更新它；两个入口不对同一次请求重复触发。细节及平台资料见 [DEPLOY](DEPLOY.md)。

构建必须检出该次运行对应的实际提交，记录完整 SHA；不在构建过程中重新拉移动中的最新 main。检查成功再导出可由 `docker load` 加载的单平台镜像归档；同一 artifact 带镜像包、非敏感 `build-info.json` 和对应版本的 Compose 文件。元数据记录源码 SHA、run ID/attempt、平台、镜像标签和构建时间；镜像标签必须能对应具体构建，不仅使用 latest。

GitHub 托管 runner 执行构建，服务器不运行构建。需要 MySQL 测试时允许 runner 内的临时测试库，不读取生产数据。仅选择已核对服务器架构对应的平台；64 位系统不等于已确认 amd64。Actions 产物默认保留 3 天；上传失败/产物过期时不得称已有可部署镜像。保留必要检查，不通过忽略错误使构建变绿。

### 生产部署合同

用户提供：1 核 1GB、可扩容；Alibaba Cloud Linux 3.2104 LTS 64 位、宝塔、已安装 MySQL。首次部署由有权限的本地 Agent 只读核对 CPU 架构、资源、版本、端口和 SSH 目标；现有信息不代表已检查，升级不是开工前置条件。

默认本地 Agent 从指定 Actions 运行下载产物，经 SSH/SCP 上传，服务器 `docker load` 后按对应标签更新 `app`。不依赖服务器到 GitHub/镜像仓库下载发布镜像；仍需满足应用运行时的微信等网络访问。不建设镜像仓库、自动 SSH 发布工作流或集群。

宝塔 Nginx 保留 80/443 入口；应用容器只发布到宿主机回环端口，再由 Nginx 代理。复用宝塔 MySQL，为项目建独立数据库和账号，不另部署生产 MySQL 容器或随意升级现有实例。容器连接宿主机数据库的地址、监听与账号需实际验证，不能把容器内 localhost 当成宿主机；数据库不开放到公网。

运行密钥留在服务器环境文件；SSH 私钥留在已授权的本地执行端，不放 Git、镜像、artifact 或 Actions。Compose 使用已导入的镜像，不包含生产 `build` 步骤；只启动一个应用进程，不运行 Vite 开发服务。

Nginx 请求体限制与 15 MiB 图片上限一致留余量。`UPLOAD_DIR` 挂载到服务器持久目录，MySQL 与环境文件独立于镜像。部署前备份、记录当前版本；更新后检查容器、日志、接口、旧进度及照片。只回退应用不恢复旧游客数据，不使用删除数据卷的操作。初次配置和后续命令见 DEPLOY；连接权限、构建权限与具体生产操作授权分别确认，同次明确授权范围内不逐条重复询问。

### 二维码交付

二维码生成脚本读取 `PUBLIC_ORIGIN` 与地点配置，输出每处 PNG、SVG，以及 key/名称/URL 对照清单。二维码保留黑白对比和足够空白边（四周至少 4 个模块），不套用效果图里的假码。默认先做约 5 cm 样张试扫；不是所有距离下都可扫的保证。

测试码必须标“测试，不可正式印刷”；正式域名未定或未核验时只交生成脚本，不产生冒称正式的印刷包。生产每处二维码均经真实扫码核对后再印刷。个人领取码运行时显示，不提前印刷。

## S11 · 验收条件

| 编号 | 操作与通过标准 | 实际验证位置 |
| --- | --- | --- |
| AC-01 | 配置 key 唯一、N 动态；空集合/重复 key 拒绝启动；关闭活动不允许新增记录或首次领取 | 本地配置/API |
| AC-02 | 公众号菜单进入并重进，恢复同一身份与进度；两用户和本人照片不串用 | API + 微信真机 |
| AC-03 | 直接扫地点码进入引导；页内扫同码进入正确上传地点；地图点击不取得提交资格 | API + 微信真机 |
| AC-04 | 扫码取消、错码、未就绪和权限失败可恢复，错误不假成功 | 本地解析 + 微信真机 |
| AC-05 | iOS、Android 实际拍照/相册选择、预览、重选、提交可用 | 微信真机 |
| AC-06 | 超大/损坏/不支持图片或保存失败不记完成，清理本次无效文件 | 本地/API/MySQL |
| AC-07 | 成功刷新恢复，重复或并发上传只一条记录、保留首图；超时先查状态再重试 | API/MySQL |
| AC-08 | 2/5 提交第三处后才是 3/5；历史无关 key 不算必达完成；未全部完成拒绝首次领取 | 本地/API |
| AC-09 | 游客确认可取消；确认后已领取；派发页打开不修改，点击后正确标记 | API + 页面 |
| AC-10 | 同一游客两种方式重复/同时确认只首次计数且不覆盖首次时间；非法领取码无效 | API/MySQL |
| AC-11 | 两名测试游客各领取一次，隔离测试库计数为 2；统计失败不显示 0，人数页受保护 | API/MySQL |
| AC-12 | 手机无横向溢出，按钮可操作；地名正确、只有照片方式；所有进度为真实数据 | 浏览器截图 |
| AC-13 | 两种入口可触发同一工作流；下载镜像的 SHA/平台与部署版本一致；单应用容器复用宝塔 MySQL；重启/更新不丢数据；生产禁用模拟、凭据不入镜像或 Git | Actions + 部署/代码检查 |
| AC-14 | 每处生产码、游客领取码走正确流程；真实纸样和两种手机实际可扫 | 样张 + 微信真机 |

用两个不同微信身份完成全流程，分别验证游客确认与扫码派发。生产数据验收只核对增量，不清空真实数据以凑测试人数。所有实际结果集中记入 TASKS，不凭文档或模拟结果勾选真机通过。

## 资料来源与核验边界

业务部分沿用 PRD v1.3；v1.4 补充用户已确认的双入口开发、Actions 构建和宝塔单容器发布方式。本轮已核对 GitHub/Docker 的相关官方资料，入口见 [DEPLOY](DEPLOY.md)；**未核验实际公众号权限、服务器版本或执行构建**。以下微信等资料为沿用入口，不表示已经接入成功：

- 微信网页授权：[官方文档入口](https://developers.weixin.qq.com/doc/offiaccount/OA_Web_Apps/Wechat_webpage_authorization.html)。
- 微信 JS-SDK：[官方文档入口](https://developers.weixin.qq.com/doc/offiaccount/OA_Web_Apps/JS-SDK.html)。
- 会话中间件：[Express session 文档](https://expressjs.com/en/resources/middleware/session/)。
- 原生文件选择：[MDN file input](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/file)。
- 条件更新：[MySQL UPDATE 文档](https://dev.mysql.com/doc/refman/8.4/en/update.html)。
- 二维码空白区：[DENSO WAVE 文档](https://www.qrcode.com/en/howto/code.html)。

A0/A1 应查阅当时可用的官方资料并在 TASKS 中记录与本项目有关的实际核验结果；不要把资料入口可访问等同于账号权限可用。
