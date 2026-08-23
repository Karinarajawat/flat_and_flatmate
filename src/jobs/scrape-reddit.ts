import { config as scrapingConfig } from "@/config/scrapping";
import { RedditClient } from "@/reddit/client";
import { scrapeSubreddit } from "@/reddit/scraper";
import { writeNormData, writeRawData } from "@/storage/storage";

const main = async () => {
  const jobTimestamp = Date.now();

  const redditClient = new RedditClient();

  for (const subreddit of scrapingConfig.reddit.subreddits) {
    const result = await scrapeSubreddit(redditClient, subreddit);

    const filename = `reddit-${subreddit}-${jobTimestamp}`;

    const rawOutputPath = await writeRawData(filename, result.rawPosts);

    const normOutputPath = await writeNormData(filename, result.posts);

    console.log(`Fetched ${result.posts.length} posts for r/${subreddit}.`);

    console.log(`Raw:  ${rawOutputPath}`);
    console.log(`Norm: ${normOutputPath}`);
  }

  console.log("\nReddit scraping complete.");
};

main().catch((error) => {
  console.error(
    "Reddit scraping job failed:",
    error instanceof Error ? error.message : String(error),
  );

  process.exit(1);
});
