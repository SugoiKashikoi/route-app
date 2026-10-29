import type { Stop } from "../types";

/** 地点ごとの条件 */
export interface StopRule {
  /** 滞在(分) */
  dwellMin: number;
  /** この時刻より前には出発しない(早く着いたら待つ) */
  departAt?: Date;
  /** この時刻までに着きたい(余裕・遅れの判定に使う) */
  arriveBy?: Date;
}

/** 地点ごとの到着・出発時刻。先頭は出発のみ、末尾は到着のみ */
export interface StopTime {
  arrive?: Date;
  depart?: Date;
  dwellMin: number;
  /** 出発時刻指定による待ち時間(分) */
  waitMin: number;
  /** 到着希望までの余裕(分)。マイナスは遅れ */
  slackMin?: number;
}

const MIN = 60_000;

/** 到着時刻と地点の条件から、その地点を出る時刻を決める */
export function nextDepart(arriveMs: number, r: StopRule | undefined): number {
  const ready = arriveMs + (r?.dwellMin ?? 0) * MIN;
  return r?.departAt ? Math.max(ready, r.departAt.getTime()) : ready;
}

/**
 * 出発時刻から順に時刻を割り当てる。
 * durationsSec[i] は地点i→i+1の所要秒(取得失敗は null。以降の時刻は不明として空ける)
 */
export function forwardSchedule(durationsSec: (number | null)[], rules: StopRule[], start: Date): StopTime[] {
  const n = durationsSec.length + 1;
  const out: StopTime[] = [{ depart: start, dwellMin: 0, waitMin: 0 }];
  let t: number | undefined = start.getTime();
  for (let i = 1; i < n; i++) {
    const d = durationsSec[i - 1];
    const r = rules[i];
    const arrive: number | undefined = t === undefined || d === null ? undefined : t + d * 1000;
    const last = i === n - 1;
    const depart: number | undefined = arrive === undefined || last ? undefined : nextDepart(arrive, r);
    const dwellMin = last ? 0 : r?.dwellMin ?? 0;
    out.push({
      arrive: arrive === undefined ? undefined : new Date(arrive),
      depart: depart === undefined ? undefined : new Date(depart),
      dwellMin,
      waitMin: arrive === undefined || depart === undefined ? 0 : Math.round((depart - arrive) / MIN) - dwellMin,
      slackMin: arrive !== undefined && r?.arriveBy ? Math.floor((r.arriveBy.getTime() - arrive) / MIN) : undefined,
    });
    t = depart;
  }
  return out;
}

/** 到着時刻から逆算した出発時刻(滞在のみ考慮)。所要が不明な区間があれば null */
export function startForArrival(durationsSec: (number | null)[], rules: StopRule[], arrival: Date): Date | null {
  if (durationsSec.some((d) => d === null)) return null;
  const moveSec = (durationsSec as number[]).reduce((a, d) => a + d, 0);
  const dwell = rules.slice(1, durationsSec.length).reduce((a, r) => a + (r?.dwellMin ?? 0), 0);
  return new Date(arrival.getTime() - moveSec * 1000 - dwell * MIN);
}

/** "HH:MM" を基準時刻以降の最初のその時刻に変換(基準より前なら翌日) */
export function resolveClock(hhmm: string | undefined, base: Date): Date | undefined {
  const m = hhmm?.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return undefined;
  const d = new Date(base);
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  if (d.getTime() < base.getTime() - 12 * 3600_000) d.setDate(d.getDate() + 1);
  return d;
}

/**
 * 入力した地点から条件を作る。"HH:MM" は base(旅程の日付)を基準に日時へ直す。
 * 次が新幹線・飛行機の地点は、発車時刻まで待ち、発車時刻までに着けるかを余裕/遅れで判定する。
 */
export function buildRules(stops: Stop[], base: Date): StopRule[] {
  return stops.map((s, i) => {
    const mid = i > 0 && i < stops.length - 1;
    const rule: StopRule = {
      dwellMin: s.dwellMin ?? 0,
      departAt: mid ? resolveClock(s.departAt, base) : undefined,
      arriveBy: i > 0 ? resolveClock(s.arriveBy, base) : undefined,
    };
    const train = s.modeToNext === "FIXED" && i < stops.length - 1 ? resolveClock(s.fixedDepart, base) : undefined;
    if (train) {
      rule.departAt = train;
      // 滞在があるなら、滞在を終えてから乗れるように着く必要がある
      const by = new Date(train.getTime() - rule.dwellMin * MIN);
      if (i > 0 && (!rule.arriveBy || by < rule.arriveBy)) rule.arriveBy = by;
    }
    return rule;
  });
}
