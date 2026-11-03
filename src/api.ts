import type { BoardMeta, BoardSummary, El, ShareMode, User } from "../shared/types";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error || res.statusText);
  return data as T;
}

export interface Providers {
  github: boolean;
  google: boolean;
  dev: boolean;
}

export const api = {
  me: () => req<{ user: User | null; providers: Providers }>("/api/me"),
  logout: () => req("/auth/logout", { method: "POST" }),
  boards: () => req<{ owned: BoardSummary[]; shared: BoardSummary[] }>("/api/boards"),
  createBoard: (title: string, elements: El[] = []) =>
    req<{ id: string }>("/api/boards", { method: "POST", body: JSON.stringify({ title, elements }) }),
  board: (id: string) => req<BoardMeta>(`/api/boards/${id}`),
  updateBoard: (id: string, patch: { title?: string; share?: ShareMode }) =>
    req(`/api/boards/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteBoard: (id: string) => req(`/api/boards/${id}`, { method: "DELETE" }),
  duplicateBoard: (id: string) => req<{ id: string }>(`/api/boards/${id}/duplicate`, { method: "POST" }),
  saveThumbnail: (id: string, thumbnail: string) =>
    req(`/api/boards/${id}/thumbnail`, { method: "PUT", body: JSON.stringify({ thumbnail }), keepalive: true }),
};
