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
          /\s*(?:…|\.\.\.)?\s*(See more|See More|See less|See Less|आणखी पहा|और देखें|कमी दाखवा|कम दिखाएं)$/gi,
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

      for (let depth = 0; depth < 20; depth++) {
        if (!postContainer || !postContainer.parentElement) {
          break;
        }

        if (
          postContainer.getAttribute("role") === "article" ||
          postContainer.parentElement.getAttribute("role") === "feed" ||
          postContainer.classList.contains("x1yztbdb")
        ) {
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

      let postIdFound: string | null = null;
      const anchors = Array.from(postContainer.querySelectorAll<HTMLAnchorElement>("a"));
      const validHrefs = anchors
        .map((a) => a.href)
        .filter(
          (href) =>
            Boolean(href) &&
            !href.includes("/emoji.php") &&
            !href.includes("/rsrc.php") &&
            !href.includes("/user/") &&
            !href.includes("profile.php") &&
            !href.includes("/profile/"),
        );

      for (const href of validHrefs) {
        const postMatch = href.match(/\/(?:posts|permalink|multi_permalink)\/(\d+)/);
        if (postMatch?.[1]) {
          postIdFound = postMatch[1];
          break;
        }
        const setMatch = href.match(/set=(?:pcb|gm|a)\.(\d+)/);
        if (setMatch?.[1]) {
          postIdFound = setMatch[1];
          break;
        }
        const storyMatch = href.match(/(?:story_fbid|fbid)=(\d+)/);
        if (storyMatch?.[1]) {
          postIdFound = storyMatch[1];
          break;
        }
      }

      if (!postIdFound) {
        const html = postContainer.outerHTML || "";
        const postMatch = html.match(/\/(?:posts|permalink|multi_permalink)\/(\d+)/);
        if (postMatch?.[1]) {
          postIdFound = postMatch[1];
        } else {
          const setMatch = html.match(/set=(?:pcb|gm|a)\.(\d+)/);
          if (setMatch?.[1]) {
            postIdFound = setMatch[1];
          } else {
            const storyMatch = html.match(/(?:story_fbid|fbid)=(\d+)/);
            if (storyMatch?.[1]) {
              postIdFound = storyMatch[1];
            }
          }
        }
      }

      let hash = 0;
      const textToHash = postText.slice(0, 100);
      for (let i = 0; i < textToHash.length; i++) {
        hash = (hash << 5) - hash + textToHash.charCodeAt(i);
        hash |= 0;
      }
      const fallbackId = "fb_" + Math.abs(hash).toString(36);

      const postId = postIdFound || fallbackId;
      const postUrl = postIdFound
        ? `https://www.facebook.com/groups/${groupId}/posts/${postIdFound}`
        : "";

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
          postContainer.querySelector<HTMLAnchorElement>("h2 a, h3 a, h4 a");

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
            /\s*(?:…|\.\.\.)?\s*(See more|See More|See less|See Less|आणखी पहा|और देखें|कमी दाखवा|कम दिखाएं)$/gi,
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
          author = authorEl.innerText.trim().split("\n")[0];
        }

        // ----------------------------------------------------------
        // URL + ID
        // ----------------------------------------------------------

        let postIdFound: string | null = null;
        const anchors = Array.from(node.querySelectorAll<HTMLAnchorElement>("a"));
        const validHrefs = anchors
          .map((a) => a.href)
          .filter(
            (href) =>
              Boolean(href) &&
              !href.includes("/emoji.php") &&
              !href.includes("/rsrc.php") &&
              !href.includes("/user/") &&
              !href.includes("profile.php") &&
              !href.includes("/profile/"),
          );

        for (const href of validHrefs) {
          const postMatch = href.match(/\/(?:posts|permalink|multi_permalink)\/(\d+)/);
          if (postMatch?.[1]) {
            postIdFound = postMatch[1];
            break;
          }
          const setMatch = href.match(/set=(?:pcb|gm|a)\.(\d+)/);
          if (setMatch?.[1]) {
            postIdFound = setMatch[1];
            break;
          }
          const storyMatch = href.match(/(?:story_fbid|fbid)=(\d+)/);
          if (storyMatch?.[1]) {
            postIdFound = storyMatch[1];
            break;
          }
        }

        if (!postIdFound) {
          const html = node.outerHTML || "";
          const postMatch = html.match(/\/(?:posts|permalink|multi_permalink)\/(\d+)/);
          if (postMatch?.[1]) {
            postIdFound = postMatch[1];
          } else {
            const setMatch = html.match(/set=(?:pcb|gm|a)\.(\d+)/);
            if (setMatch?.[1]) {
              postIdFound = setMatch[1];
            } else {
              const storyMatch = html.match(/(?:story_fbid|fbid)=(\d+)/);
              if (storyMatch?.[1]) {
                postIdFound = storyMatch[1];
              }
            }
          }
        }

        let hash = 0;
        const textToHash = postText.slice(0, 100);
        for (let i = 0; i < textToHash.length; i++) {
          hash = (hash << 5) - hash + textToHash.charCodeAt(i);
          hash |= 0;
        }
        const fallbackId = "fb_" + Math.abs(hash).toString(36);

        const postId = postIdFound || fallbackId;
        const postUrl = postIdFound
          ? `https://www.facebook.com/groups/${groupId}/posts/${postIdFound}`
          : "";

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
