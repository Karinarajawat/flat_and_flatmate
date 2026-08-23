import fs from "node:fs/promises";
import { chromium } from "playwright";

import { config } from "../config";
import { extractPosts } from "./extractor";
import type { FacebookPost } from "../types";

export class FacebookScraper {
  async scrape(): Promise<Record<string, FacebookPost[]>> {
    const browser = await chromium.launch({
      headless: true,
      args: ["--disable-notifications", "--no-sandbox"],
    });

    try {
      const context = await this.createContext(browser);

      const result: Record<string, FacebookPost[]> = {};

      for (const groupId of config.facebook.groups) {
        result[groupId] = await this.scrapeGroup(context, groupId);
      }

      await context.close();

      return result;
    } finally {
      await browser.close();
    }
  }

  private async createContext(browser: any) {
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

    const cookies = JSON.parse(
      await fs.readFile(config.facebook.cookiesPath, "utf8"),
    );

    await context.addCookies(
      cookies.map((cookie: any) => ({
        name: cookie.name,
        value: decodeURIComponent(cookie.value),
        domain: cookie.domain.startsWith(".")
          ? cookie.domain
          : `.${cookie.domain}`,
        path: cookie.path || "/",
        expires: cookie.expirationDate
          ? Math.round(cookie.expirationDate)
          : undefined,
        httpOnly: cookie.httpOnly ?? false,
        secure: cookie.secure ?? false,
        sameSite: this.normalizeSameSite(cookie.sameSite),
      })),
    );

    return context;
  }

  private normalizeSameSite(
    value?: string,
  ): "Strict" | "Lax" | "None" | undefined {
    switch (value?.toLowerCase()) {
      case "none":
      case "no_restriction":
        return "None";

      case "lax":
        return "Lax";

      case "strict":
        return "Strict";

      default:
        return undefined;
    }
  }

  private async scrapeGroup(
    context: any,
    groupId: string,
  ): Promise<FacebookPost[]> {
    const page = await context.newPage();

    try {
      const url = `https://www.facebook.com/groups/${groupId}/`;

      console.log(`Opening ${url}`);

      try {
        await page.goto(url, {
          waitUntil: "networkidle",
          timeout: 45_000,
        });
      } catch {
        console.log("Network idle timeout. Continuing...");

        await page.waitForTimeout(10_000);
      }

      if (page.url().includes("login")) {
        throw new Error(`Facebook session expired for group ${groupId}`);
      }

      const posts = new Map<string, FacebookPost>();

      for (let i = 0; i < config.facebook.pagesToScroll; i++) {
        console.log(`Scroll ${i + 1}/${config.facebook.pagesToScroll}`);

        await page.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
        });

        await page.waitForTimeout(4000);

        await this.expandSeeMore(page);

        const visiblePosts = await extractPosts(page, groupId);

        for (const post of visiblePosts) {
          posts.set(post.postId, post);
        }

        console.log(
          `Found ${visiblePosts.length} visible, ` +
            `${posts.size} unique total`,
        );
      }

      return [...posts.values()];
    } finally {
      await page.close();
    }
  }

  private async expandSeeMore(page: any) {
    try {
      const locator = page.locator(
        [
          'div:text("See more")',
          'div:text("See More")',
          'span:text("See more")',
          'span:text("See More")',
          'div:text("आणखी पहा")',
          'div:text("और देखें")',
        ].join(", "),
      );

      const count = await locator.count();

      for (let i = 0; i < count; i++) {
        try {
          const element = locator.nth(i);

          await element.scrollIntoViewIfNeeded({
            timeout: 1500,
          });

          await element.click({
            force: true,
            timeout: 2000,
          });
        } catch {
          // Individual "See more" failures are non-fatal.
        }
      }
    } catch {
      // Non-fatal.
    }
  }
}
