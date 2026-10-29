import { Fragment, useEffect, useState } from "react";
import { MapView, MODE_COLOR } from "./MapView";
import { PlaceInput } from "./PlaceInput";
import { formatClock, formatDistance, formatDuration, toLocalInput } from "./lib/format";
import { legUrl, navigateFromHereUrl } from "./lib/mapsLinks";
import { searchAll, searchFrom } from "./lib/routes";
import { forwardSchedule, startForArrival, type StopTime } from "./lib/schedule";
import { decodeFavorite, encodeFavorite, loadFavorites, saveFavorites, toFavorite, type Favorite } from "./lib/favorites";
import { MODE_LABEL, type LegResult, type Mode, type Stop } from "./types";

const MAX_STOPS = 10;
const MIN_STOPS = 2;
const STORAGE_KEY = "multimodal-route:stops";
const API_KEY_STORAGE = "multimodal-route:apikey";

function loadApiKey(): string {
  try {
    return localStorage.getItem(API_KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}
const label = (i: number) => String.fromCharCode(65 + i);
const durations = (legs: LegResult[]) => legs.map((l) => (l.ok ? l.durationSec : null));

type TimeMode = "now" | "depart" | "arrive";

/** 入力欄の初期値: 30分後を5分単位に切り上げ */
function defaultTime(): string {
  const d = new Date(Date.now() + 30 * 60_000);
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);
  return toLocalInput(d);
}
const newStop = (modeToNext: Mode = "DRIVE"): Stop => ({ id: crypto.randomUUID(), text: "", modeToNext });

function loadStops(): Stop[] {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (Array.isArray(saved) && saved.length >= MIN_STOPS) return saved;
  } catch {
    /* 保存データが使えなければ初期状態 */
  }
  return [newStop(), newStop(), newStop()];
}

/** 動作確認用のサンプル(公共の場所のみ) */
function samplePreset(): Stop[] {
  const s = (text: string, modeToNext: Mode, dwellMin = 0): Stop => ({ ...newStop(modeToNext), text, dwellMin });
  return [
    s("上野駅", "WALK"),
    s("上野恩賜公園", "TRANSIT", 30),
    s("東京駅", "WALK"),
    s("皇居外苑", "WALK"),
  ];
}

const fromFavorite = (f: Favorite): Stop[] => f.stops.map((x) => ({ ...newStop(x.modeToNext), ...x }));

/** URLの #fav=… からお気に入りを取り込む(取り込んだらハッシュは消す) */
function importFromHash(): Favorite | null {
  const m = location.hash.match(/^#fav=(.+)$/);
  if (!m) return null;
  history.replaceState(null, "", location.pathname + location.search);
  return decodeFavorite(m[1]);
}

export function App() {
  const [stops, setStops] = useState<Stop[]>(loadStops);
  const [legs, setLegs] = useState<LegResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"list" | "map">("list");
  /** ナビ進行中の区間(0始まり)。降車・到着のたびに次へ進める */
  const [step, setStep] = useState(0);
  const [apiKey, setApiKey] = useState(loadApiKey);
  const [keyOpen, setKeyOpen] = useState(() => !loadApiKey());
  const [timeMode, setTimeMode] = useState<TimeMode>("now");
  const [timeValue, setTimeValue] = useState(defaultTime);
  const [schedule, setSchedule] = useState<StopTime[]>([]);
  const [notice, setNotice] = useState("");
  const [favs, setFavs] = useState<Favorite[]>(loadFavorites);
  const [favName, setFavName] = useState("");
  const [favMsg, setFavMsg] = useState("");

  const setFavsSaved = (f: Favorite[]) => {
    setFavs(f);
    saveFavorites(f);
  };
  const resetResult = () => {
    setLegs([]);
    setSchedule([]);
    setStep(0);
  };

  // 共有リンクで開かれたら、お気に入りに追加して読み込む
  useEffect(() => {
    const f = importFromHash();
    if (!f) return;
    const cur = loadFavorites();
    const rest = cur.filter((x) => x.name !== f.name);
    setFavsSaved([...rest, f]);
    setStops(fromFavorite(f));
    setFavMsg(`お気に入り「${f.name}」を${rest.length < cur.length ? "更新" : "追加"}しました`);
  }, []);

  async function shareFav(f: Favorite) {
    const url = `${location.origin}${location.pathname}#fav=${encodeFavorite(f)}`;
    try {
      await navigator.clipboard.writeText(url);
      setFavMsg(`「${f.name}」の共有リンクをコピーしました。iPhoneなどで開くとお気に入りに追加されます`);
    } catch {
      setFavMsg(`コピーできませんでした。このリンクを手動で送ってください: ${url}`);
    }
  }

  const saveApiKey = (v: string) => {
    const key = v.trim();
    setApiKey(key);
    try {
      localStorage.setItem(API_KEY_STORAGE, key);
    } catch {
      /* 保存できなくても今回の画面では使える */
    }
  };

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stops));
    } catch {
      /* 保存できなくても動作に影響なし */
    }
  }, [stops]);

  const update = (i: number, patch: Partial<Stop>) =>
    setStops((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const remove = (i: number) => setStops((s) => s.filter((_, j) => j !== i));
  const move = (i: number, d: -1 | 1) =>
    setStops((s) => {
      const n = [...s];
      [n[i], n[i + d]] = [n[i + d], n[i]];
      return n;
    });
  const add = () => setStops((s) => [...s.slice(0, -1), { ...newStop(), modeToNext: s[s.length - 2]?.modeToNext ?? "DRIVE" }, s[s.length - 1]]);

  const ready = stops.every((s) => s.text.trim());

  async function search() {
    setBusy(true);
    setLegs([]);
    setStep(0);
    setSchedule([]);
    setNotice("");
    const now = new Date();
    const dwell = stops.map((s) => s.dwellMin ?? 0);
    const target = timeMode === "now" ? undefined : new Date(timeValue);
    const valid = target && !Number.isNaN(target.getTime());
    let res: LegResult[];
    let start = now;
    let msg = "";

    if (timeMode === "arrive" && valid) {
      // 1回目: 所要時間の概算 → 出発時刻を逆算 → 2回目: その時刻の渋滞・時刻表で取り直す
      const rough = await searchAll(apiKey, stops);
      const est = startForArrival(durations(rough), dwell, target);
      if (!est) {
        res = rough;
        msg = "取得できない区間があるため、到着時刻からの逆算はできませんでした。いま出発した場合の時刻です。";
      } else if (est < now) {
        res = rough;
        const arr = forwardSchedule(durations(rough), dwell, now).at(-1)?.arrive;
        msg = `指定の到着時刻には間に合いません。いま出発すると${arr ? ` ${formatClock(arr, now)} ` : ""}着の見込みです。`;
      } else {
        res = await searchFrom(apiKey, stops, est);
        start = startForArrival(durations(res), dwell, target) ?? est;
        msg = "到着時刻から逆算した目安です(到着指定は2回検索するため、リクエスト数は区間数×2)。";
      }
    } else if (timeMode === "depart" && valid && target.getTime() > now.getTime() + 60_000) {
      start = target;
      res = await searchFrom(apiKey, stops, start);
    } else {
      if (timeMode === "depart") msg = "過去の時刻のため、いま出発として計算しました。";
      res = await searchAll(apiKey, stops);
    }

    setLegs(res);
    setSchedule(forwardSchedule(durations(res), dwell, start));
    setNotice(msg);
    setBusy(false);
    setTab("list");
  }

  const okLegs = legs.filter((l): l is Extract<LegResult, { ok: true }> => l.ok);
  const failed = legs.length - okLegs.length;
  const totalSec = okLegs.reduce((a, l) => a + l.durationSec, 0);
  const totalM = okLegs.reduce((a, l) => a + l.distanceMeters, 0);
  const perMode = (Object.keys(MODE_LABEL) as Mode[])
    .map((m) => {
      const ls = okLegs.filter((l) => l.mode === m);
      return {
        m,
        sec: ls.reduce((a, l) => a + l.durationSec, 0),
        meters: ls.reduce((a, l) => a + l.distanceMeters, 0),
      };
    })
    .filter((x) => x.sec > 0);
  const startAt = schedule[0]?.depart;
  const endAt = schedule.at(-1)?.arrive;

  return (
    <div className="app">
      <nav className="tabs">
        <button className={tab === "list" ? "on" : ""} onClick={() => setTab("list")}>行程</button>
        <button className={tab === "map" ? "on" : ""} onClick={() => setTab("map")}>地図</button>
      </nav>

      <aside className={`panel ${tab === "list" ? "show" : ""}`}>
        <h1>マルチ移動手段ルート検索</h1>

        <details className="key-box" open={keyOpen} onToggle={(e) => setKeyOpen(e.currentTarget.open)}>
          <summary>APIキー{apiKey ? "(設定済み)" : "(未設定)"}</summary>
          <input
            type="password"
            autoComplete="off"
            placeholder="Google Maps Platform の APIキー"
            value={apiKey}
            onChange={(e) => saveApiKey(e.target.value)}
          />
          <p className="note">
            このブラウザの中にだけ保存され、Google以外へは送信されません。キーはRoutes API・Places API (New)・Maps JavaScript APIに制限し、HTTPリファラ制限でこのサイトのURLだけを許可してください。
          </p>
        </details>

        <details className="fav-box" open={favs.length > 0}>
          <summary>お気に入り({favs.length})</summary>
          <ul className="fav-list">
            {favs.map((f) => (
              <li key={f.id}>
                <button
                  className="fav-name"
                  onClick={() => {
                    setStops(fromFavorite(f));
                    resetResult();
                    setFavMsg(`「${f.name}」を読み込みました`);
                  }}
                >
                  {f.name}
                </button>
                <button title="共有リンクをコピー" onClick={() => shareFav(f)}>共有</button>
                <button title="削除" onClick={() => setFavsSaved(favs.filter((x) => x.id !== f.id))}>×</button>
              </li>
            ))}
          </ul>
          <div className="fav-add">
            <input placeholder="今のルートに名前をつけて保存" value={favName} onChange={(e) => setFavName(e.target.value)} />
            <button
              disabled={!favName.trim() || !ready}
              onClick={() => {
                setFavsSaved([...favs.filter((x) => x.name !== favName.trim()), toFavorite(favName.trim(), stops)]);
                setFavMsg(`「${favName.trim()}」を保存しました`);
                setFavName("");
              }}
            >
              保存
            </button>
          </div>
          {favMsg && <p className="note">{favMsg}</p>}
          <p className="note">お気に入りはこのブラウザの中にだけ保存されます。別の端末へは「共有」のリンクで渡せます。</p>
        </details>

        <ol className="stops">
          {stops.map((s, i) => (
            <li key={s.id}>
              <div className="stop-row">
                <span className="badge">{label(i)}</span>
                <PlaceInput
                  apiKey={apiKey}
                  value={s.text}
                  placeholder={i === 0 ? "出発地" : i === stops.length - 1 ? "目的地" : "経由地"}
                  onChange={(text, placeId) => update(i, { text, placeId })}
                />
                <span className="ops">
                  <button title="上へ" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                  <button title="下へ" disabled={i === stops.length - 1} onClick={() => move(i, 1)}>↓</button>
                  <button title="削除" disabled={stops.length <= MIN_STOPS} onClick={() => remove(i)}>×</button>
                </span>
              </div>
              {i > 0 && i < stops.length - 1 && (
                <label className="dwell-row">
                  滞在
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={5}
                    value={s.dwellMin ?? 0}
                    onChange={(e) => update(i, { dwellMin: Math.max(0, Number(e.target.value) || 0) })}
                  />
                  分
                </label>
              )}
              {i < stops.length - 1 && (
                <div className="mode-row">
                  <span className="line" style={{ background: MODE_COLOR[s.modeToNext] }} />
                  <select value={s.modeToNext} onChange={(e) => update(i, { modeToNext: e.target.value as Mode })}>
                    {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
                      <option key={m} value={m}>{MODE_LABEL[m]}</option>
                    ))}
                  </select>
                </div>
              )}
            </li>
          ))}
        </ol>

        <div className="timing">
          <div className="seg">
            {(
              [
                ["now", "いまから出発"],
                ["depart", "出発時刻"],
                ["arrive", "到着時刻"],
              ] as const
            ).map(([v, t]) => (
              <button key={v} className={timeMode === v ? "on" : ""} onClick={() => setTimeMode(v)}>
                {t}
              </button>
            ))}
          </div>
          {timeMode !== "now" && (
            <input type="datetime-local" value={timeValue} onChange={(e) => setTimeValue(e.target.value)} />
          )}
        </div>

        <div className="actions">
          <button onClick={add} disabled={stops.length >= MAX_STOPS}>＋ 経由地を追加</button>
          <button
            title="上野駅→(徒歩)上野公園で30分→(公共交通)東京駅→(徒歩)皇居外苑"
            onClick={() => {
              setStops(samplePreset());
              resetResult();
            }}
          >
            サンプル
          </button>
          <button className="primary" onClick={search} disabled={!ready || busy}>
            {busy ? "検索中…" : "ルート検索"}
          </button>
        </div>

        {legs.length > 0 && (
          <section className="result">
            <div className="total">
              <div className="total-time">{formatDuration(totalSec)}</div>
              <div className="total-sub">合計移動時間 ・ {formatDistance(totalM)}</div>
              <ul className="by-mode">
                {perMode.map((x) => (
                  <li key={x.m}>
                    <span className="dot" style={{ background: MODE_COLOR[x.m] }} />
                    <span className="by-mode-name">{MODE_LABEL[x.m]}</span>
                    <span>{formatDuration(x.sec)}</span>
                    <span className="by-mode-dist">{formatDistance(x.meters)}</span>
                  </li>
                ))}
              </ul>
              {failed > 0 && <div className="warn">{failed}区間が取得できなかったため、合計は取得できた区間のみの値です。</div>}
              {startAt && (
                <div className="sched-sum">
                  <span>{formatClock(startAt)} 発</span>
                  <span>→</span>
                  <span>{endAt ? `${formatClock(endAt, startAt)} 着` : "到着時刻不明"}</span>
                  {endAt && <span className="total-sub">滞在込み {formatDuration((endAt.getTime() - startAt.getTime()) / 1000)}</span>}
                </div>
              )}
              {notice && <div className="info">{notice}</div>}
            </div>
            <ul className="legs">
              {legs.map((l, i) => (
                <Fragment key={i}>
                {i > 0 && (schedule[i]?.dwellMin ?? 0) > 0 && (
                  <li className="dwell">
                    {label(i)}で滞在 {formatDuration(schedule[i].dwellMin * 60)}
                    {schedule[i].arrive && schedule[i].depart && (
                      <span className="sched">
                        {formatClock(schedule[i].arrive!, startAt)}〜{formatClock(schedule[i].depart!, startAt)}
                      </span>
                    )}
                  </li>
                )}
                <li className={i === step ? "current" : i < step ? "done" : ""}>
                  <div className="leg-head">
                    <span className="dot" style={{ background: MODE_COLOR[l.mode] }} />
                    {label(i)} → {label(i + 1)}({MODE_LABEL[l.mode]})
                    {i === step && <span className="now">現在の区間</span>}
                    {i < step && <span className="now">完了</span>}
                  </div>
                  {schedule[i]?.depart && (
                    <div className="sched">
                      {formatClock(schedule[i].depart!, startAt)} 発
                      {schedule[i + 1]?.arrive && ` → ${formatClock(schedule[i + 1].arrive!, startAt)} 着`}
                    </div>
                  )}
                  {l.ok ? (
                    <>
                      <div className="leg-val">{formatDuration(l.durationSec)} ・ {formatDistance(l.distanceMeters)}</div>
                      <div className="links">
                        <a href={legUrl(l.start, l.end, l.mode)} target="_blank" rel="noreferrer">Googleマップで開く</a>
                      </div>
                    </>
                  ) : (
                    <div className="err">{l.error}</div>
                  )}
                  {i === step && (
                    <div className="step-actions">
                      {l.ok && (
                        <a
                          className="nav-btn"
                          href={navigateFromHereUrl(l.end, l.mode)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {l.mode === "DRIVE" ? "車ナビ開始(CarPlay対応)" : `${MODE_LABEL[l.mode]}で${label(i + 1)}へ出発`}
                        </a>
                      )}
                      {i < legs.length - 1 ? (
                        <button onClick={() => setStep(i + 1)}>
                          {l.mode === "DRIVE" ? `${label(i + 1)}に到着・降車 → 次へ` : `${label(i + 1)}に到着 → 次へ`}
                        </button>
                      ) : (
                        <button onClick={() => setStep(i + 1)}>目的地に到着</button>
                      )}
                    </div>
                  )}
                </li>
                </Fragment>
              ))}
            </ul>
            <p className="note">
              ※「Googleマップで開く」は端点と移動手段を渡すだけで、Googleマップ側が経路を再計算します。ここに表示した経路と完全に同じになる保証はありません。
              ナビ開始ボタンはiPhoneのGoogleマップアプリで現在地を出発地としてナビを始めます(現在地の使用を許可してください)。
              車区間はiPhoneをCarPlayに接続していればGoogleマップのナビがCarPlayに表示されます。降車後は「到着・降車 → 次へ」で次の区間(徒歩など)の開始ボタンに切り替わります。このアプリ自体はCarPlayには表示されません。
            </p>
          </section>
        )}
      </aside>

      <main className={`mapcol ${tab === "map" ? "show" : ""}`}>
        <MapView apiKey={apiKey} legs={legs} visible={tab === "map"} />
      </main>
    </div>
  );
}
