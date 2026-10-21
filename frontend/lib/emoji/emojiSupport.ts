/** What drawing an emoji on a hidden canvas showed: how wide it came out, and whether any of it is in colour. */
export interface Rendering {
  width: number;
  colored: boolean;
}

export type Measure = (text: string) => Rendering | null;

// A joined sequence that is not supported falls back to several glyphs side by side, so it comes out wider than one
const SINGLE_EMOJI = "😀";
const WIDTH_TOLERANCE = 1.3;
const FONT =
  '32px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif';
const SIZE = 48;

let context: CanvasRenderingContext2D | null | undefined;

function canvasContext(): CanvasRenderingContext2D | null {
  if (context !== undefined) return context;
  if (typeof document === "undefined") return (context = null);

  try {
    const canvas = document.createElement("canvas");
    canvas.width = SIZE * 3;
    canvas.height = SIZE;
    context = canvas.getContext("2d", { willReadFrequently: true });
  } catch {
    context = null;
  }
  return context;
}

/** Draws the text and reports its width and whether any pixel is a colour rather than a shade of grey. */
export const measureOnCanvas: Measure = (text) => {
  const ctx = canvasContext();
  if (!ctx) return null;

  try {
    ctx.clearRect(0, 0, SIZE * 3, SIZE);
    ctx.font = FONT;
    ctx.textBaseline = "top";
    ctx.fillStyle = "#000";
    ctx.fillText(text, 0, 4);
    const { data } = ctx.getImageData(0, 0, SIZE * 3, SIZE);

    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3]!;
      if (
        alpha > 0 &&
        (Math.abs(data[i]! - data[i + 1]!) > 12 || Math.abs(data[i + 1]! - data[i + 2]!) > 12)
      ) {
        return { width: ctx.measureText(text).width, colored: true };
      }
    }
    return { width: ctx.measureText(text).width, colored: false };
  } catch {
    return null;
  }
};

/**
 * Whether this device can draw an emoji as a real emoji. A missing one shows as a grey box or as
 * its parts; a real colour emoji is both coloured and about one emoji wide. When the device cannot
 * be asked at all, the emoji is assumed fine, so the check can only ever add pictures, never hide an emoji.
 */
export function createEmojiSupportCheck(
  measure: Measure = measureOnCanvas,
): (emoji: string) => boolean {
  const known = new Map<string, boolean>();
  let singleWidth: number | null | undefined;

  const referenceWidth = () => {
    if (singleWidth === undefined) singleWidth = measure(SINGLE_EMOJI)?.width ?? null;
    return singleWidth;
  };

  return (emoji) => {
    const cached = known.get(emoji);
    if (cached !== undefined) return cached;

    const rendering = measure(emoji);
    const reference = referenceWidth();
    const supported =
      rendering === null || reference === null
        ? true
        : rendering.colored && rendering.width <= reference * WIDTH_TOLERANCE;

    known.set(emoji, supported);
    return supported;
  };
}

/** The check for the page, sharing one cache across every emoji drawn. */
export const isEmojiSupported = createEmojiSupportCheck();
