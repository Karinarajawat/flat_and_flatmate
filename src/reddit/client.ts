import https from "https";

import { config } from "@/config/scrapping";
import { REDDIT_API_HOST, REDDIT_USER_AGENT } from "@/config/constants";
import { logger } from "@/utils/logger";
import { sleep } from "@/utils/utils";

import type { RedditHttpResponse } from "@/types/reddit";

export class RedditClient {
  async get<T>(requestPath: string): Promise<RedditHttpResponse<T>> {
    let attempt = 0;

    while (true) {
      try {
        return await this.makeRequest<T>(requestPath);
      } catch (error) {
        attempt++;

        if (attempt > config.reddit.maxRetries) {
          throw error;
        }

        logger.warn(
          `Reddit request failed. Retrying ${attempt}/${config.reddit.maxRetries}...`,
        );

        await sleep(config.reddit.retryDelayMs);
      }
    }
  }

  private makeRequest<T>(requestPath: string): Promise<RedditHttpResponse<T>> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {
        "User-Agent": REDDIT_USER_AGENT,
      };

      if (config.reddit.cookie) {
        headers.Cookie = config.reddit.cookie;
      }

      logger.debug(`GET ${requestPath}`);

      const request = https.get(
        {
          hostname: REDDIT_API_HOST,
          path: requestPath,
          method: "GET",
          headers,

          // This matches your working script.
          rejectUnauthorized: false,
        },
        (response) => {
          const remaining = response.headers["x-ratelimit-remaining"];

          const reset = response.headers["x-ratelimit-reset"];

          if (remaining !== undefined && reset !== undefined) {
            logger.debug(
              `Rate Limits -> Remaining: ${remaining}, Reset in: ${reset}s`,
            );
          }

          let data = "";

          response.setEncoding("utf8");

          response.on("data", (chunk) => {
            data += chunk;
          });

          response.on("end", () => {
            const statusCode = response.statusCode ?? 0;

            if (statusCode >= 200 && statusCode < 300) {
              try {
                resolve({
                  data: JSON.parse(data),
                  headers: response.headers,
                  statusCode,
                });
              } catch (error) {
                reject(
                  new Error(
                    `Failed to parse Reddit JSON: ${
                      error instanceof Error ? error.message : String(error)
                    }`,
                  ),
                );
              }

              return;
            }

            reject(
              new Error(
                `Reddit request failed with status ${statusCode}: ${data}`,
              ),
            );
          });
        },
      );

      request.on("error", reject);
    });
  }

  async waitForRateLimit(
    headers: Record<string, string | string[] | undefined>,
  ): Promise<void> {
    const remaining = headers["x-ratelimit-remaining"];

    const reset = headers["x-ratelimit-reset"];

    if (
      remaining !== undefined &&
      parseFloat(String(remaining)) < config.reddit.rateLimitThreshold
    ) {
      const cooldown =
        (parseFloat(String(reset ?? 10)) +
          config.reddit.rateLimitBufferSeconds) *
        1000;

      logger.warn(
        `Rate limits remaining: ${remaining}. Cooling down for ${cooldown / 1000}s...`,
      );

      await sleep(cooldown);
      return;
    }

    await sleep(config.reddit.requestDelayMs);
  }
}
