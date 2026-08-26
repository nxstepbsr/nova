import { NextResponse, type NextRequest } from "next/server";

import { publishSite } from "@/lib/publish";
import { validateDocument, type SiteDocument } from "@/lib/site/schema";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let body: { document?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const issues = validateDocument(body.document);
  if (issues.length > 0) {
    return NextResponse.json({ error: "Invalid document." }, { status: 400 });
  }

  let id: string;
  try {
    id = await publishSite(body.document as SiteDocument);
  } catch (error) {
    console.error("[/api/publish]", error);
    return NextResponse.json({ error: "Could not publish." }, { status: 502 });
  }

  const url = new URL(`/p/${id}`, request.url).toString();
  return NextResponse.json({ id, url });
}
