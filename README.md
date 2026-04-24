# VLESS 优选 IP 订阅转换器 (VLESS Sub IP Converter)

这是一个基于 Cloudflare Workers 的无状态 VLESS 订阅转换工具。它允许你将原始 VLESS 订阅节点中的域名或 IP 替换为你优选的 IP（支持多个 IP），并生成全新的二次订阅链接。

## ✨ 特性

* **☁️ 纯边缘计算**: 部署在 Cloudflare Workers 节点上，速度快、零服务器维护。
* **🚫 无状态架构**: 所有参数均直接在 URL（查询参数）中携带和解析，不依赖 KV 或任何数据库，保证原始订阅链接的隐私安全。
* **🎯 多 IP 优选**: 支持同时填入多个目标 IP。程序会自动遍历原始订阅节点，并为每一个优选 IP 生成对应的专属节点配置，同时在节点名称（备注）后缀加上对应 IP 标识方便在客户端中区分。

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
4. 点击“生成新订阅链接”，页面将为你提供包含所有组合节点的统一链接，以及各个 IP 专属的单独订阅链接。
5. 复制所需的短链接并在 V2Ray、v2rayN 等支持 VLESS 协议的客户端中添加或更新订阅即可。