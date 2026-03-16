import { NextResponse, type NextRequest } from "next/server";
import { isPublicPath, isAuthOnlyPath } from "./lib/route-matching";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Check for session cookie — BetterAuth sets "better-auth.session_token"
  // (or "__Secure-better-auth.session_token" in production)
  const sessionCookie =
    request.cookies.get("better-auth.session_token") ??
    request.cookies.get("__Secure-better-auth.session_token");

  // Redirect authenticated users away from login/signup/forgot-password
  if (sessionCookie && isAuthOnlyPath(pathname)) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // Allow public paths (includes auth pages for unauthenticated users)
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Unauthenticated users on protected pages → redirect to login
  if (!sessionCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Authenticated — allow through. Org resolution happens in the DAL layer
  // via getSession().session.activeOrganizationId, not via middleware cookies.
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all paths except static files and Next.js internals
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
