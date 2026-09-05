import { config as scrapingConfig } from "@/config/scrapping";
import { getListingType } from "@/parsing/heuristics";
import { RedditClient } from "@/reddit/client";
import { scrapeSubreddit } from "@/reddit/scraper";
import {
  writeAmbiguousData,
  writeNormData,
  writeNotHousingData,
  writeNotOfferingData,
  writeOfferingData,
  writeRawData,
} from "@/storage/storage";
import { RedditPost } from "@/types/post";

const main = async () => {
  const jobTimestamp = Date.now();

  const redditClient = new RedditClient();

  for (const subreddit of scrapingConfig.reddit.subreddits) {
    console.log(`\n--- Fetching r/${subreddit} ---`);
    const result = await scrapeSubreddit(redditClient, subreddit);

    const filename = `reddit-${subreddit}-${jobTimestamp}`;

    const rawOutputPath = await writeRawData(filename, result.rawPosts);
    const normOutputPath = await writeNormData(filename, result.posts);

    // Segregate posts subreddit-wise by classification
    const offeringPosts: RedditPost[] = [];
    const notOfferingPosts: RedditPost[] = [];
    const ambiguousPosts: RedditPost[] = [];
    const notHousingPosts: RedditPost[] = [];

    for (const post of result.posts) {
      const type = getListingType(post);
      switch (type) {
        case "offering_room":
          offeringPosts.push(post);
          break;
        case "seeking_room":
          notOfferingPosts.push(post);
          break;
        case "ambiguous":
          ambiguousPosts.push(post);
          break;
        case "not_housing":
          notHousingPosts.push(post);
          break;
      }
    }

    const offeringPath = await writeOfferingData(filename, offeringPosts);
    const notOfferingPath = await writeNotOfferingData(
      filename,
      notOfferingPosts,
    );
    const ambiguousPath = await writeAmbiguousData(filename, ambiguousPosts);
    const notHousingPath = await writeNotHousingData(
      filename,
      notHousingPosts,
    );

    console.log(`Fetched ${result.posts.length} posts for r/${subreddit}:`);
    console.log(`  Offering:     ${offeringPosts.length} -> ${offeringPath}`);
    console.log(`  Not Offering: ${notOfferingPosts.length} -> ${notOfferingPath}`);
    console.log(`  Ambiguous:    ${ambiguousPosts.length} -> ${ambiguousPath}`);
    console.log(`  Not Housing:  ${notHousingPosts.length} -> ${notHousingPath}`);
    console.log(`  Raw:          ${rawOutputPath}`);
    console.log(`  Norm:         ${normOutputPath}`);
  }

  console.log("\nReddit scraping and segregation complete.");
};

main().catch((error) => {
  console.error(
    "Reddit scraping job failed:",
    error instanceof Error ? error.message : String(error),
  );

  process.exit(1);
});
