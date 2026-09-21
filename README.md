# 长岐村漫游打卡 H5

**交付文档 v1.4 · 2026-09-21 · 网页端与本地开发共用一条发布流程**

面向“印象芦苞”微信公众号的轻量照片打卡活动：菜单进入 → 页面内扫码 → 上传现场照片 → 完成全部地点 → 现场领取 → 标记领取人数。

仓库：`Jonoka/changqi-checkin-h5`，默认分支 `main`。PRD v1.3 的精简业务范围不变；SPEC、TASKS 及部署说明按本版执行。预算几千元、目标交付窗口 2–3 天，不建设后台、库存、员工账号、多活动或复杂防刷。

## 状态记录

任务进度、验收结果、历史 Actions 运行和外部缺项只维护在 [docs/TASKS.md](docs/TASKS.md)。本文件说明实际运行方式，不单独维护另一份任务状态。五张既有视觉原图见 [assets/reference/README.md](assets/reference/README.md)。

## 本地运行

```powershell
npm ci
npm run check
npm run build
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
# 首次启动前在本地填写必要配置；已有 .env 不覆盖。
npm start
```

开发页面可单独运行 `npm run dev`，默认访问 `http://localhost:5173`；后端默认监听 `http://localhost:3000`。没有填写数据库凭据时，开发环境仍可打开公开活动页；填写 `DB_*` 后启动会实际执行 `SELECT 1`。生产环境会拒绝缺少必需密钥或开启 `DEV_MOCK_ENABLED` 的配置。

配置校验由 `npm run check` 执行，当前地点数量从 `config/activity.json` 动态读取。建表前准备好目标数据库后运行 `npm run db:schema`；脚本只创建 `users` 和 `checkins` 两张业务表。

### 身份、会话与开发入口

身份功能需要真实 MySQL 连接和安全随机生成、不少于 32 字符的 `SESSION_SECRET`；密钥仅保存在本地 `.env`。`express-session` 与 `express-mysql-session` 在应用启动时建立必要的 `sessions` 技术表；账号需有建表权限。会话 Cookie 为 HttpOnly、SameSite=Lax，有效期 7 天；HTTPS 使用 Secure。生产遵守 DEPLOY 的回环应用端口及可信反向代理约定，不将应用端口直接暴露到公网。

使用 Vite 时，在 `.env` 设置 `PUBLIC_ORIGIN=http://localhost:5173`、`PORT=3000`；两个终端分别运行 `npm start` 与 `npm run dev`。`/api`、`/auth`、`/q`、`/health` 均由 Vite 代理到后端。只运行构建后的服务时，`PUBLIC_ORIGIN` 改为该服务实际入口（本地通常是 `http://localhost:3000`）。二维码域名、页面签名及回调都使用同一个 `PUBLIC_ORIGIN`，不能混用 localhost、127.0.0.1 或不同端口。

没有微信联调条件时，可在本地显式设置 `NODE_ENV=development` 与 `DEV_MOCK_ENABLED=true`，同时配置独立开发数据库和 `SESSION_SECRET`。页面会显示“开发演示”，提供固定游客 A/B 和完整地点码 URL 输入；它们复用真实用户表、MySQL 会话与 `/api/scan`，不是另一套假进度数据。生产拒绝模拟开关，未配置微信不会自动退回模拟身份。模拟身份会话在关闭模拟后也不能当成正式身份使用。

真实微信使用本地填写的 `WECHAT_APP_ID`、`WECHAT_APP_SECRET`，先确认授权域名、JS 接口安全域名、接口权限及服务端网络条件；不改变公众号菜单、消息服务或第三方托管配置。OAuth 错误页提供手动重试，接口未登录返回 JSON 401。直接打开 `/q/p01` 始终是公众号入口引导；页内扫码识别地点但不增加进度。地点查看使用 hash 路由，不授予扫码资格；照片上传接口和领取写入尚未接入。

### 轻量验证

`npm run check` 保留配置/HTTP 冒烟并运行 Node 内置测试；其中微信网络与 SDK 回调为明确模拟。`npm run build` 只构建前端，不请求 Actions 镜像打包。

数据库检查必须显式选择独立、回环监听的 MySQL 8 测试实例；不使用应用的 `DB_*` 作为默认测试目标。下面是变量占位，不是可直接连接生产的凭据：

```powershell
$env:TEST_DB_HOST = '127.0.0.1'
$env:TEST_DB_PORT = '3311' # 填独立测试实例的实际端口
$env:TEST_DB_USER = 'test_user'
$env:TEST_DB_PASSWORD = '<仅在本地填写>'
# 可选：使用已有 Chrome/Edge 做实际页面检查，不安装第二套测试平台。
$env:TEST_BROWSER_EXECUTABLE = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run test:a1:mysql
```

测试会创建随机 `changqi_a1_test_*` 库，执行 dotenv-only `npm run db:schema`、真实会话/接口、真实 Node 子进程重启和 Vite 代理检查，只删除本次成功创建的测试库与临时凭据文件。测试账号需可创建/删除该测试库；Vite 检查需要本地 3000、5173 端口空闲。浏览器检查只使用新建的临时 profile；未提供浏览器路径时会明确打印 SKIP。微信网络与摄像头回调均为模拟，不计作 iOS/Android 真机验收。请勿开启会输出连接或会话内容的依赖调试日志。

会话适配器的 MySQL 驱动通过 npm `overrides` 复用根 `mysql2`，避免夹带旧驱动；正常安装并维护同一个 `package-lock.json`，不要移除该约束或使用 `npm audit fix --force`。


## 当前工程结构

- `web/`：Vue 3 + Vite 页面
- `server/`：Express 应用与 MySQL 连接
- `config/activity.json`：唯一活动配置来源
- `db/schema.sql`：业务表建表脚本
- `Dockerfile`、`compose.yaml`：单 `app` 容器发布准备
- `.github/workflows/build-image.yml`：Actions 检查、单平台镜像导出与 artifact

## 文档入口

| 文件 | 职责 |
| --- | --- |
| [docs/PRD.md](docs/PRD.md) | 已确认的产品范围与用户流程，仍为 v1.3 |
| [docs/SPEC.md](docs/SPEC.md) | 行为、接口、数据、构建与部署的实现约定，v1.4 |
| [docs/TASKS.md](docs/TASKS.md) | A0–A6 任务、验收结果与唯一接续记录，v1.4 |
| [docs/DEPLOY.md](docs/DEPLOY.md) | 两种开发入口、Actions 构建、本地中转与 SSH 部署 |
| [AGENTS.md](AGENTS.md) | 修改、验证、Git 与权限约定 |
| [assets/reference/README.md](assets/reference/README.md) | 视觉参考用途与必须纠正的旧图内容 |
| [.env.example](.env.example) | 环境变量占位样例，无真实凭据；A6 补充容器运行项 |

DEPLOY 是操作说明，不是另一份任务清单。只在 TASKS 记录实际进度，不恢复 TSD、PLAN_AGENT 或独立 IMPLEMENTATION_STATUS。

## 两种开发方式，随时接续

| 环节 | 方式 A：ChatGPT 网页端 | 方式 B：电脑上的 Coding Agent |
| --- | --- | --- |
| 开发 | 通过已授权 GitHub 工具读取、修改、提交；可用执行环境按实际情况运行检查 | 在本地工作区开发、运行检查、提交并推送 |
| 触发构建 | 有手动触发工具时用 `workflow_dispatch`；否则明确更新构建请求文件触发同一工作流 | 用 `gh workflow run` 或 GitHub 的 Run workflow；也可沿用构建请求文件 |
| 构建执行 | GitHub 托管 runner，不在聊天页面或生产机上构建 | 同左；本地只是发起请求，不要求安装 Docker 来打包 |
| 构建交接 | 核对运行结果，提供源码 SHA、run ID、artifact 名称与镜像标签 | 可自行取同一组信息，不必经网页端再确认 |
| 下载与部署 | 默认交接给有权限的本地 Agent，不假定聊天能访问你的电脑或 SSH | 下载指定产物 → 上传服务器 → `docker load` → Compose 更新 → 检查 |

两种方式共用一个仓库、一份 SPEC、一份 TASKS、一个构建工作流与同一种镜像包。单次由一个执行端推进，不需要同时开启两个 Agent，也不建立协作平台。换端时先核对远端实际提交；有本地目录再检查分支、HEAD、全部未跟踪文件。保护本地修改，仅安全 fast-forward，不用旧工作区覆盖新代码。

## 已选部署结构

用户提供的环境：**1 核 1GB，可扩容；Alibaba Cloud Linux 3.2104 LTS 64 位；已安装宝塔和 MySQL。** 这是已知条件，不代表已经登录检查过。CPU 架构、剩余内存/磁盘、MySQL 版本、Docker/Compose 是否安装以及宝塔网站服务配置，首次部署时核对。

```text
ChatGPT 网页开发 ─┐
                  ├→ GitHub Actions 构建 → 本地 Agent 下载 → SSH 上传
本地 Agent 开发 ─┘                                      ↓
                                             Docker 加载一个应用镜像
                                                        ↓
                                  宝塔 Nginx / HTTPS → 应用容器
                                                        ├→ 宝塔现有 MySQL
                                                        └→ 服务器照片持久目录
```

空工程默认 Vue 3 + Vite、Node.js + Express。构建后的前端与后端放一个应用镜像；Compose 只运行 `app`，不另起生产 MySQL、Nginx 或 Redis 容器，不在 1GB 服务器上安装开发依赖、构建前端或运行整套测试。测试中临时使用 MySQL 不等于增加生产数据库。

只增加一个轻量 Actions 构建工作流：按需运行必要检查、打包、上传 artifact，不直接 SSH 生产部署，不搭镜像仓库或自托管 runner。详细触发、产物和授权规则见 [DEPLOY](docs/DEPLOY.md)。

## 开工提示词：网页端

```text
在 GitHub 仓库 Jonoka/changqi-checkin-h5 继续开发。
先读 AGENTS.md、README.md、docs/PRD.md、docs/SPEC.md、docs/TASKS.md、
docs/DEPLOY.md 和视觉参考；读取实际分支、HEAD、文件及开放 PR，保护已有工作。
按 TASKS 从首个可执行任务实际实现，不只重新规划。网页端没有用户本地工作区时，
如实记未核验；没有可用执行环境的检查交给 Actions 或本地 Agent，不编造通过。
需要构建且已获本轮构建授权时：复用 build-image 工作流；有 dispatch 工具就调用，
没有则仅更新约定的构建请求文件。不要假装已有工具或工作流。
读取实际 run 结果，按 DEPLOY 给出具体版本和产物交接。
默认由我电脑上有 SSH 权限的 Agent 下载、上传和部署；不要把构建成功当上线。
不增加后台、库存、员工账号或复杂防刷。进度只记 TASKS；生产操作按授权范围执行。
```

## 开工 / 接续提示词：本地 Agent

```text
在本地选定的 Jonoka/changqi-checkin-h5 工作区继续。
先检查分支、HEAD、git status --porcelain=v1 --untracked-files=all 及远端更新，
保留已有修改与密钥；仅安全 fast-forward。阅读 AGENTS、PRD、SPEC、TASKS、DEPLOY。
开发按 TASKS 继续，不重建已有功能。需要构建时推送目标代码后触发同一 Actions 工作流。
若是接手网页端已有构建，按其源码 SHA、run ID 和 artifact 下载，不重复构建。
先核对实际构建结果和镜像版本，再使用已配置 SSH，在已授权的目标部署或更新。
复用宝塔 MySQL，只运行应用容器，不在生产机重新构建，不覆盖照片或业务数据。
构建、服务器部署、微信真机分别记录结果；未验证的不写通过。仅在 TASKS 更新接续记录。
```

## 外部条件与权限

用户愿意为本地 Agent 配置服务器连接权限；不等于本轮已取得可用 SSH，也不等于授予所有会话无限生产操作权限。连接配置、目标与授权清楚后，同一发布任务内的常规步骤可连续执行，不逐条索要确认。公众号菜单或消息服务修改、删除生产数据仍单独确认。

微信 AppSecret、SSH 私钥、数据库密码和用户照片不进 Git、Actions artifact 或镜像；运行凭据留在服务器，SSH 凭据由有权限的本地执行端使用。正式二维码只用最终 HTTPS 域名并经实际试扫，不将效果图假码用于印刷。
