# Contributing

感谢你愿意改进 Creator Guard。

## 提交前

1. 不提交 `.env`、`.venv`、`server/data/`、数据库、真实私信/评论截图。
2. 如果改了选择器，请说明对应的平台、页面 URL 类型、DOM 结构（打码后）。
3. 如果改了 prompt/规则，请附带几个正例和反例。
4. 运行测试：

```bash
python -m compileall -q server scripts
python scripts/smoke_test.py
python scripts/llm_contract_test.py
node --check extension/content/comments-core.js
```

## 适合贡献的方向

- B 站/小红书改版后的选择器修复。
- 评论统计的聚类/去重改进。
- 私信分类的 few-shot 和规则补充。
- Windows/macOS/Linux 安装体验。
- 英文文档。

## 不适合贡献的方向

- 自动回复、自动拉黑、自动举报。
- 绕过验证码、风控、平台限制。
- 代理轮换、指纹伪造、无头浏览器登录态。
- 采集/出售他人隐私数据。

这类 PR 会被拒绝。
