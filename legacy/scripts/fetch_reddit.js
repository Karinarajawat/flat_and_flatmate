const https = require("https");
const fs = require("fs");
const path = require("path");

// Read config
const configPath = path.join(__dirname, "../config.json");
let config = {
  subreddits: ["flatmatesmumbai"],
  fetchLimit: 100,
  maxPostsPerSubreddit: 100,
  cookie: "",
  oauth: {
    clientId: "",
    clientSecret: "",
  },
};

if (fs.existsSync(configPath)) {
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (err) {
    console.error("Error reading config.json, using defaults:", err);
  }
}

const userAgent = "node:flat-sharing-etl:v1.0.0 (by /u/Kindly-Warning-2875)";
let accessToken = null;

// Authenticate using OAuth if credentials are provided
function getAccessToken() {
  return new Promise((resolve, reject) => {
    if (!config.oauth || !config.oauth.clientId || !config.oauth.clientSecret) {
      return resolve(null);
    }
    console.log("Authenticating with Reddit OAuth...");
    const auth = Buffer.from(
      `${config.oauth.clientId}:${config.oauth.clientSecret}`,
    ).toString("base64");

    const options = {
      hostname: "www.reddit.com",
      path: "/api/v1/access_token",
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": userAgent,
      },
      rejectUnauthorized: false,
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed.access_token || null);
          } catch (e) {
            reject(
              new Error("Failed to parse access token response: " + e.message),
            );
          }
        } else {
          reject(
            new Error(
              `OAuth authentication failed with status code ${res.statusCode}: ${data}`,
            ),
          );
        }
      });
    });

    req.on("error", (err) => reject(err));
    req.write("grant_type=client_credentials");
    req.end();
  });
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const headers = { "User-Agent": userAgent };

    if (config.cookie) {
      headers["Cookie"] = config.cookie;
    } else if (accessToken) {
      headers["Authorization"] = `Bearer ${accessToken}`;
    }

    const options = {
      headers: headers,
      rejectUnauthorized: false,
    };

    https
      .get(url, options, (res) => {
        // Log rate limit headers if present
        const remaining = res.headers["x-ratelimit-remaining"];
        const reset = res.headers["x-ratelimit-reset"];
        if (remaining !== undefined && reset !== undefined) {
          console.log(
            `Rate Limits -> Remaining: ${remaining}, Reset in: ${reset}s`,
          );
        }

        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve({ data: JSON.parse(data), headers: res.headers });
            } catch (e) {
              reject(new Error("Failed to parse JSON: " + e.message));
            }
          } else {
            reject(
              new Error(`Request failed with status code ${res.statusCode}`),
            );
          }
        });
      })
      .on("error", (err) => {
        reject(err);
      });
  });
}

async function fetchSubreddit(subreddit, limit, maxPosts) {
  let posts = [];
  let after = null;

  // Use OAuth endpoint if token is present, otherwise use public endpoint
  const host = accessToken ? "oauth.reddit.com" : "www.reddit.com";
  const baseUrl = `https://${host}/r/${subreddit}/new.json`;

  while (posts.length < maxPosts) {
    const currentLimit = Math.min(limit, maxPosts - posts.length);
    let url = `${baseUrl}?limit=${currentLimit}`;
    if (after) {
      url += `&after=${after}`;
    }

    console.log(`Fetching: ${url}`);
    try {
      const result = await fetchUrl(url);
      const children = result?.data?.data?.children || [];
      if (children.length === 0) {
        console.log(`No more posts found for r/${subreddit}.`);
        break;
      }

      posts.push(...children);
      after = result?.data?.data?.after;

      // Dynamic sleep if rate limit is running low
      const remaining = result?.headers?.["x-ratelimit-remaining"];
      const reset = result?.headers?.["x-ratelimit-reset"];
      if (remaining !== undefined && parseFloat(remaining) < 10) {
        const cooldown = (parseFloat(reset || 10) + 2) * 1000;
        console.log(
          `Warning: Rate limits remaining: ${remaining}. Cooling down for ${cooldown / 1000}s...`,
        );
        await new Promise((r) => setTimeout(r, cooldown));
      } else {
        await new Promise((r) => setTimeout(r, 3000));
      }

      if (!after) {
        break;
      }
    } catch (err) {
      console.error(`Error fetching r/${subreddit}:`, err.message);
      break;
    }
  }

  return posts;
}

async function main() {
  try {
    accessToken = await getAccessToken();
    if (accessToken) {
      console.log("Successfully authenticated using OAuth.");
    } else if (config.cookie) {
      console.log("Using browser Cookie session authentication.");
    } else {
      console.log(
        "No Cookie or OAuth credentials found. Running unauthenticated (may result in 403).",
      );
    }
  } catch (err) {
    console.error("Authentication setup failed:", err.message);
  }

  const allData = {};
  for (const sub of config.subreddits) {
    console.log(`Starting fetch for r/{sub}...`);
    const posts = await fetchSubreddit(
      sub,
      config.fetchLimit || 100,
      config.maxPostsPerSubreddit || 100,
    );
    allData[sub] = posts;
    console.log(`Fetched ${posts.length} posts for r/${sub}.\n`);
  }

  const dataDir = path.join(__dirname, "../data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const outputPath = path.join(dataDir, "raw_reddit_posts.json");
  fs.writeFileSync(outputPath, JSON.stringify(allData, null, 2), "utf8");
  console.log(`Successfully saved raw data to ${outputPath}`);
}

main();
