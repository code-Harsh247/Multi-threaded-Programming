// A 3x5 pixel font for numbers drawn on the canvas (berth ride counters).
// 2, 3 and 5 use diagonals / a flat top so none of them reads as an S.
const GLYPHS = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['110', '001', '010', '100', '111'],
  '3': ['110', '001', '010', '001', '110'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '110', '001', '110'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
};

export function textWidth(text) {
  return Math.max(0, text.length * 4 - 1);
}

export function drawText(ctx, text, x, y, color) {
  ctx.fillStyle = color;
  let cx = Math.round(x);
  const cy = Math.round(y);
  for (const ch of text) {
    const g = GLYPHS[ch];
    if (g) {
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 3; c++) {
          if (g[r][c] === '1') ctx.fillRect(cx + c, cy + r, 1, 1);
        }
      }
    }
    cx += 4;
  }
}
