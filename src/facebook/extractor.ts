import type { Page } from "playwright";
import type { FacebookPost } from "@/types/post";

export const extractFacebookPosts = async (
  page: Page,
  groupId: string,
): Promise<FacebookPost[]> => {
  // NOTE: no named functions inside page.evaluate — esbuild keepNames
  // breaks serialization. Inline arrow callbacks only.
  const posts = await page.evaluate((groupId) => {
    const messageNodes = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-ad-rendering-role="story_message"], ' +
          'div[data-ad-preview="message"], ' +
          'div[data-testid="post_message"]',
      ),
    );

    const extracted: FacebookPost[] = [];
    const seenTexts = new Set<string>();

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

      // Post card scope: nearest article, else climb to the feed-level
      // child so author/URL/images resolve from the whole post card,
      // not just the message body.
      let postContainer: HTMLElement | null =
        messageEl.closest('[role="article"]') as HTMLElement | null;

      if (!postContainer) {
        postContainer = messageEl.parentElement;

        for (
          let depth = 0;
          depth < 10 && postContainer?.parentElement;
          depth++
        ) {
          if (postContainer.parentElement.getAttribute("role") === "feed") {
            break;
          }

          postContainer = postContainer.parentElement;
        }
      }

      if (!postContainer) {
        return;
      }

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

      const containerHtml = postContainer.outerHTML || "";

      let hash = 0;
      const textToHash = postText.slice(0, 100);
      for (let i = 0; i < textToHash.length; i++) {
        hash = (hash << 5) - hash + textToHash.charCodeAt(i);
        hash |= 0;
      }
      const fallbackId = "fb_" + Math.abs(hash).toString(36);

      // Post identity: /posts/|permalink|, set=pcb., story_fbid/fbid,
      // /reel/, /stories/ (base64 token holds the fbid), /watch/?v=,
      // opaque /share/r|v|p/ links.
      let resolvedId: string | null = null;
      let resolvedUrl = "";

      for (const href of validHrefs) {
        const pm1 = href.match(/\/(?:posts|permalink|multi_permalink)\/(\d+)/);
        const pm2 = pm1 ? null : href.match(/set=(?:pcb|gm|a)\.(\d+)/);
        const pm3 =
          pm1 || pm2 ? null : href.match(/(?:story_fbid|fbid)=(\d+)/);
        const pmid = pm1?.[1] ?? pm2?.[1] ?? pm3?.[1] ?? null;
        if (pmid) {
          resolvedId = pmid;
          resolvedUrl = `https://www.facebook.com/groups/${groupId}/posts/${pmid}`;
          break;
        }
      }

      if (!resolvedId) {
        const pm1 = containerHtml.match(
          /\/(?:posts|permalink|multi_permalink)\/(\d+)/,
        );
        const pm2 = pm1 ? null : containerHtml.match(/set=(?:pcb|gm|a)\.(\d+)/);
        const pm3 =
          pm1 || pm2 ? null : containerHtml.match(/(?:story_fbid|fbid)=(\d+)/);
        const pmid = pm1?.[1] ?? pm2?.[1] ?? pm3?.[1] ?? null;
        if (pmid) {
          resolvedId = pmid;
          resolvedUrl = `https://www.facebook.com/groups/${groupId}/posts/${pmid}`;
        }
      }

      // Reels have no /posts/ link — the /reel/<mediaId>/ IS the id.
      if (!resolvedId) {
        for (const href of validHrefs) {
          const rm = href.match(/\/reel\/(\d+)/);
          if (rm?.[1]) {
            resolvedId = rm[1];
            resolvedUrl = `https://www.facebook.com/reel/${rm[1]}/`;
            break;
          }
        }
        if (!resolvedId) {
          const rm = containerHtml.match(/\/reel\/(\d+)/);
          if (rm?.[1]) {
            resolvedId = rm[1];
            resolvedUrl = `https://www.facebook.com/reel/${rm[1]}/`;
          }
        }
      }

      // Marketplace cross-posts: /commerce/listing/<id>/ (stable id;
      // strip media_id query so photo variants share one postUrl).
      if (!resolvedId) {
        for (const href of validHrefs) {
          const cm = href.match(/\/commerce\/listing\/(\d+)/);
          if (cm?.[1]) {
            resolvedId = cm[1];
            resolvedUrl = `https://www.facebook.com/commerce/listing/${cm[1]}/`;
            break;
          }
        }
        if (!resolvedId) {
          const cm = containerHtml.match(/\/commerce\/listing\/(\d+)/);
          if (cm?.[1]) {
            resolvedId = cm[1];
            resolvedUrl = `https://www.facebook.com/commerce/listing/${cm[1]}/`;
          }
        }
      }

      // Stories: /stories/<uid>/<token>/, token decodes to S:_I_C:<fbid>.
      if (!resolvedId) {
        const storySources = [...validHrefs];
        const shm = containerHtml.match(/\/stories\/(\d+)\/[^/?#\s"']+/);
        if (shm?.[0]) storySources.push(shm[0]);
        for (const href of storySources) {
          const sm = href.match(/\/stories\/(\d+)\/([^/?#]+)/);
          if (!sm) continue;
          const suid = sm[1];
          let stoken = sm[2];
          try {
            stoken = decodeURIComponent(stoken);
          } catch {
            // keep raw token
          }
          const sraw = href.split("?")[0];
          const sabs = sraw.startsWith("http")
            ? sraw
            : `https://www.facebook.com${sraw.startsWith("/") ? "" : "/"}${sraw}`;
          let sinner: string | null = null;
          try {
            const sdec = atob(stoken.replace(/-/g, "+").replace(/_/g, "/"));
            const sdm = sdec.match(/(\d{6,})/);
            if (sdm?.[1]) sinner = sdm[1];
          } catch {
            sinner = null;
          }
          if (sinner) {
            resolvedId = sinner;
            resolvedUrl = sabs;
            break;
          }
          let shash = 0;
          for (let i = 0; i < stoken.length; i++) {
            shash = (shash << 5) - shash + stoken.charCodeAt(i);
            shash |= 0;
          }
          resolvedId = `st_${suid}_${Math.abs(shash).toString(36)}`;
          resolvedUrl = sabs;
          break;
        }
      }

      // Watch: /watch/?v=<id>
      if (!resolvedId) {
        for (const href of validHrefs) {
          const wm = href.match(/\/watch\/?\?(?:[^#]*?&)?v=(\d+)/);
          if (wm?.[1]) {
            resolvedId = wm[1];
            resolvedUrl = `https://www.facebook.com/watch/?v=${wm[1]}`;
            break;
          }
        }
      }

      // Opaque share links: /share/r|v|p/<token>/ (token is per-post stable).
      if (!resolvedId) {
        for (const href of validHrefs) {
          const shm2 = href.match(/\/share\/([rvp])\/([A-Za-z0-9_-]+)/);
          if (shm2?.[1] && shm2?.[2]) {
            resolvedId = `sh_${shm2[2]}`;
            resolvedUrl = `https://www.facebook.com/share/${shm2[1]}/${shm2[2]}/`;
            break;
          }
        }
      }

      const postId = resolvedId || fallbackId;
      const postUrl = resolvedUrl;

      seenTexts.add(postText);

      let author = "Anonymous participant";

      const profileName = postContainer.querySelector<HTMLElement>(
        '[data-ad-rendering-role="profile_name"]',
      );
      if (profileName?.innerText) {
        author = profileName.innerText.trim().split("\n")[0];
      } else {
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
      }

      const images = Array.from(
        postContainer.querySelectorAll<HTMLImageElement>('img[src*="fbcdn"]'),
      )
        .map((img) => img.src)
        .filter(
          (src) => !src.includes("/rsrc.php/") && !src.includes("/emoji.php/"),
        );

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

    return extracted;
  }, groupId);

  if (posts.length === 0) {
    console.warn(
      `extractFacebookPosts: no posts for group ${groupId} — ` +
        "selectors may be stale (fallback path was removed).",
    );
  }

  return posts;
};
