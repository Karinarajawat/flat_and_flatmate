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
    const selectors = [
      'div:text("See more")',
      'div:text("See More")',
      'div:text("आणखी पहा")',
      'div:text("और देखें")',
      'span:text("See more")',
      'span:text("See More")',
      'span:text("आणखी पहा")',
      'span:text("और देखें")',
    ].join(", ");

    const locators = page.locator(selectors);

    const count = await locators.count();

    for (let i = 0; i < count; i++) {
      try {
        const locator = locators.nth(i);

        await locator.scrollIntoViewIfNeeded({
          timeout: 1_500,
        });

        await locator.click({
          force: true,
          timeout: 2_000,
        });
      } catch {
        // Ignore individual failures.
      }
    }

    if (count > 0) {
      await page.waitForTimeout(1_000);
    }
  } catch {
    // Non-fatal.
  }
};
