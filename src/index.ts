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
 * 目标地址解析结果结构
 */
interface ParsedTarget {
  formattedHost: string;
  port?: string;
}

/**
 * 解析目标地址字符串，分离出主机（Host）与可选端口（Port）
 *
 * @param target 目标 IP/域名，可能包含端口，如 123.xyz:443、1.1.1.1、[2606::1]:8443
 * @returns 包含格式化主机名与可选端口的对象
 */
function parseTarget(target: string): ParsedTarget {
  const trimmed = target.trim();
  let host = trimmed;
  let port: string | undefined = undefined;

  if (trimmed.startsWith('[')) {
    const closingIndex = trimmed.indexOf(']');
    if (closingIndex !== -1) {
      const rawHost = trimmed.substring(1, closingIndex);
      host = `[${rawHost}]`;
      const afterBracket = trimmed.substring(closingIndex + 1);
      if (afterBracket.startsWith(':')) {
        const candidatePort = afterBracket.substring(1);
        if (/^\d+$/.test(candidatePort)) {
          const portNum = Number(candidatePort);
          if (portNum >= 1 && portNum <= 65535) {
            port = candidatePort;
          }
        }
      }
    }
  } else {
    // 统计冒号数量：若有且仅有 1 个冒号，说明为 host:port
    // 若有多个冒号且未被中括号包围，说明为裸 IPv6 地址
    const colons = (trimmed.match(/:/g) || []).length;
    if (colons === 1) {
      const colonIndex = trimmed.indexOf(':');
      host = trimmed.substring(0, colonIndex);
      const candidatePort = trimmed.substring(colonIndex + 1);
      if (/^\d+$/.test(candidatePort)) {
        const portNum = Number(candidatePort);
        if (portNum >= 1 && portNum <= 65535) {
          port = candidatePort;
        }
      }
    } else if (colons > 1) {
      // 裸 IPv6 统一加上中括号
      host = `[${trimmed}]`;
    }
  }

  return { formattedHost: host, port };
}

/**
 * 针对单个 VLESS 节点链接，覆写其目标地址、ALPN 配置并更新备注信息
 *
 * @param line 原始 VLESS 节点链接 (如 vless://uuid@host:port?query#remark)
 * @param target 优选的目标 IP 或域名 (可包含端口，如 123.xyz:443)
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

  const { formattedHost, port: targetPort } = parseTarget(target);

  const qIndex = beforeHash.indexOf('?');
  const originalPortPart = qIndex !== -1 ? beforeHash.substring(0, qIndex) : beforeHash;
  const queryPart = qIndex !== -1 ? beforeHash.substring(qIndex + 1) : '';

  // 若 target 中包含端口，则覆写端口；否则保留原节点端口
  const effectivePortPart = targetPort ? `:${targetPort}` : originalPortPart;

  let newBeforeHash: string;
  if (overrideAlpn) {
    const searchParams = new URLSearchParams(queryPart);
    searchParams.set('alpn', overrideAlpn);
    newBeforeHash = `${effectivePortPart}?${searchParams.toString()}`;
  } else {
    newBeforeHash = queryPart ? `${effectivePortPart}?${queryPart}` : effectivePortPart;
  }

  // 更新节点备注后缀以区分优选 IP / 地址
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

  return `${prefix}${formattedHost}${newRest}`;
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
