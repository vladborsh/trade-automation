/**
 * Minimal shape of the WebSocket API this app depends on, so tests can pass
 * a fake implementation instead of a real socket.
 */
export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
}

export type SocketFactory = (url: string) => SocketLike;

export const browserSocketFactory: SocketFactory = (url: string) =>
  new WebSocket(url) as unknown as SocketLike;

export const SOCKET_OPEN = 1;
