import type { BufferedPoint } from './db';

/** Escape XML text/attribute content. */
function esc(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Build a GPX 1.1 track from buffered GPS points (Strava-compatible). */
export function pointsToGpx(args: {
  points: BufferedPoint[];
  name: string;
}): string {
  const sorted = args.points.slice().sort((a, b) => a.ts - b.ts);
  const segs = sorted
    .map(
      (p) =>
        `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}"><ele>0</ele><time>${esc(
          new Date(p.ts).toISOString(),
        )}</time></trkpt>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Trackfud" xmlns="http://www.topografix.com/GPX/1/1">\n  <trk>\n    <name>${esc(args.name)}</name>\n    <type>running</type>\n    <trkseg>\n${segs}\n    </trkseg>\n  </trk>\n</gpx>\n`;
}

/** Trigger a client-side file download (PWA-safe, no server round-trip). */
export function downloadText(args: {
  text: string;
  filename: string;
  mime: string;
}): void {
  const blob = new Blob([args.text], { type: args.mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = args.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}
