const fs = require('fs');
const path = require('path');
const https = require('https');

// Load environment variables from scripts/.env
const envPath = path.join(__dirname, '.env');
let geminiApiKey = '';
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
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
        'User-Agent': 'FlatAndFlatmateApp/1.0 (contact: karina.rajawat1101@gmail.com)'
      }
    };

    https.get(url, options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const results = JSON.parse(body);
          if (Array.isArray(results) && results.length > 0) {
            const result = {
              latitude: parseFloat(results[0].lat),
              longitude: parseFloat(results[0].lon)
            };
            geocodeCache.set(cacheKey, result);
            resolve(result);
          } else {
            geocodeCache.set(cacheKey, null);
            resolve(null);
          }
        } catch (e) {
          console.warn(`[Geocode] Failed to parse response for "${query}":`, e.message);
          resolve(null);
        }
      });
    }).on('error', (err) => {
      console.warn(`[Geocode] Request failed for "${query}":`, err.message);
      resolve(null);
    });
  });
}

// Nominatim's usage policy caps requests at 1/sec — this helper sleeps between calls
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Try geocoding with progressively broader queries: full address -> locality+city -> city.
 * This gives locality-level or city-level coordinates as a fallback when the
 * exact address can't be resolved (common for informal Reddit descriptions).
 */
async function resolveCoordinates(listing) {
  const attempts = [];
  if (listing.address) attempts.push(`${listing.address}, ${listing.city || ''}, India`);
  if (listing.locality) attempts.push(`${listing.locality}, ${listing.city || ''}, India`);
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
      if (item.status === 'valid' && (item.e === 'Image' || item.e === 'AnimatedImage')) {
        let imgUrl = item.s?.u || item.s?.gif;
        if (imgUrl) {
          imgUrl = imgUrl.replace(/&amp;/g, '&');
          images.push(imgUrl);
        }
      }
    }
  }

  if (images.length === 0 && postData.preview?.images) {
    for (const img of postData.preview.images) {
      let imgUrl = img.source?.url;
      if (imgUrl) {
        imgUrl = imgUrl.replace(/&amp;/g, '&');
        images.push(imgUrl);
      }
    }
  }

  if (images.length === 0 && postData.crosspost_parent_list && postData.crosspost_parent_list.length > 0) {
    const parentImages = extractImages(postData.crosspost_parent_list[0]);
    images.push(...parentImages);
  }

  return [...new Set(images)];
}

// Rule-based heuristic parsers
function extractListingType(title, text) {
  const combined = `${title} ${text}`.toLowerCase();

  const seekingKeywords = [
    'looking for', 'seeking', 'need a flat', 'need a room',
    'finding a', 'looking to move', 'looking for pg', 'want a flatmate'
  ];
  const offeringKeywords = [
    'available', 'room available', 'flatmate needed', 'vacancy',
    '1bhk for rent', '2bhk for rent', 'pg available', 'offering'
  ];

  let seekingScore = 0;
  let offeringScore = 0;

  seekingKeywords.forEach(kw => { if (combined.includes(kw)) seekingScore++; });
  offeringKeywords.forEach(kw => { if (combined.includes(kw)) offeringScore++; });

  if (seekingScore > offeringScore) return 'seeking_room';
  if (offeringScore > seekingScore) return 'offering_room';

  if (/looking/i.test(title)) return 'seeking_room';
  if (/available/i.test(title)) return 'offering_room';

  return 'seeking_room';
}

function extractBudget(title, text) {
  const combined = `${title} ${text}`.toLowerCase();

  const budgetRegexes = [
    /budget(?:\s+\w+){0,3}\s+(\d{1,3}(?:,\d{3})*(?:\s*k)?)/gi,
    /rent(?:\s+\w+){0,3}\s+(\d{1,3}(?:,\d{3})*(?:\s*k)?)/gi,
    /(\d{1,3}(?:,\d{3})*(?:\s*k)?)\s*(?:per month|\/month|pm)/gi,
    /around\s+(\d{1,3}(?:,\d{3})*(?:\s*k)?)/gi
  ];

  for (const regex of budgetRegexes) {
    const match = regex.exec(combined);
    if (match) {
      let rawVal = match[1].replace(/,/g, '');
      if (rawVal.endsWith('k')) {
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

  const malePatterns = [/\b(m|male|boy|boys|gents?|guy|guys)\b/i, /\b\d{2}m\b/i];
  const femalePatterns = [/\b(f|female|girl|girls|ladies?|lady)\b/i, /\b\d{2}f\b/i];

  let maleMatch = malePatterns.some(p => p.test(combined));
  let femaleMatch = femalePatterns.some(p => p.test(combined));

  if (maleMatch && femaleMatch) return 'any';
  if (maleMatch) return 'male';
  if (femaleMatch) return 'female';
  return 'any';
}

function extractLocation(title, text) {
  const combined = `${title} ${text}`.toLowerCase();

  const commonAreas = [
    'powai', 'bandra', 'andheri', 'juhu', 'chembur', 'khar', 'santacruz',
    'goregaon', 'malad', 'borivali', 'mulund', 'thane', 'worli', 'dadar', 'colaba'
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
    if (!['the', 'our', 'new', 'any', 'my', 'flat', 'room', 'budget', 'good'].includes(candidate)) {
      return candidate.charAt(0).toUpperCase() + candidate.slice(1);
    }
  }

  return null;
}

function extractOccupancy(title, text) {
  const combined = `${title} ${text}`.toLowerCase();
  if (combined.includes('single')) return 'single';
  if (combined.includes('double') || combined.includes('sharing')) return 'double';
  if (combined.includes('triple')) return 'triple';
  if (combined.includes('pg')) return 'pg';
  if (combined.includes('1bhk')) return '1bhk';
  if (combined.includes('2bhk')) return '2bhk';
  return 'flatmate';
}

const responseSchema = {
  type: "object",
  properties: {
    _id: { type: "string" },
    source: { type: "string", enum: ["app", "facebook", "reddit"] },
    source_url: { type: "string" },
    listing: {
      type: "object",
      properties: {
        title: { type: "string" },
        images: { type: "array", items: { type: "string" } },
        carpet_area: { type: "number" },
        city: { type: "string", enum: ["mumbai", "pune", "banglore", "hyderabad"] },
        locality: { type: "string", description: "Locality or sub-area. Return Mumbai or Pune if unknown." },
        address: { type: "string" },
        latitude: { type: "number", description: "Latitude. Return 0 if unknown." },
        longitude: { type: "number", description: "Longitude. Return 0 if unknown." },
        gender_preferance: { type: "string", enum: ["male", "female"] },
        bhk: { type: "string", enum: ["1RK", "1BHK", "2BHK", "3BHK"] },
        occupency: { type: "string", enum: ["single", "double", "triple"] },
        total_occupency: { type: "number" },
        furnised_status: { type: "string", enum: ["unfurnished", "semi-furnished", "fully-furnished"] },
        ammenites: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["Kitchen", "AC", "Maid", "Washroom", "Water", "Utility"] },
              desc: { type: "string" }
            },
            required: ["type", "desc"]
          }
        },
        house_rules: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["Smoking", "Food", "Pets"] },
              desc: { type: "string" }
            },
            required: ["type", "desc"]
          }
        },
        rent: { type: "number" },
        deposit: { type: "number" },
        brokerage: { type: "number" },
        setup_cost: { type: "number" },
        possession_date: { type: "string", description: "ISO date format (e.g. YYYY-MM-DD) or empty" },
        neighborhood: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["Railway Station", "Metro"] },
              distance: { type: "number", description: "Distance in meters (e.g. 700)" }
            },
            required: ["type", "distance"]
          }
        }
      },
      required: ["title", "city", "locality", "address", "latitude", "longitude", "gender_preferance", "furnised_status", "rent"]
    },
    lister: {
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
        profile_pic: { type: "string" },
        contanct_number: { type: "string" },
        life_style: { type: "array", items: { type: "string" } }
      },
      required: ["name"]
    }
  },
  required: ["_id", "source", "source_url", "listing"]
};

function callGeminiAPI(postContent, postContext) {
  return new Promise((resolve, reject) => {
    if (!geminiApiKey) {
      reject(new Error("GEMINI_API_KEY is not defined"));
      return;
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`;

    const requestBody = {
      contents: [{
        parts: [{
          text: `You are an expert flat share listing parser. Analyze this raw listing post data from social media and extract all fields conforming strictly to the requested schema. Also mark null/empty values if the value is not available and cannot be concluded in any form.
          
Context metadata:
${JSON.stringify(postContext, null, 2)}

Post body:
"${postContent}"

If latitude, longitude are unknown, set to 0. If fields like carpet_area are not specified, omit them. For locality, default to the neighborhood found in text.`
        }]
      }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: responseSchema
      }
    };

    const postData = JSON.stringify(requestBody);

    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      rejectUnauthorized: false
    };

    const req = https.request(url, options, (res) => {
      let responseBody = '';
      res.on('data', chunk => responseBody += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = JSON.parse(responseBody);
            const rawJson = parsed.candidates[0].content.parts[0].text;
            resolve(JSON.parse(rawJson));
          } catch (e) {
            reject(new Error("Failed to parse Gemini response: " + e.message + " -> Response was: " + responseBody));
          }
        } else {
          reject(new Error(`Gemini API returned status code ${res.statusCode}: ${responseBody}`));
        }
      });
    });

    req.on('error', err => reject(err));
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
const MAX_NEW_LISTINGS = 20;
let newListingsProcessed = 0;

async function parseWithLLMFallback(title, text, parsedResult) {
  if (parsedResult.listing_type === 'offering_room' && geminiApiKey) {
    if (MAX_NEW_LISTINGS !== null && newListingsProcessed >= MAX_NEW_LISTINGS) {
      console.log(`[Test Limit] Reached MAX_NEW_LISTINGS (${MAX_NEW_LISTINGS}), skipping listing ID ${parsedResult.id}.`);
      return parsedResult;
    }

    if (cachedIds.has(parsedResult.id)) {
      console.log(`[Cache Hit] Skipping Gemini call for cached listing ID ${parsedResult.id}.`);
      return parsedResult;
    }

    const normalizedText = (text || title || '').trim().toLowerCase();
    if (normalizedText && seenTexts.has(normalizedText)) {
      console.log(`[LLM Skip] Skipping duplicate text for listing ID ${parsedResult.id} to save tokens.`);
      return parsedResult;
    }
    if (normalizedText) {
      seenTexts.add(normalizedText);
    }

    console.log(`[LLM Fallback/Platform Extraction] Extracting rich schema for listing ID ${parsedResult.id}...`);

    const context = {
      _id: parsedResult.id,
      source: parsedResult.source,
      source_url: parsedResult.source_url,
      images: parsedResult.images,
      author: parsedResult.author
    };

    try {
      const parsedData = await callGeminiAPI(text || title, context);

      parsedData._id = parsedResult.id;
      parsedData.source = parsedResult.source;
      parsedData.source_url = parsedResult.source_url;
      if (parsedResult.images && parsedResult.images.length > 0) {
        parsedData.listing.images = parsedResult.images;
      }
      if (parsedResult.author) {
        parsedData.lister = parsedData.lister || {};
        parsedData.lister.name = parsedResult.author;
      }

      // --- Geocoding step ---
      // Gemini deliberately returns 0,0 when it doesn't know real coordinates
      // (that's correct — an LLM guessing coordinates would hallucinate them).
      // Resolve real coordinates here using OpenStreetMap Nominatim instead.
      const lat = parsedData.listing?.latitude;
      const lng = parsedData.listing?.longitude;
      if ((!lat || lat === 0) && (!lng || lng === 0)) {
        console.log(`[Geocode] Resolving coordinates for "${parsedData.listing?.locality || parsedData.listing?.address}"...`);
        const coords = await resolveCoordinates(parsedData.listing);
        if (coords) {
          parsedData.listing.latitude = coords.latitude;
          parsedData.listing.longitude = coords.longitude;
          console.log(`[Geocode] Resolved to ${coords.latitude}, ${coords.longitude}`);
        } else {
          console.log(`[Geocode] Could not resolve coordinates, leaving as 0,0`);
        }
      }

      geminiExtractedListings.push(parsedData);
      newListingsProcessed++;

      // Sleep to avoid rate limit issues with Gemini
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      console.error(`[LLM Fallback Error] Failed to parse listing ${parsedResult.id}:`, err.message);
    }
  }

  return parsedResult;
}

// Main parser process
async function main() {
  const rawDataPath = path.join(__dirname, '../data/raw_reddit_posts.json');
  if (!fs.existsSync(rawDataPath)) {
    console.error(`Raw data file not found at ${rawDataPath}. Run fetcher script first.`);
    return;
  }

  const geminiOutputPath = path.join(__dirname, '../data/gemini_extracted_listings.json');
  if (fs.existsSync(geminiOutputPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(geminiOutputPath, 'utf8'));
      existing.forEach(listing => {
        if (listing && listing._id) {
          cachedIds.add(listing._id);
          geminiExtractedListings.push(listing);
        }
      });
      console.log(`Loaded ${cachedIds.size} existing cached listings from: ${geminiOutputPath}`);
    } catch (e) {
      console.warn("Could not load existing listings cache:", e.message);
    }
  }

  const rawData = JSON.parse(fs.readFileSync(rawDataPath, 'utf8'));
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
    geocodeFailed: 0
  };

  for (const subreddit in rawData) {
    const posts = rawData[subreddit];
    console.log(`Parsing ${posts.length} posts from r/${subreddit}...`);

    for (const post of posts) {
      const data = post.data;
      if (!data) continue;
      stats.totalPosts++;

      const title = data.title || '';
      let text = data.selftext || '';

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
        source: 'reddit',
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
        inserted_at: new Date().toISOString()
      };

      if (rawListing.listing_type === 'offering_room') stats.classifiedOffering++;

      const finalizedListing = await parseWithLLMFallback(title, text, rawListing);
      parsedListings.push(finalizedListing);
    }
  }

  const outputPath = path.join(__dirname, '../data/parsed_listings.json');
  fs.writeFileSync(outputPath, JSON.stringify(parsedListings, null, 2), 'utf8');
  console.log(`\nETL parsing complete! Saved ${parsedListings.length} structured listings to: ${outputPath}`);

  const offerings = parsedListings.filter(l => l.listing_type === 'offering_room');
  const offeringsPath = path.join(__dirname, '../data/offering_data.json');
  fs.writeFileSync(offeringsPath, JSON.stringify(offerings, null, 2), 'utf8');
  console.log(`Saved ${offerings.length} offering listings to: ${offeringsPath}`);

  if (geminiExtractedListings.length > 0) {
    fs.writeFileSync(geminiOutputPath, JSON.stringify(geminiExtractedListings, null, 2), 'utf8');
    console.log(`Saved ${geminiExtractedListings.length} rich Gemini extracted listings to: ${geminiOutputPath}`);

    const facebookExtractedPath = path.join(__dirname, '../data/gemini_extracted_facebook_listings.json');
    let mergedListings = [...geminiExtractedListings];
    if (fs.existsSync(facebookExtractedPath)) {
      try {
        const facebookListings = JSON.parse(fs.readFileSync(facebookExtractedPath, 'utf8'));
        mergedListings = [...mergedListings, ...facebookListings];
        console.log(`Merged with ${facebookListings.length} Facebook listings.`);
      } catch (e) {
        console.error("Failed to load Facebook listings for merge:", e.message);
      }
    }
    const mergedPath = path.join(__dirname, '../data/all_extracted_listings.json');
    fs.writeFileSync(mergedPath, JSON.stringify(mergedListings, null, 2), 'utf8');
    console.log(`Saved all unified listings (Reddit + Facebook) to: ${mergedPath}`);
  }

  console.log(`\n--- Run summary ---`);
  console.log(`Total posts processed:      ${stats.totalPosts}`);
  console.log(`Classified as offering:     ${stats.classifiedOffering}`);
}

main();