# Agent Note: WebKit history replay and durable Web authentication

Status: implemented

English | [中文](2026-09-06-webkit-history-replay.md)

## Problem

使用 WebKit 的客户端可以加载 DSH 会话列表，却在回放 assistant-stream 历史时失败；相同会话在 Chromium 客户端中正常显示。手机端还需要一个在托管 Web 进程重启后仍有效的启动链接。

## Decision

`@deepseek-ai/dsh-util-values` 中的无损 JSON 校验器及 `@deepseek-ai/dsh-tools` 中的镜像实现，会先折叠 `Function#toString()` 返回的 native 构造函数字符串中的空白，再识别内建的 Array 和 Object 原型。这样保留了跨 realm 安全检查，同时接受 JavaScriptCore 的多行 native 函数格式。`client-connection/browser-session` grant 将启动 token 与签名密钥一起持久化，因此 Web 进程重启后复用同一 token；交换得到的 HttpOnly 会话 Cookie 仍绑定 authority。

## Alternatives considered

**信任所有构造函数名类似 Object 的对象。** 放弃，因为校验器会失去对伪造或特殊原型的防护。

**在 WebKit 上禁用 assistant-stream 回放。** 放弃，因为这会隐藏持久会话数据，并让不同浏览器的行为不一致。

**每次进程重启都生成新的启动 token。** 放弃，因为托管重启会让远程设备失效，并要求再次通过带外方式登录。

## Consequences

Safari 和 iPhone Chrome 在刷新缓存的插件 bundle 后，可以像 Chromium 一样回放同一份持久会话记录。启动 token 现在是本地凭据存储中的持久 bearer credential，因此不得写入文档或分享；按 authority 绑定的 Cookie 与现有 WAF 门禁仍是独立控制。JSON-schema 校验器保留一份重复的 native 构造函数判断，因为该包拥有自己的实现。

## Testing

browser-auth 与 JSON-schema 测试共 30 项全部通过。Host/client 库和 Web 前端均构建成功；公网链路验证结果为无 Cookie 403、登录 200、仅 WAF Cookie 401、已认证根路径 200、已认证 API probe 404。Mac Safari 与 iPhone Safari/Chrome 在强制刷新后均能显示历史消息。
