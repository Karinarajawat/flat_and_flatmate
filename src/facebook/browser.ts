import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

import { config } from "@/config/scrapping";

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

const loadFacebookCookies = async () => {
  const cookiesPath = path.resolve(config.facebook.cookiesPath);

  try {
    const raw = await fs.readFile(cookiesPath, "utf8");

    return JSON.parse(raw) as FacebookCookie[];
  } catch {
    throw new Error(`Facebook cookies file not found: ${cookiesPath}`);
  }
};

const mapCookies = (cookies: FacebookCookie[]) => {
  return cookies.map((cookie) => {
    const sameSiteLower = cookie.sameSite?.toLowerCase() ?? "";

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

export const createFacebookBrowser = async (): Promise<{
  browser: Browser;
  context: BrowserContext;
}> => {
  const cookies = await loadFacebookCookies();

  console.log("Launching Facebook browser...");

  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-notifications", "--no-sandbox"],
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/120.0.0.0 Safari/537.36",

    viewport: {
      width: 1280,
      height: 800,
    },
  });

  console.log("Injecting Facebook cookies...");

  await context.addCookies(mapCookies(cookies));

  return {
    browser,
    context,
  };
};

export const navigateToFacebookGroup = async (
  page: Page,
  groupId: string,
): Promise<boolean> => {
  const url = `https://www.facebook.com/groups/${groupId}/`;

  console.log(`Navigating to Facebook group: ${url}`);

  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
  } catch {
    console.log(
      "Facebook navigation timed out. " + "Waiting before continuing...",
    );

    await page.waitForTimeout(10_000);
  }

  if (page.url().includes("login")) {
    return false;
  }

  return true;
};

export const scrollFacebookPage = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
  });

  await page.waitForTimeout(4_000);
};

export const expandSeeMore = async (page: Page): Promise<void> => {
  try {
    // 1. Expand via fast in-page DOM clicks across all matching role="button" and text nodes
    await page.evaluate(() => {
      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>(
          'div[role="button"], span[role="button"], div[dir="auto"], span[dir="auto"]',
        ),
      );

      for (const el of candidates) {
        const text = el.textContent?.trim() || "";
        if (
          /^(See more|See More|और देखें|आणखी पहा|Ver más|Mais)$/i.test(text) ||
          /(?:…|\.\.\.)\s*(?:See more|See More|और देखें|आणखी पहा)$/i.test(text)
        ) {
          try {
            el.click();
          } catch {
            // Ignore individual click errors
          }
        }
      }
    });

    await page.waitForTimeout(1_000);
  } catch {
    // Non-fatal.
  }
};

export const hydrateFacebookPostLinks = async (page: Page): Promise<void> => {
  try {
    // Find all post timestamp anchors in viewport and hover them to trigger dynamic URL hydration
    const boxes = await page.evaluate(() => {
      const anchors = Array.from(
        document.querySelectorAll<HTMLAnchorElement>(
          'a[href*="__tn__=%2CO%2CP-R"], a[href*="__tn__=%2CmH-R"], a[href*="__tn__=-R"]',
        ),
      );

      return anchors.map((a) => {
        const rect = a.getBoundingClientRect();
        return {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          visible:
            rect.width > 0 &&
            rect.height > 0 &&
            rect.top >= -150 &&
            rect.bottom <= window.innerHeight + 150,
        };
      });
    });

    for (const box of boxes) {
      if (box.visible) {
        await page.mouse.move(box.x, box.y);
        await page.waitForTimeout(60);
      }
    }
  } catch {
    // Non-fatal.
  }
};
