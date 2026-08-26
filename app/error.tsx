"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

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
          Something went wrong
        </h1>
        <p style={{ margin: "0 0 20px", fontSize: "13px", color: "var(--muted, #6a6d66)" }}>
          The build hit an unexpected error. Your work in this session may still be recoverable
          by trying again.
        </p>
        <button
          onClick={reset}
          style={{
            border: 0,
            borderRadius: "8px",
            padding: "10px 18px",
            fontSize: "12px",
            fontWeight: 650,
            cursor: "pointer",
            background: "var(--ink, #161817)",
            color: "white",
          }}
        >
          Try again
        </button>
      </div>
    </main>
  );
}
