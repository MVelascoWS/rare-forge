/**
 * Thin client-side fetch helpers for the /api/* routes. Centralizes the
 * convention that error responses are { error: string } with a 4xx/5xx status,
 * surfacing that message as a thrown Error so screens can show it directly.
 *
 * Screens call these — never the service layer or rare-cli — keeping business
 * logic in the backend (FRONTEND_SPEC: "call the existing /api/* routes").
 */

async function parse<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(json?.error ?? `Request failed (${res.status})`);
  }
  return json as T;
}

export async function apiGet<T>(url: string): Promise<T> {
  return parse<T>(await fetch(url, { cache: "no-store" }));
}

export async function apiPost<T>(url: string, body?: unknown): Promise<T> {
  return parse<T>(
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    })
  );
}

/** Upload one image to /api/upload, returning the server path for rare-cli. */
export async function apiUpload(file: File): Promise<{ path: string }> {
  const fd = new FormData();
  fd.append("file", file);
  return parse<{ path: string }>(
    await fetch("/api/upload", { method: "POST", body: fd })
  );
}
