import https from "https";
import { logger } from "@/utils/logger";
import { sleep } from "@/utils/utils";

const cache = new Map<string, { latitude: number; longitude: number } | null>();

async function geocode(query: string) {
  if (!query.trim()) {
    return null;
  }

  const cacheKey = query.trim().toLowerCase();

  if (cache.has(cacheKey)) {
    logger.debug(`Geocode cache hit: "${query}"`);
    return cache.get(cacheKey)!;
  }

  logger.debug(`Geocode query: "${query}"`);

  const encoded = encodeURIComponent(query.trim());

  const url =
    `https://nominatim.openstreetmap.org/search` +
    `?q=${encoded}` +
    `&format=json` +
    `&limit=1` +
    `&countrycodes=in`;

  const result = await new Promise<{
    latitude: number;
    longitude: number;
  } | null>((resolve) => {
    https
      .get(
        url,
        {
          headers: {
            "User-Agent": "FlatAndFlatmateApp/1.0",
          },
        },
        (response) => {
          let body = "";

          response.on("data", (chunk) => {
            body += chunk;
          });

          response.on("end", () => {
            try {
              const data = JSON.parse(body);

              if (Array.isArray(data) && data.length > 0) {
                resolve({
                  latitude: parseFloat(data[0].lat),

                  longitude: parseFloat(data[0].lon),
                });
              } else {
                resolve(null);
              }
            } catch {
              resolve(null);
            }
          });
        },
      )
      .on("error", () => {
        resolve(null);
      });
  });

  cache.set(cacheKey, result);

  if (result) {
    logger.debug(`Geocode result: [${result.longitude}, ${result.latitude}]`);
  } else {
    logger.debug(`Geocode: no results for "${query}"`);
  }

  await sleep(1100);

  return result;
}

export async function resolveCoordinates(listing: {
  address?: string;
  locality: string;
  city: string;
}) {
  const attempts: string[] = [];
  const address = listing.address?.trim();
  const locality = listing.locality?.trim();
  const city = listing.city?.trim();

  if (address && locality && address.toLowerCase() !== locality.toLowerCase()) {
    attempts.push(`${address}, ${locality}, ${city}, India`);
    attempts.push(`${address}, ${city}, India`);
  } else if (address) {
    attempts.push(`${address}, ${city}, India`);
  }

  if (locality) {
    attempts.push(`${locality}, ${city}, India`);
  }

  if (city) {
    attempts.push(`${city}, India`);
  }

  // Deduplicate queries while preserving order
  const uniqueAttempts: string[] = [];
  const seen = new Set<string>();

  for (const query of attempts) {
    const key = query.toLowerCase().trim();
    if (!seen.has(key)) {
      seen.add(key);
      uniqueAttempts.push(query);
    }
  }

  logger.debug(`Geocode attempts (${uniqueAttempts.length}): ${uniqueAttempts.join(" | ")}`);

  for (const query of uniqueAttempts) {
    const coordinates = await geocode(query);

    if (coordinates) {
      return coordinates;
    }
  }

  return null;
}
