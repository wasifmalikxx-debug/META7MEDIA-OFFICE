"use client";

// Last-resort boundary: only renders if the ROOT LAYOUT itself crashes
// (src/app/error.tsx handles everything else). Replaces <html>/<body>, and
// the app's CSS is not guaranteed here — inline styles only. One guarded
// auto-reload (old tab hitting a fresh deploy), then a manual button.
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  if (typeof window !== "undefined") {
    console.error("[app] global error:", error);
    try {
      const KEY = "m7_global_reload_at";
      const last = Number(sessionStorage.getItem(KEY) || 0);
      if (Date.now() - last > 30_000) {
        sessionStorage.setItem(KEY, String(Date.now()));
        window.location.reload();
      }
    } catch {}
  }

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          background: "#f8fafc",
          color: "#0f172a",
        }}
      >
        <div style={{ textAlign: "center", padding: 24, maxWidth: 420 }}>
          <p style={{ fontSize: 15, fontWeight: 600, margin: "0 0 6px" }}>
            Temporary connection hiccup
          </p>
          <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 18px" }}>
            The portal hit a brief error — it usually clears right away.
          </p>
          {/* reset() alone does not refetch in Next 16 and the root layout is
              down here anyway — a full reload is the only honest recovery. */}
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "10px 22px",
              borderRadius: 10,
              border: 0,
              background: "#0f172a",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload page
          </button>
        </div>
      </body>
    </html>
  );
}
