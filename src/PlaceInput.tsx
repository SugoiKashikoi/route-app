import { useEffect, useRef, useState } from "react";

interface Suggestion {
  placeId: string;
  text: string;
}

interface Props {
  apiKey: string;
  value: string;
  placeholder: string;
  /** 読み上げ・自動操作用の名前(例: 地点A 出発地) */
  label?: string;
  onChange: (text: string, placeId?: string) => void;
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
    if (!apiKey || value.trim().length < 2) {
      setItems([]);
      return;
    }
    timer.current = window.setTimeout(async () => {
      try {
        const r = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey },
          body: JSON.stringify({ input: value, languageCode: "ja", regionCode: "jp" }),
        });
        if (!r.ok) return setItems([]);
        const d = await r.json();
        setItems(
          (d.suggestions ?? [])
            .filter((s: any) => s.placePrediction)
            .map((s: any) => ({ placeId: s.placePrediction.placeId, text: s.placePrediction.text.text })),
        );
      } catch {
        setItems([]);
      }
    }, 250);
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
              key={s.placeId}
              onMouseDown={(e) => {
                e.preventDefault();
                skip.current = true;
                onChange(s.text, s.placeId);
                setItems([]);
                setOpen(false);
              }}
            >
              {s.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
