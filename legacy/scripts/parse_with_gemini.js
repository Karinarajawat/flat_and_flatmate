const fs = require("fs");
const path = require("path");
const https = require("https");

// Load environment variables from scripts/.env
const envPath = path.join(__dirname, ".env");
let geminiApiKey = "";
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8");
  const match = envContent.match(/GEMINI_API_KEY\s*=\s*(.*)/);
  if (match) {
    geminiApiKey = match[1].trim();
  }
}

// Simple in-memory cache so repeated localities in the same run only geocode once
const geocodeCache = new Map();

/**
 * Geocode an address string using OpenStreetMap's free Nominatim API.
 * Returns { latitude, longitude } or null if it can't be resolved.
 * Respects Nominatim's usage policy: custom User-Agent + max 1 req/sec.
 */
function geocodeAddress(query) {
  return new Promise((resolve) => {
    if (!query || !query.trim()) {
      resolve(null);
      return;
    }

    const cacheKey = query.trim().toLowerCase();
    if (geocodeCache.has(cacheKey)) {
      resolve(geocodeCache.get(cacheKey));
      return;
    }

    const encoded = encodeURIComponent(query.trim());
    const url = `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=1&countrycodes=in`;

    const options = {
      headers: {
        // Nominatim requires a descriptive User-Agent identifying your app
        "User-Agent":
          "FlatAndFlatmateApp/1.0 (contact: karina.rajawat1101@gmail.com)",
      },
    };

    https
      .get(url, options, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            const results = JSON.parse(body);
            if (Array.isArray(results) && results.length > 0) {
              const result = {
                latitude: parseFloat(results[0].lat),
                longitude: parseFloat(results[0].lon),
              };
              geocodeCache.set(cacheKey, result);
              resolve(result);
            } else {
              geocodeCache.set(cacheKey, null);
              resolve(null);
            }
          } catch (e) {
            console.warn(
              `[Geocode] Failed to parse response for "${query}":`,
              e.message,
            );
            resolve(null);
          }
        });
      })
      .on("error", (err) => {
        console.warn(`[Geocode] Request failed for "${query}":`, err.message);
        resolve(null);
      });
  });
}

// Nominatim's usage policy caps requests at 1/sec — this helper sleeps between calls
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Try geocoding with progressively broader queries: full address -> locality+city -> city.
 * This gives locality-level or city-level coordinates as a fallback when the
 * exact address can't be resolved (common for informal Reddit descriptions).
 */
async function resolveCoordinates(listing) {
  const attempts = [];
  if (listing.address)
    attempts.push(`${listing.address}, ${listing.city || ""}, India`);
  if (listing.locality)
    attempts.push(`${listing.locality}, ${listing.city || ""}, India`);
  if (listing.city) attempts.push(`${listing.city}, India`);

  for (const query of attempts) {
    const result = await geocodeAddress(query);
    await sleep(1100); // stay under Nominatim's 1 req/sec limit
    if (result) {
      return result;
    }
  }
  return null;
}

// Extract all available images/attachments
function extractImages(postData) {
  const images = [];

  if (postData.url && /\.(jpg|jpeg|png|gif|webp)$/i.test(postData.url)) {
    images.push(postData.url);
  }

  if (postData.media_metadata) {
    for (const key in postData.media_metadata) {
      const item = postData.media_metadata[key];
      if (
        item.status === "valid" &&
        (item.e === "Image" || item.e === "AnimatedImage")
      ) {
        let imgUrl = item.s?.u || item.s?.gif;
        if (imgUrl) {
          imgUrl = imgUrl.replace(/&amp;/g, "&");
          images.push(imgUrl);
        }
      }
    }
  }

  if (images.length === 0 && postData.preview?.images) {
    for (const img of postData.preview.images) {
      let imgUrl = img.source?.url;
      if (imgUrl) {
        imgUrl = imgUrl.replace(/&amp;/g, "&");
        images.push(imgUrl);
      }
    }
  }

  if (
    images.length === 0 &&
    postData.crosspost_parent_list &&
    postData.crosspost_parent_list.length > 0
  ) {
    const parentImages = extractImages(postData.crosspost_parent_list[0]);
    images.push(...parentImages);
  }

  return [...new Set(images)];
}

// Rule-based heuristic parsers
function extractListingType(title, text) {
  const combined = `${title} ${text}`.toLowerCase();

  const seekingKeywords = [
    "looking for",
    "seeking",
    "need a flat",
    "need a room",
    "finding a",
    "looking to move",
    "looking for pg",
    "want a flatmate",
  ];
  const offeringKeywords = [
    "available",
    "room available",
    "flatmate needed",
    "vacancy",
    "1bhk for rent",
    "2bhk for rent",
    "pg available",
    "offering",
  ];

  let seekingScore = 0;
  let offeringScore = 0;

  seekingKeywords.forEach((kw) => {
    if (combined.includes(kw)) seekingScore++;
  });
  offeringKeywords.forEach((kw) => {
    if (combined.includes(kw)) offeringScore++;
  });

  if (seekingScore > offeringScore) return "seeking_room";
  if (offeringScore > seekingScore) return "offering_room";

  if (/looking/i.test(title)) return "seeking_room";
  if (/available/i.test(title)) return "offering_room";

  return "seeking_room";
}

function extractBudget(title, text) {
  const combined = `${title} ${text}`.toLowerCase();

  const budgetRegexes = [
    /budget(?:\s+\w+){0,3}\s+(\d{1,3}(?:,\d{3})*(?:\s*k)?)/gi,
    /rent(?:\s+\w+){0,3}\s+(\d{1,3}(?:,\d{3})*(?:\s*k)?)/gi,
    /(\d{1,3}(?:,\d{3})*(?:\s*k)?)\s*(?:per month|\/month|pm)/gi,
    /around\s+(\d{1,3}(?:,\d{3})*(?:\s*k)?)/gi,
  ];

  for (const regex of budgetRegexes) {
    const match = regex.exec(combined);
    if (match) {
      let rawVal = match[1].replace(/,/g, "");
      if (rawVal.endsWith("k")) {
        return parseInt(rawVal.slice(0, -1)) * 1000;
      }
      const parsedVal = parseInt(rawVal);
      if (parsedVal > 1000 && parsedVal < 500000) {
        return parsedVal;
      }
    }
  }

  const simpleMatch = combined.match(/\b\d{5}\b/);
  if (simpleMatch) {
    return parseInt(simpleMatch[0]);
  }

  return null;
}

function extractGenderPreference(title, text) {
  const combined = `${title} ${text}`.toLowerCase();

  const malePatterns = [
    /\b(m|male|boy|boys|gents?|guy|guys)\b/i,
    /\b\d{2}m\b/i,
  ];
  const femalePatterns = [
    /\b(f|female|girl|girls|ladies?|lady)\b/i,
    /\b\d{2}f\b/i,
  ];

  let maleMatch = malePatterns.some((p) => p.test(combined));
  let femaleMatch = femalePatterns.some((p) => p.test(combined));

  if (maleMatch && femaleMatch) return "any";
  if (maleMatch) return "male";
  if (femaleMatch) return "female";
  return "any";
}

function extractLocation(title, text) {
  const combined = `${title} ${text}`.toLowerCase();

  const commonAreas = [
    "powai",
    "bandra",
    "andheri",
    "juhu",
    "chembur",
    "khar",
    "santacruz",
    "goregaon",
    "malad",
    "borivali",
    "mulund",
    "thane",
    "worli",
    "dadar",
    "colaba",
  ];

  for (const area of commonAreas) {
    if (combined.includes(area)) {
      return area.charAt(0).toUpperCase() + area.slice(1);
    }
  }

  const locRegex = /\b(?:in|at|near)\s+([a-z]{3,15})\b/gi;
  let match;
  while ((match = locRegex.exec(combined)) !== null) {
    const candidate = match[1];
    if (
      ![
        "the",
        "our",
        "new",
        "any",
        "my",
        "flat",
        "room",
        "budget",
        "good",
      ].includes(candidate)
    ) {
      return candidate.charAt(0).toUpperCase() + candidate.slice(1);
    }
  }

  return null;
}

function extractOccupancy(title, text) {
  const combined = `${title} ${text}`.toLowerCase();
  if (combined.includes("single")) return "single";
  if (combined.includes("double") || combined.includes("sharing"))
    return "double";
  if (combined.includes("triple")) return "triple";
  if (combined.includes("pg")) return "pg";
  if (combined.includes("1bhk")) return "1bhk";
  if (combined.includes("2bhk")) return "2bhk";
  return "flatmate";
}

const responseSchema = {
  type: "object",

  properties: {
    title: {
      type: "string",
      description:
        "Concise, app-friendly title for the listing. Do not copy the social media post title verbatim. Describe the available room/property, locality, city, and important preference when useful. Keep it short, ideally under 60 characters.",
    },

    images: {
      type: "array",
      items: {
        type: "string",
      },
      description: "URLs of listing images found in the source post.",
    },

    cover_image: {
      type: "string",
      description: "URL of the primary listing image, if available.",
    },

    carpet_area: {
      type: "number",
      description: "Carpet area in square feet, if available.",
    },

    status: {
      type: "string",
      enum: ["active", "rented", "draft", "expired"],
      description: "Listing status. Use active for newly extracted listings.",
    },

    city: {
      type: "string",
      enum: ["mumbai", "pune", "bangalore", "hyderabad"],
    },

    locality: {
      type: "string",
      description: "Locality or neighborhood where the property is located.",
    },

    address: {
      type: "string",
      description:
        "Most specific property address that can be determined from the listing.",
    },

    gender_preference: {
      type: "string",
      enum: ["male", "female"],
    },

    bhk: {
      type: "string",
      enum: ["1RK", "1BHK", "2BHK", "3BHK"],
    },

    occupancy: {
      type: "string",
      enum: ["single", "double", "triple"],
    },

    total_occupancy: {
      type: "number",
      description:
        "Total number of people occupying the flat/property. Infer when the listing clearly provides enough information.",
    },

    furnished_status: {
      type: "string",
      enum: ["unfurnished", "semi-furnished", "fully-furnished"],
    },

    floor: {
      type: "number",
      description: "Floor number, if available.",
    },

    add_ons: {
      type: "array",
      description:
        "Appliances, furniture, room/home features, utilities, or services included with or available for the listing.",
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: [
              "Air Conditioning",
              "Refrigerator",
              "Washing Machine",
              "Microwave",
              "Oven",
              "Dishwasher",
              "TV",
              "Modular Kitchen",
              "Gas Stove",
              "Chimney",
              "Water Purifier",
              "WiFi",
              "Fiber Internet",
              "Attached Bathroom",
              "Balcony",
              "Private Terrace",
              "Walk-in Closet",
              "Furniture",
              "Cook",
              "Maid",
              "Housekeeping",
              "Laundry",
              "Others",
            ],
          },

          desc: {
            type: "string",
            description:
              "Additional details such as cost, sharing arrangement, quantity, or specific item description.",
          },
        },
        required: ["type"],
      },
    },

    amenities: {
      type: "array",
      description:
        "Building, society, security, parking, and common-area facilities.",
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: [
              "Clubhouse",
              "Swimming Pool",
              "Gym",
              "Garden",
              "Sports Facilities",
              "Indoor Games",
              "Jogging Track",
              "24x7 Security",
              "CCTV",
              "Security Guard",
              "Gated Community",
              "Intercom",
              "Lift",
              "Power Backup",
              "Water Supply",
              "Gas Pipeline",
              "Car Parking",
              "Bike Parking",
              "Visitor Parking",
              "Covered Parking",
              "EV Charging",
              "Pet Area",
              "Others",
            ],
          },

          desc: {
            type: "string",
            description: "Additional details about the amenity, if applicable.",
          },
        },
        required: ["type"],
      },
    },

    house_rules: {
      type: "array",
      description:
        "Rules or restrictions governing behavior and living arrangements.",
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: [
              "No Smoking",
              "No Alcohol",
              "Vegetarian Only",
              "Non-Vegetarian Allowed",
              "No Cooking",
              "Guests Allowed",
              "No Overnight Guests",
              "No Parties",
              "No Pets",
              "Pets Allowed",
              "No Loud Music",
              "No Loud Noise",
              "No Subletting",
              "Couples Only",
              "Students Only",
              "Working Professionals Only",
              "Others",
            ],
          },

          desc: {
            type: "string",
            description: "Additional details about the rule.",
          },
        },
        required: ["type"],
      },
    },

    neighborhood: {
      type: "array",
      description:
        "Nearby transportation or points of interest mentioned in the listing.",
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["Railway Station", "Metro"],
          },

          distance: {
            type: "number",
            description: "Approximate distance from the property in meters.",
          },
        },
        required: ["type", "distance"],
      },
    },

    rent: {
      type: "number",
      description: "Monthly rent in INR.",
    },

    deposit: {
      type: "number",
      description: "Security deposit in INR, if available.",
    },

    brokerage: {
      type: "number",
      description: "Brokerage amount in INR, if available.",
    },

    setup_cost: {
      type: "number",
      description:
        "One-time additional cost for furniture, furnishing, setup, moving-in, etc., in INR.",
    },

    available_from: {
      type: "string",
      description:
        "Date from which the property is available. Use ISO 8601 format when available.",
    },

    available_immediately: {
      type: "boolean",
      description:
        "Whether the listing indicates that the property is available immediately.",
    },

    external_listing: {
      type: "object",
      description:
        "Information about the external source from which this listing was extracted.",
      properties: {
        source: {
          type: "string",
          enum: ["app", "facebook", "reddit"],
          description: "Platform where the listing was originally posted.",
        },

        url: {
          type: "string",
          description: "URL of the original listing/post.",
        },

        lister: {
          type: "object",
          description: "Information about the person who posted the listing.",
          properties: {
            name: {
              type: "string",
              description:
                "Name or username of the person who posted the listing.",
            },

            age: {
              type: "number",
              description: "Age of the lister, if explicitly available.",
            },

            profile_pic: {
              type: "string",
              description: "Profile picture URL of the lister, if available.",
            },

            contact_number: {
              type: "string",
              description: "Contact phone number of the lister, if available.",
            },

            life_style: {
              type: "array",
              items: {
                type: "string",
              },
              description:
                "Lifestyle information explicitly stated about the lister.",
            },
          },

          required: ["name"],
        },
      },

      required: ["source", "url", "lister"],
    },
  },

  required: [
    "title",
    "images",
    "status",
    "city",
    "locality",
    "address",
    "gender_preference",
    "bhk",
    "occupancy",
    "furnished_status",
    "add_ons",
    "amenities",
    "house_rules",
    "neighborhood",
    "rent",
    "available_immediately",
    "external_listing",
  ],
};

function callGeminiAPI(postContent, postContext) {
  return new Promise((resolve, reject) => {
    if (!geminiApiKey) {
      reject(new Error("GEMINI_API_KEY is not defined"));
      return;
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${geminiApiKey}`;

    const requestBody = {
      contents: [
        {
          parts: [
            {
              text: `
                You are an expert flat-share listing parser and normalizer.

                Analyze the raw social-media listing and convert it into a clean, app-ready
                flat-share listing conforming STRICTLY to the provided response schema.

                Your job is NOT to simply copy information from the post. You must:
                1. Extract explicit information.
                2. Normalize different ways of expressing the same information into the
                available schema enums.
                3. Make reasonable contextual inferences when the information is strongly
                implied.
                4. Preserve useful information by mapping it to "Others" when no specific
                enum exists.
                5. Never output values that are not allowed by the response schema.

                Context metadata:
                ${JSON.stringify(postContext, null, 2)}

                Post body:
                "${postContent}"


                ## TITLE

                Generate a short, concise, user-facing listing title.

                Do NOT blindly copy the social-media title. Social-media titles are often
                awkward, verbose, or written as requests.

                Instead, construct a useful title using the important listing information.

                Examples:

                "Looking for replacement - Female"
                -> "Female Flatmate in Parel"

                "Flatmate required"
                -> "Flatmate Needed"

                "1 room available for single occupancy in a shared flat. (Female)"
                -> "Female Room in Parel"

                Keep titles concise and suitable for a listing card.


                ## FINANCIAL INFORMATION

                Extract the actual/base rent separately from additional costs.

                For example, if the post says:

                "Rent: Per person - 22k"
                "Furniture - 3k"
                "Total with furniture - 25k"

                output:

                rent: 22000
                setup_cost: 3000

                Do NOT set rent to 25000.

                If the post explicitly provides a base rent and an additional furnishing,
                setup, maintenance, or similar cost, put the additional cost in
                setup_cost.

                When an additional cost is associated with optional furniture or amenities,
                still include the corresponding items in add_ons.


                ## ADD-ONS

                Extract all explicitly mentioned appliances, furniture, services,
                connectivity, and room/home features into add_ons.

                Map them to the closest valid ADD_ON_TYPES enum.

                Examples:

                "AC" -> "Air Conditioning"
                "fridge" -> "Refrigerator"
                "double door fridge" -> "Refrigerator" with desc "double door fridge"
                "washing machine" -> "Washing Machine"
                "wifi" -> "WiFi"
                "shared cook" -> "Cook" with desc "shared"
                "shared cleaner" -> "Housekeeping" with desc "shared cleaner"

                If an item cannot be represented by a specific enum, use:

                {
                "type": "Others",
                "desc": "..."
                }

                Do not invent enum values.


                ## FURNISHED STATUS

                Determine the effective furnishing status from the listing.

                If a property is described as unfurnished but furniture is explicitly
                available as part of the offered arrangement, consider the furnished
                option when determining furnished_status.

                For example:

                "unfurnished flat"
                "furniture available for 3k"
                "total with furniture 25k"

                should be interpreted as:

                furnished_status: "fully-furnished"

                when the listed furniture is sufficient to reasonably make the property
                furnished.

                Also include the furniture in add_ons.


                ## BHK

                Use the explicitly stated BHK whenever available.

                If BHK is not explicitly stated but the post provides enough contextual
                information to make a reasonable inference, infer the most likely BHK.

                For example, a shared flat with two separate occupants/rooms may reasonably
                be inferred as a 2BHK.

                Reasonable contextual inference is preferred over leaving an obvious field
                empty.

                Do not make an arbitrary inference when the available information is
                insufficient.


                ## AMENITIES

                Extract society/building/property amenities.

                Map information to the closest valid AMENITY_TYPES enum.

                Examples:

                "gated society" -> "Gated Community"
                "24x7 water" -> "Water Supply"
                "security" -> "Security Guard" or "24x7 Security" depending on context.

                If useful information does not correspond to any specific enum, use:

                {
                "type": "Others",
                "desc": "..."
                }

                For example:

                "sea view, 2 washrooms"

                can become:

                {
                "type": "Others",
                "desc": "Sea view, 2 washrooms"
                }

                Do not create unsupported values such as "Water", "Utility", or "AC".


                ## HOUSE RULES

                Extract actual restrictions/preferences as house_rules.

                Normalize them to the available HOUSE_RULE_TYPES enums.

                Examples:

                "vegetarian only" -> "Vegetarian Only"
                "no pets" -> "No Pets"
                "students preferred" -> "Students Only"

                Do not interpret general lifestyle descriptions as house rules unless they
                clearly represent a restriction or preference.


                ## NEIGHBORHOOD

                Extract nearby landmarks such as metro stations and railway stations.

                Use the appropriate NEIGHBORHOOD_TYPES enum.

                Distances are represented in meters.

                If the post provides an approximate distance, convert it to meters.

                If the post says something like "walking distance" but does not provide an
                exact distance, a reasonable approximate distance may be inferred.

                For example:

                "walking distance from Prabhadevi station"

                may reasonably be represented as approximately 1000 meters.

                Do not omit an obvious nearby landmark merely because its exact distance
                is not stated.


                ## LOCATION

                Extract city, locality, and address from the listing.

                For locality, prefer the specific neighborhood/locality mentioned in the
                post rather than the city.

                For address, preserve the useful location description from the post.

                Coordinates are resolved separately by the application pipeline.

                If latitude/longitude are part of the response schema and are unknown,
                set them to 0.


                ## external_listing:

                - source MUST come from Context metadata.source.
                - url MUST come from Context metadata.source_url.
                - external_listing.lister.name MUST come from Context metadata.author when available.
                - Do not invent or modify these values.
                - Extract age, profile_pic, contact_number, and life_style only when explicitly available in the post or context.
                - If optional lister information is unavailable, omit those fields.

                ## MISSING VALUES

                If a field is not specified and cannot reasonably be inferred, omit it
                when the response schema permits omission.

                Do not invent arbitrary values.

                However, reasonable contextual inference is expected when the source gives
                strong evidence for a value.


                ## STRICT SCHEMA REQUIREMENT

                The final output MUST conform strictly to the provided response schema.

                Only use enum values defined by the schema.

                Never output:
                - explanatory text
                - markdown
                - fields outside the schema
                - unsupported enum values

                Return only the structured JSON object.
              `,
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: responseSchema,
      },
    };

    const postData = JSON.stringify(requestBody);

    const options = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
      },
      rejectUnauthorized: false,
    };

    const req = https.request(url, options, (res) => {
      let responseBody = "";
      res.on("data", (chunk) => (responseBody += chunk));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = JSON.parse(responseBody);
            const rawJson = parsed.candidates[0].content.parts[0].text;
            resolve(JSON.parse(rawJson));
          } catch (e) {
            reject(
              new Error(
                "Failed to parse Gemini response: " +
                  e.message +
                  " -> Response was: " +
                  responseBody,
              ),
            );
          }
        } else {
          reject(
            new Error(
              `Gemini API returned status code ${res.statusCode}: ${responseBody}`,
            ),
          );
        }
      });
    });

    req.on("error", (err) => reject(err));
    req.write(postData);
    req.end();
  });
}

// Global list to store Gemini structured extractions
const geminiExtractedListings = [];
const seenTexts = new Set();
const cachedIds = new Set();

// --- TEST LIMIT ---
// Set to a number (e.g. 2) to only run Gemini on the first N NEW offering
// listings this run (cached/skipped ones don't count against the limit).
// Set to null to disable and process everything.
const MAX_NEW_LISTINGS = 100;
let newListingsProcessed = 0;

async function parseWithLLMFallback(title, text, parsedResult) {
  if (parsedResult.listing_type === "offering_room" && geminiApiKey) {
    if (MAX_NEW_LISTINGS !== null && newListingsProcessed >= MAX_NEW_LISTINGS) {
      console.log(
        `[Test Limit] Reached MAX_NEW_LISTINGS (${MAX_NEW_LISTINGS}), skipping listing ID ${parsedResult.id}.`,
      );
      return parsedResult;
    }

    if (cachedIds.has(parsedResult.id)) {
      console.log(
        `[Cache Hit] Skipping Gemini call for cached listing ID ${parsedResult.id}.`,
      );
      return parsedResult;
    }

    const normalizedText = (text || title || "").trim().toLowerCase();
    if (normalizedText && seenTexts.has(normalizedText)) {
      console.log(
        `[LLM Skip] Skipping duplicate text for listing ID ${parsedResult.id} to save tokens.`,
      );
      return parsedResult;
    }
    if (normalizedText) {
      seenTexts.add(normalizedText);
    }

    console.log(
      `[LLM Fallback/Platform Extraction] Extracting rich schema for listing ID ${parsedResult.id}...`,
    );

    const context = {
      _id: parsedResult.id,
      source: parsedResult.source,
      source_url: parsedResult.source_url,
      images: parsedResult.images,
      author: parsedResult.author,
    };

    try {
      const parsed = await callGeminiAPI(text || title, context);

      //   parsedData._id = parsedResult.id;
      //   parsedData.source = parsedResult.source;
      //   parsedData.source_url = parsedResult.source_url;
      //   if (parsedResult.images && parsedResult.images.length > 0) {
      //     parsedData.listing.images = parsedResult.images;
      //   }
      //   if (parsedResult.author) {
      //     parsedData.lister = parsedData.lister || {};
      //     parsedData.lister.name = parsedResult.author;
      //   }

      // --- Geocoding step ---
      // Resolve coordinates here using OpenStreetMap Nominatim instead.
      const coordinates = await resolveCoordinates(parsed);

      if (!coordinates) {
        throw new Error(
          `Could not resolve coordinates for: ${parsed.address}, ${parsed.locality}, ${parsed.city}`,
        );
      }

      const { external_listing, ...listingData } = parsed;

      const finalListing = {
        data: {
          ...listingData,
          location: {
            type: "Point",
            coordinates: [coordinates.longitude, coordinates.latitude],
          },
        },

        views: 0,
        favorites: 0,

        external_listing,
      };

      geminiExtractedListings.push(finalListing);
      newListingsProcessed++;

      // Sleep to avoid rate limit issues with Gemini
      await new Promise((r) => setTimeout(r, 1000));
    } catch (err) {
      console.error(
        `[LLM Fallback Error] Failed to parse listing ${parsedResult.id}:`,
        err.message,
      );
    }
  }

  return parsedResult;
}

// Main parser process
async function main() {
  const rawDataPath = path.join(__dirname, "../data/raw_reddit_posts.json");
  if (!fs.existsSync(rawDataPath)) {
    console.error(
      `Raw data file not found at ${rawDataPath}. Run fetcher script first.`,
    );
    return;
  }

  const geminiOutputPath = path.join(
    __dirname,
    "../data/gemini_extracted_listings.json",
  );
  if (fs.existsSync(geminiOutputPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(geminiOutputPath, "utf8"));
      existing.forEach((listing) => {
        if (listing && listing._id) {
          cachedIds.add(listing._id);
          geminiExtractedListings.push(listing);
        }
      });
      console.log(
        `Loaded ${cachedIds.size} existing cached listings from: ${geminiOutputPath}`,
      );
    } catch (e) {
      console.warn("Could not load existing listings cache:", e.message);
    }
  }

  const rawData = JSON.parse(fs.readFileSync(rawDataPath, "utf8"));
  const parsedListings = [];

  // Stage counters for a clear end-of-run summary
  const stats = {
    totalPosts: 0,
    classifiedOffering: 0,
    cacheHit: 0,
    dedupSkip: 0,
    geminiSuccess: 0,
    geminiError: 0,
    geocodeResolved: 0,
    geocodeFailed: 0,
  };

  for (const subreddit in rawData) {
    const posts = rawData[subreddit];
    console.log(`Parsing ${posts.length} posts from r/${subreddit}...`);

    for (const post of posts) {
      const data = post.data;
      if (!data) continue;
      stats.totalPosts++;

      const title = data.title || "";
      let text = data.selftext || "";

      if (data.crosspost_parent_list && data.crosspost_parent_list.length > 0) {
        const parent = data.crosspost_parent_list[0];
        if (parent && parent.selftext && parent.selftext.trim()) {
          const parentText = parent.selftext.trim();
          if (text.trim()) {
            if (!text.includes(parentText)) {
              text = `${text.trim()}\n\n[Crosspost parent description]:\n${parentText}`;
            }
          } else {
            text = parentText;
          }
        }
      }

      const rawListing = {
        id: `reddit_${data.id}`,
        source: "reddit",
        source_url: `https://www.reddit.com${data.permalink}`,
        title: title,
        description: text,
        listing_type: extractListingType(title, text),
        budget: extractBudget(title, text),
        location: extractLocation(title, text),
        gender_preference: extractGenderPreference(title, text),
        occupancy: extractOccupancy(title, text),
        images: extractImages(data),
        author: data.author,
        raw_data: data,
        created_at: new Date(data.created_utc * 1000).toISOString(),
        inserted_at: new Date().toISOString(),
      };

      if (rawListing.listing_type === "offering_room")
        stats.classifiedOffering++;

      const finalizedListing = await parseWithLLMFallback(
        title,
        text,
        rawListing,
      );
      parsedListings.push(finalizedListing);
    }
  }

  const outputPath = path.join(__dirname, "../data/parsed_listings.json");
  fs.writeFileSync(outputPath, JSON.stringify(parsedListings, null, 2), "utf8");
  console.log(
    `\nETL parsing complete! Saved ${parsedListings.length} structured listings to: ${outputPath}`,
  );

  const offerings = parsedListings.filter(
    (l) => l.listing_type === "offering_room",
  );
  const offeringsPath = path.join(__dirname, "../data/offering_data.json");
  fs.writeFileSync(offeringsPath, JSON.stringify(offerings, null, 2), "utf8");
  console.log(
    `Saved ${offerings.length} offering listings to: ${offeringsPath}`,
  );

  if (geminiExtractedListings.length > 0) {
    fs.writeFileSync(
      geminiOutputPath,
      JSON.stringify(geminiExtractedListings, null, 2),
      "utf8",
    );
    console.log(
      `Saved ${geminiExtractedListings.length} rich Gemini extracted listings to: ${geminiOutputPath}`,
    );

    const facebookExtractedPath = path.join(
      __dirname,
      "../data/gemini_extracted_facebook_listings.json",
    );
    let mergedListings = [...geminiExtractedListings];
    if (fs.existsSync(facebookExtractedPath)) {
      try {
        const facebookListings = JSON.parse(
          fs.readFileSync(facebookExtractedPath, "utf8"),
        );
        mergedListings = [...mergedListings, ...facebookListings];
        console.log(
          `Merged with ${facebookListings.length} Facebook listings.`,
        );
      } catch (e) {
        console.error("Failed to load Facebook listings for merge:", e.message);
      }
    }
    const mergedPath = path.join(
      __dirname,
      "../data/all_extracted_listings.json",
    );
    fs.writeFileSync(
      mergedPath,
      JSON.stringify(mergedListings, null, 2),
      "utf8",
    );
    console.log(
      `Saved all unified listings (Reddit + Facebook) to: ${mergedPath}`,
    );
  }

  console.log(`\n--- Run summary ---`);
  console.log(`Total posts processed:      ${stats.totalPosts}`);
  console.log(`Classified as offering:     ${stats.classifiedOffering}`);
}

main();
