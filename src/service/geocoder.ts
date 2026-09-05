import https from "https";

const cache = new Map<string, { latitude: number; longitude: number } | null>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function geocode(query: string) {
  if (!query.trim()) {
    return null;
  }

  const cacheKey = query.trim().toLowerCase();

  if (cache.has(cacheKey)) {
    return cache.get(cacheKey)!;
  }

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

  await sleep(1100);

  return result;
}

export async function resolveCoordinates(listing: {
  address?: string;
  locality: string;
  city: string;
}) {
  const attempts: string[] = [];

  if (listing.address) {
    attempts.push(
      `${listing.address}, ${listing.locality}, ${listing.city}, India`,
    );
  }

  if (listing.locality) {
    attempts.push(`${listing.locality}, ${listing.city}, India`);
  }

  if (listing.city) {
    attempts.push(`${listing.city}, India`);
  }

  for (const query of attempts) {
    const coordinates = await geocode(query);

    if (coordinates) {
      return coordinates;
    }
  }

  return null;
}
