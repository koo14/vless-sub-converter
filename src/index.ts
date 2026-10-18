import htmlTemplate from "./index.html";

export interface Env { }

// 定义订阅配置结构
interface SubConfig {
  subUrl: string;
  ip: string;
  alpn?: string;
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // 1. 根路径 `/` 渲染前端配置页面
    if (url.pathname === "/") {
      return new Response(htmlTemplate, {
        headers: { "Content-Type": "text/html;charset=UTF-8" },
      });
    }

    // 2. 匹配 `/sub` 路径，直接从 URL 查询参数读取
    if (url.pathname === "/sub" || url.pathname === "/sub/") {
      const subUrl = url.searchParams.get("url");
      const targets = url.searchParams.get("ips"); // 接收 IP 或域名列表
      const alpn = url.searchParams.get("alpn")?.trim() || undefined; // ALPN 覆写参数

      try {
        if (!subUrl || !targets) {
          return new Response("缺少 url 或 ips 参数", { status: 400 });
        }

        // 获取并转换订阅内容
        const modifiedSub = await processSubscription(subUrl, targets, alpn);

        return new Response(modifiedSub, {
          headers: {
            "Content-Type": "text/plain;charset=UTF-8",
            "Cache-Control": "no-store, no-cache, must-revalidate", // 禁用缓存以保持节点更新
            "Access-Control-Allow-Origin": "*",
          },
        });
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : "未知错误";
        return new Response(`订阅解析失败或远端拉取错误: ${errorMessage}`, { status: 400 });
      }
    }

    return new Response("Not Found", { status: 404 });
  },
};

export default worker;

// 兼容 Cloudflare Pages Functions 的入口
export async function onRequest(context: { request: Request; env: Env } & ExecutionContext): Promise<Response> {
  return await worker.fetch(context.request, context.env, context);
}

/**
 * 获取并处理远端订阅链接
 *
 * @param url 原始订阅地址
 * @param targetList 逗号分隔的目标 IP 或域名列表
 * @param overrideAlpn 可选的 ALPN 覆写值 (如 "h3" 或 "h3,h2")
 * @returns 转换后的订阅内容字符串
 */
async function processSubscription(url: string, targetList: string, overrideAlpn?: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) VLESS-Converter",
    }
  });

  if (!response.ok) {
    throw new Error(`无法获取原始订阅，状态码: ${response.status}`);
  }

  let text = await response.text();
  let isBase64 = false;

  // 判断是否为 Base64 编码的订阅
  if (!text.includes("://")) {
    try {
      text = decodeBase64UTF8(text.trim());
      isBase64 = true;
    } catch {
      // 解析失败忽略，按明文处理
    }
  }

  // 将传入的逗号分隔的字符串转换为数组，清理空格并过滤空值
  const targets = targetList.split(',').map(t => t.trim()).filter(Boolean);
  if (targets.length === 0) {
    throw new Error("没有提供有效的目标 IP 或域名");
  }

  // 清洗 ALPN 覆写参数，去除多余空格
  const sanitizedAlpn = overrideAlpn
    ? overrideAlpn.split(',').map(s => s.trim()).filter(Boolean).join(',')
    : undefined;

  // 按行分割并处理每一个节点
  const lines = text.split('\n');
  const newLines = lines.flatMap(line => {
    line = line.trim();
    if (!line) return []; // 过滤掉空行

    if (line.startsWith('vless://')) {
      return targets.map(target => modifyVlessNode(line, target, sanitizedAlpn));
    }
    return [line];
  });

  let result = newLines.join('\n');

  // 如果原始订阅是 Base64，处理完后重新进行 Base64 编码返回
  if (isBase64) {
    result = encodeBase64UTF8(result);
  }

  return result;
}

/**
 * 针对单个 VLESS 节点链接，覆写其目标地址、ALPN 配置并更新备注信息
 *
 * @param line 原始 VLESS 节点链接 (如 vless://uuid@host:port?query#remark)
 * @param target 优选的目标 IP 或域名
 * @param overrideAlpn 可选的已清洗 ALPN 覆写值 (如 "h3" 或 "h3,h2")
 * @returns 覆写修改后的 VLESS 节点链接，若格式不匹配则返回原链接
 */
function modifyVlessNode(line: string, target: string, overrideAlpn?: string): string {
  // 匹配 VLESS 协议: vless://[uuid]@[host]:[port][...]
  const match = line.match(/^(vless:\/\/[^@]+@)(.+?)(:\d+.*)$/i);
  if (!match) {
    return line;
  }

  const prefix = match[1];
  const rest = match[3];

  const hashIndex = rest.indexOf('#');
  const beforeHash = hashIndex !== -1 ? rest.substring(0, hashIndex) : rest;
  let newBeforeHash = beforeHash;

  // 若提供了 ALPN 覆写参数，更新或插入 query 中的 alpn 字段
  if (overrideAlpn) {
    const qIndex = beforeHash.indexOf('?');
    const portPart = qIndex !== -1 ? beforeHash.substring(0, qIndex) : beforeHash;
    const queryPart = qIndex !== -1 ? beforeHash.substring(qIndex + 1) : '';
    const searchParams = new URLSearchParams(queryPart);
    searchParams.set('alpn', overrideAlpn);
    newBeforeHash = `${portPart}?${searchParams.toString()}`;
  }

  // 格式化 IPv6 目标地址 (添加中括号)
  const isIPv6 = target.includes(':') && !target.startsWith('[');
  const formattedTarget = isIPv6 ? `[${target}]` : target;

  // 更新节点备注后缀以区分优选 IP
  let newRest: string;
  if (hashIndex !== -1) {
    try {
      const originalRemark = decodeURIComponent(rest.substring(hashIndex + 1));
      newRest = `${newBeforeHash}#${encodeURIComponent(`${originalRemark} - ${target}`)}`;
    } catch {
      // 容错处理：若原始备注 URL 解码失败，直接在原字符串后追加
      newRest = `${newBeforeHash}${rest.substring(hashIndex)}${encodeURIComponent(` - ${target}`)}`;
    }
  } else {
    newRest = `${newBeforeHash}#${encodeURIComponent(target)}`;
  }

  return `${prefix}${formattedTarget}${newRest}`;
}

// 高性能且类型安全的 UTF-8 Base64 解码
function decodeBase64UTF8(str: string): string {
  const binaryStr = atob(str);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

// 高性能且类型安全的 UTF-8 Base64 编码
function encodeBase64UTF8(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
