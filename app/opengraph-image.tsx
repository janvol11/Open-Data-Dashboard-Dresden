import { ImageResponse } from "next/og";

// Vorschaubild für geteilte Links (Messenger, soziale Netzwerke), beim Build erzeugt
export const alt = "Dresden Data Workspace – offene Geodaten der Landeshauptstadt Dresden";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BARS = [38, 64, 50, 82, 58];

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 90px",
          background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)",
          color: "#f1f5f9",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 680 }}>
          <div style={{ fontSize: 30, color: "#a5b4fc", marginBottom: 18 }}>Open Data Dresden</div>
          <div style={{ fontSize: 72, fontWeight: 700, lineHeight: 1.1 }}>Dresden Data Workspace</div>
          <div style={{ fontSize: 32, color: "#cbd5e1", marginTop: 28, lineHeight: 1.4 }}>
            Offene Geodaten auf der Karte erkunden, auswerten und als Link teilen.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 18,
            width: 300,
            height: 300,
            padding: 40,
            borderRadius: 48,
            background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
          }}
        >
          {BARS.map((height, i) => (
            <div
              key={i}
              style={{ flex: 1, height: `${height}%`, borderRadius: 10, background: "rgba(255,255,255,0.92)" }}
            />
          ))}
        </div>
      </div>
    ),
    size
  );
}
