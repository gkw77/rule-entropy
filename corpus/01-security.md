<!-- middleware: stage-1 -->

# Stage 1: Security

> 触发时机: 收到用户消息、每次工具调用前
> 职责: 安全前置检查，防止恶意输入和泄露

## Secret 检测

在任何操作前检查：
- [ ] 无硬编码 secret（API key、密码、token）
- [ ] 所有用户输入已验证
- [ ] SQL 注入防护（参数化查询）
- [ ] XSS 防护（HTML 转义）
- [ ] CSRF 保护已启用
- [ ] 错误信息不泄露敏感数据

## Secret 管理

- NEVER 在源码中硬编码 secret
- ALWAYS 使用环境变量或 secret manager
- 启动时验证必需的 secret 存在
- 泄露的 secret 立即轮换

## 敏感数据 pipeline 隐私工程链（来自 Doriandarko/texts-to-transformer，未自测-行为规则）

> 上面 Secret 检测是"源码里别硬编码"；本节是"处理用户隐私数据（消息/邮件/病历/财务）时的完整 pipeline"--secret 是输入面，隐私数据是处理面。咬合 06a 审计纪律（findings 永不复现 secret 值）。

texts-to-transformer 从 iMessage chat.db 训练个人风格模型，隐私工程是全链路的：

1. **doctor 预检环境**：跑 `doctor` 命令验证硬件/磁盘/**gitignore 覆盖**/目录权限/**只读 db 访问**全满足再动手。不满足即停，不靠手动 workaround。咬合 04 前置估算门（可行性预检）
2. **read-only + 私有备份**：live db 永以 SQLite read-only 打开、永不修改；从 consistent private backup 处理，不从 live db。永不手动复制 live db 或改其权限作 workaround
3. **pseudonymize（≠ anonymize）**：handles/chat IDs 替换为 keyed HMAC 假名；URL/email/phone-shaped strings 默认 redact。**明确声明 pseudonymization 不是 anonymization**，work/ 仍须 FileVault 保护、永不 commit/upload
4. **leakage-resistant split**：按 conversation session 切分 train/val/test，防同一对话跨集合泄漏（随机切分会把一条对话的上下文同时进训练和测试）
5. **memorization check**：训练后检查模型是否记忆了私有文本；结果模型"可能记忆私有文本，必须保持私有"
6. **never print raw + never upload**：正常日志永不打印原始消息；任何命令不上传数据、不发 iMessage；chat 只在终端打印建议
7. **artifacts 进 .gitignore**：datasets/tokenizers/checkpoints/weights 全排除出 Git

**落地**：处理隐私数据任务（分析用户数据、训练个人模型、导出含 PII 的报告）按此链：doctor 预检 -> read-only 备份 -> HMAC pseudonymize + redact -> session-aware split -> memorization check -> never print/upload -> artifacts 不入树。咬合 01 Secret 管理（轮换）+ 06a 审计纪律（不写 credential 值）+ 06 产物溯源链（artifacts 带溯源但不入树）。

## 输入验证

ALWAYS 在系统边界验证输入：
- 验证所有用户输入再处理
- 使用 schema 验证（如 Zod、Pydantic）
- 快速失败，清晰错误消息
- 永不信任外部数据（API 响应、用户输入、文件内容）

## 权限控制

- 仅对可信、明确的计划启用 auto-accept
- 探索性工作时禁用 auto-accept
- 永不使用 dangerously-skip-permissions
- 通过 `~/.claude.json` 的 `allowedTools` 配置权限

## Policy 三层叠加（严格者胜）

> 来自 omnigent。安全/审批规则跨层级组合，比单层 checklist 更强。

策略按三层叠加，**更严格的会话级胜出**，每次 PreToolUse 都查：

1. **Global** — `~/.claude/settings.json`（用户全局底线）
2. **Project** — 项目 `.claude/settings.json`（项目加固）
3. **Session** — 本次会话的临时覆盖（最严）

写一条策略（如 `ask_on_os_tools`、`max_tool_calls_per_session`、`cost_budget`）即对所有层生效。冲突时取最严，而非取最近。

## 安全审查触发器

以下场景必须 STOP 并使用 **security-reviewer** agent：
- 认证/授权代码
- 用户输入处理
- 数据库查询
- 文件系统操作
- 外部 API 调用
- 密码学操作
- 支付/金融代码

## 供应链攻击检测（campaign 声明式）

> 来自 lenucksi/aur-malware-check（2026-06 AUR atomic-lockfile 攻击，1600+ 包被植入 `npm install atomic-lockfile` / `bun install js-digest`，投递 infostealer + eBPF rootkit 打 dev 凭证 + CI/CD secrets）。把供应链检测从静态 checklist 升级为**声明式、多波次、带 provenance** 的结构。

**新攻击波 = 新 campaign 对象，零代码改动。** campaigns.json 每 campaign 声明：

| 字段 | 用途 |
|------|------|
| `id` / `type` / `display` | 标识 + 生态类型（aur/npm/pypi…）+ 人读名 |
| `lists` / `npm_lists` | 受害包列表。**跨生态**：AUR 攻击的 payload 是 npm 包，所以同时列 AUR 包 + npm 包 |
| `date_window` | 攻击窗口 `{start, end}`，按时间过滤 |
| `refresh_url` → `refresh_target` | 活更新源（如 HedgeDoc）+ 刷新写入的本地文件 |
| `ioc_files` | Indicators of Compromise：`[{path, sha256, description}]`（如 `~/.local/bin/sudo` + sha256 + "Sudo password grabber"） |
| `sources` | provenance 图：`{URL/path → {date, comment}}`。每条声明可溯源到带日期的原始报告/邮件/commit |

**为什么比 checklist 强：**
1. **多波次**：同一架构处理 CHAOS RAT 2025 / atomic-lockfile 2026 / 未来波，每波一个 campaign 对象
2. **provenance 可溯**：每个 IOC / 包列表条目挂来源 + 日期，不是裸断言
3. **活更新**：`refresh_url` 拉官方 HedgeDoc，攻击演进时列表自动跟进
4. **跨生态**：`npm_lists` 捕获"AUR 投递 npm 包"这类跨生态 payload

**落地**：scanners/ 按 `campaign.type` 分发（aur_scanner / npm_scanner），campaign.py 加载声明，merger.py 合并多 campaign 列表。新生态 = 加 scanner + 新 type，不改现有 campaign。

咬合 06a-security-audit-skill：06a 审 codebase 漏洞；本节审**依赖图供应链**。两者 findings.json 可同 schema（06a 的 trace/conditions 适用于"恶意包如何进入依赖树"）。

## 权限模型：deny-by-default + 不可覆盖硬策略（来自 unicity-astrid）

> Astrid OS 的 Five-Layer Security Gate。agent 跑在沙箱里**无 ambient authority**——每个能力 / 路径 / 主机 / tool 都是显式声明 + 签名 grant，不是"默认全给然后限制"。补本文件"权限控制"只有 auto-accept 开关、缺 capability 模型的缺口。

### Deny-by-default

每个 resource（net / fs_read / fs_write / host_process / identity…）在 manifest 里显式声明 allowlist。**字段缺省 = 空 allowlist = 拒绝**。check 方法未 override 时 fail-closed。对照：auto-accept 是"默认给然后拦"，capability 是"默认不给然后授"。

### 五层门，硬策略不可覆盖

每个 sensitive action 过 `SecurityInterceptor`，五层固定顺序、intersection 语义：

1. **Policy（硬边界）** — operator 配置的静态规则，**永不被 capability token / allowance / 用户 approval 覆盖**。`rm -rf /`/`sudo`/`mkfs`/`dd`/`shutdown` 直接 block；`/etc/`/`/boot/`/`/sys/`/`/proc/`/`/dev/` 写拒绝
2. **Capability Token** — 签名 token 覆盖 resource+permission；`use_token` 在 audit 前调用（消耗 / 过期 / 吊销即失败）
3. **Budget** — 配额核算
4. **Approval** — 风险评估后人工批准（Layer 1 标 RequiresApproval 才走）
5. **Audit** — 每个 gated action 写 audit 条目，记 `proof`（如何授权）+ `audit_id`

关键：**Layer 1 是硬墙，capability/approval 都越不过**。补本文件"Policy 三层叠加"——三层叠加是 settings 层级取严；五层门是**安全门类间取严**（policy > capability > approval，前层 block 后层跳过）。

### Per-principal 隔离

所有 capability/allowance 查询 scope 到 `PrincipalId`。**Agent A 的 prior approval 不能授权 Agent B 的 invocation。** 咬合 06-verify.md maker-checker 独立上下文——审查者与执行者是不同 principal，权限不串。

### Resource URI 规范化

每个 action 有 canonical URI，跨工具类型统一 gating：`mcp://{server}:{tool}` / `file://{path}` / `exec://{command}` / `net://{host}:{port}` / `capsule://{id}:{cap}`。MCP 工具调用与文件读写走同一套 capability 机制，不特殊化。
