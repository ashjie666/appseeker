# AppSeeker · 小程序机会雷达（MVP）

跨平台小程序榜单聚合 + **「高下载 · 低好评」反向筛选**洞察工具。
核心目标：发现**需求强、体验差**的可替代机会 —— 即那些**下载量很高、但好评率明显偏低**的小程序。

> 本地可零依赖直接运行：原生 HTML/CSS/JS 静态站 + PowerShell 数据管道，本机无需 Python / Node / Docker。
> 生产形态为**互联网端**：云端定时任务每日两次刷新数据，整站发布在 GitHub Pages。

---

## 一、快速开始

**本地预览（开发调试）**

```powershell
# 1) 生成数据（首次运行会自动回填 14 天历史，让趋势图有内容）
powershell -NoProfile -ExecutionPolicy Bypass -File L:\site\appseeker\pipeline\run.ps1

# 2) 打开网站（双击即可，数据以 JS 变量下发，不受 file:// 的 CORS 限制）
start L:\site\appseeker\public\index.html
```

**上互联网（生产）** —— 见「五、云端部署与自动更新」。云端跑的是同一套管道，由 GitHub Actions 每日两次自动更新并发布。

看到首页顶部提示 **数据最新**，说明管道已跑通。

---

## 二、目录结构

```
appseeker/
├─ config.json                    阈值 / 平台 / 调度 / 合规开关（唯一配置入口）
├─ docs/PRD.md                    完整产品需求文档（10 章）
├─ .github/workflows/update.yml   云端定时任务：每日两次刷新数据 + 发布 GitHub Pages
├─ .gitignore                     排除手工导入的榜单 CSV 等
├─ pipeline/
│  ├─ run.ps1                     主入口：采集 → 清洗 → 评分 → 输出
│  ├─ adapters.ps1                数据源适配器（demo / csv / 平台占位）
│  └─ scoring.ps1                 清洗、评分、历史合并、输出契约
├─ inbox/                         真实数据入口：放入 *.csv 即被采集
│  └─ sample-rankings.csv         示例格式（12 行，含「高下载低好评」样本）
├─ public/                        ← 网站本体
│  ├─ index.html                  首页：榜单列表 + 筛选 + 排序 + 收藏 + 象限散点图
│  ├─ detail.html                 详情页：指标卡 + 趋势图 + 跨平台对比
│  ├─ css/style.css               视觉系统
│  ├─ js/app.js                   首页逻辑
│  ├─ js/detail.js                详情页逻辑
│  └─ data/                       管道产出（云端每轮自动提交回仓库）
│     ├─ latest.js  latest.json   榜单快照（window.APPS_DATA）
│     └─ history.js history.json  历史趋势（window.APPS_HISTORY）
└─ data/                          运行期产物
   ├─ snapshots/                  每轮归档快照（用于算排名变化，云端仅保留最近 6 份）
   └─ logs/                       任务日志 last-run.json（对应 PRD log_crawl_job）
```

---

## 三、平台与量纲口径（metricLabel）

默认启用 3 个平台（`config.json` → `platforms`）：

| code | 名称 | 量纲（metricLabel） | 默认条数 |
|---|---|---|---|
| `wechat` | 微信 | 下载量 | 200 |
| `alipay` | 支付宝 | 下载量 | 160 |
| `html5` | HTML5游戏 | **游玩次数** | 140 |

**为什么需要 `metricLabel`**：HTML5 网页小游戏没有「下载量」这一指标，对应的用户行为是「游玩次数」。若前端写死「下载量」会误导判断，因此：

- 管道在 `latest.js` 的 `meta.platforms[]` 中为每个平台下发 `metricLabel`；
- **首页**处于多平台混合语境，统一使用中性的「**热度**」表述（热度量级 / 热度门槛 / 热度 × 好评率象限图）；
- **详情页**只展示单一平台，按该平台的 `metricLabel` 显示精确量纲（「估算游玩次数」、趋势图左轴「游玩次数」）。

数据模型字段名**保持不变**（`download_display` / `download_est` / `download_pctl`），仅展示文案自适应 —— 对 `html5` 平台，`download_est` 的语义即「估算游玩次数下界」。

**新增平台**：在 `config.json` 的 `platforms` 数组追加一条即可（示意）：

```json
{ "code": "wxgame", "name": "微信小游戏", "enabled": true, "adapter": "wxgame", "demoCount": 120, "metricLabel": "游玩次数" }
```

`adapters.ps1` 会为 `html5` / `wxgame` / `dygame` 自动启用**游戏风格词库**（品类如「休闲益智 / 跑酷 / 塔防」，命名如「疯狂消除大作战」），并额外压低一档口碑 —— 游戏的差评更多来自广告过多、难度不合理、卡关。

---

## 四、数据源三档（默认 demo，零风险）

| 模式 | 配置 | 说明 |
|---|---|---|
| **demo**（默认） | `"source": "demo"` | 确定性模拟数据，**不发起任何真实抓取**。开箱即跑、结果可复现。 |
| **csv**（真实入口） | `"source": "csv"` | 读取 `inbox/*.csv`。把你从公开渠道整理的数据按示例格式放进 inbox 即可。 |
| **平台适配器**（占位） | `"source": "wechat"` 等 | 返回空集并告警；真实抓取**必须先完成 robots/ToS 合规评审**并配置公开榜单端点。 |

切换 CSV 模式：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File L:\site\appseeker\pipeline\run.ps1 -Source csv
```

CSV 列（UTF-8，表头固定）：

```
platform,external_id,name,developer,category,download_display,rating_positive,rating_total,rating_avg,comment_count,source_url
```

- `platform`：`wechat` / `alipay` / `html5` / …（需与 config.json 中 code 一致）
- `download_display`：平台原文，如 `1000万+`、`50万+`、`<1万`（管道解析为估算下界）
- `rating_positive` / `rating_total`：好评数 / 评价总数 → 好评率 = 好评 / 总数

> ⚠️ 云端运行时，`inbox/*.csv` **不会**被提交进仓库（见 `.gitignore`），因此 CSV 模式只适合本地跑。要在云端走真实数据，需启用平台适配器或改用其他数据通道。

---

## 五、云端部署与自动更新（GitHub Actions + GitHub Pages）

生产形态在**互联网端**，不再依赖本机计划任务：

```
GitHub Actions cron（北京时间 07:07 / 19:07）
   └─ windows-latest runner 执行 pipeline/run.ps1
        └─ 产出 public/data/latest.js · history.js
             ├─ 提交回仓库（数据留档，供下一轮计算排名变化）
             └─ 发布到 GitHub Pages → https://<用户名>.github.io/<仓库名>/
```

**前端页面、数据契约、PowerShell 管道逻辑零改动** —— 上云只换了「谁来触发」和「产物放在哪访问」。
站点内所有资源引用均为**相对路径**，因此部署在 `/<仓库名>/` 子路径下无需任何调整。

### 5.1 一次性部署

**① 建一个公开仓库**，仓库名建议 `appseeker`。

> GitHub Free 计划下**只有公开仓库**才能使用 Pages。仓库里只有代码和 demo 模拟数据，不含任何敏感信息。

**② 安装 Git 客户端**（本机当前没有 git）。二选一：

- **GitHub Desktop**（图形化，推荐）<https://desktop.github.com/>
- **Git for Windows**（命令行）<https://git-scm.com/download/win>

**③ 初始化并推送**（在 `L:\site\appseeker` 目录下执行）：

```powershell
git init
git add .
git commit -m "feat: AppSeeker MVP with cloud pipeline"
git branch -M main
git remote add origin https://github.com/<你的用户名>/appseeker.git
git push -u origin main
```

> 用 GitHub Desktop 的话：`File → Add local repository` 选择 `L:\site\appseeker` → `Publish repository`，注意**取消勾选** “Keep this code private”。

**④ 开启 Pages**：仓库 → `Settings` → `Pages` → Build and deployment → Source 选 **GitHub Actions**。

> 这一步必须手动做一次，否则发布环节会报 `Pages is not enabled`。

**⑤ 手动触发一次验证**：仓库 → `Actions` → 左侧选 `Refresh data and deploy` → 右上 `Run workflow`。

跑完后确认三件事：运行标绿、`Run data pipeline` 日志中出现 `pipeline ok`、`Commit refreshed data` 显示已提交推送。

**⑥ 访问站点**：`https://<你的用户名>.github.io/appseeker/`

### 5.2 定时规则

`.github/workflows/update.yml` 中的 cron **一律使用 UTC**（北京时间 = UTC + 8）：

| cron 表达式 | 北京时间 |
|---|---|
| `7 23 * * *` | 07:07 |
| `7 11 * * *` | 19:07 |

**为什么是 7 分而不是 0 分**：GitHub 的定时任务在整点前后极度拥堵，经常延迟数十分钟；错开到 7 分能明显提升准点率。

**其他约束**：`schedule` 事件**只在默认分支上生效**；仓库若超过 60 天无任何活动，定时任务会被自动停用 —— 本 workflow 每轮都会提交数据，因此天然保持活跃。

**想改更新时间**：改 workflow 里那两行 cron（注意换算成 UTC），不需要动 `config.json`。

### 5.3 数据与仓库的关系

- 每轮产物 `public/data/*.js` 会**提交回仓库**，所以仓库里始终保存着最新数据，并且有完整变更历史
- `data/snapshots/` 由 workflow 自动清理，**只保留最近 6 份**，避免仓库体积随每日两次运行持续膨胀
- 排名变化（▲ / ▼）依赖上一轮快照，因此快照**必须**留在仓库里，不能忽略

### 5.4 本地预览仍然可用

云端跑的就是这套管道，本地随时可手动跑一次做调试：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File L:\site\appseeker\pipeline\run.ps1
start L:\site\appseeker\public\index.html
```

### 5.5 失败与停滞

- **失败**：Actions 里该次运行会标红。管道内部会捕获异常，因此 workflow 额外核对了 `data/logs/last-run.json` 的 `status` —— 只要不是 `success` 就**主动抛错**，不会静默通过
- **停滞**：首页根据 `generated_at` 与 `config.json` 的 `freshness`（12h / 24h）显示 `数据最新` → `数据延迟` → `数据已过期` 三级徽章，无需额外监控
- **紧急停止**：把 `config.json` 的 `compliance.killSwitch` 改为 `true`，管道立即停止采集

### 5.6 已知边界

- **收藏不跨设备**：收藏数据存在浏览器 localStorage，换设备或清缓存即丢失。跨设备同步需要账号体系 + 后端存储，属另一个量级的工程，当前 MVP 不做
- **国内访问速度**：GitHub Pages 在国内访问不稳定。若这是硬约束，可后续迁移到「国内云函数 + COS/OSS」—— 届时只需重写管道实现，前端与数据契约无需改动
- **数据源仍是 demo**：上云解决的是「何时更新、放在哪访问」，**不解决「数据从哪来」**。真实数据需走平台适配器（须先过合规评审）或其他数据通道

---

## 六、核心算法（对应 PRD 第 4 章）

**筛选四道门槛**（全部满足才进入「反差名单」）：

```
下载分位 download_pctl ≥ P80
AND 好评率 positive_rate ≤ 70%
AND 评价总量 rating_total ≥ 100
AND 评论数 comment_count ≥ 30
AND NOT 疑似刷量（下载≥100万 且 评价<30）
```

**机会指数**（排序主键，越高越值得关注）：

```
OpportunityScore = 100 × download_pctl × (1 − positive_rate) × confidence
confidence = min(1, rating_total / 500)     # 评价样本不足时降低置信度
```

**热度分 / 口碑分**（辅助解读）：

```
热度分 = 100 × (0.60×download_pctl + 0.25×rank_score + 0.15×norm(ln(1+comment_count)))
口碑分 = 100 × (0.75×positive_rate + 0.25×rating_avg / 5)
```

分位数在**同一「平台 × 品类」内**计算，避免跨品类量纲不可比。
阈值与预设档位（宽松 / 标准 / 严格）都在 `config.json` 中调整。

---

## 七、网站功能一览

**首页** [index.html](public/index.html)
- KPI 概览：覆盖平台数、抓取条目数、反差命中数、全量平均好评率、最高机会指数
- 筛选：平台多选 / 品类 / 热度门槛（预设档位）/ 好评率上限滑杆 / 仅看反差名单
- 排序：机会指数、热度量级、好评率（最低优先）、排名
- 标签：机会 · 口碑告急 · 排名跃升 · 疑似刷量
- 排名变化：▲ 上升 / ▼ 下降（对比上一轮快照）
- **收藏**：每行最左侧 ☆ 一键收藏，顶部「榜单列表 / 我的收藏 N」切换，收藏以独立表格展示并记录**收藏时间**（按时间倒序、可移除、可点击进入详情页）
- **热度 × 好评率象限散点图**：右下角橙区即「需求强、体验差」目标象限（横轴口径随平台：小程序为下载量，HTML5 游戏为游玩次数）
- 所有筛选条件写入 URL，可直接分享；点击任意行进入详情页

**详情页** [detail.html](public/detail.html)
- 五张指标卡：估算热度量级（按当前平台口径，如「估算游玩次数」）/ 好评率 / 平均评分 / 榜内排名 / 机会指数
- 双轴趋势图：柱形=估算热度量级（口径随平台），折线=好评率，含 70% 反差参考线
- 跨平台同名对比：同名条目的横向表现（下载列附平台量纲）
- 数据来源与口径：`source_url`、抓取时间、量纲说明（区间值 ≈ 估算下界）、数据质量标记

---

## 八、合规基线

- 默认 **demo 模式**，不发起任何真实网络请求
- 只采集**平台公开榜单页**的聚合数值（下载档位、评价总数、好评数）
- 遵守 `robots.txt` 与平台 ToS（`compliance.respectRobots`）
- 限速 `rateLimitPerSec = 1`，可随时用 `killSwitch` 停止
- 网站只展示**聚合统计**，**不收录任何评论原文、不涉及任何用户个人信息**
- 所有下载量若为区间值，一律标注 `≈` 并说明「估算下界，非精确值」
- 手工导入的真实榜单 CSV 不进公开仓库（`.gitignore` 已排除 `inbox/*.csv`）

> 免责声明：数据来源于公开榜单 / 模拟示例数据，仅供参考，不构成任何投资建议。

---

## 九、常见问题

**页面打开是空白 / 提示「尚未生成榜单数据」**
→ 还没跑管道。执行第一节的 `run.ps1`。

**提示「脚本运行被禁用」**
→ 始终使用 `-ExecutionPolicy Bypass`（本仓库所有命令都已带上）。若组策略强制限制，请联系 IT 放开或为当前用户设置 `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`。

**趋势图只有一个点**
→ 首次运行会回填 14 天 demo 历史；若切换为 csv 模式，历史会从第二轮运行起逐次累积。

**Actions 报 `Pages is not enabled`**
→ 仓库 `Settings` → `Pages` → Source 还没选成 **GitHub Actions**，见 5.1 第 ④ 步。

**Actions 定时任务不触发**
→ 两个常见原因：workflow 不在默认分支上；或仓库长期无活动被自动停用（本 workflow 每轮会提交数据，通常不会遇到）。

**想改更新时间**
→ 改 `.github/workflows/update.yml` 里两行 cron（UTC，北京时间 − 8 小时）。`config.json` 的 `schedule.times` 只用于页面上的展示文案。

**想调松 / 调严筛选口径**
→ 改 `config.json` 的 `thresholds`（或 `presets`），或直接用首页的预设档位 chip。
