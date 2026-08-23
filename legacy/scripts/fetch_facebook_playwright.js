const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
 
// Load config.json
const configPath = path.join(__dirname, '../config.json');
let config = {};
if (fs.existsSync(configPath)) {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
}
 
const facebookGroups = config.facebookGroups || ["1223846759040286"];
const pagesToScroll = config.facebookPages || 50;
 
// Extraction logic, reused every scroll iteration (kept as a string-free function
// so it can run inside page.evaluate())
async function extractPostsFromPage(page) {
  return page.evaluate(() => {
    const messageNodes = Array.from(document.querySelectorAll('div[data-ad-preview="message"], div[data-testid="post_message"]'));
    const extracted = [];
    const seenTexts = new Set();
 
    messageNodes.forEach((messageEl) => {
      let postText = messageEl.innerText ? messageEl.innerText.trim() : "";
      postText = postText.replace(/\s*(See more|See More|See less|See Less|आणखी पहा|और देखें|कमी दाखवा|कम दिखाएं)$/gi, '').trim();
      if (!postText || seenTexts.has(postText)) return;
 
      let postContainer = messageEl.parentElement;
      for (let depth = 0; depth < 15; depth++) {
        if (!postContainer) break;
        const hasAuthor = postContainer.querySelector('a[href*="/user/"], a[href*="/groups/"], a[role="link"] strong, h2, h3');
        const hasPostLink = postContainer.querySelector('a[href*="/posts/"], a[href*="/permalink/"], a[href*="/multi_permalink/"]');
        if (hasAuthor && hasPostLink) break;
        postContainer = postContainer.parentElement;
      }
      if (!postContainer) postContainer = messageEl.parentElement;
 
      let postUrl = "";
      let postId = "fb_" + Math.random().toString(36).substr(2, 9);
      const postLink = postContainer.querySelector('a[href*="/posts/"], a[href*="/permalink/"], a[href*="/multi_permalink/"], a[href*="?__cft__"]');
      if (postLink) {
        postUrl = postLink.href;
        const match = postUrl.match(/\/(posts|permalink|multi_permalink)\/(\d+)/);
        if (match && match[2]) {
          postId = match[2];
        } else {
          const photoLink = postContainer.querySelector('a[href*="set="]');
          if (photoLink) {
            const setMatch = photoLink.href.match(/set=(pcb|gm)\.(\d+)/);
            if (setMatch && setMatch[2]) postId = setMatch[2];
          }
        }
      }
 
      seenTexts.add(postText);
 
      let author = "Anonymous participant";
      let authorProfileUrl = "";
      const userLinks = Array.from(postContainer.querySelectorAll('a[href*="/user/"], a[href*="profile.php"], a[href*="/profile/"]'));
      const nameLink = userLinks.find(link => {
        const text = link.innerText ? link.innerText.trim() : "";
        return text.length > 0 && !link.querySelector('svg') && !link.querySelector('img');
      });
 
      if (nameLink) {
        author = nameLink.innerText.trim().split('\n')[0];
        authorProfileUrl = nameLink.href;
      } else {
        const fallbackHeaderLink = postContainer.querySelector('h2 a, h3 a');
        if (fallbackHeaderLink && fallbackHeaderLink.innerText) {
          author = fallbackHeaderLink.innerText.trim().split('\n')[0];
          authorProfileUrl = fallbackHeaderLink.href;
        }
      }
 
      const images = Array.from(postContainer.querySelectorAll('img[src*="fbcdn"]'))
        .map(img => img.src)
        .filter(src => !src.includes('/rsrc.php/') && !src.includes('/emoji.php/'));
 
      const comments = [];
      const commentElements = postContainer.querySelectorAll('ul > li div[role="article"]');
      commentElements.forEach(commentEl => {
        const commentAuthorLink = commentEl.querySelector('a[role="link"], span[style*="font-weight: 600"]');
        const commentTextEl = commentEl.querySelector('div[dir="auto"]');
        if (commentAuthorLink && commentTextEl) {
          comments.push({
            author: commentAuthorLink.innerText.trim(),
            text: commentTextEl.innerText.trim()
          });
        }
      });
 
      extracted.push({
        postId, author, authorProfileUrl, text: postText,
        timestamp: new Date().toISOString(),
        reactions: 0, comments: comments.length, shares: 0,
        postUrl, imageUrls: images, videoUrl: "",
        totalImages: images.length,
        postType: images.length > 0 ? "image" : "text",
        scrapedAt: new Date().toISOString(),
        topComments: comments
      });
    });
 
    // FALLBACK: role="article" nodes when no messageNodes matched at all
    if (extracted.length === 0) {
      const articleNodes = Array.from(document.querySelectorAll('div[role="article"]'));
      articleNodes.forEach((node) => {
        const parentArticle = node.parentElement ? node.parentElement.closest('div[role="article"]') : null;
        if (parentArticle !== null) return;
 
        const textElements = Array.from(node.querySelectorAll('div[dir="auto"]'));
        let postText = "";
        let longestLen = 0;
        textElements.forEach(el => {
          const t = el.innerText ? el.innerText.trim() : "";
          if (t.length > longestLen && !t.includes("Join group") && !t.includes("Members") && !t.includes("Like") && !t.includes("Comment")) {
            postText = t;
            longestLen = t.length;
          }
        });
 
        if (!postText || postText.length < 30) return;
 
        let author = "Anonymous participant";
        const authorEl = node.querySelector('h2 strong a, h3 strong a, a[role="link"] strong, a[role="link"] span');
        if (authorEl) author = authorEl.innerText.trim();
 
        let postUrl = "";
        let postId = "fb_" + Math.random().toString(36).substr(2, 9);
        const linkEl = node.querySelector('a[href*="/posts/"], a[href*="/permalink/"]');
        if (linkEl) {
          postUrl = linkEl.href;
          const match = postUrl.match(/\/(posts|permalink)\/(\d+)/);
          if (match && match[2]) postId = match[2];
        }
 
        const images = Array.from(node.querySelectorAll('img[src*="fbcdn"]'))
          .map(img => img.src)
          .filter(src => !src.includes('/rsrc.php/') && !src.includes('/emoji.php/'));
 
        extracted.push({
          postId, author, authorProfileUrl: "", text: postText,
          timestamp: new Date().toISOString(),
          reactions: 0, comments: 0, shares: 0,
          postUrl, imageUrls: images, videoUrl: "",
          totalImages: images.length,
          postType: images.length > 0 ? "image" : "text",
          scrapedAt: new Date().toISOString(),
          topComments: []
        });
      });
    }
 
    return extracted;
  });
}
 
async function run() {
  const cookiesPath = path.join(__dirname, 'facebook_cookies.txt');
  if (!fs.existsSync(cookiesPath)) {
    console.error(`Error: Cookies file not found at ${cookiesPath}`);
    console.log("Please create scripts/facebook_cookies.txt containing your browser cookies JSON.");
    process.exit(1);
  }
 
  console.log(`Loading session cookies from: ${cookiesPath}`);
  const rawCookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf8'));
 
  const mappedCookies = rawCookies.map(cookie => {
    let sameSite = undefined;
    const sameSiteLower = (cookie.sameSite || '').toLowerCase();
    if (sameSiteLower === 'no_restriction' || sameSiteLower === 'none') {
      sameSite = 'None';
    } else if (sameSiteLower === 'lax') {
      sameSite = 'Lax';
    } else if (sameSiteLower === 'strict') {
      sameSite = 'Strict';
    }
 
    return {
      name: cookie.name,
      value: decodeURIComponent(cookie.value),
      domain: cookie.domain.startsWith('.') ? cookie.domain : `.${cookie.domain}`,
      path: cookie.path || '/',
      expires: cookie.expirationDate ? Math.round(cookie.expirationDate) : undefined,
      httpOnly: cookie.httpOnly || false,
      secure: cookie.secure || false,
      sameSite: sameSite
    };
  });
 
  console.log("Launching headless browser...");
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-notifications', '--no-sandbox']
  });
 
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 }
  });
 
  console.log("Injecting session cookies into browser context...");
  await context.addCookies(mappedCookies);
 
  const allGroupPosts = {};
 
  for (const groupId of facebookGroups) {
    const url = `https://www.facebook.com/groups/${groupId}/`;
    console.log(`\nNavigating to Facebook Group: ${url}`);
 
    const page = await context.newPage();
 
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
    } catch (e) {
      console.log("Timeout waiting for network idle. Continuing after a 10s static sleep...");
      await page.waitForTimeout(10000);
    }
 
    if (page.url().includes('login')) {
      console.error("Error: Redirected to login page. Your cookies might be expired or invalid.");
      await page.screenshot({ path: path.join(__dirname, '../data/facebook_login_redirect.png') });
      console.log("Saved redirect screenshot to: data/facebook_login_redirect.png");
      await page.close();
      continue;
    }
 
    console.log(`Successfully loaded group page. Scrolling + extracting incrementally (${pagesToScroll} passes)...`);
 
    // Incremental extraction: collect posts after EVERY scroll, not just at the end.
    // Facebook virtualizes/unmounts posts that scroll out of view, so a single
    // extraction pass after all scrolling only sees whatever is left on screen.
    const seenPostIds = new Set();
    const groupPosts = [];
 
    for (let scroll = 0; scroll < pagesToScroll; scroll++) {
      console.log(`Scroll ${scroll + 1}/${pagesToScroll}`);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(4000);
 
      // Expand "See more" on whatever is currently rendered before extracting
      try {
        const seeMoreLocators = page.locator([
          'div:text("See more")', 'div:text("See More")', 'div:text("आणखी पहा")', 'div:text("और देखें")',
          'span:text("See more")', 'span:text("See More")', 'span:text("आणखी पहा")', 'span:text("और देखें")'
        ].join(', '));
        const count = await seeMoreLocators.count();
        for (let i = 0; i < count; i++) {
          try {
            const locator = seeMoreLocators.nth(i);
            await locator.scrollIntoViewIfNeeded({ timeout: 1500 });
            await locator.click({ force: true, timeout: 2000 });
          } catch (e) {
            // ignore individual click failures, keep going
          }
        }
        if (count > 0) await page.waitForTimeout(1000);
      } catch (err) {
        // non-fatal
      }
 
      const postsNow = await extractPostsFromPage(page);
      let newCount = 0;
      for (const post of postsNow) {
        if (!seenPostIds.has(post.postId)) {
          seenPostIds.add(post.postId);
          groupPosts.push(post);
          newCount++;
        }
      }
      console.log(`  -> ${postsNow.length} posts visible, ${newCount} new (total so far: ${groupPosts.length})`);
    }
 
    // Debug artifacts from final scroll position
    const debugScreenshotPath = path.join(__dirname, '../data/facebook_page_screenshot.png');
    const debugHtmlPath = path.join(__dirname, '../data/facebook_page_rendered.html');
    await page.screenshot({ path: debugScreenshotPath });
    fs.writeFileSync(debugHtmlPath, await page.content(), 'utf8');
    console.log(`Debug screenshot saved to: ${debugScreenshotPath}`);
    console.log(`Debug HTML saved to: ${debugHtmlPath}`);
 
    console.log(`Successfully scraped ${groupPosts.length} unique posts for group ${groupId}.`);
    allGroupPosts[groupId] = groupPosts;
    await page.close();
  }
 
  await browser.close();
 
  const dataDir = path.join(__dirname, '../data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
 
  const outputPath = path.join(dataDir, 'raw_facebook_posts.json');
  fs.writeFileSync(outputPath, JSON.stringify(allGroupPosts, null, 2), 'utf8');
  console.log(`Saved scraped Facebook posts JSON database to: ${outputPath}`);
}
 
run().catch(err => {
  console.error("Playwright scraping execution failed:", err);
});
 