import https from "https";

import {
  GeminiListingResponse,
  GeminiListingResponseSchema,
  GeminiListingResponseZodSchema,
  ListingDataFromGemeni,
  ValidGeminiListing,
} from "@/types/listing";

import { RawPost } from "@/types/post";
import { buildPrompt } from "@/config/prompts";
import { config } from "@/config/parsing";

export async function parseWithGemini(
  post: RawPost,
): Promise<GeminiListingResponse> {
  if (!config.gemini.api_key) {
    throw new Error("GEMINI_API_KEY is not defined");
  }

  const prompt = buildPrompt(post);

  const requestBody = {
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: GeminiListingResponseSchema,
    },
  };

  const rawResponse = await makeGeminiRequest(requestBody);
  const parsed = JSON.parse(rawResponse);

  const result = GeminiListingResponseZodSchema.safeParse(parsed);

  if (!result.success) {
    console.error("Invalid Gemini listing:", result.error.format());
    throw new Error("Gemini returned invalid listing data");
  }

  if (result.data.skip) {
    return {
      skip: true,
    };
  }

  return normalizeGeminiResponse(result.data, post);
}

function normalizeGeminiResponse(
  result: ValidGeminiListing,
  post: RawPost,
): GeminiListingResponse {
  const data: ListingDataFromGemeni = {
    ...result.data,
    available_from: undefined,
  };

  const now = new Date();

  if (result.data.available_from) {
    const parsedDate = new Date(result.data.available_from);

    if (Number.isNaN(parsedDate.getTime())) {
      delete data.available_from;
      data.available_immediately = data.available_immediately ?? true;
    } else {
      data.available_from = parsedDate;
      data.available_immediately = parsedDate <= now;
    }
  } else {
    data.available_immediately = true;
  }

  return {
    skip: false,
    data,
    lister: {
      ...result.lister,
      name: result.lister?.name || post.author,
      life_style: result.lister?.life_style ?? [],
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function makeGeminiRequest(body: unknown): Promise<string> {
  for (let attempt = 0; attempt <= config.gemini.max_retry_count; attempt++) {
    try {
      return await makeGeminiRequestOnce(body);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      const isRateLimited = message.includes("Gemini API 429");

      if (!isRateLimited || attempt === config.gemini.max_retry_count) {
        throw error;
      }

      const delay = config.gemini.base_delay * (attempt + 1);

      await sleep(delay);
    }
  }

  throw new Error("Gemini request failed");
}

function makeGeminiRequestOnce(body: unknown): Promise<string> {
  return new Promise((resolve, reject) => {
    const url =
      `https://generativelanguage.googleapis.com/` +
      `v1beta/models/gemini-3.5-flash-lite:generateContent` +
      `?key=${config.gemini.api_key}`;

    const payload = JSON.stringify(body);

    const request = https.request(
      url,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (response) => {
        let responseBody = "";

        response.on("data", (chunk) => {
          responseBody += chunk;
        });

        response.on("end", () => {
          if (
            response.statusCode &&
            response.statusCode >= 200 &&
            response.statusCode < 300
          ) {
            try {
              const parsed = JSON.parse(responseBody);

              const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;

              if (!text) {
                reject(new Error("Gemini returned no content"));
                return;
              }

              resolve(text);
            } catch (error) {
              reject(
                new Error(
                  `Invalid Gemini response: ${(error as Error).message}`,
                ),
              );
            }

            return;
          }

          reject(
            new Error(`Gemini API ${response.statusCode}: ${responseBody}`),
          );
        });
      },
    );

    request.on("error", reject);

    request.write(payload);
    request.end();
  });
}
