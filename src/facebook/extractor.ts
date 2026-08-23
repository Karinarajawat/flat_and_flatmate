import type { Page } from "playwright";
import type { FacebookPost } from "../types";

export async function extractPosts(
  page: Page,
  groupId: string,
): Promise<FacebookPost[]> {
  return page.evaluate((groupId) => {
    const messageNodes = Array.from(
      document.querySelectorAll(
        'div[data-ad-preview="message"], div[data-testid="post_message"]',
      ),
    );

    const extracted: FacebookPost[] = [];
    const seenTexts = new Set<string>();

    for (const messageEl of messageNodes) {
      let text = (messageEl as HTMLElement).innerText?.trim() ?? "";

      text = text
        .replace(
          /\s*(See more|See More|आणखी पहा|और देखें|कमी दाखवा|कम दिखाएं)$/gi,
          "",
        )
        .trim();

      if (!text || seenTexts.has(text)) {
        continue;
      }

      const postContainer = findPostContainer(messageEl);

      if (!postContainer) {
        continue;
      }

      const postLink = postContainer.querySelector<HTMLAnchorElement>(
        'a[href*="/posts/"], a[href*="/permalink/"], a[href*="/multi_permalink/"]',
      );

      const postUrl = postLink?.href ?? "";

      const postId =
        extractPostId(postUrl) ??
        `fb_${Math.random().toString(36).slice(2, 11)}`;

      const authorData = extractAuthor(postContainer);

      const imageUrls = Array.from(
        postContainer.querySelectorAll<HTMLImageElement>('img[src*="fbcdn"]'),
      )
        .map((img) => img.src)
        .filter(
          (src) => !src.includes("/rsrc.php/") && !src.includes("/emoji.php/"),
        );

      const comments = extractComments(postContainer);

      seenTexts.add(text);

      extracted.push({
        platform: "facebook",
        groupId,

        postId,
        author: authorData.name,
        authorProfileUrl: authorData.url,

        text,

        timestamp: new Date().toISOString(),
        scrapedAt: new Date().toISOString(),

        postUrl,

        reactions: 0,
        comments: comments.length,
        shares: 0,

        imageUrls,
        videoUrl: undefined,

        totalImages: imageUrls.length,

        postType: imageUrls.length > 0 ? "image" : "text",

        topComments: comments,
      });
    }

    return extracted;

    // Helper functions must live inside evaluate()
    // because they execute in the browser.
    function findPostContainer(element: Element): Element | null {
      let current: Element | null = element.parentElement;

      for (let depth = 0; depth < 15; depth++) {
        if (!current) break;

        const hasAuthor = current.querySelector(
          'a[href*="/user/"], a[href*="/groups/"], a[role="link"] strong, h2, h3',
        );

        const hasPostLink = current.querySelector(
          'a[href*="/posts/"], a[href*="/permalink/"], a[href*="/multi_permalink/"]',
        );

        if (hasAuthor && hasPostLink) {
          return current;
        }

        current = current.parentElement;
      }

      return element.parentElement;
    }

    function extractPostId(url: string): string | null {
      const match = url.match(/\/(posts|permalink|multi_permalink)\/(\d+)/);

      return match?.[2] ?? null;
    }

    function extractAuthor(container: Element) {
      const links = Array.from(
        container.querySelectorAll<HTMLAnchorElement>(
          'a[href*="/user/"], a[href*="profile.php"], a[href*="/profile/"]',
        ),
      );

      const link = links.find(
        (el) =>
          el.innerText?.trim() &&
          !el.querySelector("svg") &&
          !el.querySelector("img"),
      );

      return {
        name: link?.innerText?.trim().split("\n")[0] ?? "Anonymous participant",

        url: link?.href ?? "",
      };
    }

    function extractComments(container: Element) {
      const comments = [];

      const elements = container.querySelectorAll(
        'ul > li div[role="article"]',
      );

      for (const comment of elements) {
        const author = comment.querySelector<HTMLAnchorElement>(
          'a[role="link"], span[style*="font-weight: 600"]',
        );

        const text = comment.querySelector<HTMLDivElement>('div[dir="auto"]');

        if (author && text) {
          comments.push({
            author: author.innerText.trim(),
            text: text.innerText.trim(),
          });
        }
      }

      return comments;
    }
  }, groupId);
}
