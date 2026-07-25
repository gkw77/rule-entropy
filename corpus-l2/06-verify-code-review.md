# 代码审查

写完代码后强制审查。三趟职责分离，互不稀释。

## Review Checklist
- 代码可读、命名清晰
- 函数聚焦（<50 行）
- 文件内聚（<800 行）
- 无硬编码 secret
- 新功能有测试
- 覆盖率 >= 80%

## 分级审查
- Deletion-only（猎过度工程）
- Handoff（审 cheaper executor 的 diff）
- Cross-model（不同模型 reviewer）
- Maker-checker（独立上下文，implementer 不给自己打分）

## 严重级别
CRITICAL（BLOCK）/ HIGH（WARN）/ MEDIUM（INFO）/ LOW（NOTE）。
