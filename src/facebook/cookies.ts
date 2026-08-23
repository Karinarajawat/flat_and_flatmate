import { config } from "@/config/scrapping";
import fs from "fs";

interface FacebookCookie {
  name: string;
  value: string;
  domain: string;
  path?: string;
  expirationDate?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
}

export const loadFacebookCookies = () => {
  const cookiesPath = config.facebook.cookiesPath;

  if (!fs.existsSync(cookiesPath)) {
    throw new Error(`Facebook cookies file not found: ${cookiesPath}`);
  }

  const cookies = JSON.parse(
    fs.readFileSync(cookiesPath, "utf8"),
  ) as FacebookCookie[];

  return cookies.map((cookie) => {
    const sameSiteLower = cookie.sameSite?.toLowerCase();

    let sameSite: "Strict" | "Lax" | "None" | undefined;

    if (sameSiteLower === "no_restriction" || sameSiteLower === "none") {
      sameSite = "None";
    } else if (sameSiteLower === "lax") {
      sameSite = "Lax";
    } else if (sameSiteLower === "strict") {
      sameSite = "Strict";
    }

    return {
      name: cookie.name,
      value: decodeURIComponent(cookie.value),
      domain: cookie.domain.startsWith(".")
        ? cookie.domain
        : `.${cookie.domain}`,
      path: cookie.path ?? "/",
      expires: cookie.expirationDate
        ? Math.round(cookie.expirationDate)
        : undefined,
      httpOnly: cookie.httpOnly ?? false,
      secure: cookie.secure ?? false,
      sameSite,
    };
  });
};
