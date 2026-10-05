// A read-only model-list probe. It never invokes completion or image generation.
export function connectionConfig(input, saved = {}) {
  let endpoint;
  try { endpoint = new URL(String(input.endpoint || '').trim()); }
  catch { throw Error('请填写完整的 HTTPS 接口地址'); }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw Error('模型地址必须是无密钥参数的 HTTPS URL');
  }
  const model = String(input.model || '').trim();
  if (!model) throw Error('请填写模型名称');
  let apiKey = String(input.apiKey || '').trim();
  if (!apiKey && saved.apiKey) {
    // Never send a previously saved secret to a different provider.
    if (endpoint.origin !== new URL(saved.endpoint).origin) throw Error('接口域名已更改，请重新填写 API Key 后测试');
    apiKey = saved.apiKey;
  }
  if (!apiKey) throw Error('请填写 API Key，或使用已保存的密钥');
  return {endpoint: endpoint.href, model, apiKey};
}

export async function testConnection(config, fetcher = fetch) {
  const url = new URL(config.endpoint);
  const suffix = /\/(?:chat\/completions|images\/(?:edits|generations))\/?$/;
  if (!suffix.test(url.pathname)) return {status: 'unsupported', message: '此自定义接口无法推导模型列表地址，暂不支持无生成连接测试。请核对服务商接口文档。'};
  url.pathname = url.pathname.replace(suffix, '/models');
  const started = Date.now();
  try {
    const response = await fetcher(url.href, {
      method: 'GET', headers: {Accept: 'application/json', Authorization: `Bearer ${config.apiKey}`},
      redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    const elapsedMs = Date.now() - started;
    if (!response.ok) {
      const messages = {
        401: '认证失败，请检查 API Key 是否正确或已过期。',
        403: '访问被拒绝，请检查密钥权限或服务商访问限制。',
        404: '服务商未提供标准模型列表接口，无法用此方式确认连接；这不代表模型调用接口不可用。',
        405: '服务商不支持模型列表读取，无法用此方式确认连接。',
        429: '服务商限流或额度受限，请检查账户状态后再测试。',
      };
      return {status: [404, 405].includes(response.status) ? 'unsupported' : 'error', elapsedMs,
        message: messages[response.status] || `服务商返回 HTTP ${response.status}，请检查地址或稍后再试。`};
    }
    const payload = await response.json().catch(() => null);
    if (!Array.isArray(payload?.data) || payload.data.some(item => typeof item?.id !== 'string')) {
      return {status: 'unsupported', elapsedMs, message: '接口已响应，但不是标准模型列表，暂时无法确认密钥和模型是否可用。'};
    }
    if (!payload.data.some(item => item.id === config.model)) {
      return {status: 'warning', elapsedMs, message: '模型列表读取成功，但未找到所填模型。请核对模型 ID；部分服务商的模型列表并不完整。'};
    }
    return {status: 'success', elapsedMs, message: '连接成功，模型列表中已找到所填模型。尚未验证图片输入、JSON 输出或实际生图能力。'};
  } catch {
    // Provider bodies and network exceptions may contain keys; never return them.
    return {status: 'error', elapsedMs: Date.now() - started, message: '连接失败或超过 15 秒，请检查网络、HTTPS 地址和服务商状态。重定向不会自动跟随。'};
  }
}
