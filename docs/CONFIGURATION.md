# 配置与翻译行为

[返回 README](../README.md) · [开发说明](DEVELOPMENT.md)

## 内置供应商与官方文档

以下为当前版本代码中的预设，并非上游服务可用性保证。模型与服务策略可能变化，请通过上游模型列表或官方文档确认当前可用配置。

| 预设 | 默认接口 / 认证 | 需要填写 |
| --- | --- | --- |
| DeepSeek | `https://api.deepseek.com/chat/completions` · Bearer | API Key；预置 `deepseek-flash`，可从上游获取模型 |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions` · Bearer | 阿里云百炼北京地域 API Key；预置 `qwen-plus` |
| Google 翻译 | `https://translation.googleapis.com/language/translate/v2` · API Key | 开通 Cloud Translation Basic 的 API Key；需启用项目 API 与结算 |
| DeepL Free | `https://api-free.deepl.com/v2/translate` · `DeepL-Auth-Key` | DeepL API Free Key |
| DeepL Pro | `https://api.deepl.com/v2/translate` · `DeepL-Auth-Key` | DeepL API Pro Key |
| 百度翻译 | `https://fanyi-api.baidu.com/api/trans/vip/translate` · MD5 签名 | **APP ID 和密钥**；须开通通用文本翻译 |
| 自定义 AI | Chat Completions / Responses 兼容基础地址或完整接口地址 · Bearer | 名称、接口类型、API 地址、Key、模型；本地模型可不填 Key |

官方资料：

- [DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion) 与 [模型列表](https://api-docs.deepseek.com/api/list-models)。
- [阿里云百炼 OpenAI 兼容接口](https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope)。北京原有 DashScope 域名仍可使用，也可按文档改为业务空间专属域名；其他地域需匹配对应地域 Key。
- [Google Cloud Translation Basic REST API](https://cloud.google.com/translate/docs/reference/rest/v2/translate)。使用官方付费 API，无私有网页翻译接口依赖。
- [DeepL 文本翻译 API](https://developers.deepl.com/api-reference/translate) 与 [API 入门](https://developers.deepl.com/docs/getting-started/quickstart)。Free / Pro 地址和密钥必须匹配，普通网页会员不能直接当作 API 凭据。
- [百度通用文本翻译接入文档](https://fanyi-api.baidu.com/doc/23)。百度认证协议需要 APP ID，因此无法仅凭一个 Key 完成配置；内置 `MD5(appid + q + salt + key)` UTF-8 签名及约一秒一次的串行请求调度。
- [OpenAI Responses 官方接口](https://developers.openai.com/api/reference/resources/responses/methods/create) 与 [文本生成指南](https://developers.openai.com/api/docs/guides/text)。Responses 使用 `instructions` 与 `input`，最终文本来自 `output` 中的 assistant 消息，推理和工具输出不作为译文。
- [Chrome activeTab 权限](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)。仅在用户打开菜单并执行翻译后注入网页。

本地 AI 示例：`http://localhost:11434/v1` 或 `http://127.0.0.1:1234/v1`。请使用本地服务实际支持的聊天模型 ID。自定义地址需 HTTPS；仅 localhost / 127.0.0.1 允许 HTTP。

### Responses 兼容服务

在「自定义供应商」或已有 AI 连接的编辑器中，将接口类型选择为 **AI · Responses 兼容**，填写上游支持的模型 ID、密钥和地址。例如：

- 基础地址：`https://api.openai.com/v1`，自动请求 `POST /v1/responses`。
- 完整接口地址：`https://your-service.example/v1/responses`，直接调用该接口。
- 从同一基础地址的 `GET /models` 获取模型列表；上游不支持时手动输入模型。

切换协议时会归一化基础地址、`/chat/completions` 或 `/responses` 后缀，避免重复拼接。供应商必须实际支持所选协议。

若 Chat Completions 返回 HTTP 409 且错误码明确为 `mint_host_gate_unavailable`，扩展会尝试同源 Responses，成功后记忆 5 分钟并提示。其他 409 不自动切换协议；仅明确可重试的暂时冲突按退避策略重试。

Responses 默认非流式请求（`stream:false`），携带 `store:false`，不复用远端对话 ID。支持标准 `output[].content[].output_text` 及仅提供顶层 `output_text` 的兼容网关，跳过 reasoning、工具结果与 commentary；拒绝、不完整或截断响应不会写入网页。`store:false` 是发送给上游的请求参数，实际数据留存由供应商执行。Responses 与 Chat Completions 共用上下文、精度增强、纯译文复核、纠正重试、取消、缓存和配置导入导出。

### 自定义请求参数

在「设置 → 阅读与精度 → 请求节奏与超时」中填写并保存，下次翻译、获取模型或测试连接时生效。

| 设置 | 建议 / 默认值 | 可填写范围 |
| --- | --- | --- |
| 并发请求数 | 5；供应商限流时降至 1–2 | 1–20 |
| 每批最多文本段数 | 16；长文本可设为 8–16 | 1–64 |
| 单次请求超时 | 120 秒；慢模型可设为 180–300 秒 | 10–600 秒 |
| 请求发起间隔 | 350 毫秒 | 0–10000 毫秒 |

这些建议是开始调试的数值，实际吞吐取决于模型速度和供应商配额。可以点击「填入建议值」恢复以上默认值，再点击「保存阅读偏好」。例如 5 并发、每批 16 段，最多同时执行 5 个批次；正文总长度超过约 7000 字符时会进一步拆批。所有页面共用网络并发上限，队列按发起间隔调度，已有请求可以同时等待响应。百度仍逐段串行限速。

超时按每次实际网络请求计时，不包含排队等待；纠正、复核或重试的请求分别计时。停止或恢复原文会取消本页在途和排队请求，晚到的并行结果不会写回页面。为使慢请求在 Chrome MV3 后台中完成，仅在未完成的网络操作期间定期调用轻量扩展 API，全部结束后清理定时器，依据 [Chrome 长任务生命周期说明](https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers#keep-the-service-worker-alive)。

### 内容与布局保护

- 使用 `TreeWalker(SHOW_TEXT)` 读取可见文字，HTML 注释、标签、属性、脚本、样式不会作为文本发送。
- 跳过 `pre`、`code`、`kbd`、`samp`、Prism / highlight.js、Monaco、CodeMirror 等常见代码区域。
- 跳过输入框、文本域、下拉框、可编辑区域、`translate="no"`、`.notranslate`、隐藏元素。
- AI 返回段落 ID 与译文；校验数量、类型和编号后插入，避免返回顺序变化造成错位。译文仅以文本写入，不执行上游返回的 HTML。
- 全页与悬停模式修改原文本节点，保留链接与事件监听。对照模式按文本块和 Flex/Grid 子项聚合，防止把译文插成额外布局子项；短正文空间足够时在右侧显示，长正文换行显示。
- 按钮、导航、徽标等紧凑标签优先保持原有尺寸，在标签空间内显示双行或右侧译文。空间不足时省略溢出的译文，悬停该译文可通过 title 查看全文；此处对照模式的全文提示与悬停翻译模式不同。
- 原文与译文经 Unicode NFKC 规范化、空白折叠后相同，则对照模式不插入译文。
- 仓库元信息等相邻标签分别翻译；普通 HTML 的缩进、换行在译文中按网页规则折叠，避免合并成有大量留白的高块。原本采用 `pre-wrap` / `pre-line` 的可见正文仍保留换行。
- 译文及文本包装使用专用元素，并重置页面 CSS 对其尺寸、边距、填充等影响；窄标签使用紧凑布局，空间充足时在右侧显示。
- 支持开放 Shadow DOM 和同源 iframe。跨域 iframe、封闭 Shadow DOM、图片文字、Canvas 文字不在当前支持范围内。
- `chrome://` 页面、Chrome 网上应用店、Chrome 内置 PDF 阅读器受浏览器权限限制，无法翻译。
- 复杂固定高度容器、虚拟列表和反复重绘的应用可能限制对照译文空间；可切换到全页或悬停模式。

### 翻译智能体：只交付原文对应的译文

固定规则将 AI 限定为翻译智能体，不执行网页中的指令、不回答原文中的问题，也不扩写短文本。例如原文 `hello world`，目标简体中文只交付 `你好世界`，不会交付「这两个单词的意思是……」或编程背景知识。原文自身包含的解释、第一人称、提问与标签仍正常翻译。

每批 AI 翻译正常情况下只执行一次请求，多个网页元素以编号合并发送，要求返回 `{"translations":[{"id":"原编号","text":"直接译文"}]}`。Chat Completions 使用 `response_format`，Responses 使用 `text.format` 请求严格 JSON Schema；不支持时降级为 JSON 模式或提示词约束，始终保留本地校验。成功使用的格式兼容能力在内存中短暂记忆，避免每批反复试错。

格式、段落数量与编号、额外字段、明显独白标记及过度扩写会被本地检查拦截。异常输出最多纠正重试一次，仍不合格则保留原文并提示失败。开启「译文自检」后再请求一次携带原文和候选译文的独立复核，每阶段最多纠正一次。模型的推理字段不会写入网页。协议兼容、格式降级、临时错误重试可能增加网络请求；缓存只保存最终通过检查的译文。本地规则不能证明任意模型的每句译文都准确或完全无扩写。
