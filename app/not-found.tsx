import Link from "next/link";

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "24px",
        background: "var(--paper, #f7f7f3)",
        color: "var(--ink, #161817)",
        fontFamily: "var(--font-geist-sans), Arial, sans-serif",
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: "420px" }}>
        <h1 style={{ fontSize: "20px", margin: "0 0 8px", letterSpacing: "-.02em" }}>
          Page not found
        </h1>
        <p style={{ margin: "0 0 20px", fontSize: "13px", color: "var(--muted, #6a6d66)" }}>
          There&apos;s nothing here. Canvas only has one page right now.
        </p>
        <Link
          href="/"
          style={{
            display: "inline-block",
            borderRadius: "8px",
            padding: "10px 18px",
            fontSize: "12px",
            fontWeight: 650,
            background: "var(--ink, #161817)",
            color: "white",
          }}
        >
          Back to Canvas
        </Link>
      </div>
    </main>
  );
}
