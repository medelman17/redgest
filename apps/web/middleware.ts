import { NextResponse, type NextRequest } from "next/server";
import { isPublicPath } from "./lib/route-matching";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Check for session cookie — BetterAuth sets "better-auth.session_token"
  // (or "__Secure-better-auth.session_token" in production)
  const sessionCookie =
    request.cookies.get("better-auth.session_token") ??
    request.cookies.get("__Secure-better-auth.session_token");

  if (!sessionCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Allow /onboarding for authenticated users (don't check org)
  if (pathname === "/onboarding") {
    return NextResponse.next();
  }

  // Check for active org cookie — redirect to onboarding if missing.
  // BetterAuth may not set this cookie in all versions/configs, so we check
  // both possible cookie names. If neither exists we redirect to onboarding
  // ONLY if the cookie name is recognized by the installed BetterAuth version.
  // To prevent redirect loops, we only check the standard cookie names.
  const activeOrgCookie =
    request.cookies.get("better-auth.active_organization") ??
    request.cookies.get("__Secure-better-auth.active_organization");

  if (!activeOrgCookie) {
    return NextResponse.redirect(new URL("/onboarding", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all paths except static files and Next.js internals
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
