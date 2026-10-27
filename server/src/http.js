/** 统一响应体 + 错误码 */
export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extra,
    },
  });
}

export function fail(code, message, status = 400, extra = {}) {
  return json({ ok: false, error: { code, message }, ...extra }, status);
}

export class ApiError extends Error {
  constructor(code, message, status = 400, extra = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}

export const ERR = {
  badRequest: () => new ApiError('bad_request', '参数不合法', 400),
  unauthorized: (msg = '登录状态已失效，请重新登录') => new ApiError('unauthorized', msg, 401),
  forbidden: (msg = '没有权限') => new ApiError('forbidden', msg, 403),
  notFound: () => new ApiError('not_found', '资源不存在', 404),
  tooMany: (msg, retryAfter = 60) =>
    new ApiError('too_many_requests', msg, 429, { 'retry-after': String(retryAfter) }),
  conflict: (msg) => new ApiError('conflict', msg, 409),
};
