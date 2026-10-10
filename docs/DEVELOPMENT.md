# 开发与验证

[返回 README](../README.md) · [配置指南](CONFIGURATION.md) · [贡献指南](../CONTRIBUTING.md)

## 环境与运行

扩展运行时没有第三方依赖，所有脚本和样式本地提供。开发校验需要 Node.js 20.3 或更新版本（测试使用 `AbortSignal.any`），CI 使用 Node.js 22。Playwright 是开发依赖，版本由 `package-lock.json` 锁定。

```sh
git clone https://github.com/sudoriaa/ErrorTranslator.git
cd ErrorTranslator
npm ci
npx playwright install chromium
```

在 `chrome://extensions/` 加载 `extension/`。修改源文件后重新加载扩展，再刷新目标页面。

## 命令

| 命令 | 用途 |
| --- | --- |
| `npm run check` | JavaScript 语法、Manifest 资源和 HTML 本地引用检查 |
| `npm test` | API、协议、队列和纯译文契约单元测试 |
| `npm run test:browser` | Chat Completions、Responses 扩展测试及布局回归 |
| `npm run build` | 复制扩展与说明文件，创建版本化 ZIP |
| `node tests/browser.mjs` | 单独运行 Chat Completions 浏览器测试 |
| `node tests/browser.mjs responses` | 单独运行 Responses 浏览器测试 |
| `node tests/layout.mjs` | 单独运行布局回归 |

浏览器测试使用本地模拟 AI 服务，运行真实 MV3 后台、菜单和设置页。由于无头浏览器不能确认原生主机权限弹窗，测试用临时扩展副本仅预授权本地模拟服务；正式扩展仍使用可选网络权限。

覆盖供应商保存、模型列表、连接测试、三种翻译模式、段落编号映射、代码与表单保护、链接和事件保留、Shadow DOM、同源 iframe、动态更新、停止及恢复。还检查纯译文纠正、接口错误、自定义控件和配置导入导出，以及 5 并发 × 16 段的乱序交付与取消。Responses 用例包含约 32 秒的模拟上游响应，验证长请求；整个测试流程可能需要数分钟。

布局测试使用合成的 GitHub 风格页面，检查窄 Flex/Grid 标签、额外空白和强制页面样式。悬停测试覆盖移开后 2 秒恢复、移回取消恢复和立即恢复操作。

上述检查不代表所有真实供应商、网站或模型均已验证。真实服务测试需要自己的凭据，结果取决于上游服务。

## 构建

`npm run build` 输出：

```text
dist/
  error-translator/          可直接加载的目录
  error-translator-1.2.1.zip  可分发的扩展包
```

构建在 Windows 使用系统 PowerShell 的 ZIP API，在其他系统需要 `zip` 命令。构建脚本直接复制文件，不做压缩混淆或编译。包内包含 README、许可证、隐私与安全说明、贡献指南、变更记录及 `docs/`，解压后可离线查看本地文档。

发布前检查三个版本字段一致：`package.json`、`package-lock.json` 与 `extension/manifest.json`；更新 `CHANGELOG.md`。构建不会自动提交商店、创建 GitHub Release 或推送 Git。

CI 在推送 `main`、发起 PR 或手动触发时执行资源检查、单元测试、浏览器测试和构建；成功的 ZIP 保存在 Actions artifacts 中，并非 GitHub Release。失败时尝试保存 `test-results/` 便于排查。

## 可选 HTML 快照回归

```sh
node tests/snapshot.mjs "/absolute/path/to/private-snapshot.html"
```

该脚本接受仓库外的 HTML 文件，移除页面脚本，使用模拟译文，检查可见控件尺寸和恢复。它会加载 `github.githubassets.com` 的公共样式，禁止其余外部请求，不把页面文本发送给翻译供应商；不覆盖原站脚本实时重绘。需提供带有有效 GitHub 样式引用的快照，该测试不属于 CI。

快照及其截图可能含私人内容，请保持在仓库之外或忽略的 `test-results/` 中。浏览器测试输出同样写入 `test-results/`，均不提交。README 的界面预览位于 `docs/images/`，由模拟数据生成。

## 项目结构

```text
extension/
  manifest.json             Chrome MV3 配置
  popup.html / options.html 菜单与设置页
  ui.css                    共享样式
  icons/                    原创扩展图标
  src/
    config.js               供应商预设、语言与配置
    api.js / md5.js          API 适配、结果校验、百度签名
    translation-agent.js    纯译文契约、复核与纠正
    request-queue.js         并发上限、发起间隔与取消
    ui-controls.js          自定义下拉框与模型建议
    background.js           网络请求、缓存、取消与凭据隔离
    popup.js / options.js    菜单与设置交互
    content/dom.js          文本采集与布局保护
    content/controller.js   翻译会话、渲染与动态更新
docs/                       配置、开发文档与界面预览
tests/                      单元测试、浏览器测试与 HTML fixtures
scripts/                    校验、打包、图标生成
.github/                    CI、Issue 与 PR 模板
```

`python scripts/icons.py` 可重新生成原创图标，需额外安装 Pillow。日常开发、使用和构建无需 Python。
