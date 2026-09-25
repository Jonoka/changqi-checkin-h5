# TASKS · Coding Agent 执行清单

**v1.9 · 2026-09-25 · 网页端 / 本地 Agent 可接续，单次顺序执行**

输入：[PRD.md](PRD.md)、[SPEC.md](SPEC.md)、[AGENTS.md](../AGENTS.md)、[视觉参考](../assets/reference/README.md)。发布方式见 [DEPLOY.md](DEPLOY.md)。本文件既是任务清单，也是唯一进度/接续记录，不再维护人工排期或另一份状态文档。

## 0. 当前真实状态

### 2026-09-25 · 只读统计、CSV 与受控照片导出（本地验证通过，待 Draft 交接；未部署）

已核对 PR #1 实际 merged/closed、合并提交 cd4c18d、已验收 head a399d54；远端/Windows main 同为 `7885c4e62da0d771c1d400cfdaa7caf7de5b3a44`，全量 porcelain 干净，无开放 PR、无同名目标分支。从此 main 新建 `feat/stats-photo-export`，不继续旧分支。按用户新需求最小更新 PRD/SPEC，以下既有发布和真机历史全部保留。本轮仅实现/隔离验证，不连接生产、不发布、不触发 Actions、不改活动配置/地图/分享/正式二维码。

实现共享 `activity-reports.js` / `report-csv.js`：唯一服务端配置、精确当前 key、动态非空 N、BIGINT 字符串 CQ，短同 connection 只读一致快照；参与/完成/领取/完成未领取独立按条件计算，缺图不撤销打卡，异常领取只提示。北京时间每日事件先聚合完整记录再分组。可选 `STATS_EXCLUDE_CQ_FILE` 默认空，规范名单失败即报错，只公开启用及匹配数。`/stats` 保留既有样式、固定凭据、手动刷新；三个固定 `/stats/export/{summary,points,daily}.csv` 同样先认证。CSV 为 BOM UTF-8、中文、正确转义/公式防护，网页仅聚合资料。

新增 `npm run export:activity -- --help` / `--out <私有新批次绝对目录> --scope participants [--dry-run]`。另支持 completed/claimed，三个统计CSV始终为活动总览。显式 DB_* / UPLOAD_DIR，不自动加载 .env 或建库/迁移。只复制当前已提交引用，逐张64KiB缓冲，核对前后路径/revision及源文件身份，最多3次；源图消失或同名文件替换也不得凭旧句柄报成功。批次拒绝覆盖、源目录/源码重叠及链接，输出兼容Windows；空间不足、权限、断连、中断分别如实失败。6份CSV、照片和 export-info 保存实际版本/哈希、预期/成功/异常数；退出0完整、2部分、1致命。未新增照片权限、网页相册或压缩服务。源码指纹记录实际文件哈希，提交/镜像标识取不到即说明。

最终实际执行：`npm run check` 配置/HTTP与 **86/86**、`npm run build`、`git diff --check` 全通过；日志 `tmp/stats-export-final-ltpd0B/{check,build}.log`。独立 **MySQL 8.4.9 127.0.0.1:3325**、全新 datadir/UUID 验证、显式 TEST_DB_*、合成JPEG与实际 Chrome 154.0.8037.57：`npm run test:export:mysql` **9/9分组**，`npm run test:a4:mysql` **57/57分组**（已含A1–A3）通过；最终日志 `tmp/mysql-stats-export-3325-FoqRyK/{test-export-mysql,test-a4-mysql}.log`。仅关闭本次隔离实例，测试随机库按原入口清理；历史环境、照片与证据保留。Windows仍为 Node24.12.0/npm11.6.2，未升级运行时/依赖/单一lockfile。

独立固定期望 A仅识别、B2处、C全完成未领取、D全完成已领取得到 **4/3/2/1/1/12**；覆盖空库、零地点人数、可变N、历史/大小写key、跨日/+08边界、排除、超大CQ、异常领取、查询失败和认证下载。真实导出 participants=3人/12图、completed=2人/10图、claimed=1人/5图，原字节/哈希一致，业务行全量摘要未变；替换竞争以第2次取得新版本，起始快照后新增身份不混入，复制期间真实领取21ms提交（仅本次小样本观察）。连续变化3次/缺图/坏路径各为11成功+1异常，完成统计不变。权限/空间/合作式中断另有显式故障注入；源路径消失/重绑定、NTFS junction/硬链接拒绝也实际验证。

最终证据 `tmp/changqi_export_test_9117de59304c/`：`http-{summary,points,daily}.csv`、`cli-dry-run.json`、`export-verification.json`、`stats-screenshots.json`、`stats-review.html`、`stats-390.png`（390×1767）和 `stats-1440.png`（1440×1526）。PNG完整解码、尺寸/哈希与Chrome实际DOM数字、无横向溢出/手动刷新均通过；源码逐文件哈希与本轮最终运行时代码一致，证据如实记录基准HEAD+dirty工作区，不伪称提交后截图。WebCodex图片回传仅取得元数据、原生窗口复核报 stale_surface，本轮不冒称逐图目视已通过；可在本地 stats-review.html 复核。合成批次在 `C:\Users\ADMINI~1\AppData\Local\Temp\changqi-export-synthetic-pwwCJ5\batches`，7批次与6份清单已回读检查；不含生产游客照片，不入Git/Actions/聊天。A4最新证据 `tmp/changqi_a1_test_94faee915ebe/`，只选择本轮stats及必要home/认证恢复状态，不机械重做历史截图。

保留中间失败与修复：最初FileHandle关联流关闭等待超时，改为显式有界读写；Chrome专项选择器引号错误的失败日志 `tmp/mysql-stats-export-3325-YIlTti/` 保留，修复后重新运行；提交前补源路径复核后完整重跑为上述最终结果。旧地图/分享完整标题、首次上传/领取、照片认证恢复、账号隔离和进程重启回归均通过，微信网络/SDK仍是模拟，不称真机通过。

Dockerfile已在构建和运行阶段复制CLI，11个传递本地模块与3个既有生产依赖的静态复制链、实际CLI --help通过；.gitignore/.dockerignore忽略导出资料。package-lock、schema、compose、activity、web与工作流均未变；无新增表/索引/生产ALTER。DEPLOY给出未来指定镜像一次性运行、照片只读/输出单独可写示例。**未执行新镜像构建或容器运行、生产导出/部署、真实系统磁盘耗尽/断电或大规模负载验证**；源码环境专项的进程RSS采样约99MiB，不是部署上限。负责人仍需确认输出父目录不被Web服务公开、Windows ACL/文件系统能力，以及正式收尾停止写入授权；不会自动清理或停活动。

### 2026-09-25 · main 合并版本同步并发布（生产检查通过，新增真机待验）

Windows 工作区开工 porcelain 干净；远端默认分支 `main` 为 PR #1 合并提交 `cd4c18dde1e26d4820f7fb6787089488b8c5da9b`，包含原 `feat/a1-wechat-scan` head `a399d54fd69715e0460321c5b24b93a89aa18fc2`，无开放 PR。本地 `main` 已从 `cc411965dd384e9608a80abf87a9e883eea8294d` 安全 fast-forward 到该提交，未 reset/clean，也未覆盖忽略文件。

Actions run `36095477907` / attempt 1 在上述 `main` SHA 上成功完成依赖安装、配置与 Node 测试、前端构建、linux/amd64 镜像构建、临时 MySQL schema/应用冒烟、导出和唯一 artifact 上传。artifact `changqi-image-cd4c18dde1e2-36095477907-1` 未过期；下载目录 `tmp/release-36095477907`，镜像归档 105,201,545 B、SHA-256 `1a4526331c6ea968e869606abfd6a235262afc8d877d1ec824082ba82329de30` 与 sidecar 一致。`build-info.json` 的 source SHA、run ID/attempt、`linux/amd64`、Node `v24.21.0`、npm `11.19.0` 和镜像 `changqi-checkin-h5:cd4c18dde1e2-36095477907-1` 均与运行记录一致。

服务器预检确认 Docker 26.1.3、Compose v2.27.0、x86_64、原容器数据库健康、`.env.runtime` 为 root 600、`network_mode: bridge`、`127.0.0.1:3002` 及必要密钥存在；未输出密钥值。发布文件上传至 `/opt/changqi-checkin-h5/releases/36095477907` 并复核同一归档哈希，加载镜像 ID `sha256:8747d4b5654733480b018a1bd1902eb68d434731a5d5a6545413180485ece8d7`。回滚备份为 `/opt/changqi-checkin-h5/backups/.env.runtime.before-36095477907`、`compose.before-36095477907.yaml`、`cq.fsxinhuo.cn.conf.before-36095477907` 和 `image.before-36095477907.txt`；原镜像保留。持久照片目录、生产数据库、Nginx、公众号菜单、DNS、证书及其他站点未修改。

同一新镜像幂等 `npm run db:schema` 成功显示项目 3 表，随后只重建 app 容器。服务器回环与 Windows 外部 HTTPS 均通过：`/health` 200/database connected、`/api/activity` 活动名与五点、`/q/p01` 200、v2 WebP 200 image/webp、未登录 `/api/me` JSON 401、无效领取码 JSON 404、`/stats` 401、HTTP→HTTPS 301；`nginx -t` 通过。容器实际重启后仍为上述 tag/镜像 ID、bridge、回环端口且数据库健康。未调用生产上传、领取或统计写路径；本次上线的照片替换认证恢复和既有分享完整标题仍待 iOS/Android 微信真机专项确认。

### 2026-09-25 · 照片替换认证恢复（历史本地检查；后续发布见上）

开工已读 AGENTS、README、PRD、SPEC、TASKS、DEPLOY。Windows/远端 `feat/a1-wechat-scan` 均为参考 HEAD `2a07a18c09bdae8582fd1fbb301c0f4cb78f8886`，全量 porcelain 干净；main 为 `cc411965dd384e9608a80abf87a9e883eea8294d`，PR #1 Draft/Open、未合并、Review/行内评论为空，无其他开放 PR。沿原分支修复认证失效后只能不断核对、缺少重新登录入口的问题；这是恢复路径缺口，不是永久数据丢失。

运行时代码只改 `photo-replacement.js`、`SavedPhoto.vue`、`App.vue`：保留 NEED_LOGIN/PHOTO_OWNER_CHANGED 类型，前置查询、PUT、核对及图片读取统一发出已有 login-required 事件；及时撤下旧身份照片/本地预览，保留独立业务锁，只允许现有“重新识别微信身份”显式授权入口。owner（userLabel）/pointKey/replacementId/expectedRevision/fileHash/原 point 或 claim 视图仍按原标记保留，不存 OpenID、Cookie 或照片。同用户回来先读服务器 revision；未保存/未知结果继续锁定，只允许选回同一文件显式同 ID 重试；不使用 completedKeys 判断成功、不自动重传、不重建 UUID。A→B 不读取或提交 A 的未决操作，不展示 A 照片；B→A 后才恢复 A 标记。空闲页已有的并行身份刷新仍可完成账号切换；该读取本身失败时也保留显式登录入口，不放开未决业务操作。

先补失败证据：新增 3 个认证单元用例在旧代码上全部失败（原 7 个通过）；完整隔离 Chrome 回归在进入编辑后前置查询 401 的“重新认证入口”断言处失败，日志 `tmp/mysql-photo-auth-3325-oc3Zuf/suite.log`。修复期间 `WOnilZ` 运行发现空闲账号切换竞争，已修复并增加确定性先后顺序检查；失败与中间通过日志均保留。最终源码实际执行 `npm run check` 配置/HTTP + **75/75**、`npm run build`、`git diff --check` 通过；仓库的 A4 入口是 `npm run test:a4:mysql`（没有单独的 test:a4 脚本），完整套件 **57/57** 通过。覆盖前置/PUT/核对/图片 401、连续 401 与手动 OAuth、服务器已保存但会话丢失、未发送/未保存、同用户重进、A→B→A、同文件同 ID、未知锁、凭证照片/二维码/领取一致及首次人数不重复；旧上传/领取/扫码与实际进程重启回归保留。

隔离启动器 `tmp/run-photo-auth-local-20260925.mjs`，显式 TEST_DB_* 指向全新 MySQL 8.4.9 `127.0.0.1:3325`，校验本次 datadir 的 UUID、回环绑定和端口；实际 Chrome、SQL、文件与会话/OAuth 路由，微信服务/SDK/网络故障明确模拟。最终日志 `tmp/mysql-photo-auth-3325-vEE7fx/suite.log`；结束只关闭本次自建 MySQL，不访问生产数据库。Windows 验证运行时仍为 Node `v24.12.0` / npm `11.6.2`，本轮未更换运行时/依赖。

截图与实时报告：`tmp/changqi_a1_test_a8411c19740b/{index.html,a4-screenshots.json,a4-regression.json}`。204 个实时状态/宽度检查通过；只新增编辑、需重新认证、同用户待核对、成功恢复、不同用户五种状态的 320/390/430px **15 张所选截图**，未机械重做全套历史截图。38 个运行时文件逐一回读一致，指纹 `6b01ac1b6ddd4b85b188aae4d40212c45d97b15e0754890f1c69b26f4a4479b9`；15 张 PNG 完整解码与尺寸检查通过。证据如实记录基准 HEAD + 工作区文件哈希，不伪称提交后截图。远程 computer_snapshot 回传报 invalid_runner_response，本轮不冒称逐图人工目视通过；原 PNG 和本地 index.html 可供复核。

未改地图、分享图/完整标题、正式二维码、统计、数据库结构、服务端鉴权及上传/领取业务范围；未增加后台或照片协议。既有微信授权、扫码、首次上传、领取、纸样的用户确认仍有效，只有新增认证恢复未做真机验收。本轮只提交必要代码、测试和 TASKS，并更新原 PR 记录；不转 Ready、不合并、不触发 Actions 镜像构建或发布。现有生产版本沿用下方已记录的分享标题发布，不把本地修复称为已上线。

### 2026-09-24 · 分享卡片完整标题修正（已构建并发布，待新卡片真机确认）

开工本地/远端分支 `feat/a1-wechat-scan` 与审阅基准 `69cf9f71adc1c50d8af1a0f9992d970949b66d60` 一致，Windows 全量 porcelain 干净；main 仍为 `cc411965dd384e9608a80abf87a9e883eea8294d`，PR #1 Draft/Open、未合并、Review 为空，无其他开放 PR。用户反馈新海报已显示但标题仍旧；核对确定共享配置及 HTML title/og:title 仍写短名称，原测试只与同一配置比较，不能证明满足完整标题要求。此问题按代码值修正，不归因于缓存。

运行时只改 `WECHAT_SHARE_DATA.title`、HTML title 和 og:title 三个值为“2026三水区芦苞镇长岐古村黄金节庆影视游园季活动”，不截断。聊天/群聊、朋友圈和旧接口回退继续共用配置。描述、`https://cq.fsxinhuo.cn/share/share-card-v1.jpg`、公开入口 `https://cq.fsxinhuo.cn/` 不变；无 document.title 赋值或额外路由分享覆盖。PRD/SPEC 同步当前要求。`config/activity.json.activityName`、首页 h1 仍为“长岐村漫游打卡”，App/匿名派发组件、SDK 初始化/签名/授权、地图 v2、海报字节和单一 lockfile 均未修改。

Node `v24.12.0` / npm `11.6.2` 实际执行：新增独立完整标题期望测试在修正前 **2/2 失败**，明确捕获配置和模拟 SDK 参数中的旧标题；修正后 `npm run check` **72/72**、`npm run build`、`node scripts/a1-unit.test.mjs --built` **16/16**、`git diff --check` 通过。模拟现代/旧 SDK 在首页、带 OAuth 参数的地点 hash、带扫码字段的游客凭证、匿名 `/r/` URL 环境下读取 ready 后实际参数，并逐一重新初始化；标题逐字正确，分享 link 始终是无参数公开首页。源 HTML 与实际构建 HTML、其引用的 `index-sr3tkXpP.js` 中具体分享对象均通过独立期望值检查；产物 JPEG SHA-256 仍为 `c8ccfebc011319b3fb0b5c26356abb5055d7429ff0c0912055d77212a7976db3`。非微信不加载 SDK、扫码取消/失败/重试与原生上传相关既有轻量回归通过；未机械重跑 MySQL/Chrome 全套，不冒称真机或实际浏览器分享通过。

修复源码为 `a851773b3571796d0e902c365560284b14559b82`。Actions run `36006086113` / attempt 1 的 `headSha` 与源码一致，检查、前端构建、临时 MySQL 冒烟、linux/amd64 镜像导出及 artifact 上传均成功；artifact `changqi-image-a851773b3571-36006086113-1`，归档 105,200,118 B、SHA-256 `cfdd143b4306cb72391ebf4785b1b183866c2322082cba5d4b37470195375e3d`，镜像 `changqi-checkin-h5:a851773b3571-36006086113-1`、ID `sha256:d9a7a39fecf49501f21c3b1bcc851c5d35e03fb923703fd46136f65467f25585`，Node `v24.21.0`、npm `11.19.0`。同一 artifact 下载至 `tmp/release-36006086113`，上传至 `/opt/changqi-checkin-h5/releases/36006086113`，未重跑旧 run `35995282545`。

发布前备份位于 `/opt/changqi-checkin-h5/backups/36006086113-20260924T133823Z`，包含原 `.env.runtime`、Compose、Nginx 配置、旧镜像记录、数据库 SQL gzip、持久照片 tar 及已校验的 `SHA256SUMS`。服务器校验归档和镜像内分享合同后加载同一镜像，幂等 schema 显示项目 3 表成功，再只更新现有 app 容器；未新增数据库迁移，未修改数据库权限、Nginx、公众号菜单、DNS、密钥、照片或游客记录。生产保持 `network_mode: bridge`、`127.0.0.1:3002` 和 `/var/lib/changqi/uploads` 挂载，旧镜像 `changqi-checkin-h5:7365b0d887f9-35995282545-1` 保留用于回滚。

服务器回环与 Windows 外部 HTTPS 均读取实际线上 HTML 引用的 `/assets/index-sr3tkXpP.js`：title、og:title 和具体分享对象均为完整标题，描述、海报 URL、公开 link 保持原值；`/api/activity.activityName` 仍为“长岐村漫游打卡”。海报返回 200 image/jpeg、61,605 B，SHA-256 仍为 `c8ccfebc011319b3fb0b5c26356abb5055d7429ff0c0912055d77212a7976db3`。`/health` database connected、五点活动配置、`/q/p01`、未登录 `/api/me` 401、无效领取码 404、`/stats` 401、HTTP→HTTPS 301 和 `nginx -t` 均通过；应用容器实际重启后仍为同一 tag/镜像 ID并健康，bridge 与照片挂载未变。**代码修正、Actions 构建和线上资源更新已通过；待新分享卡片真机确认。**

真机待验：iOS/Android 关闭旧活动页，重开正式首页并等待身份读取/SDK ready，从首页、地点、游客凭证和已有匿名派发页各新发卡片，不转发聊天中的旧卡片；记录完整配置标题对应的客户端可见行数、新海报及点击落地公开首页。既有授权、扫码、首次上传、领取和纸样用户验收仍保留。以下为原执行记录，短标题和当时验证结果不改写为本次完整标题通过。

**当前轮：微信分享卡片固定公开入口（2026-09-24，本地实现、Actions 构建和生产部署通过；待微信真机确认）。** 开工 Windows 工作区干净，分支 `feat/a1-wechat-scan`、起点/远端 PR #1 head 均为 `f522719f9b8d5e141fbbf995cf7c675d64e0ae52`；实现源为 `7365b0d887f99387b5ed6984b5eefcb977614e6c`，main 仍为 `cc411965dd384e9608a80abf87a9e883eea8294d`。PR #1 保持 Draft/Open、merge state CLEAN，没有 reset、clean、合并或转 Ready。

微信 SDK ready 后统一配置聊天/群聊和朋友圈：标题“长岐村漫游打卡”，描述“微信扫码参与长岐村漫游打卡，上传现场照片，集齐地点后现场领取礼品。”，图片 `https://cq.fsxinhuo.cn/share/share-card-v1.jpg`，链接固定 `https://cq.fsxinhuo.cn/`。首页、地点 hash、游客 `/#claim` 继续复用原 SDK 初始化；匿名 `/r/:claimCode` 只新增同域签名和固定公开分享数据，不取得身份、照片或领取权限。分享内容不读取当前 URL，因此不携带 claimCode、OAuth code/state、scannedPointKey 或统计路径；非微信环境直接跳过分享 SDK。

用户提供的 JPEG 原字节保存在 `assets/share/share-poster-original-v1.jpg`：1500×995、313,405 B。运行图 `web/public/share/share-card-v1.jpg`：800×800、61,605 B；使用现有 `sharp` 等比缩放并以原图近似米白背景补成方图，完整保留“八茗长岐”、2026 活动信息、兔子和灯笼，不重新生成或改写海报。版本化文件名用于规避微信旧图缓存；Vite 构建产物已包含同路径图片。

`npm run check` 配置/HTTP及 **70/70 Node 测试通过**；覆盖 SDK ready 后两类新分享 API、固定公开链接、私有字段不进入 link、非微信无副作用，以及匿名同域 JS-SDK 签名不创建游客身份。`npm run build` 通过；产物 HTML 含 title/description/OG 兜底，产物图片 61,605 B；`git diff --check` 通过。本轮没有业务、数据库或布局改动，未重复运行隔离 MySQL/Chrome 全套。

Actions run `35995282545` / attempt 1 在源码 `7365b0d887f99387b5ed6984b5eefcb977614e6c` 上成功，检查、前端构建、linux/amd64 镜像、临时 MySQL schema/应用冒烟、导出和上传均通过。唯一 artifact 为 `changqi-image-7365b0d887f9-35995282545-1`；归档 105,201,610 B、SHA-256 `29bb56995d94fac792eb64095b663297f6362ed9a67e14e9cf11c262f0ae3a1c`，镜像 `changqi-checkin-h5:7365b0d887f9-35995282545-1`、ID `sha256:48fa5ec43fd515062270fd1945770c816a5057c87df62771d3e07d0f881002e5`，Node `v24.21.0`、npm `11.19.0`。artifact 下载至 `tmp/release-35995282545`，上传至 `/opt/changqi-checkin-h5/releases/35995282545`；本地、服务器归档哈希和镜像内分享图 SHA 均一致。

部署前完整备份位于 `/opt/changqi-checkin-h5/backups/35995282545-20260924T115746Z`：原 `.env.runtime`、Compose、Nginx 配置、旧镜像标识、3 表 SQL dump 和完整持久照片 tar，`SHA256SUMS` 全部回读通过。项目账号从宿主机连接受既有 host 授权限制，备份最终使用现有本机 root socket 完成，未改数据库授权；Docker Hub 客户端镜像下载超时未影响运行。新镜像幂等 `db:schema` 显示 3 表成功；首次脚本切换因 `docker compose run` 消费 SSH 标准输入而触发自动回滚，旧容器保持健康；改为 `-T </dev/null` 后完成替换。

生产当前运行上述新镜像，保持 `network_mode: bridge`、`127.0.0.1:3002` 和 `/var/lib/changqi/uploads` 挂载。服务器回环和 Windows 外部 HTTPS 均验证：`/health` database connected、`/api/activity` 活动名及五点、首页 OG 分享 meta、`/q/p01` 200、v2 地图 200/485,720 B、分享图 200 image/jpeg/61,605 B 且 SHA 正确、未登录 `/api/me` 401、无效领取码 404、`/stats` 401、HTTP→HTTPS 301；Nginx 配置通过且未修改。容器重启后仍为同一 tag/镜像 ID并健康。未调用生产上传、领取或统计写接口；微信真实聊天卡片标题、缩略图缓存和点击落地仍待真机确认。

**当前轮：同步最新源码并替换最终现场地图 v2（2026-09-24，本地完整回归、构建和生产部署通过，微信真机待验）。** 开工 Windows 工作区干净且已与 PR #1 远端 head `a89919969799738a7871a15c5426642f65bf1d57` 一致，无需 fast-forward；main 仍为 `cc411965dd384e9608a80abf87a9e883eea8294d`，PR 保持 Draft/Open。沿用 v1 的完整成图 + 五个透明热点方案，不恢复网页路线/兑奖处/编号叠加，不改地点、二维码、OAuth、扫码、照片核查/替换或领取逻辑。

新 PNG 保存为 `assets/illustrations/restoration/masters/map-field-final-v2.png`，1377×1142、3,439,453 B、SHA-256 `236031caf5869710d9671893dc2ac21ec015b282d5791cf9af82defa670c353e`；运行 WebP 为 `web/public/art/map-field-final-v2.webp`，同尺寸、485,720 B、SHA-256 `8c8d376ff3f0807cf8cce7a3afdfe266a61d7e3aff5e3806bf0b0577b477462c`。v1 资产不覆盖。编号圆心重新校准为 p01 `(5.00,36.65)`、p02 `(56.39,59.59)`、p03 `(61.04,84.89)`、p04 `(75.20,57.05)`、p05 `(82.68,20.62)`；p01 实际圆心 x≈4.83%，按现有 5–95% 配置边界取 5.00%，在 320px 下偏差不足 1px且中心点击通过。

`npm run check` 69/69、`npm run build`、`git diff --check` 通过；全新隔离 MySQL 8.4.9 `127.0.0.1:3324`、实际 Chrome、真实 SQL/文件/迁移/进程重启的 `npm run test:a4:mysql` 56/56 通过，微信网络/SDK 明确模拟。日志 `tmp/mysql-map-v2-3324-cb4pxy/suite.log`，三宽证据 `tmp/changqi_a1_test_2fbb5d9d7ca7/`；只新增 home 320/390/430 页面、地图和首屏截图，已目视确认原图比例、文字可读、无重复可视层及主操作位置。

生产发布源为 `3a97dc5c30d8f1f2c7a79a3313b93c32798cc25f`。Actions run `35988227363` / attempt 1 成功，artifact `changqi-image-3a97dc5c30d8-35988227363-1`；归档 105,141,449 B、SHA-256 `7770aa51b660afbac88819c6845d37c5a9ba5cf01f9367c1864113807f7ff2eb`，镜像 `changqi-checkin-h5:3a97dc5c30d8-35988227363-1`、ID `sha256:761d5a09d7cb48a355ba110b86dfee2843f92e4dc9aa4fc9805cd76fcb1e863f`、`linux/amd64`。同一 artifact 下载到 `tmp/release-35988227363` 并上传至 `/opt/changqi-checkin-h5/releases/35988227363`。部署前备份位于 `/opt/changqi-checkin-h5/backups/35988227363-20260924T104249Z`：配置/Nginx、经校验的 3 表数据库 dump 和完整持久照片 tar；备份 SHA 记录在该目录 `SHA256SUMS`。新镜像先执行 `npm run db:schema`，生产 `checkins.photo_revision` 已核对为 `varchar(36) NOT NULL DEFAULT 'initial'`、ascii/`ascii_bin`，再替换 app；旧镜像 `7e792a...` 保留用于回滚。

服务器回环及 Windows 外部 HTTPS 均验证：`/health` 200/database connected、`/api/activity` 五点和 v2 坐标、`/q/p01` 200、`/art/map-field-final-v2.webp` 200 image/webp/485,720 B、未登录 `/api/me` 401、无效领取码 404、`/stats` 401、HTTP→HTTPS 301；生产 bundle 只引用 v2 地图且无旧路线/兑奖处 DOM 标识。Nginx 配置检查通过，保持 `network_mode: bridge`、`127.0.0.1:3002` 和 `/var/lib/changqi/uploads` 挂载，容器重启后仍为同一镜像且数据库健康。未调用生产上传、领取或统计写接口；v2 地图点击及新增照片核查/替换仍待真实微信验收。

**当前轮：领取凭证照片现场核查与领奖前显式替换（2026-09-24，本地实现、完整回归、生产迁移及部署通过；新增微信真机待验）。** Windows `D:\外包\changqi-checkin-h5` 实际分支仍为 `feat/a1-wechat-scan`，起点/远端 head 为 `b4f85117d360ac228b099891079786dbd6e6da1f`，main 为 `cc411965dd384e9608a80abf87a9e883eea8294d`；PR #1 Draft/Open、Review 为空、无其他开放 PR。开工工作区干净；接续时保留本轮全部未提交代码与忽略的环境/照片/历史证据。源码、测试与最小增量迁移已实现；最终检查与证据见下文。正常提交沿用原分支/PR，实际最终 HEAD 以 Git/PR 回读为准，不写自引用 SHA；不能将旧 `completedKeys` 当成替换成功。

**用户已确认的既有真机结果：**用户明确确认此前微信 iOS/Android 授权、扫码、现场照片上传、领取和纸样试扫已通过。保留这些已确认结果，不继续列为笼统缺项；未逐项确认的其他专项不补造结论。本轮新增凭证照片核查/替换仍需单独真机验收。下方历史“待真机/待纸样”均保留发生时的边界，不覆盖本段当前用户反馈。

旧地图发布源 `7e792a31185ad2255e88bdeda53e421bfba88f95`、Actions run `35962178962` / attempt 1 已成功；其后仅 TASKS 发布记录的旧文档提交不要求重建。照片核查/替换与 v2 地图已共同进入上述 `3a97dc5` 生产镜像并完成增量迁移；五张详情图、正式二维码与 OAuth 不变。

### 本轮照片核查/替换 · 最终本地证据

- `npm run check`：配置/HTTP 冒烟与 **69/69 Node 测试通过**；`npm run build` 通过。`npm run test:a4:mysql` 最终 **56/56 分组检查通过**（含原 A1–A4 与新增照片专项）；`git diff --check` 在提交前单独执行。没有新增依赖或改 lockfile。
- Windows Node.js 24.12.0 / npm 11.6.2；全新独立 MySQL 8.4.9 `127.0.0.1:3323`，启动器按本次 datadir 的 server_uuid、绑定地址和端口核对目标；实际 Chrome、SQL、文件字节、原生 file input 与应用进程重启。所有微信提供方/SDK/网络故障为明确模拟；绿色/黄色图片是生成夹具经真实上传接口保存，不是现场照片，不读取线上游客照片。只定向停止本次测试实例，不触碰原 MySQL、环境或照片。
- 最终日志：`tmp/mysql-photo-3323-fU0SxU/suite.log`；启动器 `tmp/run-photo-local-20260924.mjs`。最终画廊：`tmp/changqi_a1_test_753425732dbd/index.html`，截图/断言元数据同目录。**189 个实时状态/宽度组合，36 张所选凭证 PNG（12 状态×320/390/430），加原 A2/A3 必要截图共42 PNG**。包含列表、编辑、坏文件、读取失败、未知、冲突、真实未决提交、替换成功、已领取只读、缺图、关闭活动与 `own-voucher-after-last`；没有机械重做全部历史截图。
- 运行时/素材指纹 `6fdf03f4679251b312804021dbf85a0ec6a9830630d33825dcfb6f7d99dbcc0a`；每个源文件 SHA 已与截图元数据回读相符。截图记录基准 b4f8511 加当时实际 dirty 源码，不改写成提交后截图。三宽截图在独立 Chrome 复核页 `tmp/photo-voucher-final-review-t3dOjb/index.html` 实际目视：编号/提示/照片顺序、原地编辑、新旧图区分、失败/未知、成功新图、只读、缺图和最后一站领取区均可读，无横向溢出。修掉凭证标题的程序焦点黑框；保留真实交互焦点。八张真实截图复核拼页已通过原生窗口截图交付聊天，完整 PNG 留在上方目录。
- 真实验证：未扫码替换已有记录与首次 POST 门禁并存；2/N、N/N 替换只改变 photo_path/revision，行数、id、创建时间、用户/地点、领取码/人数均不变；普通 POST 及同ID重试不覆盖。坏文件/超大/写盘/真实 MySQL UPDATE 失败保留旧图；旧文件清理失败只记待清理。两同版本替换只一胜；self/staff 分别验证双方先取得 users 行锁的两种顺序，领取先提交拒绝换图，换图先提交可随后领取，首次时间/渠道/人数不重复。
- 恢复验证：真实 COMMIT 丢确认可回读恢复；COMMIT+回读失败以及未发送 COMMIT 都返回待核对并保留可能有效的新旧文件；同ID重试最终确认。浏览器连续核对失败/旧记录存在不误报成功；刷新保存最小标记但不存照片，重选不同文件拒绝；未决 SQL 仍持编辑/领取/hash锁。凭证、详情、大图的 revision 和字节摘要一致，迟到图片/元数据和用户切换不回显旧图，旧 blob URL 已释放。
- 数据升级：空库通过实际 `npm run db:schema`；另建已有照片旧库，幂等增量添加 initial 版本、重复执行不改行/原时间，旧图首次替换与再升级后 UUID 均保持；实际 Node 进程重启恢复会话、照片版本/字节。迁移模块进入 Dockerfile 的 db 复制链；生产已在新版 app 启动前用同一 `3a97dc5` 镜像执行并核对字段定义，原 app 在迁移成功前保持运行。
- 过程失败保留：`mysql-photo-3323-BOITY9` 的旧页面 reload 竞争、`r5qee2` 的刷新恢复后其他卡片读取失败均已定位修复；`pHDJ26` 的专用 Chrome 自动调试端口落入禁用端口导致停滞，只停止本次任务，改为有界高位回环端口；`IXXvmm` 的一次性故障注入与 `RenEE9` 的 hash-only 配置重载假设修正后重跑。中间成功 `eO7vCj` 及全部历史日志/截图保留；最终补取消兼容性/标题小修后完整重跑为 `fU0SxU`。独立复核 Chrome 关闭时辅助 Node 的 WebSocket close 监听报错，但随后回读该 Chrome Job 为 exit0/已退出；不影响已完成业务测试或截图，不把辅助错误抹掉。

**上一轮：最终现场地图成图直接替换页面地图（2026-09-24，本地回归、构建和生产部署通过，微信真机待验）。** 地图内自带路线、1–5 点位和兑奖处，页面只保留五个透明查看热点；折叠地点列表、扫码资格、照片、领取、统计及正式二维码不变。旧地图和上一镜像均保留，PR 仍为 Draft/Open，未转 Ready 或合并。

最终 PNG 保存为 `assets/illustrations/restoration/masters/map-field-final-v1.png`，1334×1179、3,604,079 B、SHA-256 `abfa811468d14e4e830b2c8b985183ebd9222aac542956e6dbd33c96510fa159`；运行 WebP 为 `web/public/art/map-field-final-v1.webp`，同尺寸、560,002 B、SHA-256 `123d476a065cc27597a563235d6bded6c4e9a03c700039bf0b3824b700257b9d`。最终热点为 p01 `(5.10,34.86)`、p02 `(57.50,56.74)`、p03 `(62.22,81.09)`、p04 `(76.39,54.54)`、p05 `(87.56,15.44)`；均以成图编号圆心校准，40px 透明目标在 320/390/430px 实际点击通过。

已删除 `map-route-overlay`、`map-route-underlay`、`map-route-line`、`claim-map-marker`、`claim-map-gift`、可见编号圆点、`claimMapPosition` 与 `mapRouteSegments`；页面不再重复绘制路线、兑奖处、地点名或完成状态。`npm run check` 62/62、`npm run build`、`git diff --check` 通过；新建隔离 MySQL 8.4.9 `127.0.0.1:3322`、实际 Chrome、真实 SQL/文件/进程重启的 `npm run test:a4:mysql` 45/45 通过，微信网络/SDK 明确模拟。首轮由旧 A1 浏览器测试的一条重复失效文案断言阻断，删除该测试死断言后完整重跑通过，未改业务文案。证据为 `tmp/mysql-map-final-3322-QupesL/suite.log` 与 `tmp/changqi_a1_test_9615c4129fc2/`；320/390/430px 页面、地图和首屏截图均在该目录，已目视确认原图比例、无重复路线/兑奖处/网页圆点、热点命中及主操作位置。微信内真实尺寸与真机点击仍待验。

本次发布源为 `7e792a31185ad2255e88bdeda53e421bfba88f95`。Actions run `35962178962` / attempt 1 的检查、前端构建、linux/amd64 镜像、临时 MySQL 冒烟、导出和上传全部通过；artifact `changqi-image-7e792a31185a-35962178962-1` 下载至 `tmp/release-35962178962`，镜像归档 104,643,084 B、SHA-256 `6d97e7f4b48a6ebe1fd3b50c0439b112d02c7d0e993626577ff8c79654baa4db`，镜像标签 `changqi-checkin-h5:7e792a31185a-35962178962-1`，镜像 ID `sha256:29241b577609c0619bd38aff74aea1ebff0c475b186746d4b8981a8d6bd10399`。同一 artifact 已上传至 `/opt/changqi-checkin-h5/releases/35962178962`，幂等 schema 通过，仅更新现有 app 容器；保持 `network_mode: bridge`、`127.0.0.1:3002` 和 `/var/lib/changqi/uploads` 挂载。回滚备份为 `backups/.env.runtime.before-35962178962`、`backups/compose.before-35962178962.yaml`、`backups/cq.fsxinhuo.cn.conf.before-35962178962`。

服务器回环及 Windows 外部 HTTPS 均验证：`/health` 200/database connected、`/api/activity` 五点和最终坐标、`/q/p01` 200、`/art/map-field-final-v1.webp` 200 image/webp/560,002 B、未登录 `/api/me` 401、无效领取码 404、`/stats` 401、HTTP→HTTPS 301；Nginx 配置检查通过，容器重启后仍为同一镜像且数据库健康。未调用生产上传、领取或统计写接口；真实微信授权、地图点击、相册/拍照、领取与纸样仍由真机验证。

**上一轮：地图现场方位/线路修正（2026-09-24，已回归并发布）。** 用户提供现场方位参考图；当时保留旧地图底图，并将 p01–p05 的 HTML 点位、路线线层和“兑奖处”位置按参考图重新标定。源码 `b64460743205033fefa33adff2321013a87404b0` 已由项目级 `changqi-release` skill 构建发布；该实现现已由本轮最终成图方案在源码和生产中替代，旧镜像仅作回滚保留。


**当前轮：微信地点入口直达（2026-09-23，最新版本已部署，微信真机待验）。** 应用发布源为 `953291f87e544d301381673edbb46d4d457df6d4`；其后仅追加 docs-only 的发布记录提交，均在 `feat/a1-wechat-scan` 上。提交前回读 main 仍为 `cc411965dd384e9608a80abf87a9e883eea8294d`，PR #1 Draft/Open、未合并、Review 为空，未在旧 SHA 上覆盖他人提交。最终 HEAD 以 Git/PR 回读为准，不写自引用 SHA。

微信内有效 `/q/:pointKey` 在会话前校验地点后复用原 snsapi_base，重新识别当前微信用户一次；服务端 oauth 保存 entryPointKey/returnTo/state。回调先捕获已校验地点、消费 state，经真实 code 交换流程 findOrCreateUser，再 regenerateSession 写 userId/有效地点，等待 saveSession 后跳 `/#point/:key`。不依赖入口共享 Cookie，不接受旧 A 会话代替本次 B 授权。既有随机 state 的公开地点提示只供 Cookie 缺失时生成经配置校验的手动重试链接，不作为身份/资格；失败停留错误页，不自动重试或回首页。微信外游客首页/地点引导即使带旧 Cookie 也不显示个人记录/上传，`/q/` 在访问会话存储前返回；`/r/` 匿名、`/stats` 固定凭据、API JSON 401 不变。

`/api/me.scannedPointKey` 只来自当前会话及有效配置，活动关闭返回 null；App 集中恢复，同用户上传/领取响应不含该字段时不误清空，切换用户清除旧照片/资格，迟到的 `/api/me` 不覆盖后来的扫码。直达原生 file input 不等待 wx.ready，SDK 失败不清空身份或阻塞已有资格的上传。地图/列表/hash 不增加资格，保存照片前进度不增加；原未知结果锁、最后一站 #claim、两路首次领取与照片隔离保留。

**本轮验证：**`npm run check` 配置/HTTP + 58/58 Node、`npm run build`、`npm run test:a4:mysql` 45/45 分组检查与 `git diff --check` 通过。显式 TEST_DB_HOST=127.0.0.1 / TEST_DB_PORT=3321 / TEST_DB_USER=root / TEST_DB_PASSWORD=''，使用全新独立 MySQL 8.4.9 datadir 并校验自身 UUID/绑定/端口；实际 Chrome 与 SQL、文件上传、应用重启，未连接生产数据库。冷启动/无共享 Cookie、2/N→保存后3/N、同 OpenID 原用户/领取码/首图、A→B、会话过期、关闭活动、重复 code/state、微信与会话读写故障、拒绝 Cookie、迟到状态、SDK 故障及原 A1–A4 回归均覆盖。故障注入日志中的预期错误不计为业务成功；生成照片夹具不是现场照片。

**本轮证据：**最终日志 `tmp/mysql-entry-3321-fDZ6O2/suite.log`；独立启动器 `tmp/run-entry-local-20260923.mjs`。156 个实时状态/宽度组合通过，54 条所选新截图记录、共 66 PNG，覆盖 320/390/430px 引导、读取中/失败、直达上传、SDK 故障上传、已完成/已领取等；`tmp/changqi_a1_test_5403af373bd4/{index.html,a4-screenshots.json,a4-regression.json}`。运行时/图片指纹 `9cf32c619340444a5610aa30cae434086991d2f7b13a8874ea8154eced8bb754`，逐文件回读一致；截图记录基准 HEAD 加本轮源文件哈希，不改写为提交后截图。当前聊天导出接口只返回元数据，未冒称网页端逐图目视或客户已确认新页面。首轮旧引导断言和 Chrome 模拟 UA 后同文档 hash 导航的测试假设已修正；失败日志 `tmp/mysql-entry-3321-AsshRm/suite.log` 与中间通过日志均保留，不改写历史结果。补充视觉证据时发现原截图选择漏了 `own-voucher-after-last`；已单独选择该状态并补齐 320/390/430px 三张：`tmp/changqi_a1_test_ab629c340720/a4-own-voucher-after-last-{320,390,430}.png`，截图元数据同目录 `a4-screenshots.json`。补图完整隔离回归最终 45/45 通过，日志 `tmp/mysql-entry-3321-pXexVO/suite.log`；首轮补图运行在 Chrome 重载后的旧 `point-count` 读取竞争处失败、未生成有效补证结论，日志 `tmp/mysql-entry-3321-z7ncYW/suite.log` 保留，未改业务代码，随后同一断言完整重跑通过。

**边界：**六图母版/派生、地图比例/热点、CQ 范围、锁文件/依赖和数据库结构未改。五处固定正式二维码载荷/码图不变，生成器的离线页和印刷说明已同步，可给旧包附 `docs/point-qr-entry-correction.md`，不要求重印码图。本次仅更新项目镜像与既有 app 容器，未改公众号菜单、消息服务、其他站点或生产数据。iOS/Android 微信真实授权（包括已关注/未关注、原菜单换入口、同设备换账号）、五地点拍照/相册/复扫/领取与真实纸样仍待验，不把本地模拟等同真机，不恢复强制关注规则。

**2026-09-24 最新发布：**本次部署源为 `b64460743205033fefa33adff2321013a87404b0`；发布记录随后以 docs-only commit `a2a5c27268750cd7497961289c75e07371c5c4ab` 推送，当前分支 HEAD 与生产源码明确区分。Actions run `35950810377` / attempt 1 成功，artifact `changqi-image-b64460743205-35950810377-1` 未过期；`build-info.json` 确认 `linux/amd64`、镜像 `changqi-checkin-h5:b64460743205-35950810377-1`，归档 SHA-256 `edd606c70249dbb699f543b144a7773099dcdbd204961aceb5288942d3069824` 与 sidecar 一致。已下载到 `tmp/release-35950810377`，上传至 `/opt/changqi-checkin-h5/releases/35950810377` 并 `docker load`；生产镜像 ID `sha256:b193ec7fa0e5410e5945b6f5ef5b8b7e7a84870498fad18a522061b273c031f4`，容器保持 `network_mode: bridge`、`127.0.0.1:3002`。幂等 schema、HTTPS `/health`（database connected）、`/api/activity` 五点、`/q/p01`、WebP、未登录 `401`、无效领取 `404`、`/stats` `401`、HTTP `301`、容器重启后健康和 Windows 外部 HTTPS 检查均通过。回滚备份：`/opt/changqi-checkin-h5/backups/.env.runtime.before-35950810377`、`compose.before-35950810377.yaml`、`cq.fsxinhuo.cn.conf.before-35950810377`；旧镜像仍保留。

### 六图接入及先前发布记录（历史边界）

以下六图/A1–A6 与 guide-only 测试保留发生时的结果，不再作为新入口验收规则；本轮状态以上方记录为准。

- 仓库：`Jonoka/changqi-checkin-h5`；本轮六图接入先从干净 Windows `66003bea…` 安全 fast-forward 到远端 handoff `be60f540b404ba677eefef087b4278fb3e48cdbb`。最新 `main` 为 `cc411965dd384e9608a80abf87a9e883eea8294d`；原 PR #1 Draft/OPEN、未合并、Review 为空，无其他开放 PR，继续 `feat/a1-wechat-scan`。六张真实 PNG 已在 `6889e359515f84ce9b910017871d097d213b37e4` 提交推送；最终接入 HEAD 以 Git/PR 回读为准，不写自引用 SHA。
- 初始化历史：`c5bd5888d993984e8d7cfcbd42e5c92416070d6f` 建立仓库；文档基线随后提交；`5e0a67d` 已补入五张视觉原图。当前 HEAD 以工具或 Git 实际读取为准，不写自引用 SHA。
- 素材：本轮直接导入根目录六图 ZIP，六张 PNG 共 19,182,073 B，尺寸/SHA/完整解码与导入清单一致；未生图、未裁旧效果图。地图 1334×1179、五处详情母版各 1536×1024，原字节保留；地图/p03 为用户确认，另四张只标接入预览。既有原图、历史裁图/SVG 与 source-manifest 均保留。新 WebP 地图保持 1334×1179，详情各 960×640，quality 86，总 1,840,696 B；独立母版与派生哈希可追溯。
- 接入：完整图片地图替代旧环境图/矢量路线/五张叠卡，HTML 标签按配置 key 与百分比锚点叠加；缺锚点仅进既有折叠列表，N 仍动态。PointArt 按实际宽高显示，详情/列表使用相同 key 图片。App、IdentityStatus、照片/授权/扫码/领取逻辑未改；首页/地点隐藏 CQ、凭证/派发编号、地图上方主操作、身份互斥、未知结果锁及最后一站 #claim 均保留。server/config 只补图片宽高校验，不修改数据库。
- 本轮验证：check 配置/HTTP + 56/56 Node、build、独立 MySQL 8.4.9:3320/Chrome 完整回归 39/39 通过；135 个 320/390/430 状态组合，56 条所选截图记录，共 75 PNG（含首屏、地图局部及 A2/A3 必要图）。最终证据 `tmp/changqi_a1_test_232bffccbccc`，runtime 指纹 `bf73d23ac9663c86846d399a0e23088ca5d7e448b27276c39eb4f47a14bc66a1`，未复用旧图。实际目视地图三宽、五处详情、展开列表和首页主操作；最终客户页面确认/微信真机仍待验。
- 执行入口：ChatGPT 网页端或电脑本地 Agent 开发均可；Actions 统一构建，有 SSH 权限的本地 Agent 默认负责下载、上传和部署。
- 服务器核验与运行时：`root@100.95.32.56` 可通过 Tailscale 连接；Alibaba Cloud Linux 3.2104 LTS 内核 `5.10.134-18.al8.x86_64`，`x86_64`，约 0.94 GiB RAM，根盘 40G/可用约 18G。Nginx 1.26.2、MySQL 服务 active，项目库建表成功；配置端口 3306、socket `/tmp/mysql.sock`、数据目录 `/www/server/data`。现有 Node 应用占用 3000，本项目 app 绑定 `127.0.0.1:3002`；Docker CE 26.1.3、containerd 1.6.32、Compose v2.27.0 已从阿里云镜像安装并设为开机启动，`docker version`、`docker info`、`docker ps` 已通过。Skill 验证用 artifact 已上传至 `/opt/changqi-checkin-h5/releases/35844751374`，归档 SHA-256 校验为 `d8cab91ebcdf8ccf00dedc3e4d30cf59d3e8656565dfc7a3c39829acf3c201d3`，镜像已 `docker load`。`cq.fsxinhuo.cn` 已由宝塔 Nginx 反代到本项目并强制 HTTP→HTTPS，最新镜像 HTTPS 健康检查、活动接口和静态插画资源通过，证书有效期至 2026-12-20；未改其他站点、未清理生产数据。
- Windows 工作区已实际核对并开发，保留忽略文件、照片、二维码、根目录 ZIP 及历史截图。本轮已按用户授权触发 Actions 并更新生产镜像；服务器部署结果与本地图片回归分开记录，不冒称已验证微信。真实照片、微信真机和领取操作仍待验。
- A6.3：正式 origin `https://cq.fsxinhuo.cn` 与 p01–p05 绑定已定版；10 张码、清单、约 5cm 离线打印页和警示 ZIP 已生成并自动解码。仍为“正式地址已定，待真机/纸样试扫，不可直接批量印刷。”地址不再缺项；原图插画恢复需新素材验收，不影响已定版地点码。
- 当前接续：A5 本地回归通过、微信真机未验；项目级 `.agents/skills/changqi-release/SKILL.md` 已创建、校验并提交。最新提交 `953291f87e544d301381673edbb46d4d457df6d4` 已由该 Skill 驱动 Actions run `35844751374` / attempt 1 构建、冒烟、导出并上传 artifact；A6.3 样张和自动解码完成、真实纸样未验；A6.2 已完成新 artifact 下载、校验、加载、幂等建表、容器替换和 Nginx HTTPS 检查。当前生产容器/HTTPS 已实测，微信 iOS/Android 真机、真实照片和纸样仍待验。
- 2026-09-23 线上只读：独立普通 Chrome profile，以 GET-only 检查首页、沉香古井查看页、五条 `/q/` 和无效 `/r/invalid`，共 24 个 320/390/430px 组合。页面及图片正常，无脚本异常/横向溢出；匿名 `/api/me` 的 401 是预期，未当成宕机。列表默认折叠、展开 5 项；首页禁用的扫一扫在 568px 高首屏可见；旧版普通浏览器地点页因身份提示重复，按钮在此短视窗下需下滑。线上报告 `tmp/ui-public-z04NLz/report.json`。旧默认页/404 结果属于首次部署之前，不是当前状态。

## 1. 执行顺序与完成规则

| 任务 | 目标 | 依赖 | 当前状态 |
| --- | --- | --- | --- |
| A0 | 最小工程、配置、MySQL | 明确目标仓库 | 完成 |
| A1 | 微信身份、两类扫码入口 | A0；真实账号/域名用于真机 | 本地通过；既有授权/扫码已由用户确认真机通过 |
| A2 | 一处照片打卡与进度恢复 | A0、扫码接口；本地可用开发模拟 | 本地通过；既有现场照片上传已由用户确认真机通过；新增替换单独验收 |
| A3 | 两种领取与人数 | A2 | 本地通过；既有领取已由用户确认真机通过；新增替换并发单独回归 |
| A4 | 保留布局/UI，接入地点插画与最终现场地图 | A2、A3 | v2 本地回归/三宽目视/生产部署通过；待微信真机 |
| A5 | 必要回归、问题修复 | A1–A4 | 本轮完整本地回归通过；既有真机反馈保留，新增照片能力待真机 |
| A6 | 双入口构建、本地中转、授权部署与二维码 | 构建/部署依各自授权；纸样不等镜像发布 | 进行中：A6.1/A6.2 最新版本构建、校验、迁移、服务器更新与 HTTPS 检查完成；A6.3 样张/解码完成，既有微信扫码和纸样由用户确认通过；新增功能待真机 |
| PHOTO | 凭证现场照片核查、显式替换与旧库升级 | 保留 A1–A6；只改本人领奖前当前照片 | 原实现/回归/三宽目视及生产迁移通过；9月25日认证恢复已合并、构建并发布；新增真机待验 |

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

发布边界：本次用户已明确授权对最新提交构建并更新生产。SSH 实测容器 `changqi-checkin-h5-app-1` 正运行 `changqi-checkin-h5:953291f87e54-35844751374-1`，发布目录 `build-info.json` 对应 source SHA `953291f87e544d301381673edbb46d4d457df6d4` / run `35844751374` attempt 1；OCI revision label 为空，SHA 来源明确为配套发布元数据，不冒称容器标签自证。当前镜像 ID 为 `sha256:a482ad49e67c25c7b85707e6d9c882523c816044e952a0acc65fa06b23f08bfb`，容器 running；回环和公网 HTTPS `/health` 返回 database connected，`/api/activity`、`/q/p01`、插画资源、未登录 401、无效领取码 404、`/stats` 401 均通过，容器重启后仍健康。旧镜像 `changqi-checkin-h5:260768c33c77-35836566244-1` 与环境备份保留，可回退；未改公众号菜单、未清理生产数据，普通 Chrome 与模拟 SDK 不是微信真机结果。

### 原 PNG 插画恢复历史 · 2026-09-23（当时素材关阻塞；现由下方六图接入接续）

已核对并实际查看五张原图。聊天图像接口未产出合格的原图局部修补母版；返回的示意板不采用、不入库，不是实际页面截图。Runner 的 Plugin/MCP 列表为空。当前仅完成原生裁切，不将涂白、模糊或插值冒充修补/高清，不要求用户重交已有原图。

`assets/illustrations/restoration/recipe.json` 记录来源与裁切，`source-manifest.json` 记录原文件 SHA、尺寸、输出 SHA/字节，`index.html` 提供真实原图→编辑输入对照。已逐张目视：地图 739×653 / 1,353,479 B，古井 307×302 / 266,587 B，无字井身 266×168 / 128,853 B，p01 229×236 / 154,909 B，p02 330×252 / 228,883 B，p04 252×274 / 192,062 B，p05 425×241 / 289,936 B。井身片段无字但缺屋顶；其余仍有标签/错字/状态或遮挡，均不是完整母版。p01 原葫芦、p02 镬耳祠堂、p03 古井棚亭、p04 榕树气根、p05 观景台/村落/山林的来源已定位，不添加人物或无来源建筑。

新脚本 `--extract-sources` 只提取原生 PNG；默认命令只读独立图片母版，当前因 6 张 master 缺项而停止，实测现有 runtime 字节未变。拒绝 SVG 假后缀、哈希/尺寸不符、缺目视记录、未知或被手改的输出；整批预检后才写入，预留 restored-v1 新文件名，不改 key/域名/地点码。旧素材测试保留 key/字节校验，撤掉 SVG 指纹与统一尺寸/50KB/200KB 门槛，新增来源/像素/母版/体积/保护测试。页面未改，旧坐标测试仍对应旧 runtime，不冒称新热点通过。

验证：`tmp/run-art-gate-local-20260923.mjs`；日志 `tmp/mysql-art-gate-3319-iA8HTz/suite.log`；新检查/截图 `tmp/changqi_a1_test_a175c836cb89/{index.html,a4-screenshots.json,a4-regression.json}`。显式 TEST_DB_HOST=127.0.0.1 / PORT=3319 / USER=root / 独立测试密码，验证全新 datadir UUID/回环绑定后运行，只停止本实例；未用生产 DB_* 或真实照片。runtime 指纹仍为 `5a3e3b27f63fd0f1648666dd6c72957b9c290d6975537b55e4902784ed79f5c2` 是源文件未改的结果，不是复用旧图；扫码门禁、动态 N、两用户隔离、未知锁、首次领取、CQ 和最后一站 #claim 回归通过。

最小接续缺项：先完成无 UI 地图（至少保留 739×653 有效像素/比例，清除标签错字并恢复中性步道）和完整古井详情（建议经真实局部修补/扩图到 768×512，去牌匾字、补屋檐/人物边缘）。两张目视通过后再做另外四处与图片/HTML 热点接入，不上线占位版。其余目标尺寸见 recipe，只是编辑建议，不是已存在高清素材；实际编辑结果另存母版与哈希/方法，不承诺模型重跑像素相同。

最新生产核对为 `changqi-checkin-h5:953291f87e54-35844751374-1`，image ID `sha256:a482ad49e67c25c7b85707e6d9c882523c816044e952a0acc65fa06b23f08bfb`；build-info source `953291f87e544d301381673edbb46d4d457df6d4` / run 35844751374 attempt 1，OCI revision label 为空，回环 health=database connected。本轮由项目级 Skill 驱动 Actions、下载并校验 artifact、替换生产容器；旧镜像/环境备份保留，未清库或修改微信/正式地点码；真机仍待验。

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
| AC-02 | 本地通过；既有授权/上传已由用户确认 | MySQL 身份/会话/进度、照片隔离和进程重启已回归。保留用户已确认的微信授权/上传；细分异常是本地模拟，不扩写为真机通过。 |
| AC-03 | 本地通过；既有微信授权/扫码已由用户确认 | 微信有效 /q 经模拟提供方、真实服务端会话/SQL直达并实际上传；微信外旧 Cookie 引导、两入口同 OpenID、A→B 隔离、SDK 故障与迟到状态已回归。列表/hash 不授新资格；历史 guide-only 规则已替换。 |
| AC-04 | 本地异常专项通过；既有扫码由用户确认 | 解析、模拟 SDK/Chrome 的未就绪、取消、拒绝/失败、错误码、初始化重试和返回后再扫已回归。用户确认既有扫码通过；未单独确认的异常专项不冒称真机。 |
| AC-05 | 既有现场上传由用户确认；新增替换待真机 | Chrome 原生 file input 选择/预览/重选/提交及替换已通过；既有 iOS/Android 现场上传反馈保留，新增替换拍照/相册由真机单独验收。 |
| AC-06 | 本地通过 | 超大/损坏/不支持格式、实际磁盘失败、MySQL INSERT 拒绝与 HTTP 上传中断不增加完成进度；请求临时文件/无效新文件清理已核对。 |
| AC-07 | 本地通过；新增替换恢复见 AC-16 | 刷新/真实进程重启恢复、重复/四请求并发只一条记录且保留首图、真实保存后模拟响应丢失先查状态均通过；实际 Chrome 已验证上传与手动核对连续失败时保持提交禁用，恢复网络确认未保存后才允许重试。 |
| AC-08 | 本地通过 | 真实照片提交后 2/5→3/5、扫码不增加进度、旧无关 key 不计入完成均通过；A3 两路接口均拒绝未完成用户首次领取。 |
| AC-09 | 本地通过；既有领取由用户确认 | 游客/派发二次确认可取消、GET不写、首次时间与刷新重进均回归。保留用户既有领取真机通过；新照片核查/替换与现场派发联动待真机。 |
| AC-10 | 本地通过 | 实际 MySQL 两路重复/12 请求并发只计首次且时间/渠道不覆盖；非法领取码及伪造身份/渠道请求拒绝。 |
| AC-11 | 本地通过 | 两位实际上传完成的测试游客分别领取后只读 COUNT=2；正确凭据可读，未授权不可读，统计连接失败不显示 0。生产人数尚未验证。 |
| AC-12 | 最终地图 v2 本地/目视及生产资源通过；待微信真机 | 新完整地图 PNG/WebP 已接入，页面无额外可见路线、兑奖处、编号或地点标签；五个透明热点、折叠列表、动态增删、无位置地点兜底、扫码资格不变及 320/390/430px 点击/比例/首屏均通过。生产 `/art/map-field-final-v2.webp` 已回读为 200 image/webp。 |
| AC-13 | 最新 main 镜像已构建并部署，运行检查通过 | Actions run `36095477907` / attempt 1、源码 `cd4c18dde1e26d4820f7fb6787089488b8c5da9b`：linux/amd64 镜像、临时 MySQL schema、前端构建和 smoke checks 全部通过。artifact `changqi-image-cd4c18dde1e2-36095477907-1` 已下载并上传至 `/opt/changqi-checkin-h5/releases/36095477907`；归档 SHA-256 `1a4526331c6ea968e869606abfd6a235262afc8d877d1ec824082ba82329de30`，镜像 ID `sha256:8747d4b5654733480b018a1bd1902eb68d434731a5d5a6545413180485ece8d7`。项目库幂等建表、容器更新、Nginx 检查、回环/公网 HTTPS、最终地图资源、401/404 保护、HTTP 301 和容器重启后健康均通过；旧镜像与回滚备份保留。 |
| AC-14 | 原载荷/码图保留；既有微信扫码和纸样由用户确认通过 | 五个最终网址和10张 PNG/SVG不变，旧样张与解码结果保留。保留用户已确认的 iOS/Android 微信扫码、现场照片、领取和纸样试扫结果；新增凭证照片核查/替换另验，不重新生成正式地点码。 |
| AC-15 | 本地/三宽目视通过；新增真机待验 | 本人 N 张服务器照片、单列完整画面/大图/逐卡重试、原地单张编辑、取消、隐藏码/禁领取、已领取/关闭只读、匿名边界与不复扫替换均通过。 |
| AC-16 | 本地 MySQL/Chrome/升级与重启通过；生产幂等 schema 与新镜像发布通过，新增真机待验 | 版本/同ID恢复与冲突、旧记录不误报、确定失败/COMMIT不明文件保全、两路领取锁顺序、字节/迟到响应/用户隔离、空库/旧库/重复迁移均实际验证；生产 run `36095477907` 使用同一镜像执行 schema、替换容器并通过内外网及重启健康检查，未调用生产写业务路径。 |

可分开写“Actions API 检查已通过；宝塔数据库/微信真机未验证”。本地命令、Actions 日志、服务器结果与真机用户反馈标明来源，不将它们混为一个“全绿”。

## 4. 接续记录（只维护此处）

**上次发布 · 分享完整标题修正（2026-09-24）：**生产已运行修复源码 `a851773b3571796d0e902c365560284b14559b82` 对应的 Actions run `36006086113` / attempt 1 镜像；完整发布证据见第0节。源码、Actions `headSha`、`build-info.json`、运行镜像、公网 HTML 和实际引用 JS 已闭环一致；线上标题为“2026三水区芦苞镇长岐古村黄金节庆影视游园季活动”，页面可见活动名仍为“长岐村漫游打卡”。

每个执行任务结束时更新顶部状态、任务表、验收表和下面的当前摘要。避免重复长篇历史；需要的命令输出可放不含敏感数据的测试报告，并在此引用。

**当前接续（2026-09-25）：**PR #1 已合并，Windows `main` 已同步并包含生产源码 `cd4c18dde1e26d4820f7fb6787089488b8c5da9b`；Actions run `36095477907` / attempt 1 的同一 artifact 已校验并部署，生产容器、数据库健康、回环/公网 HTTPS 与重启检查通过。生产源码之后仅追加本 TASKS 发布记录，不重复构建。下一验收层仅为照片替换认证恢复和完整分享标题的 iOS/Android 微信真机专项；既有授权、扫码、首次上传、领取和纸样用户验收不改写。所有忽略的环境、照片和历次证据保留。

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

A1–A5 本地业务与已确认布局/UI 保留；本轮六张独立母版已接入并完成本地回归及实际目视，随后按用户授权完成最新版本 Actions 构建和服务器更新。真实微信、现场照片/领取及纸样仍需单独验证。
