const fs = require('fs');
const path = require('path');
const https = require('https');

// Load config.json
const configPath = path.join(__dirname, '../config.json');
let config = {};
if (fs.existsSync(configPath)) {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

// Locate the Facebook JSON file (default to local scraped posts, fallback to configured/downloaded paths)
const localScrapedPath = path.join(__dirname, '../data/raw_facebook_posts.json');
const rawFacebookPath = fs.existsSync(localScrapedPath) ? localScrapedPath : (config.facebookRawJSONPath || '/Users/consultadd/Downloads/3342868009371382_posts_2026-07-25T19-47-07.json');

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

if (!geminiApiKey) {
  console.error("GEMINI_API_KEY not found in scripts/.env");
  process.exit(1);
}

// Target JSON Schema for Gemini response
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

async function main() {
  if (!fs.existsSync(rawFacebookPath)) {
    console.error(`Raw Facebook posts file not found at: ${rawFacebookPath}`);
    console.log("Please make sure the path is correct or specify 'facebookRawJSONPath' in config.json.");
    return;
  }

  let rawData = JSON.parse(fs.readFileSync(rawFacebookPath, 'utf8'));
  
  // Flatten if it's an object of arrays (grouped by group ID)
  if (!Array.isArray(rawData)) {
    const flattened = [];
    for (const group in rawData) {
      if (Array.isArray(rawData[group])) {
        flattened.push(...rawData[group]);
      }
    }
    rawData = flattened;
  }

  console.log(`Starting Gemini extraction on ${rawData.length} Facebook posts from: ${rawFacebookPath}`);

  const extractedListings = [];

  for (let i = 0; i < rawData.length; i++) {
    const item = rawData[i];
    
    // Generate clean ID
    const cleanPostId = item.postId ? item.postId.replace(/[^a-zA-Z0-9]/g, '_') : `fb_${i}`;
    const id = `facebook_${cleanPostId}`;
    
    const firstLine = item.text ? item.text.split('\n')[0].substring(0, 100) : "Facebook Flat Share Listing";
    console.log(`[${i+1}/${rawData.length}] Extracting: "${firstLine}"`);

    // Prepare full text content including comments (crucial for finding contact info or details)
    let fullText = item.text || "";
    if (item.topComments && item.topComments.length > 0) {
      fullText += "\n\n--- Comments section ---";
      item.topComments.forEach(comment => {
        fullText += `\n${comment.author || 'User'}: ${comment.text || ''}`;
      });
    }

    const context = {
      _id: id,
      source: "facebook",
      source_url: item.postUrl || item.authorProfileUrl || "https://www.facebook.com/",
      images: item.imageUrls || [],
      author: item.author || "Anonymous participant"
    };

    try {
      const parsedData = await callGeminiAPI(fullText, context);
      
      // Ensure metadata fields match our identifiers exactly
      parsedData._id = id;
      parsedData.source = "facebook";
      parsedData.source_url = context.source_url;
      if (context.images && context.images.length > 0) {
        parsedData.listing.images = context.images;
      }
      if (item.author) {
        parsedData.lister = parsedData.lister || {};
        parsedData.lister.name = item.author;
      }

      extractedListings.push(parsedData);
      
      // Safety sleep to avoid rate limit/quota hits
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      console.error(`Failed to parse Facebook post "${firstLine}":`, err.message);
    }
  }

  const outputPath = path.join(__dirname, '../data/gemini_extracted_facebook_listings.json');
  fs.writeFileSync(outputPath, JSON.stringify(extractedListings, null, 2), 'utf8');
  console.log(`\nSuccessfully saved ${extractedListings.length} structured Facebook listings to: ${outputPath}`);

  // Optional: Merge with Reddit listings if present to create a single database
  const redditExtractedPath = path.join(__dirname, '../data/gemini_extracted_listings.json');
  if (fs.existsSync(redditExtractedPath)) {
    try {
      const redditListings = JSON.parse(fs.readFileSync(redditExtractedPath, 'utf8'));
      const mergedListings = [...redditListings, ...extractedListings];
      const mergedPath = path.join(__dirname, '../data/all_extracted_listings.json');
      fs.writeFileSync(mergedPath, JSON.stringify(mergedListings, null, 2), 'utf8');
      console.log(`Merged all listings (Reddit + Facebook) into: ${mergedPath}`);
    } catch (e) {
      console.error("Failed to merge listings:", e.message);
    }
  }
}

main();