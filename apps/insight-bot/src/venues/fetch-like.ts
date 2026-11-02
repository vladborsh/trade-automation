/**
 * WD-008 — the one `fetch` shape every venue client takes, so a single fake (`test/venues/fake-fetch.ts`)
 * serves them all. Narrower than `typeof fetch` on purpose: a URL string in, and only the parts of
 * the response the clients read. The global `fetch` is assignable to it, so production passes
 * nothing and specs pass a table of canned answers.
 */
export interface FetchLikeResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  /** Optional so older hand-written fakes still type-check; read through `responseText`. */
  text?(): Promise<string>;
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<FetchLikeResponse>;

export const globalFetch: FetchLike = (url, init) => fetch(url, init) as unknown as Promise<FetchLikeResponse>;

/** The body of a failed response as text, whether or not the fake (or the runtime) gave `text()`. */
export async function responseText(response: FetchLikeResponse): Promise<string> {
  if (response.text) return response.text();
  return JSON.stringify(await response.json().catch(() => null));
}
