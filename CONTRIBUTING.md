# 贡献指南

欢迎通过 Issue 和 Pull Request 改进 Error Translator。

## 本地开发

1. Fork 仓库并克隆，或在自己的工作副本创建分支。
2. 安装 Node.js 20.3 或更新版本，执行 `npm ci`。
3. 执行 `npx playwright install chromium`，安装浏览器测试使用的 Chromium。
4. 在 Chrome 扩展管理页面加载 `extension/`，修改后重新加载扩展并刷新测试网页。

扩展运行时使用原生 JavaScript、HTML 和 CSS，无构建步骤和第三方运行时依赖。详见 [开发说明](docs/DEVELOPMENT.md)。

## 提交修改

- 让每个 PR 聚焦一个问题，说明触发条件、修改后的行为和验证结果。
- 修复翻译或布局问题时提供可公开的最小 HTML 示例，避免上传私人网页快照。
- 涉及 API 协议时使用模拟响应或脱敏示例；不得提交真实 API Key、Cookie 或账号凭据。
- 新增供应商请附其官方文档，说明认证、语言映射和限流行为。
- 修改版本时同步 `package.json`、`package-lock.json` 和 `extension/manifest.json`，更新 [变更记录](CHANGELOG.md)。

提交前执行：

```sh
npm run check
npm test
npm run test:browser
npm run build
```

测试输出与构建产物已由 `.gitignore` 排除。涉及行为变化应增加相应回归测试；文档修改请检查相对链接和命令。贡献遵循仓库的 [MIT 许可证](LICENSE)。
