import fs from "node:fs/promises";
import path from "node:path";
import type { FacebookPost } from "@/types/post";
import type { BrowserContext } from "playwright";

import { config } from "@/config/scrapping";

import {
  createFacebookBrowser,
  expandSeeMore,
  hydrateFacebookPostLinks,
  navigateToFacebookGroup,
  scrollFacebookPage,
} from "./browser";

import { extractFacebookPosts } from "./extractor";

export const scrapeGroup = async (
  context: BrowserContext,
  groupId: string,
): Promise<FacebookPost[]> => {
  const page = await context.newPage();

  try {
    console.log(`\nScraping Facebook group: ${groupId}`);

    const loaded = await navigateToFacebookGroup(page, groupId);

    if (!loaded) {
      console.error(
        `Failed to load Facebook group ${groupId}. ` +
          "Cookies may be expired.",
      );

      return [];
    }

    console.log(
      `Successfully loaded group page. ` +
        `Scrolling + extracting incrementally ` +
        `(${config.facebook.pagesToScroll} passes)...`,
    );

    const seenPostIds = new Set<string>();
    const groupPosts: FacebookPost[] = [];

    for (let scroll = 0; scroll < config.facebook.pagesToScroll; scroll++) {
      console.log(`Scroll ${scroll + 1}/` + `${config.facebook.pagesToScroll}`);

      // ----------------------------------------------------------
      // Scroll
      // ----------------------------------------------------------

      await scrollFacebookPage(page);

      // ----------------------------------------------------------
      // Expand "See more"
      // ----------------------------------------------------------

      await expandSeeMore(page);

      // ----------------------------------------------------------
      // Hydrate post links
      // ----------------------------------------------------------

      await hydrateFacebookPostLinks(page);

      // ----------------------------------------------------------
      // Extract currently visible posts
      // ----------------------------------------------------------

      const postsNow = await extractFacebookPosts(page, groupId);

      let newCount = 0;

      for (const post of postsNow) {
        if (seenPostIds.has(post.postId)) {
          continue;
        }

        seenPostIds.add(post.postId);
        groupPosts.push(post);
        newCount++;
      }

      console.log(
        `  -> ${postsNow.length} posts visible, ` +
          `${newCount} new ` +
          `(total so far: ${groupPosts.length})`,
      );
    }

    console.log(
      `Successfully scraped ${groupPosts.length} ` +
        `unique posts for group ${groupId}.`,
    );

    return groupPosts;
  } finally {
    await page.close();
  }
};

export const scrapeFacebook = async (): Promise<FacebookPost[]> => {
  const { browser, context } = await createFacebookBrowser();

  try {
    const allPosts: FacebookPost[] = [];

    for (const groupId of config.facebook.groups) {
      const groupPosts = await scrapeGroup(context, groupId);

      allPosts.push(...groupPosts);
    }

    return allPosts;
  } finally {
    await browser.close();
  }
};
