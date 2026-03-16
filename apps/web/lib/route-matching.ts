export const PUBLIC_PATHS = [
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/invite",
  "/api/auth",
];

/** Auth pages that authenticated users should be redirected away from. */
export const AUTH_ONLY_PATHS = [
  "/login",
  "/signup",
  "/forgot-password",
];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

export function isAuthOnlyPath(pathname: string): boolean {
  return AUTH_ONLY_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}
