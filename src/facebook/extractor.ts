import type { Page } from "playwright";
import type { FacebookPost } from "@/types/post";

export const extractFacebookPosts = async (
  page: Page,
  groupId: string,
): Promise<FacebookPost[]> => {
  return page.evaluate((groupId) => {
    const messageNodes = Array.from(
      document.querySelectorAll<HTMLElement>(
        'div[data-ad-preview="message"], div[data-testid="post_message"]',
      ),
    );

    const extracted: FacebookPost[] = [];
    const seenTexts = new Set<string>();

    // ------------------------------------------------------------
    // PRIMARY EXTRACTION
    // ------------------------------------------------------------

    messageNodes.forEach((messageEl) => {
      let postText = messageEl.innerText ? messageEl.innerText.trim() : "";

      postText = postText
        .replace(
          /\s*(See more|See More|See less|See Less|आणखी पहा|और देखें|कमी दाखवा|कम दिखाएं)$/gi,
          "",
        )
        .trim();

      if (!postText || seenTexts.has(postText)) {
        return;
      }

      // ----------------------------------------------------------
      // Find post container
      // ----------------------------------------------------------

      let postContainer: HTMLElement | null = messageEl.parentElement;

      for (let depth = 0; depth < 15; depth++) {
        if (!postContainer) {
          break;
        }

        const hasAuthor = postContainer.querySelector(
          'a[href*="/user/"], ' +
            'a[href*="/groups/"], ' +
            'a[role="link"] strong, ' +
            "h2, h3",
        );

        const hasPostLink = postContainer.querySelector(
          'a[href*="/posts/"], ' +
            'a[href*="/permalink/"], ' +
            'a[href*="/multi_permalink/"]',
        );

        if (hasAuthor && hasPostLink) {
          break;
        }

        postContainer = postContainer.parentElement;
      }

      if (!postContainer) {
        postContainer = messageEl.parentElement;
      }

      if (!postContainer) {
        return;
      }

      // ----------------------------------------------------------
      // Post URL + ID
      // ----------------------------------------------------------

      let postUrl = "";
      let postId = "fb_" + Math.random().toString(36).slice(2, 11);

      const postLink = postContainer.querySelector<HTMLAnchorElement>(
        'a[href*="/posts/"], ' +
          'a[href*="/permalink/"], ' +
          'a[href*="/multi_permalink/"], ' +
          'a[href*="?__cft__"]',
      );

      if (postLink) {
        postUrl = postLink.href;

        const match = postUrl.match(
          /\/(posts|permalink|multi_permalink)\/(\d+)/,
        );

        if (match?.[2]) {
          postId = match[2];
        } else {
          const photoLink =
            postContainer.querySelector<HTMLAnchorElement>('a[href*="set="]');

          if (photoLink) {
            const setMatch = photoLink.href.match(/set=(pcb|gm)\.(\d+)/);

            if (setMatch?.[2]) {
              postId = setMatch[2];
            }
          }
        }
      }

      seenTexts.add(postText);

      // ----------------------------------------------------------
      // Author
      // ----------------------------------------------------------

      let author = "Anonymous participant";

      const userLinks = Array.from(
        postContainer.querySelectorAll<HTMLAnchorElement>(
          'a[href*="/user/"], ' +
            'a[href*="profile.php"], ' +
            'a[href*="/profile/"]',
        ),
      );

      const nameLink = userLinks.find((link) => {
        const text = link.innerText ? link.innerText.trim() : "";

        return (
          text.length > 0 &&
          !link.querySelector("svg") &&
          !link.querySelector("img")
        );
      });

      if (nameLink) {
        author = nameLink.innerText.trim().split("\n")[0];
      } else {
        const fallbackHeaderLink =
          postContainer.querySelector<HTMLAnchorElement>("h2 a, h3 a");

        if (fallbackHeaderLink && fallbackHeaderLink.innerText) {
          author = fallbackHeaderLink.innerText.trim().split("\n")[0];
        }
      }

      // ----------------------------------------------------------
      // Images
      // ----------------------------------------------------------

      const images = Array.from(
        postContainer.querySelectorAll<HTMLImageElement>('img[src*="fbcdn"]'),
      )
        .map((img) => img.src)
        .filter(
          (src) => !src.includes("/rsrc.php/") && !src.includes("/emoji.php/"),
        );

      // ----------------------------------------------------------
      // Normalized FacebookPost
      // ----------------------------------------------------------

      extracted.push({
        platform: "facebook",
        postId,
        author,
        content: postText,
        timestamp: new Date().toISOString(),
        postUrl,
        imageUrls: images.length > 0 ? images : undefined,
        groupId,
      });
    });

    // ------------------------------------------------------------
    // FALLBACK: role="article"
    // ------------------------------------------------------------

    if (extracted.length === 0) {
      const articleNodes = Array.from(
        document.querySelectorAll<HTMLDivElement>('div[role="article"]'),
      );

      articleNodes.forEach((node) => {
        const parentArticle = node.parentElement
          ? node.parentElement.closest('div[role="article"]')
          : null;

        if (parentArticle !== null) {
          return;
        }

        const textElements = Array.from(
          node.querySelectorAll<HTMLDivElement>('div[dir="auto"]'),
        );

        let postText = "";
        let longestLen = 0;

        textElements.forEach((el) => {
          const text = el.innerText ? el.innerText.trim() : "";

          if (
            text.length > longestLen &&
            !text.includes("Join group") &&
            !text.includes("Members") &&
            !text.includes("Like") &&
            !text.includes("Comment")
          ) {
            postText = text;
            longestLen = text.length;
          }
        });

        if (!postText || postText.length < 30) {
          return;
        }

        postText = postText
          .replace(
            /\s*(See more|See More|See less|See Less|आणखी पहा|और देखें|कमी दाखवा|कम दिखाएं)$/gi,
            "",
          )
          .trim();

        if (!postText || seenTexts.has(postText)) {
          return;
        }

        // ----------------------------------------------------------
        // Author
        // ----------------------------------------------------------

        let author = "Anonymous participant";

        const authorEl = node.querySelector<HTMLElement>(
          "h2 strong a, " +
            "h3 strong a, " +
            'a[role="link"] strong, ' +
            'a[role="link"] span',
        );

        if (authorEl) {
          author = authorEl.innerText.trim();
        }

        // ----------------------------------------------------------
        // URL + ID
        // ----------------------------------------------------------

        let postUrl = "";
        let postId = "fb_" + Math.random().toString(36).slice(2, 11);

        const linkEl = node.querySelector<HTMLAnchorElement>(
          'a[href*="/posts/"], ' +
            'a[href*="/permalink/"], ' +
            'a[href*="/multi_permalink/"]',
        );

        if (linkEl) {
          postUrl = linkEl.href;

          const match = postUrl.match(
            /\/(posts|permalink|multi_permalink)\/(\d+)/,
          );

          if (match?.[2]) {
            postId = match[2];
          } else {
            const photoLink =
              node.querySelector<HTMLAnchorElement>('a[href*="set="]');

            if (photoLink) {
              const setMatch = photoLink.href.match(/set=(pcb|gm)\.(\d+)/);

              if (setMatch?.[2]) {
                postId = setMatch[2];
              }
            }
          }
        }

        // ----------------------------------------------------------
        // Images
        // ----------------------------------------------------------

        const images = Array.from(
          node.querySelectorAll<HTMLImageElement>('img[src*="fbcdn"]'),
        )
          .map((img) => img.src)
          .filter(
            (src) =>
              !src.includes("/rsrc.php/") && !src.includes("/emoji.php/"),
          );

        seenTexts.add(postText);

        extracted.push({
          platform: "facebook",
          postId,
          author,
          content: postText,
          timestamp: new Date().toISOString(),
          postUrl,
          imageUrls: images.length > 0 ? images : undefined,
          groupId,
        });
      });
    }

    return extracted;
  }, groupId);
};
