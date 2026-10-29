/**
 * Transit API(https://api.transit.ls8h.com/ 非公式・認証不要)の検証用。
 * 本番の検索にはまだ使わない。利用者の端末(iPhone Safari)から CORS・応答・返り値の形を確かめる。
 */
const BASE = "https://api.transit.ls8h.com";

const CASES = [
  { name: "岡山駅→倉敷駅", from: "34.6661,133.9177", to: "34.6013,133.7660" },
  { name: "東京駅→渋谷駅", from: "35.6812,139.7671", to: "35.6580,139.7016" },
];

/** 値の形だけを短く表す(配列は先頭1件、文字列は30字まで) */
function shape(v: unknown, depth = 0): unknown {
  if (Array.isArray(v)) return v.length ? [`(${v.length}件)`, shape(v[0], depth + 1)] : [];
  if (v && typeof v === "object") {
    if (depth > 3) return "{…}";
    return Object.fromEntries(Object.entries(v).slice(0, 25).map(([k, x]) => [k, shape(x, depth + 1)]));
  }
  return typeof v === "string" ? v.slice(0, 30) : v;
}

async function get(path: string): Promise<string> {
  const t0 = performance.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20_000);
  try {
    const r = await fetch(BASE + path, { signal: ctl.signal });
    const ms = Math.round(performance.now() - t0);
    const text = await r.text();
    let body: string;
    try {
      body = JSON.stringify(shape(JSON.parse(text)));
    } catch {
      body = text.slice(0, 200);
    }
    return `HTTP ${r.status} ${ms}ms ${body.slice(0, 1500)}`;
  } catch (e) {
    return `通信失敗(CORS・停止・タイムアウトの可能性) ${String(e)}`;
  } finally {
    clearTimeout(timer);
  }
}

export async function testTransitApi(): Promise<string> {
  const out = [`[health] ${await get("/api/health")}`];
  for (const c of CASES) out.push(`[${c.name}] ${await get(`/api/v1/plan?from=geo:${c.from}&to=geo:${c.to}`)}`);
  return out.join("\n\n");
}
