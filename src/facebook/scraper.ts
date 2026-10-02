import type { FacebookPost } from "@/types/post";
import type { BrowserContext, Page } from "playwright";

import { config } from "@/config/scrapping";

import {
  expandSeeMore,
  navigateToFacebookGroup,
  revisitFacebookFeed,
  scrollFacebookPage,
} from "./browser";

import { extractFacebookPosts } from "./extractor";
import { createMergeState, mergePost, type PostMergeState } from "./merge";

interface FeedPassResult {
  visible: number;
  added: number;
  updated: number;
}

// One expand + extract + merge cycle, shared by the scroll loop and the
// revisit pass so the two can't drift apart.
export const runFeedPass = async (
  page: Page,
  groupId: string,
  mergeState: PostMergeState,
): Promise<FeedPassResult> => {
  await expandSeeMore(page);

  const postsNow = await extractFacebookPosts(page, groupId);

  let added = 0;
  let updated = 0;

  for (const post of postsNow) {
    const outcome = mergePost(mergeState, post);
    if (outcome === "new") added++;
    else if (outcome === "updated") updated++;
  }

  return { visible: postsNow.length, added, updated };
};

export const scrapeGroup = async (
  context: BrowserContext,
  groupId: string,
): Promise<FacebookPost[]> => {
  const page = await context.newPage();

  try {
    console.log(`\nScraping Facebook group: ${groupId}`);

    if (!(await navigateToFacebookGroup(page, groupId))) {
      console.error(
        `Failed to load Facebook group ${groupId}. Cookies may be expired.`,
      );
      return [];
    }

    console.log(
      `Loaded group page. Scrolling + extracting ` +
        `(${config.facebook.pagesToScroll} passes)...`,
    );

    const mergeState = createMergeState();

    for (let scroll = 0; scroll < config.facebook.pagesToScroll; scroll++) {
      await scrollFacebookPage(page);

      const pass = await runFeedPass(page, groupId, mergeState);

      console.log(
        `Scroll ${scroll + 1}/${config.facebook.pagesToScroll} -> ` +
          `${pass.visible} visible, ${pass.added} new ` +
          `(total: ${mergeState.posts.length})`,
      );
    }

    // Revisit pass: re-render full post chrome, backfill resolved URLs.
    await revisitFacebookFeed(page);

    const revisit = await runFeedPass(page, groupId, mergeState);

    console.log(
      `Revisit -> ${revisit.visible} visible, ` +
        `${revisit.added} new, ${revisit.updated} updated ` +
        `(total: ${mergeState.posts.length})`,
    );

    return mergeState.posts;
  } finally {
    await page.close();
  }
};
