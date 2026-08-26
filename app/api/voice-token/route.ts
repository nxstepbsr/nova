import { NextResponse } from "next/server";

/**
 * Mints a short-lived OpenAI Realtime client secret so the browser can open
 * a WebRTC session directly with OpenAI, without ever seeing OPENAI_API_KEY.
 *
 * The realtime session itself only captures the user's spoken request via
 * its update_site tool (see app/page.tsx) — deciding *what* to change still
 * goes through /api/edit (Claude), same as a typed prompt. This route only
 * sets model + voice at mint time; instructions and tools are sent over the
 * data channel via a session.update event once connected, per OpenAI's docs.
 */

export const runtime = "nodejs";

const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime-2.1";

export async function POST() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OPENAI_API_KEY is not configured." }, { status: 503 });
  }

  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: REALTIME_MODEL,
          audio: { output: { voice: "marin" } },
        },
      }),
    });
  } catch (error) {
    console.error("[/api/voice-token]", error);
    return NextResponse.json({ error: "Could not reach OpenAI." }, { status: 502 });
  }

  if (!response.ok) {
    console.error("[/api/voice-token]", response.status, await response.text());
    return NextResponse.json({ error: "Could not create a realtime session." }, { status: 502 });
  }

  const data = (await response.json()) as { value?: string };
  if (!data.value) {
    return NextResponse.json({ error: "No client secret in the response." }, { status: 502 });
  }

  return NextResponse.json({ value: data.value });
}
