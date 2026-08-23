const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

// Load environment variables from scripts/.env
const envPath = path.join(__dirname, '.env');
let mongoUri = '';
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  const match = envContent.match(/MONGODB_URI\s*=\s*(.*)/);
  if (match) {
    mongoUri = match[1].trim();
  }
}

const COLLECTION_NAME = 'flat_and_flatmates';

async function main() {
  if (!mongoUri) {
    console.error('Error: MONGODB_URI is not set in scripts/.env');
    console.log('Add a line like: MONGODB_URI=mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/flatandflatmate');
    process.exit(1);
  }

  const dataPath = path.join(__dirname, '../data/all_extracted_listings.json');
  if (!fs.existsSync(dataPath)) {
    console.error(`Data file not found at ${dataPath}. Run parse_reddit.js / parse_facebook.js first.`);
    process.exit(1);
  }

  const listings = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  if (!Array.isArray(listings) || listings.length === 0) {
    console.log('No listings found in all_extracted_listings.json. Nothing to insert.');
    return;
  }

  console.log(`Loaded ${listings.length} listings from ${dataPath}`);
  console.log('Connecting to MongoDB...');

  const client = new MongoClient(mongoUri);

  try {
    await client.connect();
    console.log('Connected successfully.');

    const db = client.db(); // uses the database name from the URI
    const collection = db.collection(COLLECTION_NAME);

    // Helpful indexes for common query patterns (safe to run every time — no-op if they exist)
    await collection.createIndex({ 'listing.city': 1 });
    await collection.createIndex({ 'listing.locality': 1 });
    await collection.createIndex({ source: 1 });
    await collection.createIndex({ 'listing.latitude': 1, 'listing.longitude': 1 });

    const stats = { inserted: 0, updated: 0, skipped: 0, failed: 0 };

    for (const listing of listings) {
      if (!listing._id) {
        console.warn('Skipping a listing with no _id:', listing.source_url || '(no url)');
        stats.skipped++;
        continue;
      }

      // Use _id from your schema directly as MongoDB's _id (string, not ObjectId).
      // MongoDB allows any unique value as _id, so this preserves your existing
      // "reddit_xxxxx" / "facebook_xxxxx" convention without needing a separate field.
      const doc = { ...listing };
      const docId = doc._id;

      try {
        const result = await collection.replaceOne(
          { _id: docId },
          doc,
          { upsert: true }
        );

        if (result.upsertedCount > 0) {
          stats.inserted++;
        } else if (result.modifiedCount > 0) {
          stats.updated++;
        } else {
          stats.skipped++; // matched but identical, no change
        }
      } catch (err) {
        console.error(`Failed to upsert listing ${docId}:`, err.message);
        stats.failed++;
      }
    }

    console.log('\n--- MongoDB sync summary ---');
    console.log(`New listings inserted:      ${stats.inserted}`);
    console.log(`Existing listings updated:  ${stats.updated}`);
    console.log(`Unchanged / skipped:        ${stats.skipped}`);
    console.log(`Failed:                     ${stats.failed}`);
    console.log(`Total in collection now:    ${await collection.countDocuments()}`);

  } finally {
    await client.close();
    console.log('\nConnection closed.');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});