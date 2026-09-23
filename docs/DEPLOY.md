# DEPLOY · 两种开发入口，共用 Actions 构建与本地部署

**v1.4 · 发布与微信联调操作约定；实际状态只记 TASKS**

业务与验收以 [SPEC](SPEC.md) 为准，进度只写 [TASKS](TASKS.md)。本文件不增加后台、库存或运维平台。

## 1. 已选环境与边界

用户提供：1 核 1GB（可扩容）、Alibaba Cloud Linux 3.2104 LTS 64 位、宝塔、现有 MySQL。首次部署再实际核对架构、内存/磁盘余量、Docker/Compose、数据库版本和网站入口，不重复索要这些已知条件，也不把“64 位”直接等同于 amd64。

生产只运行一个 `app` 容器：构建好的 Vue 页面由 Node.js 后端同进程提供；宝塔 Nginx 管 HTTPS 和代理，复用宝塔 MySQL，照片放服务器持久目录。不开生产 MySQL/Nginx/Redis 容器，不在小服务器上构建镜像、安装开发依赖、跑全套测试或设置 self-hosted runner。内存是否够用按实测决定，扩容不是开始开发的门槛。

## 2. 两种入口

### A：在 ChatGPT 网页端开发和请求构建

通过已授权 GitHub 工具读最新代码并提交 → 请求同一个 Actions 工作流 → 回读检查与产物结果 → 将具体版本交给本地 Agent → 本地下载、SSH 上传、加载和更新。

网页端有可用 dispatch 接口时直接手动触发；没有时使用下节的构建请求文件。不能把“有 GitHub 写权限”说成“所有 Actions/SSH 操作都能执行”。不同连接是否暴露 workflow_dispatch 以当次工具为准；保留文件触发路径，不要求为了网页开发必装额外插件。

网页端不必先把大镜像下载进聊天沙箱再交给电脑；默认直接交 run ID 和 artifact 名称，由本地取同一产物。能实际下载时可以辅助，但不能声称文件已在用户电脑上。没有执行环境的检查交给 Actions 或本地端，未执行的测试如实标记。

### B：在电脑本地开发和请求构建

本地 Agent 检查工作区及远端 → 开发和本地检查 → 提交并推送 → 用 CLI 或 GitHub 页面手动触发同一工作流 → 下载指定运行的产物 → 在授权范围内 SSH 部署。

本地无需安装 Docker 才能触发云端构建、下载文件或 SCP 上传。需要本地运行镜像测试时才需本地 Docker。接手方式 A 已成功的构建时直接下载，不为换执行端重新构建。

两种方式可轮换，不要求同时运行两个 Agent。接续先核对仓库/分支/提交及 TASKS，有本地目录再查未提交与未跟踪文件；分叉先比较，不 reset、clean、force push。发布版本以实际构建提交和镜像元数据为准，不以“我电脑上看起来是最新的”为准。

## 3. 一个工作流，两个按需触发入口

A6.1 已实现 `.github/workflows/build-image.yml`，名称为 `Build application image`，只有一套检查和镜像导出步骤。触发约定如下，实际运行和产物状态只记 TASKS：[G1][G2]

```yaml
on:
  workflow_dispatch:
  push:
    branches: [main]
    paths:
      - .github/build-request.txt
```

**手动入口：**工作流先存在于默认分支，目标 ref 也需含可用工作流。用户或有权限的 Agent 用 Run workflow / CLI / 可用 API 触发；示例 `gh workflow run build-image.yml -R Jonoka/changqi-checkin-h5 --ref main`。先记录要构建的提交，之后核对实际 run 的 SHA，不把请求受理当作成功。[G1]

**文件入口：**网页端代码就绪且本次已获构建授权后，只更新 `.github/build-request.txt` 为一行新的请求标识，例如 `2026-09-21-request-01`，随明确的 `build: request image` 提交进入 main。每次实际请求用新值，文件不是脚本，不携带密钥，也不指定要偷偷切换的另一份源码。这个小提交本身的 HEAD 就是要检出、测试、打包的版本；镜像 SHA 不是它的父提交。保护规则要求 PR 时按规则处理，不绕过。[G2]

普通代码、文档修改不更改请求文件；同一次请求选一种触发方式，不先改文件又手动 dispatch。请求文件只由用户授权的开发端更新，不让工作流回写以形成循环。首次用两条路径各试通一次；连接权限、事件或 Actions 配额受阻时记录实际失败，不反复改工作流碰运气。没有明确构建授权时，不创建或修改该请求文件，也不触发构建。

## 4. 构建和产物最小合同

GitHub 托管 Linux runner 检出运行对应的 `github.sha`，记录 `git rev-parse HEAD`，运行安装、已有必要检查和构建，再导出一个可由 `docker load` 加载的单平台 Docker 镜像归档。不在步骤中重新拉最新 main，不跳过失败检查。版本与依赖在实现时核对、锁定。[D1]

平台按服务器 `uname -m` 的实测结果确定：x86_64 对应 linux/amd64，aarch64 对应 linux/arm64。工作流统一配置一个已验证的目标平台，不因入口不同各构建一套；若使用异架构构建则配置相应 builder 并验证。未知架构时只可产出标明平台的测试包，不称为已匹配服务器的生产包。

需要数据验证时可在 runner 临时起 MySQL 测试库，运行已有冒烟脚本；不带生产数据或真实微信凭据。多阶段构建仅保留前端产物、后端及生产依赖；真实 `.env`、私钥、数据库、上传照片和本地下载的大包不得进入构建上下文或 artifact。

同一次 artifact 包含以下三个小类别，避免另建发布系统：

| 产物 | 约定 |
| --- | --- |
| 镜像归档 `.tar.gz` | 完整 Docker image archive，不是源码 ZIP，不依赖服务器重新构建或拉取发布镜像 |
| `build-info.json` | 完整源码 SHA、run ID、run attempt、platform、imageTag、builtAt；可附归档 SHA-256 校验传输，不做签名平台 |
| `compose.yaml` | 同一源码版本的生产配置，只引用已加载的 `APP_IMAGE`，不含真实运行密钥或生产 build 指令 |

命名示例：artifact 为 `changqi-image-<sha12>-<runId>-<attempt>`；镜像为 `changqi-checkin-h5:<sha12>-<runId>-<attempt>`。这些是命名模板，不是真实产物。保留完整 SHA 在元数据中，区分同一源码的重跑结果。

产物默认 `retention-days: 3`，用于下载中转而非长期备份。成功标准是必要检查、构建、归档上传均成功且产物可下载；失败不能忽略后宣称可部署。额度或产物过期时明确提示；重新构建会生成新 run/产物，更新交接信息，不偷偷改下一个发布版本。镜像导出与 artifact 流程参考 [D1]，产物下载参考 [G3]。

## 5. 本地下载与交接

网页端交给本地 Agent 的信息只需一段，写进 TASKS 当前接续记录即可：

```text
仓库：Jonoka/changqi-checkin-h5
源码 SHA / 分支：实际值
workflow / run ID / attempt / 运行链接：实际值
artifact 名称 / 是否可下载：实际值
镜像标签 / 平台：来自 build-info.json
检查结果 / 未验证项：实际值
下一步：下载并在已授权目标上部署；或等待具体缺项
```

本地按指定 run 下载，不取“最近一个成功运行”碰运气。CLI 示例中的占位符应替换为实际值：[G3]

```bash
gh run view RUN_ID -R Jonoka/changqi-checkin-h5
gh run download RUN_ID -R Jonoka/changqi-checkin-h5 -n ARTIFACT_NAME -D ./release
```

核对该 run 的 SHA、attempt、检查状态和包内元数据；只有日志显示真实完成才算通过。浏览器下载若外层为 ZIP，先解包，再取内部镜像归档。下载后的发布目录只是文件中转，不需要作为 Git 代码提交；传输中断重传文件，不重新编译源代码。

## 6. 服务器加载与更新

首次由有权限的本地 Agent 核对目标服务器、部署目录、Docker/Compose 和 MySQL；安装缺失组件、创建项目库或调整 Nginx 前明确对象及影响。不能影响其他站点或升级迁移现有数据库。桥接容器到宿主机 MySQL 的地址/监听/授权需实测，不照搬容器 localhost，也不开放公网数据库端口。

宝塔继续接收 80/443；应用按未占用端口绑定宿主机回环地址（例如 `127.0.0.1:3000`），反代到应用。设置请求体大小余量及原始协议转发，检查 HTTPS 下会话 Cookie 和微信回调能正常工作。照片宿主机目录挂载到容器配置的 UPLOAD_DIR，不放临时容器层。

SSH 私钥保留在已授权的本地环境，微信/数据库/SESSION_SECRET 留服务器 `.env.runtime`。Compose 中 APP_IMAGE 从环境文件读取；不要上传本地测试 `.env` 覆盖生产文件。GitHub Actions 不持生产 SSH 私钥，也不自动执行部署。

首次部署需按同一源码版本的建表脚本建立新项目库；后续更新不重置数据。备份并记录当前镜像，上传指定产物后更新 `.env.runtime` 中的 APP_IMAGE 为本次 `build-info.json` 的 imageTag，再执行以下约定命令。**命令仅供 A6 实现后使用，本轮未执行；文件名和部署目录以实际情况替换。**[D2][D3]

```bash
# 在项目部署目录中，镜像包已通过 SCP/SFTP 上传
docker load -i changqi-image.tar.gz
docker compose --env-file .env.runtime -f compose.yaml up -d --no-build --pull never app
docker compose --env-file .env.runtime -f compose.yaml ps
docker compose --env-file .env.runtime -f compose.yaml logs --tail=100 app
```

检查页面/API、日志、数据库连接及旧照片和进度；微信授权、页内扫码和真实相册由真机另验。容器运行不等于微信业务通过；运行失败记录原因，保留原数据。需要回退时将 APP_IMAGE 改回保留的上一版并更新 app，不恢复旧游客数据库、不删除数据卷。只需保留当前/上一版镜像并观察磁盘，不做自动清理平台或零停机集群。

## 7. 授权边界

用户准备给本地 Agent 服务器连接权限；连接可用性以实际 SSH 配置和成功读取为准。明确发布任务与目标后，在该授权范围内连续完成下载、上传、加载、更新和检查，不逐条重复请求确认。单纯开发/改文档/请求构建不视为允许修改生产；公众号菜单、其他消息服务、删除数据另行确认。

历史运行、artifact 配额、服务器检查与实际授权范围只记 TASKS，不在本文件累积重复状态。额度未知时不能宣称已恢复，不能删除其他项目产物、调整付费或忽略上传失败来完成交付。地点二维码纸样导出独立于 Actions artifact。

## 8. 正式入口与微信联调核对

正式 origin 是 `https://cq.fsxinhuo.cn`。以下仅为非敏感生产约定，不是完整可直接启动的环境文件，不覆盖服务器已有 `.env.runtime` 或电脑 `.env`：

```dotenv
PUBLIC_ORIGIN=https://cq.fsxinhuo.cn
NODE_ENV=production
DEV_MOCK_ENABLED=false
UPLOAD_DIR=/var/lib/changqi/uploads
```

菜单计划地址为 `https://cq.fsxinhuo.cn/`；OAuth 固定回调为 `https://cq.fsxinhuo.cn/auth/callback`。保持 `/q/p01`～`/q/p05` 地点码路径，游客视图 `/#claim` 与持码派发 `/r/:claimCode` 不互换。运行代码按环境读取 PUBLIC_ORIGIN，不把最终域名硬编码为所有环境默认值。

公众号负责人按当时官方后台核对“印象芦苞”的网页授权与 JS-SDK/scanQRCode 实际权限。网页授权域名与 JS 接口安全域名按后台要求配置为 `cq.fsxinhuo.cn`；填域名而非带协议和回调路径的 URL。后台要求时再核对业务域名、平台提供的校验文件与真实应用服务器出口 IP 白名单，不把电脑网络出口或解析 IP 当成应用出口。公众号若已有第三方托管，先确认凭据/票据管理方式，不重置 AppSecret、不开关消息服务器、不改已有托管和菜单。[W1][W2]

只在已授权运行环境核对微信凭据、SESSION_SECRET、数据库及统计凭据是否完整，不输出密钥、Cookie、OpenID、完整连接串或环境文件。网页授权采用 snsapi_base，页面扫描使用 needResult:1；这些代码约定或官方说明均不证明该公众号已具备权限。[W1][W2]

服务器只读核对须区分四层：公网 DNS；证书域名/有效期/信任链；当前 `/`、`/api/activity` 与五条 `/q/` 确实属于本项目；运行镜像/source SHA 与验收代码一致。默认欢迎页或单纯 200 不等于部署成功。只读探测不调用上传、领取写接口，也不访问任意游客凭证。

已获服务器权限后，核对 MySQL 连接及容器到宿主机地址、会话持久化、Secure/HttpOnly/SameSite Cookie、Nginx 原始协议转发、HTTP→HTTPS、路径不被错误重写、应用回环端口、15 MiB 上传余量和照片持久挂载的写权限。只报告是否正确，不打印凭据；没有可用 SSH 时写未核验，不因提供域名而自行安装、重启或部署。

域名未运行可用项目时，A5 本地回归和 A6.3 最终地址纸样仍可完成；A6.1 构建与 A6.2 首次联调部署在取得对应授权后衔接，不形成相互等待。没有正式库测试写入授权，不新增游客照片或标记领取。纸样操作及批量印刷条件见 SPEC S10，生成命令见 README。

### 微信地点直达入口（2026-09-23 变更）

正式 origin、固定回调和五条 `/q/` 载荷不变，不更换 AppID/AppSecret，不重置或迁移数据库。微信内有效 `/q/` 重新 snsapi_base 识别当前用户一次，回调保存会话/有效地点后直接到 `/#point/:key`；外部游客首页/地点入口只提示微信打开，不依赖数据库，不影响匿名 `/r/`、API、静态资源或 `/stats` 固定凭据。不能缓存 `/q/`、授权和本人状态，按环境分流返回 Vary: User-Agent；静态图片缓存不受影响。

游客说明：使用微信扫一扫现场地点二维码，打开页面并上传现场照片。也可从‘印象芦苞’公众号进入活动，使用页面内扫一扫。旧纸样包/码图保留，仅更正外围说明；不得写扫码即完成或要求重印码图。

本轮入口代码默认仅本地实现/测试/提交，不沿用旧发布授权替换线上。获本次发布授权后按同一云构建/SSH 流程更新并回读镜像 SHA，保护环境、游客记录、照片。随后用 iOS/Android 微信验证首次直扫、原菜单用户换入口、重进/会话过期、同设备换账号、已关注/未关注、五处、拍照/相册、复扫与两路领取。公众号权限或真机不足明确待验，不将失败改成强制关注规则；本地 OAuth/SDK 模拟不等于微信通过。

## 资料入口

本轮读取以下官方资料核对能力与命令；未因此认定本项目账号或服务器已配置成功。具体 action / runner / 依赖版本在 A0/A6 实现时选择并验证。

- [G1 GitHub：手动运行工作流](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)
- [G2 GitHub：工作流触发与路径过滤](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
- [G3 GitHub：下载构建产物](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts)
- [D1 Docker：通过 Actions artifact 传递镜像](https://docs.docker.com/build/ci/github-actions/share-image-jobs/)
- [D2 Docker：load 导入归档](https://docs.docker.com/reference/cli/docker/image/load/)
- [D3 Docker：Compose 更新服务](https://docs.docker.com/reference/cli/docker/compose/up/)
- [W1 微信：网页授权](https://developers.weixin.qq.com/doc/service/guide/h5/auth.html)
- [W2 微信：JS-SDK 使用说明](https://developers.weixin.qq.com/doc/service/guide/h5/jssdk.html)
