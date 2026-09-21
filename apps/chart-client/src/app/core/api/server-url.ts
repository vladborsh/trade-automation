/**
 * The server hands out absolute paths (e.g. screenshot URLs `/api/backtest/…`, T-025). They are
 * on the API's origin, which in development is not the page's (:3010 vs :4210), so resolve them
 * against the configured API base, never against `window.location`.
 */
export function serverUrl(apiBaseUrl: string, path: string, pageOrigin: string): string {
  return new URL(path, new URL(apiBaseUrl, pageOrigin)).toString();
}
