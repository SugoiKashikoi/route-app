import type { Stop } from "../types";

/** お気に入り。ブラウザごと(localStorage)に保存し、コードやサーバーには置かない */
export interface Favorite {
  id: string;
  name: string;
  stops: Omit<Stop, "id">[];
}

const KEY = "multimodal-route:favorites";

export function loadFavorites(): Favorite[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function saveFavorites(favs: Favorite[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(favs));
  } catch {
    /* 保存できなくても今回の画面では使える */
  }
}

export function toFavorite(name: string, stops: Stop[]): Favorite {
  return {
    id: crypto.randomUUID(),
    name,
    stops: stops.map(({ id: _id, ...rest }) => rest),
  };
}

/** 別の端末(iPhoneなど)へ渡すためのURLハッシュ。ハッシュはサーバーへ送られない */
export function encodeFavorite(f: Favorite): string {
  const bytes = new TextEncoder().encode(JSON.stringify({ name: f.name, stops: f.stops }));
  const b64 = btoa(String.fromCharCode(...bytes));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeFavorite(s: string): Favorite | null {
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const v = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof v?.name !== "string" || !Array.isArray(v.stops) || v.stops.length < 2) return null;
    return { id: crypto.randomUUID(), name: v.name, stops: v.stops };
  } catch {
    return null;
  }
}
