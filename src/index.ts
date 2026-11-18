import htmlTemplate from "./index.html";

export interface Env { }

const DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) VLESS-Converter";

/**
 * 支持的客户端输出格式参数
 */
type ClientOutputFormat = "auto" | "shadowrocket" | "standard";

/**
 * 解析后实际使用的输出格式
 */
type ResolvedOutputFormat = "shadowrocket" | "standard";

/**
 * 客户端 UA 识别结果
 */
interface ClientDetectionResult {
  clientName: string;
  format: ResolvedOutputFormat;
}

/**
 * 订阅处理选项
 */
interface ProcessOptions {
  overrideAlpn?: string;
  upstreamUserAgent?: string;
  outputFormat: ResolvedOutputFormat;
}

// 定义订阅配置结构
interface SubConfig {
  subUrl: string;
  ip: string;
  alpn?: string;
  client?: ClientOutputFormat;
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
      const clientParam = url.searchParams.get("client")?.trim() || null; // 可选客户端输出格式覆写
      const incomingUa = request.headers.get("User-Agent")?.trim() || undefined;

      try {
        if (!subUrl || !targets) {
          return new Response("缺少 url 或 ips 参数", { status: 400 });
        }

        const resolvedClient = resolveOutputFormat(clientParam, incomingUa);

        // 优先透传客户端真实 UA 请求上游订阅，再按指定或识别出的客户端格式输出
        const modifiedSub = await processSubscription(subUrl, targets, {
          overrideAlpn: alpn,
          upstreamUserAgent: incomingUa,
          outputFormat: resolvedClient.format,
        });

        return new Response(modifiedSub, {
          headers: {
            "Content-Type": "text/plain;charset=UTF-8",
            "Cache-Control": "no-store, no-cache, must-revalidate", // 禁用缓存以保持节点更新
            "Access-Control-Allow-Origin": "*",
            "X-Detected-Client": resolvedClient.clientName,
            "X-Output-Format": resolvedClient.format,
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
 * 根据请求头 User-Agent 识别代理客户端类型及推荐输出格式
 *
 * @param userAgent 客户端携带的 User-Agent 字符串
 * @returns 识别到的客户端名称与实际输出格式
 */
function detectClientFromUserAgent(userAgent?: string): ClientDetectionResult {
  if (!userAgent) {
    return { clientName: "Unknown", format: "standard" };
  }

  const ua = userAgent.toLowerCase();

  if (ua.includes("shadowrocket")) {
    return { clientName: "Shadowrocket", format: "shadowrocket" };
  }
  if (ua.includes("quantumult%20x") || ua.includes("quantumult x")) {
    return { clientName: "Quantumult X", format: "standard" };
  }
  if (ua.includes("surge")) {
    return { clientName: "Surge", format: "standard" };
  }
  if (ua.includes("loon") || ua.includes("decar")) {
    return { clientName: "Loon", format: "standard" };
  }
  if (ua.includes("stash")) {
    return { clientName: "Stash", format: "standard" };
  }
  if (ua.includes("egern")) {
    return { clientName: "Egern", format: "standard" };
  }
  if (ua.includes("surfboard")) {
    return { clientName: "Surfboard", format: "standard" };
  }
  if (ua.includes("happ")) {
    return { clientName: "Happ", format: "standard" };
  }
  if (ua.includes("v2rayn")) {
    return { clientName: "v2rayN", format: "standard" };
  }
  if (ua.includes("v2rayng")) {
    return { clientName: "v2rayNG", format: "standard" };
  }
  if (ua.includes("v2box")) {
    return { clientName: "V2Box", format: "standard" };
  }
  if (ua.includes("streisand")) {
    return { clientName: "Streisand", format: "standard" };
  }
  if (ua.includes("foxray")) {
    return { clientName: "FoXray", format: "standard" };
  }
  if (ua.includes("karing")) {
    return { clientName: "Karing", format: "standard" };
  }
  if (ua.includes("hiddify")) {
    return { clientName: "Hiddify", format: "standard" };
  }
  if (ua.includes("nekobox") || ua.includes("nekoray")) {
    return { clientName: "NekoBox", format: "standard" };
  }
  if (ua.includes("sing-box") || ua.includes("singbox") || /\bsf[iam]\b/.test(ua)) {
    return { clientName: "sing-box", format: "standard" };
  }
  if (ua === "meta" || ua.includes("mihomo") || ua.includes("clash-verge") || ua.includes("flclash") || ua.includes("clash.meta")) {
    return { clientName: "ClashMeta", format: "standard" };
  }
  if (ua.includes("clash")) {
    return { clientName: "Clash", format: "standard" };
  }
  if (ua.includes("v2ray") || ua.includes("xray")) {
    return { clientName: "V2Ray", format: "standard" };
  }

  return { clientName: "Generic", format: "standard" };
}

/**
 * 解析最终使用的客户端输出格式（显式参数优先，未指定或 auto 时回退到 UA 自动识别）
 *
 * @param clientParam URL 查询参数 `client`
 * @param userAgent 请求头 `User-Agent`
 * @returns 解析后的客户端名称与输出格式
 */
function resolveOutputFormat(clientParam: string | null, userAgent?: string): ClientDetectionResult {
  const detected = detectClientFromUserAgent(userAgent);
  const normalized = clientParam?.toLowerCase();

  if (normalized === "shadowrocket" || normalized === "sr") {
    return { clientName: detected.clientName === "Unknown" ? "Shadowrocket(Manual)" : detected.clientName, format: "shadowrocket" };
  }
  if (normalized === "standard" || normalized === "v2ray" || normalized === "xray") {
    return { clientName: detected.clientName === "Unknown" ? "Standard(Manual)" : detected.clientName, format: "standard" };
  }

  return detected;
}

/**
 * 获取并处理远端订阅链接
 *
 * @param url 原始订阅地址
 * @param targetList 逗号分隔的目标 IP 或域名列表
 * @param options 订阅转换处理选项 (ALPN 覆写、透传 UA、输出格式)
 * @returns 转换后的订阅内容字符串
 */
async function processSubscription(url: string, targetList: string, options: ProcessOptions): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": options.upstreamUserAgent || DEFAULT_USER_AGENT,
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
  const sanitizedAlpn = options.overrideAlpn
    ? options.overrideAlpn.split(',').map(s => s.trim()).filter(Boolean).join(',')
    : undefined;

  // 按行分割并处理每一个节点
  const lines = text.split('\n');
  const newLines = lines.flatMap(line => {
    line = line.trim();
    if (!line) return []; // 过滤掉空行

    if (line.toLowerCase().startsWith('vless://')) {
      return targets.map(target => modifyVlessNode(line, target, options.outputFormat, sanitizedAlpn));
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
 * 判断未知值是否为普通键值对对象
 *
 * @param value 待检查的值
 * @returns 若为非数组、非 null 的对象则返回 true
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 将 URLSearchParams 序列化为标准 URI 查询字符串（空格使用 %20 编码而非 +，避免客户端解析备注等字段时出现加号）
 *
 * @param params URLSearchParams 实例
 * @returns 序列化后的查询字符串
 */
function serializeQueryParams(params: URLSearchParams): string {
  return params.toString().replace(/\+/g, "%20");
}

/**
 * 容错的 URI 组件解码
 *
 * @param value 待解码字符串
 * @returns 解码后的字符串，解码失败时返回原字符串
 */
function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * 构建 XHTTP 在 Shadowrocket 中的 obfsParam JSON 字符串
 *
 * @param searchParams 标准 VLESS URL 查询参数
 * @returns 序列化后的 obfsParam 字符串，若无可用字段则返回 undefined
 */
function buildShadowrocketXhttpObfsParam(searchParams: URLSearchParams): string | undefined {
  const obfsParamObj: Record<string, unknown> = {};
  const extraInner: Record<string, unknown> = {};

  const rawExtra = searchParams.get("extra");
  let extraHeaders: Record<string, unknown> | undefined;

  if (rawExtra) {
    try {
      const parsed: unknown = JSON.parse(rawExtra);
      if (isRecord(parsed)) {
        for (const [key, value] of Object.entries(parsed)) {
          if (key === "mode") {
            // mode 已作为 Shadowrocket 顶层参数输出
            continue;
          }
          if (key === "xmux" && isRecord(value)) {
            // Shadowrocket 将 xmux 参数直接展平在 obfsParam[""] 对象内
            for (const [xmuxKey, xmuxVal] of Object.entries(value)) {
              extraInner[xmuxKey] = xmuxVal;
            }
            continue;
          }
          if (key === "headers" && isRecord(value)) {
            extraHeaders = value;
            continue;
          }
          extraInner[key] = value;
        }
      }
    } catch {
      // extra 非合法 JSON 时忽略解析，防止阻塞其余字段转换
    }
  }

  // 若顶层存在 x_padding_bytes 且 extra 中未设置 xPaddingBytes，则补充写入
  const topPadding = searchParams.get("x_padding_bytes");
  if (topPadding && extraInner.xPaddingBytes === undefined) {
    extraInner.xPaddingBytes = topPadding;
  }

  if (Object.keys(extraInner).length > 0) {
    obfsParamObj[""] = extraInner;
  }

  const topHost = searchParams.get("host");
  const headerHost = extraHeaders ? (extraHeaders.Host ?? extraHeaders.host) : undefined;
  const effectiveHost = topHost || (typeof headerHost === "string" ? headerHost : undefined);

  if (effectiveHost) {
    obfsParamObj.Host = effectiveHost;
  }

  if (extraHeaders) {
    for (const [headerKey, headerVal] of Object.entries(extraHeaders)) {
      if (headerKey.toLowerCase() !== "host") {
        obfsParamObj[headerKey] = headerVal;
      }
    }
  }

  if (Object.keys(obfsParamObj).length === 0) {
    return undefined;
  }

  return JSON.stringify(obfsParamObj);
}

/**
 * 针对单个 VLESS 节点链接，按目标格式覆写主机、端口、ALPN 与备注信息
 *
 * @param line 原始 VLESS 节点链接 (支持标准格式与 Shadowrocket Base64 格式)
 * @param target 优选的目标 IP 或域名 (可包含端口，如 123.xyz:443)
 * @param outputFormat 目标输出格式 ("standard" | "shadowrocket")
 * @param overrideAlpn 可选的已清洗 ALPN 覆写值 (如 "h3" 或 "h3,h2")
 * @returns 覆写并转换后的 VLESS 节点链接，若格式不匹配则返回原链接
 */
function modifyVlessNode(
  line: string,
  target: string,
  outputFormat: ResolvedOutputFormat,
  overrideAlpn?: string,
): string {
  // 1. 尝试按标准 VLESS 格式匹配: vless://[uuid]@[host]:[port][tail]
  const stdMatch = line.match(/^vless:\/\/([^@]+)@(\[[^\]]+\]|[^:/?#]+):(\d+)(.*)$/i);
  if (stdMatch) {
    const rawUser = stdMatch[1];
    const origPort = stdMatch[3];
    const tail = stdMatch[4];

    if (outputFormat === "shadowrocket") {
      return convertStandardVlessToShadowrocket(safeDecodeURIComponent(rawUser), origPort, tail, target, overrideAlpn);
    }
    return modifyStandardVlessNode(`vless://${rawUser}@`, `:${origPort}${tail}`, target, overrideAlpn);
  }

  // 2. 尝试按 Shadowrocket Base64 格式匹配: vless://[base64][?query][#hash]
  const srMatch = line.match(/^vless:\/\/([^/?#]+)(\?[^#]*)?(#.*)?$/i);
  if (srMatch && !srMatch[1].includes("@")) {
    try {
      const decodedAuthority = decodeBase64UTF8(srMatch[1]);
      const authMatch = decodedAuthority.match(/^([^:@]*):([^@]+)@(\[[^\]]+\]|[^:]+):(\d+)$/);
      if (authMatch) {
        const encPrefix = authMatch[1];
        const uuid = authMatch[2];
        const origPort = authMatch[4];
        const queryPart = srMatch[2] || "";
        const hashPart = srMatch[3] || "";

        if (outputFormat === "shadowrocket") {
          return modifyShadowrocketVlessNode(encPrefix, uuid, origPort, queryPart, hashPart, target, overrideAlpn);
        }
        return convertShadowrocketVlessToStandard(uuid, origPort, queryPart, hashPart, target, overrideAlpn);
      }
    } catch {
      // Base64 解码失败时原样返回
    }
  }

  return line;
}

/**
 * 标准 VLESS 节点覆写（保持原查询参数顺序与编码，零侵入改动）
 *
 * @param prefix 协议与用户信息前缀 (如 "vless://uuid@")
 * @param rest 端口及其后的完整后缀 (如 ":2053?query#remark")
 * @param target 优选目标地址
 * @param overrideAlpn 可选 ALPN 覆写值
 * @returns 修改后的标准 VLESS 链接
 */
function modifyStandardVlessNode(prefix: string, rest: string, target: string, overrideAlpn?: string): string {
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
    newBeforeHash = `${effectivePortPart}?${serializeQueryParams(searchParams)}`;
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

/**
 * 将标准 VLESS 链接转换为 Shadowrocket 原生 Base64 格式（适配 XHTTP / XMUX 参数）
 *
 * @param uuid 节点 UUID
 * @param origPort 原节点端口
 * @param tail 查询字符串与备注后缀 (如 "?type=xhttp...#remark")
 * @param target 优选目标地址
 * @param overrideAlpn 可选 ALPN 覆写值
 * @returns Shadowrocket 原生 VLESS 链接
 */
function convertStandardVlessToShadowrocket(
  uuid: string,
  origPort: string,
  tail: string,
  target: string,
  overrideAlpn?: string,
): string {
  const hashIndex = tail.indexOf("#");
  const beforeHash = hashIndex !== -1 ? tail.substring(0, hashIndex) : tail;
  const rawRemark = hashIndex !== -1 ? safeDecodeURIComponent(tail.substring(hashIndex + 1)) : "";
  const queryString = beforeHash.startsWith("?") ? beforeHash.substring(1) : "";
  const searchParams = new URLSearchParams(queryString);

  const { formattedHost, port: targetPort } = parseTarget(target);
  const effectivePort = targetPort || origPort;

  const encryption = searchParams.get("encryption");
  const encPrefix = !encryption || encryption === "none" ? "" : encryption;
  const encodedAuthority = encodeBase64UTF8(`${encPrefix}:${uuid}@${formattedHost}:${effectivePort}`);

  const outParams = new URLSearchParams();
  const remarkText = rawRemark ? `${rawRemark} - ${target}` : target;
  outParams.set("remarks", remarkText);

  const security = (searchParams.get("security") || "").toLowerCase();
  const sni = searchParams.get("sni") || searchParams.get("peer") || "";
  const pbk = searchParams.get("pbk") || "";

  if (security === "reality" || pbk) {
    outParams.set("tls", "1");
    if (sni) outParams.set("sni", sni);
    if (pbk) outParams.set("pbk", pbk);
    const sid = searchParams.get("sid");
    if (sid) outParams.set("sid", sid);
    const spx = searchParams.get("spx");
    if (spx) outParams.set("spx", spx);
  } else if (security === "tls") {
    outParams.set("tls", "1");
    if (sni) outParams.set("peer", sni);
  }

  const allowInsecure = searchParams.get("allowInsecure") || searchParams.get("insecure");
  if (allowInsecure === "1" || allowInsecure?.toLowerCase() === "true") {
    outParams.set("allowInsecure", "1");
  }

  const effectiveAlpn = overrideAlpn || searchParams.get("alpn");
  if (effectiveAlpn) {
    outParams.set("alpn", effectiveAlpn);
  }

  const fp = searchParams.get("fp") || searchParams.get("fingerprint");
  if (fp) {
    outParams.set("fingerprint", fp);
  }

  const ech = searchParams.get("ech");
  if (ech) {
    outParams.set("ech", ech);
  }

  const flow = searchParams.get("flow");
  if (flow === "xtls-rprx-vision") {
    outParams.set("xtls", "2");
  } else if (flow === "xtls-rprx-direct") {
    outParams.set("xtls", "1");
  } else if (flow) {
    outParams.set("flow", flow);
  }

  outParams.set("udp", "1");

  const netType = (searchParams.get("type") || "tcp").toLowerCase();
  const path = searchParams.get("path");
  const host = searchParams.get("host");
  const mode = searchParams.get("mode");

  switch (netType) {
    case "xhttp":
    case "splithttp": {
      outParams.set("obfs", "xhttp");
      if (path) outParams.set("path", path);
      if (mode) outParams.set("mode", mode);
      const obfsParam = buildShadowrocketXhttpObfsParam(searchParams);
      if (obfsParam) {
        outParams.set("obfsParam", obfsParam);
      }
      break;
    }
    case "ws":
    case "websocket": {
      outParams.set("obfs", "websocket");
      if (path) outParams.set("path", path);
      if (host) outParams.set("obfsParam", host);
      break;
    }
    case "grpc": {
      outParams.set("obfs", "grpc");
      const serviceName = searchParams.get("serviceName") || path;
      if (serviceName) outParams.set("path", serviceName);
      if (host || sni) outParams.set("host", host || sni);
      break;
    }
    case "h2":
    case "http": {
      outParams.set("obfs", "h2");
      if (path) outParams.set("path", path);
      if (host) outParams.set("obfsParam", host);
      break;
    }
    case "httpupgrade": {
      outParams.set("obfs", "httpupgrade");
      if (path) outParams.set("path", path);
      if (host) outParams.set("obfsParam", host);
      break;
    }
    case "kcp": {
      outParams.set("obfs", "kcp");
      const seed = searchParams.get("seed") || path;
      if (seed) outParams.set("path", seed);
      const headerType = searchParams.get("headerType");
      if (headerType) outParams.set("type", headerType);
      break;
    }
    default: {
      const headerType = searchParams.get("headerType");
      if (headerType === "http") {
        outParams.set("obfs", "http");
        if (path) outParams.set("path", path);
        if (host) outParams.set("obfsParam", host);
      }
      break;
    }
  }

  return `vless://${encodedAuthority}?${serializeQueryParams(outParams)}`;
}

/**
 * 覆写已为 Shadowrocket 原生格式的 VLESS 链接（支持上游直接返回 Shadowrocket 格式的场景）
 *
 * @param encPrefix 原加密前缀 (如 "" 或 "auto")
 * @param uuid 节点 UUID
 * @param origPort 原节点端口
 * @param queryPart 查询部分 (包含前导 "?")
 * @param hashPart 备注部分 (包含前导 "#")
 * @param target 优选目标地址
 * @param overrideAlpn 可选 ALPN 覆写值
 * @returns 修改后的 Shadowrocket VLESS 链接
 */
function modifyShadowrocketVlessNode(
  encPrefix: string,
  uuid: string,
  origPort: string,
  queryPart: string,
  hashPart: string,
  target: string,
  overrideAlpn?: string,
): string {
  const { formattedHost, port: targetPort } = parseTarget(target);
  const effectivePort = targetPort || origPort;
  const encodedAuthority = encodeBase64UTF8(`${encPrefix}:${uuid}@${formattedHost}:${effectivePort}`);

  const searchParams = new URLSearchParams(queryPart.startsWith("?") ? queryPart.substring(1) : queryPart);
  if (overrideAlpn) {
    searchParams.set("alpn", overrideAlpn);
  }

  let newHash = "";
  if (searchParams.has("remarks")) {
    const oldRemark = searchParams.get("remarks") || "";
    searchParams.set("remarks", oldRemark ? `${oldRemark} - ${target}` : target);
  } else if (searchParams.has("remark")) {
    const oldRemark = searchParams.get("remark") || "";
    searchParams.set("remark", oldRemark ? `${oldRemark} - ${target}` : target);
  } else if (hashPart) {
    const oldRemark = safeDecodeURIComponent(hashPart.substring(1));
    newHash = `#${encodeURIComponent(oldRemark ? `${oldRemark} - ${target}` : target)}`;
  } else {
    searchParams.set("remarks", target);
  }

  const queryStr = serializeQueryParams(searchParams);
  return `vless://${encodedAuthority}${queryStr ? `?${queryStr}` : ""}${newHash}`;
}

/**
 * 将 Shadowrocket 原生格式还原转换为标准 VLESS 链接（当上游返回 Shadowrocket 格式而面板强制输出标准格式时使用）
 *
 * @param uuid 节点 UUID
 * @param origPort 原节点端口
 * @param queryPart 查询部分 (包含前导 "?")
 * @param hashPart 备注部分 (包含前导 "#")
 * @param target 优选目标地址
 * @param overrideAlpn 可选 ALPN 覆写值
 * @returns 标准格式 VLESS 链接
 */
function convertShadowrocketVlessToStandard(
  uuid: string,
  origPort: string,
  queryPart: string,
  hashPart: string,
  target: string,
  overrideAlpn?: string,
): string {
  const { formattedHost, port: targetPort } = parseTarget(target);
  const effectivePort = targetPort || origPort;
  const srcParams = new URLSearchParams(queryPart.startsWith("?") ? queryPart.substring(1) : queryPart);
  const outParams = new URLSearchParams();

  outParams.set("encryption", "none");

  const pbk = srcParams.get("pbk");
  const isTls = srcParams.get("tls") === "1" || srcParams.get("tls")?.toLowerCase() === "true";
  const sni = srcParams.get("sni") || srcParams.get("peer");

  if (pbk) {
    outParams.set("security", "reality");
    outParams.set("pbk", pbk);
    if (sni) outParams.set("sni", sni);
    const sid = srcParams.get("sid");
    if (sid) outParams.set("sid", sid);
    const spx = srcParams.get("spx");
    if (spx) outParams.set("spx", spx);
  } else if (isTls) {
    outParams.set("security", "tls");
    if (sni) outParams.set("sni", sni);
  }

  const effectiveAlpn = overrideAlpn || srcParams.get("alpn");
  if (effectiveAlpn) outParams.set("alpn", effectiveAlpn);

  const fp = srcParams.get("fingerprint") || srcParams.get("fp");
  if (fp) outParams.set("fp", fp);

  const ech = srcParams.get("ech");
  if (ech) outParams.set("ech", ech);

  const allowInsecure = srcParams.get("allowInsecure") || srcParams.get("insecure");
  if (allowInsecure === "1" || allowInsecure?.toLowerCase() === "true") {
    outParams.set("allowInsecure", "1");
  }

  const xtls = srcParams.get("xtls");
  if (xtls === "2") outParams.set("flow", "xtls-rprx-vision");
  else if (xtls === "1") outParams.set("flow", "xtls-rprx-direct");
  else if (srcParams.get("flow")) outParams.set("flow", srcParams.get("flow") || "");

  const obfs = (srcParams.get("obfs") || "").toLowerCase();
  const path = srcParams.get("path");
  const mode = srcParams.get("mode");
  const obfsParam = srcParams.get("obfsParam");

  if (obfs === "xhttp") {
    outParams.set("type", "xhttp");
    if (mode) outParams.set("mode", mode);
    if (path) outParams.set("path", path);
    if (obfsParam) {
      try {
        const parsed: unknown = JSON.parse(obfsParam);
        if (isRecord(parsed)) {
          if (typeof parsed.Host === "string" && parsed.Host) {
            outParams.set("host", parsed.Host);
          }
          const inner = parsed[""];
          if (isRecord(inner)) {
            const xmuxKeys = new Set([
              "maxConcurrency",
              "maxConnections",
              "cMaxReuseTimes",
              "cMaxLifetimeMs",
              "hMaxReusableSecs",
              "hKeepAlivePeriod",
              "hMaxRequestTimes",
            ]);
            const extraObj: Record<string, unknown> = {};
            const xmuxObj: Record<string, unknown> = {};
            if (mode) extraObj.mode = mode;

            for (const [k, v] of Object.entries(inner)) {
              if (xmuxKeys.has(k)) {
                xmuxObj[k] = v;
              } else {
                extraObj[k] = v;
              }
            }
            if (Object.keys(xmuxObj).length > 0) {
              extraObj.xmux = xmuxObj;
            }
            if (Object.keys(extraObj).length > 0) {
              outParams.set("extra", JSON.stringify(extraObj));
            }
          }
        } else {
          outParams.set("host", obfsParam);
        }
      } catch {
        outParams.set("host", obfsParam);
      }
    }
  } else if (obfs === "websocket") {
    outParams.set("type", "ws");
    if (path) outParams.set("path", path);
    if (obfsParam) outParams.set("host", obfsParam);
  } else if (obfs === "grpc") {
    outParams.set("type", "grpc");
    if (path) outParams.set("serviceName", path);
    if (srcParams.get("host")) outParams.set("host", srcParams.get("host") || "");
  } else if (obfs === "h2" || obfs === "httpupgrade") {
    outParams.set("type", obfs);
    if (path) outParams.set("path", path);
    if (obfsParam) outParams.set("host", obfsParam);
  } else if (obfs === "http") {
    outParams.set("type", "tcp");
    outParams.set("headerType", "http");
    if (path) outParams.set("path", path);
    if (obfsParam) outParams.set("host", obfsParam);
  }

  const rawRemark =
    srcParams.get("remarks") ||
    srcParams.get("remark") ||
    (hashPart ? safeDecodeURIComponent(hashPart.substring(1)) : "");
  const finalRemark = rawRemark ? `${rawRemark} - ${target}` : target;

  return `vless://${encodeURIComponent(uuid)}@${formattedHost}:${effectivePort}?${serializeQueryParams(outParams)}#${encodeURIComponent(finalRemark)}`;
}

// 高性能且类型安全的 UTF-8 Base64 解码（兼容 URL-safe 与无填充 Base64）
function decodeBase64UTF8(str: string): string {
  const normalized = str.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + '='.repeat(padLength);
  const binaryStr = atob(padded);
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
