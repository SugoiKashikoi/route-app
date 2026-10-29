/** 地点ごとの到着・出発時刻。先頭は出発のみ、末尾は到着のみ */
export interface StopTime {
  arrive?: Date;
  depart?: Date;
  /** この地点での滞在(分) */
  dwellMin: number;
}

const MIN = 60_000;

/**
 * 出発時刻から順に時刻を割り当てる。
 * durationsSec[i] は地点i→i+1の所要秒(取得失敗は null。以降の時刻は不明として空ける)
 */
export function forwardSchedule(durationsSec: (number | null)[], dwellMin: number[], start: Date): StopTime[] {
  const n = durationsSec.length + 1;
  const out: StopTime[] = [{ depart: start, dwellMin: 0 }];
  let t: number | undefined = start.getTime();
  for (let i = 1; i < n; i++) {
    const d = durationsSec[i - 1];
    t = t === undefined || d === null ? undefined : t + d * 1000;
    const last = i === n - 1;
    const dwell = last ? 0 : dwellMin[i] ?? 0;
    out.push({
      arrive: t === undefined ? undefined : new Date(t),
      depart: t === undefined || last ? undefined : new Date(t + dwell * MIN),
      dwellMin: dwell,
    });
    if (t !== undefined && !last) t += dwell * MIN;
  }
  return out;
}

/** 到着時刻から逆算した出発時刻。所要が不明な区間があれば null */
export function startForArrival(durationsSec: (number | null)[], dwellMin: number[], arrival: Date): Date | null {
  if (durationsSec.some((d) => d === null)) return null;
  const moveSec = (durationsSec as number[]).reduce((a, d) => a + d, 0);
  const dwell = dwellMin.slice(1, durationsSec.length).reduce((a, m) => a + (m ?? 0), 0);
  return new Date(arrival.getTime() - moveSec * 1000 - dwell * MIN);
}
