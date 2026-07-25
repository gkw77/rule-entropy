# SQL 注入防护

参数化查询是防 SQL 注入的核心。永不拼接 SQL 字符串。

## 检测点
- 硬编码 SQL 拼接
- 动态标识符（表名 / 列名拼接）
- search / FTS 查询
- `sql.raw()` 调用

## 防护
- 参数化查询（prepared statement）
- ORM 的 raw() 要逐个审计
- 动态标识符用白名单
- 永不信任外部数据拼接进 SQL

## 误报源
"用了参数化查询所以没 SQLi"是懒结论，要查每个 raw()、动态标识符、search/FTS。
