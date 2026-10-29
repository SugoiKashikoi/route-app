import type { LegResult } from "../types";

/** 乗り継ぎ・到着の余裕がこれ未満なら要注意(分)。次が新幹線・飛行機なら長めに見る */
const TIGHT_MIN = 10;
const TIGHT_FIXED_MIN = 15;
const LONG_WALK_MIN = 20;
const LONG_BIKE_MIN = 40;
const LONG_DRIVE_MIN = 120;

/**
 * 区間の要注意ポイント。
 * slackMin は区間の到着地点での余裕(分、マイナスは遅れ)。nextFixed は到着地点から新幹線・飛行機に乗るか。
 */
export function legCautions(leg: LegResult, slackMin: number | undefined, nextFixed: boolean): string[] {
  const out: string[] = [];
  if (slackMin !== undefined) {
    if (slackMin < 0) out.push(nextFixed ? `発車に${-slackMin}分間に合いません` : `到着希望に${-slackMin}分遅れます`);
    else if (slackMin < (nextFixed ? TIGHT_FIXED_MIN : TIGHT_MIN))
      out.push(nextFixed ? `発車まで余裕${slackMin}分(乗り遅れ注意)` : `余裕が${slackMin}分しかありません`);
  }
  if (leg.ok) {
    const min = Math.round(leg.durationSec / 60);
    if (leg.mode === "WALK" && min >= LONG_WALK_MIN) out.push(`徒歩${min}分と長め`);
    if (leg.mode === "BICYCLE" && min >= LONG_BIKE_MIN) out.push(`自転車${min}分と長め`);
    if (leg.mode === "DRIVE" && min >= LONG_DRIVE_MIN) out.push("2時間以上の連続運転(途中で休憩を)");
  }
  return out;
}
