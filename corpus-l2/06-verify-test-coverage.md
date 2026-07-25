# 测试覆盖率门

最低覆盖率 80%。Unit / Integration / E2E 全必需。

## 豁免（YAGNI 适用于测试）
- trivial one-liner
- 一次性脚本
- 纯文档 / 注释改动

## ONE-check
非平凡逻辑至少留一个 assert 自检（demo() / __main__ 或一个 test_*），断言会在逻辑破坏时失败。

## TDD 流程
先写测试（RED）-> 确认 FAIL -> 写最小实现（GREEN）-> 重构（IMPROVE）-> 验证覆盖率。
