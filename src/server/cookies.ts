// Cookie policy in one place.
//
// These options were duplicated at eleven call sites, each re-deciding the
// `secure` flag from NODE_ENV. That made the policy impossible to change with
// confidence — and impossible to see. Now the shape lives here and the only
// input is whether the install is reached over TLS (see Config.cookies.secure).

export type CookieOptions = {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax" | "strict";
  path: string;
  maxAge: number;
  signed?: boolean;
};

const SEVEN_DAYS_IN_SECONDS = 7 * 24 * 60 * 60;
const TEN_MINUTES_IN_SECONDS = 10 * 60;

/** The signed-in session cookie. Lives a week. */
export function sessionCookieOptions(secure: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: SEVEN_DAYS_IN_SECONDS,
  };
}

/** The OAuth CSRF state cookie. Short-lived: it only spans one redirect. */
export function oauthStateCookieOptions(secure: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: TEN_MINUTES_IN_SECONDS,
  };
}

/**
 * Carries a freshly minted API key to the one page that reveals it. Signed so
 * it cannot be forged, `strict` so it never rides along on a cross-site
 * navigation, and short-lived because it exists for a single render.
 */
export function oneTimeSecretCookieOptions(
  secure: boolean,
  maxAge: number,
): CookieOptions {
  return {
    signed: true,
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: "/",
    maxAge,
  };
}
