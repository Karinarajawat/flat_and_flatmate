const fs = require('fs');
const path = require('path');

function analyzeListings() {
  const parsedDataPath = path.join(__dirname, '../data/parsed_listings.json');
  
  if (!fs.existsSync(parsedDataPath)) {
    console.error(`Parsed data file not found at ${parsedDataPath}. Please run the parser script first.`);
    return;
  }

  const listings = JSON.parse(fs.readFileSync(parsedDataPath, 'utf8'));
  console.log(`=== FLAT sharing ETL ANALYSIS REPORT ===`);
  console.log(`Total Listings Analyzed: ${listings.length}\n`);

  // 1. Seeking vs Offering Breakdown
  let seekingCount = 0;
  let offeringCount = 0;
  let otherCount = 0;

  // 2. Images Analysis (for seeking specifically, and overall)
  let seekingWithImages = 0;
  let seekingWithoutImages = 0;
  let offeringWithImages = 0;
  let offeringWithoutImages = 0;

  // 3. Gender Preference Breakdown
  const genderBreakdown = { male: 0, female: 0, any: 0, other: 0 };

  // 4. Location Breakdown
  const locationCounts = {};

  // 5. Occupancy / Flat Type Breakdown
  const occupancyCounts = {};

  // 6. Budgets
  const seekingBudgets = [];
  const offeringBudgets = [];

  for (const listing of listings) {
    const type = listing.listing_type;
    const hasImages = listing.images && listing.images.length > 0;
    
    // Type and image count
    if (type === 'seeking_room') {
      seekingCount++;
      if (hasImages) seekingWithImages++;
      else seekingWithoutImages++;
      if (listing.budget) seekingBudgets.push(listing.budget);
    } else if (type === 'offering_room') {
      offeringCount++;
      if (hasImages) offeringWithImages++;
      else offeringWithoutImages++;
      if (listing.budget) offeringBudgets.push(listing.budget);
    } else {
      otherCount++;
    }

    // Gender pref
    const gender = listing.gender_preference || 'any';
    if (genderBreakdown[gender] !== undefined) {
      genderBreakdown[gender]++;
    } else {
      genderBreakdown.other++;
    }

    // Locations
    const loc = listing.location || 'Unknown';
    locationCounts[loc] = (locationCounts[loc] || 0) + 1;

    // Occupancy
    const occ = listing.occupancy || 'Unspecified';
    occupancyCounts[occ] = (occupancyCounts[occ] || 0) + 1;
  }

  // Helper stats
  const avg = (arr) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
  const min = (arr) => arr.length ? Math.min(...arr) : 0;
  const max = (arr) => arr.length ? Math.max(...arr) : 0;

  console.log(`--- Listing Type breakdown ---`);
  console.log(`• Seeking Flat/Room: ${seekingCount} (${Math.round(seekingCount/listings.length*100)}%)`);
  console.log(`• Offering Flat/Room: ${offeringCount} (${Math.round(offeringCount/listings.length*100)}%)`);
  if (otherCount > 0) {
    console.log(`• Other/Unclassified: ${otherCount}`);
  }
  console.log();

  console.log(`--- Attachment & Images Analysis ---`);
  console.log(`• Seeking listings with images: ${seekingWithImages} / ${seekingCount} (${seekingCount ? Math.round(seekingWithImages/seekingCount*100) : 0}%)`);
  console.log(`• Offering listings with images: ${offeringWithImages} / ${offeringCount} (${offeringCount ? Math.round(offeringWithImages/offeringCount*100) : 0}%)`);
  console.log();

  console.log(`--- Gender Preference breakdown ---`);
  for (const [gender, count] of Object.entries(genderBreakdown)) {
    console.log(`• ${gender.charAt(0).toUpperCase() + gender.slice(1)}: ${count} (${Math.round(count/listings.length*100)}%)`);
  }
  console.log();

  console.log(`--- Budget Statistics (INR) ---`);
  console.log(`• Seeking Accommodation Budget:`);
  console.log(`  - Average: ₹${avg(seekingBudgets).toLocaleString()}`);
  console.log(`  - Min:     ₹${min(seekingBudgets).toLocaleString()}`);
  console.log(`  - Max:     ₹${max(seekingBudgets).toLocaleString()}`);
  console.log(`• Offering Accommodation Budget:`);
  console.log(`  - Average: ₹${avg(offeringBudgets).toLocaleString()}`);
  console.log(`  - Min:     ₹${min(offeringBudgets).toLocaleString()}`);
  console.log(`  - Max:     ₹${max(offeringBudgets).toLocaleString()}`);
  console.log();

  console.log(`--- Top Locations (Demand & Supply) ---`);
  const sortedLocs = Object.entries(locationCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  for (const [loc, count] of sortedLocs) {
    console.log(`• ${loc}: ${count} post(s)`);
  }
  console.log();

  console.log(`--- Room/Occupancy Type ---`);
  const sortedOcc = Object.entries(occupancyCounts)
    .sort((a, b) => b[1] - a[1]);
  for (const [occ, count] of sortedOcc) {
    console.log(`• ${occ}: ${count} post(s)`);
  }
  console.log();
}

analyzeListings();