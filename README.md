# VLESS 优选 IP 订阅转换器 (VLESS Sub IP Converter)

这是一个基于 Cloudflare Workers 的无状态 VLESS 订阅转换工具。它允许你将原始 VLESS 订阅节点中的域名或 IP 替换为你优选的 IP（支持多个 IP），并生成全新的二次订阅链接。

## ✨ 特性

* **☁️ 纯边缘计算**: 部署在 Cloudflare Workers 节点上，速度快、零服务器维护。
* **🚫 无状态架构**: 所有参数均直接在 URL（查询参数）中携带和解析，不依赖 KV 或任何数据库，保证原始订阅链接的隐私安全。
* **🎯 多 IP / 端口优选**: 支持同时填入多个目标 IP 或域名，并支持自定义端口（如 `123.xyz:443` 或 `1.1.1.1:8443`）。若目标条目中包含端口，程序会自动覆写节点的连接端口；未指定端口时则保留节点原端口。同时在节点名称（备注）后缀加上对应目标标识方便在客户端中区分。
* **⚡ ALPN 覆写**: 支持自定义覆写节点的 ALPN 协商协议（例如 `h3`、`h2`、`h3,h2` 等），解决不同客户端（如 v2rayN、Sing-box、Clash Meta）在 HTTP/3 或多协议配置时的协商兼容问题。
* **📱 客户端 UA 识别与 Shadowrocket 适配**: 优先透传客户端 `User-Agent` 拉取上游订阅，并自动识别 `Shadowrocket`、`v2rayN`、`v2rayNG`、`Happ`、`Clash`/`Mihomo`、`sing-box`、`Stash`、`Surge`、`Loon`、`Quantumult X`、`V2Box`、`Streisand`、`Karing` 等客户端；针对 Shadowrocket 自动转换为原生 `obfs=xhttp&obfsParam=...` 格式以完整保留 XHTTP 与 XMUX 参数（如 `maxConcurrency`、`hMaxReusableSecs`、`hKeepAlivePeriod` 等），亦可在前端面板手动指定输出格式。

## 🚀 部署指引

本项目使用 TypeScript + Cloudflare Wrangler 构建。

### 1. 环境准备
确保你的电脑已经安装了 [Node.js](https://nodejs.org/) 以及 npm。

### 2. 安装依赖
```bash
npm install
```

### 3. 本地开发与测试
```bash
npm run dev
```

### 4. 部署到 Cloudflare
运行部署命令，并根据提示登录你的 Cloudflare 账号：
```bash
npm run deploy
```

## 🛠️ 使用方法

1. 访问你部署成功后获得的 Worker 域名首页。
2. 在“原始 VLESS 订阅链接”框中填入你的原订阅地址（如：`https://.../subs/xxx`）。
3. 在“目标 IP 列表”框中填入你测试好的优选 IP（如果有多个，请使用逗号 `,` 隔开，如：`1.1.1.1, 2.2.2.2`）。
4. （可选）在“ALPN 覆写”框中填入需要指定的 ALPN 协议（如 `h3`），或点击预设按钮快速选择；留空则保持节点原配置。
5. （可选）在“客户端输出格式”中选择自动识别（默认根据 UA 识别）或强制指定 `Shadowrocket` / `标准 VLESS 格式`。
6. 页面自动生成新的二次订阅链接，可通过点击“复制”或扫描二维码在 V2Ray、v2rayN、Shadowrocket、Sing-box 等客户端中添加订阅。

### API 参数说明

`/sub` 接口支持以下 URL 查询参数：

| 参数 | 必填 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| `url` | 是 | 原始订阅链接（需 URL 编码） | `https%3A%2F%2Fexample.com%2Fsub` |
| `ips` | 是 | 优选目标 IP 或域名（可附带端口，逗号分隔） | `1.1.1.1,123.xyz:443` |
| `alpn` | 否 | 覆写节点中的 ALPN 参数 | `h3` 或 `h3,h2` |
| `client` | 否 | 指定输出格式：`auto`（默认按 UA 识别）、`shadowrocket`、`standard` | `shadowrocket` |