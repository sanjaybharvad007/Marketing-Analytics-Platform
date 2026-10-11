"use client";

// Shown when the root layout itself fails (for example, the database is down).
// It replaces the whole document, so it carries its own minimal styles.
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#eef2f1",
          color: "#14201e",
        }}
      >
        <title>MAP is unavailable</title>
        <main style={{ maxWidth: 440, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>MAP could not start this page</h1>
          <p style={{ margin: "0 0 16px", color: "#43504d", lineHeight: 1.5 }}>
            The application could not reach its database. Check that PostgreSQL is running and that
            DATABASE_URL points at it, then try again.
          </p>
          {error.digest ? (
            <p style={{ margin: "0 0 16px", fontSize: 12, color: "#65716e" }}>
              Reference: {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => retry()}
            style={{
              height: 32,
              padding: "0 12px",
              border: 0,
              borderRadius: 6,
              background: "#1f5c4d",
              color: "#fff",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
