// Shared scriptable callbacks for chart.js datalabels on stacked bars.
// When a segment is too thin to host a top-aligned label cleanly, we
// switch to a centered label with no offset; otherwise we keep the
// top-of-segment placement that looks tidy on bigger bars.

// Threshold in pixels (label height ~12px + offset/margin headroom).
const THIN_PX = 18;

function segmentHeightPx(ctx) {
  const v = ctx.dataset.data[ctx.dataIndex] || 0;
  const y = ctx.chart?.scales?.y;
  if (!y || !v) return 0;
  return Math.abs(y.getPixelForValue(v) - y.getPixelForValue(0));
}

function isThin(ctx) {
  return segmentHeightPx(ctx) < THIN_PX;
}

export const labelAnchor = (ctx) => (isThin(ctx) ? 'center' : 'end');
export const labelAlign  = (ctx) => (isThin(ctx) ? 'center' : 'start');
export const labelOffset = (ctx) => (isThin(ctx) ? 0 : 2);
