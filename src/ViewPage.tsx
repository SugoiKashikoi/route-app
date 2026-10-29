import { Fragment } from "react";
import { MODE_COLOR } from "./MapView";
import { formatClock, formatDistance, formatDuration } from "./lib/format";
import { legUrlByName } from "./lib/mapsLinks";
import type { SharedPlan } from "./lib/share";
import { MODE_ICON, MODE_LABEL } from "./types";

const label = (i: number) => String.fromCharCode(65 + i);

/** 共有された予定の閲覧専用ページ(APIキー不要。地図は各区間のGoogleマップリンクで見る) */
export function ViewPage({ plan }: { plan: SharedPlan }) {
  const date = (ms?: number) => (ms === undefined ? undefined : new Date(ms));
  const start = date(plan.stops[0]?.d);
  const end = date(plan.stops.at(-1)?.a);
  const clock = (ms?: number) => (ms === undefined ? "--:--" : formatClock(new Date(ms), start));
  const moveSec = plan.legs.reduce((a, l) => a + (l.s ?? 0), 0);
  const editUrl = () => {
    const stops = plan.stops.map((s, i) => ({ text: s.t, modeToNext: plan.legs[i]?.m ?? "DRIVE", dwellMin: s.dw, overnight: s.o ? true : undefined }));
    return `${location.pathname}#plan=${encodeURIComponent(JSON.stringify({ stops }))}`;
  };

  return (
    <div className="view">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          <div>
            <div className="brand-name">MULTI ROUTE</div>
            <div className="brand-sub">共有された予定(閲覧専用)</div>
          </div>
        </div>
      </header>
      <main className="view-body">
        <section className="hud">
          <div className="hud-label">{plan.name || "PLAN"}</div>
          <div className="hud-time">{formatDuration(moveSec)}</div>
          <div className="hud-grid">
            <div><small>DEPART</small><b>{start ? `${start.getMonth() + 1}/${start.getDate()} ${clock(plan.stops[0].d)}` : "--"}</b></div>
            <div><small>ARRIVE</small><b>{clock(plan.stops.at(-1)?.a)}</b></div>
            <div><small>STOPS</small><b>{plan.stops.length}</b></div>
            <div><small>TOTAL</small><b>{start && end ? formatDuration((end.getTime() - start.getTime()) / 1000) : "--"}</b></div>
          </div>
        </section>
        <ol className="sectors">
          {plan.stops.map((s, i) => {
            const l = plan.legs[i];
            const next = plan.stops[i + 1];
            return (
              <Fragment key={i}>
                <li className="pit">
                  <span className={`plate sm ${i === 0 ? "p-start" : i === plan.stops.length - 1 ? "p-goal" : ""}`}>{label(i)}</span>
                  <b className="view-name">{s.t}</b>
                  <span className="mono">
                    {i > 0 && clock(s.a)}
                    {i > 0 && i < plan.stops.length - 1 && "〜"}
                    {i < plan.stops.length - 1 && clock(s.d)}
                  </span>
                  {s.o ? <span className="chip wait">🏨 宿泊</span> : s.dw ? <span className="chip">滞在 {formatDuration(s.dw * 60)}</span> : null}
                </li>
                {l && next && (
                  <li className="sector" style={{ ["--mc" as string]: MODE_COLOR[l.m] }}>
                    <div className="sector-head">
                      <span className="sector-no">S{i + 1}</span>
                      <span className="mode-tag">{MODE_ICON[l.m]} {l.f || MODE_LABEL[l.m]}</span>
                    </div>
                    {l.e ? (
                      <div className="err">この区間は経路を取得できませんでした</div>
                    ) : (
                      <div className="sector-body">
                        <div className="sector-time">{formatDuration(l.s ?? 0)}</div>
                        <div className="sector-meta">
                          {l.km !== undefined && <span>{formatDistance(l.km * 1000)}</span>}
                          {l.m !== "FIXED" && (
                            <a href={legUrlByName(s.t, next.t, l.m)} target="_blank" rel="noreferrer">Googleマップ</a>
                          )}
                        </div>
                      </div>
                    )}
                  </li>
                )}
              </Fragment>
            );
          })}
        </ol>
        <p className="note">
          作成時点の検索結果です(渋滞・時刻表の変化は反映されません)。編集・再検索するには
          <a href={editUrl()} onClick={() => setTimeout(() => location.reload(), 0)}>自分の画面で開く</a>
          (APIキーが必要)。
        </p>
      </main>
    </div>
  );
}
