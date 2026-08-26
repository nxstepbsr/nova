"use client";

import { useState } from "react";

export default function Login() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        setError("Incorrect password.");
        setSubmitting(false);
        return;
      }
      const next = new URLSearchParams(window.location.search).get("next") || "/";
      window.location.href = next;
    } catch {
      setError("Something went wrong. Try again.");
      setSubmitting(false);
    }
  }

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
      }}
    >
      <form
        onSubmit={submit}
        style={{
          width: "min(340px, 100%)",
          display: "grid",
          gap: "14px",
          padding: "28px",
          background: "white",
          border: "1px solid var(--line, #dedfd9)",
          borderRadius: "12px",
          boxShadow: "0 24px 70px rgba(35,38,31,.08)",
        }}
      >
        <div
          style={{
            display: "grid",
            placeItems: "center",
            width: "30px",
            height: "30px",
            color: "white",
            background: "var(--ink, #161817)",
            borderRadius: "9px 9px 9px 3px",
            fontSize: "16px",
          }}
        >
          C
        </div>
        <div>
          <h1 style={{ fontSize: "18px", margin: "0 0 4px", letterSpacing: "-.02em" }}>Canvas</h1>
          <p style={{ margin: 0, fontSize: "13px", color: "var(--muted, #6a6d66)" }}>
            Enter the password to continue.
          </p>
        </div>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password"
          autoFocus
          disabled={submitting}
          style={{
            width: "100%",
            padding: "10px 12px",
            fontSize: "14px",
            border: "1px solid var(--line, #dedfd9)",
            borderRadius: "8px",
            outline: "none",
          }}
        />
        {error && (
          <p style={{ margin: 0, fontSize: "12px", color: "#a3392f" }} role="alert">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={!password || submitting}
          style={{
            padding: "10px 16px",
            fontSize: "13px",
            fontWeight: 650,
            border: 0,
            borderRadius: "8px",
            background: "var(--ink, #161817)",
            color: "white",
            cursor: password && !submitting ? "pointer" : "default",
            opacity: password && !submitting ? 1 : 0.6,
          }}
        >
          {submitting ? "Checking…" : "Continue"}
        </button>
      </form>
    </main>
  );
}
