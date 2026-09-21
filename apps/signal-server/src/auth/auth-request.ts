import { User } from '@trade-automation/contracts';

/**
 * The slice of the HTTP request/response the auth layer touches. Declared here rather than
 * imported from `express`, which this app does not depend on directly (`@types/express` is not
 * installed); `@nestjs/platform-express` hands over objects that satisfy these shapes.
 */
export interface AuthHttpRequest {
  headers: Record<string, string | string[] | undefined>;
  /** Set by `AuthGuard` on authenticated requests; read by `@CurrentUser()`. */
  user?: User;
}

export interface AuthHttpResponse {
  setHeader(name: string, value: string | string[]): unknown;
}

export function headerValue(request: AuthHttpRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value.join('; ') : value;
}
