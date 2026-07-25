# API Key 与 Secret 管理

永不硬编码 secret。用环境变量或 secret manager。

## 检测点
- 源码里的 API key / token / 密码
- .env 提交进 git
- 配置文件里的凭证

## 防护
- 环境变量
- secret manager
- 启动时验证必需 secret 存在
- 泄露的 secret 立即轮换

## 审计纪律
findings / plans / REPORT 里永不复现 credential 实际值，只引 file:line + 凭证类型，建议轮换。
