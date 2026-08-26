import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

const PUBLIC_PATHS = ["/login", "/api/login"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Published sites are meant to be publicly shareable — this gate protects
  // the studio itself, not sites people publish out of it.
  if (pathname.startsWith("/p/") || PUBLIC_PATHS.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  const password = process.env.APP_PASSWORD;
  if (!password) {
    // Unlike every other integration in this app, auth must fail CLOSED,
    // not open — "not configured" here must never silently mean "no gate
    // at all". Set APP_PASSWORD (see .env.example) to use the app at all.
    return new NextResponse(
      "Auth isn't configured. Set APP_PASSWORD in .env.local (see .env.example) and restart.",
      { status: 500 },
    );
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (await verifySessionToken(token, password)) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
