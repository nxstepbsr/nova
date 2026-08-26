import { NextResponse, type NextRequest } from "next/server";

import { getPublishedSite } from "@/lib/publish";
import { renderSite } from "@/lib/site/render";

export const runtime = "nodejs";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const document = await getPublishedSite(id);

  if (!document) {
    return new NextResponse("Not found", { status: 404 });
  }

  return new NextResponse(renderSite(document), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
