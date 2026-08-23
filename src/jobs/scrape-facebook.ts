import { config as scrapingConfig } from "@/config/scrapping";
import { createFacebookBrowser } from "@/facebook/browser";
import { scrapeGroup } from "@/facebook/scraper";
import { writeNormData } from "@/storage/storage";

const main = async () => {
  const jobTimestamp = Date.now();

  const { browser, context } = await createFacebookBrowser();
  try {
    for (const groupId of scrapingConfig.facebook.groups) {
      const result = await scrapeGroup(context, groupId);

      const filename = `facebook-${groupId}-${jobTimestamp}`;

      const normOutputPath = await writeNormData(filename, result);

      console.log(`Fetched ${result.length} posts for fb-${groupId}.`);

      console.log(`Norm: ${normOutputPath}`);
    }

    console.log("\nFacebook scraping complete.");
  } finally {
    await browser.close();
  }
};

main().catch((error) => {
  console.error(
    "Facebook scraping job failed:",
    error instanceof Error ? error.message : String(error),
  );

  process.exit(1);
});
