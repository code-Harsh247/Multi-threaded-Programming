// A small pixel-style step chart of how many people are waiting at the jetty.
const CW = 200;
const CH = 64;
const PAD = { left: 2, right: 2, top: 4, bottom: 2 };

export class QueueChart {
  constructor(canvas) {
    this.canvas = canvas;
    canvas.width = CW;
    canvas.height = CH;
    this.g = canvas.getContext('2d');
  }

  // series: [[minute, waiting], ...] in time order; nowMin: current simulated minute.
  // Returns the axis ranges so the page can label them.
  draw(series, nowMin, colors) {
    const g = this.g;
    g.fillStyle = colors.bg;
    g.fillRect(0, 0, CW, CH);

    const xMax = Math.max(60, Math.ceil(nowMin / 30) * 30);
    const peak = series.reduce((m, [, w]) => Math.max(m, w), 0);
    const yMax = Math.max(5, Math.ceil(peak / 5) * 5);
    const plotW = CW - PAD.left - PAD.right;
    const plotH = CH - PAD.top - PAD.bottom;
    const px = (min) => PAD.left + Math.round((min / xMax) * (plotW - 1));
    const py = (w) => PAD.top + plotH - 1 - Math.round((w / yMax) * (plotH - 1));

    // Grid lines at quarters of the y range.
    g.fillStyle = colors.grid;
    for (let k = 1; k < 4; k++) {
      const y = py((yMax * k) / 4);
      for (let x = PAD.left; x < CW - PAD.right; x += 3) g.fillRect(x, y, 1, 1);
    }
    g.fillStyle = colors.axis;
    g.fillRect(PAD.left, py(0) + 1, plotW, 1);

    if (series.length) {
      // Each value holds until the next change, and the last one until now.
      const points = [...series, [nowMin, series.at(-1)[1]]];
      for (let i = 0; i < points.length - 1; i++) {
        const [m0, w] = points[i];
        const x0 = px(m0);
        const x1 = Math.max(x0, px(points[i + 1][0]));
        const y = py(w);
        g.fillStyle = colors.fill;
        g.fillRect(x0, y, x1 - x0 + 1, py(0) - y + 1);
        g.fillStyle = colors.line;
        g.fillRect(x0, y, x1 - x0 + 1, 1);
        const next = points[i + 1][1];
        if (i < points.length - 2 && next !== w) {
          const ya = Math.min(y, py(next));
          const yb = Math.max(y, py(next));
          g.fillRect(x1, ya, 1, yb - ya + 1);
        }
      }
    }
    return { xMax, yMax, peak };
  }
}
