import { useEffect, useRef, useState } from "react";
import { take } from "./lib/quota";
import { suggestStations } from "./lib/transit";
import type { LatLng } from "./types";

/** 候補を選んだときに地点へ保存する情報 */
export interface PlacePick {
  placeId?: string;
  latLng?: LatLng;
  /** 公共交通検索(Transit API)で使う駅の指定 */
  transitEndpoint?: string;
}

interface Suggestion extends PlacePick {
  key: string;
  text: string;
  station?: boolean;
}

interface Props {
  apiKey: string;
  value: string;
  placeholder: string;
  /** 読み上げ・自動操作用の名前(例: 地点A 出発地) */
  label?: string;
  onChange: (text: string, pick?: PlacePick) => void;
}

export function PlaceInput({ apiKey, value, placeholder, label, onChange }: Props) {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<number>();
  const skip = useRef(false);

  useEffect(() => {
    if (skip.current) {
      skip.current = false;
      return;
    }
    window.clearTimeout(timer.current);
    if (value.trim().length < 2) {
      setItems([]);
      return;
    }
    // 1文字ごとに問い合わせないよう、入力が止まってから送る(無料枠の節約)
    // 駅は公共交通の検索(Transit API・無料)から、それ以外の場所は Google から候補を出す。駅を上に並べる
    timer.current = window.setTimeout(async () => {
      const google = async (): Promise<Suggestion[]> => {
        if (!apiKey || !take("autocomplete")) return [];
        try {
          const r = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey },
            body: JSON.stringify({ input: value, languageCode: "ja", regionCode: "jp" }),
          });
          if (!r.ok) return [];
          const d = await r.json();
          return (d.suggestions ?? [])
            .filter((s: any) => s.placePrediction)
            .map((s: any) => ({ key: s.placePrediction.placeId, placeId: s.placePrediction.placeId, text: s.placePrediction.text.text }));
        } catch {
          return [];
        }
      };
      const stations = async (): Promise<Suggestion[]> =>
        (await suggestStations(value)).map((x) => ({
          key: `st:${x.endpoint}`,
          text: x.name,
          station: true,
          latLng: { lat: x.lat, lng: x.lon },
          transitEndpoint: x.endpoint,
        }));
      const [st, gg] = await Promise.all([stations(), google()]);
      setItems([...st, ...gg]);
    }, 600);
    return () => window.clearTimeout(timer.current);
  }, [value, apiKey]);

  return (
    <div className="place-input">
      <input
        value={value}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        onChange={(e) => {
          setOpen(true);
          onChange(e.target.value, undefined);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
      />
      {open && items.length > 0 && (
        <ul className="suggest">
          {items.map((s) => (
            <li
              key={s.key}
              className={s.station ? "station" : ""}
              onMouseDown={(e) => {
                e.preventDefault();
                skip.current = true;
                onChange(s.text, { placeId: s.placeId, latLng: s.latLng, transitEndpoint: s.transitEndpoint });
                setItems([]);
                setOpen(false);
              }}
            >
              {s.station && <span className="st-badge">駅</span>}
              {s.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
