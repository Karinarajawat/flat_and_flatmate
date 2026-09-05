import { RawPost } from "@/types/post";

export type ListingType =
  | "offering_room"
  | "seeking_room"
  | "ambiguous"
  | "not_housing";

// ------------------------------------------------------------------
// 0. NORMALIZATION
// ------------------------------------------------------------------

const TYPO_MAP: [RegExp, string][] = [
  [/\broom\s*mates?(s)?\b/gi, "roommate$1"],
  [/\broomate(s)?\b/gi, "roommate$1"],
  [/\bflat\s*mates?(s)?\b/gi, "flatmate$1"],
  [/\bflatmmate(s)?\b/gi, "flatmate$1"],
  [/\bflatmet(s)?\b/gi, "flatmate$1"],
  [/\bvaccan(t|cy)\b/gi, "vacan$1"],
  [/\baccomodation(s)?\b/gi, "accommodation$1"],
  [/\bappartment(s)?\b/gi, "apartment$1"],
  [/\btennant(s)?\b/gi, "tenant$1"],
  [/\bavailble\b/gi, "available"],
  [/\bavailabe\b/gi, "available"],
  [/\bbrokage\b/gi, "brokerage"],
  [/\bshearing\b/gi, "sharing"],
  [/\bledies\b/gi, "ladies"],
  [/\bdhundh\b/gi, "searching"],
];

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu;
const UNIT_RE = /(\d+)\s*[-/]?\s*(bhk|rk)\b/gi;

function normalize(rawContent: string): string {
  let t = rawContent;
  t = t.replace(/&amp;/gi, "&").replace(/&#x200b;/gi, " ");
  t = t.replace(/\u2019/g, "'").replace(/\u2018/g, "'");
  t = t.replace(EMOJI_RE, " ");
  t = t.replace(/https?:\/\/\S+/g, " ");
  t = t.replace(/[\*\_\~\|\#\`]/g, " "); // Strip markdown formatting characters
  t = t.replace(/\s+/g, " ").trim().toLowerCase();
  for (const [pat, repl] of TYPO_MAP) t = t.replace(pat, repl);
  t = t.replace(UNIT_RE, (_, d, unit) => `${d}${unit}`);
  return t;
}

// ------------------------------------------------------------------
// 1. NON-HOUSING / NON-LISTING FILTER (Immediate discard)
// ------------------------------------------------------------------

const NON_HOUSING_ITEM_RE = new RegExp(
  "\\b(?:" +
    "commercial\\s+space|office\\s+space|shop\\s+for\\s+rent|warehouse|retail\\s+space|" +
    "scooty|scooter|bike\\s+for\\s+rent|car\\s+for\\s+rent|vehicle\\s+for\\s+rent|" +
    "air\\s+fryer\\s+(?:on|for)\\s+rent|washing\\s+machine\\s+(?:on|for)\\s+rent|looking\\s+for\\s+(?:a\\s+)?washing\\s+machine|" +
    "ac\\s+on\\s+rent|ac\\s+from\\s+rentomojo|renting\\s+ac|renting\\s+furniture|" +
    "storage\\s+unit\\s+used\\s+available|used\\s+available\\s+in|" +
    "buyer\\s+of\\s+apartment|whatsapp\\s+group\\s+of\\s+buyer|" +
    "public\\s+warning|be\\s+careful\\s+while\\s+dealing|broker\\s+scam|" +
    "horror\\s+story|tenants\\s+are\\s+equally\\s+responsible|whats?\\s+the\\s+catch|" +
    "is\\s+there\\s+something\\s+wrong\\s+with\\s+the\\s+society|tenant\\s+allowed\\s+parking|" +
    "1\\s+day\\s+stay\\s+every\\s+week|hotel|per\\s+night" +
    ")\\b",
  "i",
);

const NON_LISTING_DISCUSSIONS: RegExp[] = [
  /\bwhich\s+area\b.{0,20}\b(?:stay|rent|live|better)\b/i,
  /\bwhat\s+is\s+cheaper\b/i,
  /\bhow(?:'s| is)\s+(?:the\s+)?rent\b/i,
  /\bwhat(?:'s| is)\s+the\s+(?:rent|price)\b/i,
  /\bwhats?\s+the\s+rent\s+for\b/i,
  /\bhow\s+much\s+(?:can\s+i\s+get|is|does)\b.{0,25}\b(?:room|flat|rent|pg)\b/i,
  /\bdoes\s+it\s+make\s+sense\b/i,
  /\bhelp\s+me\s+decide\b/i,
  /\banyone\s+(?:stayed?|staying|lived?|living|has\s+experience)\s+(?:at|in|with)\b/i,
  /\bworth\s+it\b/i,
  /\bguide\b/i,
  /^\s*review\b/i,
  /\bany\s+(?:whatsapp|telegram)\s+group\b/i,
  /\bhow\s+(?:is|'s)\s+(?:the\s+)?(?:area|locality|neighborhood|neighbourhood)\b/i,
  /\bshould\s+i\s+(?:buy|cancel|continue|stay)\b/i,
  /\btell\s+me\s+about\s+your\s+flat[- ]sharing\s+experiences\b/i,
  /\bwanna\s+know\s+ongoing\s+property\s+prices\b/i,
  /\bnot\s+able\s+to\s+figure\s+out\s+whether\b/i,
  /\bfurlenco\s+or\s+rent\s*mojo\b/i,
  /\bairbnb\s+or\s+service\s+apartment\b/i,
  /\bwhere\s+to\s+stay\b/i,
  /\bpossession\s+delay\b/i,
  /\brenting\s+room\s+for\s+party\b/i,
  /\bplease\s+follow\s+for\s+premium\s+quality\s+flats\b/i,
  /\bground\s+work\s+partner\b/i,
  /^\s*flatmate\s*$/i, // Single word post "flatmate"
  /^\s*pg\s+in\s+[a-z\s]+$/i, // "pg in mumbai" (no actual listing info)
  /\b(?:any\s+)?(?:good\s+)?(?:pg|flat|room|colive)\s+suggestions?\b/i,
];

// Housing check
const HOUSING_SIGNAL = new RegExp(
  "\\b(?:" +
    "\\d+bhk|\\d+rk|bhk|rk|pg|flat(?:mate)?s?|room(?:mate)?s?|roomie(?:s)?|" +
    "apartment|accommodation|tenant(?:s)?|landlord|brokerage|broker|sublet|" +
    "lease|co-?living|hostel|vacant|vacancy|occupancy|paying\\s+guest|villa|" +
    "rent(?:ed|ing|al)?|seater|master\\s+bedroom" +
    ")\\b",
  "i",
);

// ------------------------------------------------------------------
// 2. VOCAB & INTENT
// ------------------------------------------------------------------

const INTENT_VERBS =
  "looking\\s+(?:out\\s+)?for|look(?:ing)?\\s+for|looking\\s+4|need|want|" +
  "seeking|search(?:ing)?\\s+for|in\\s+search\\s+of|require|requires|finding|" +
  "find|hunting\\s+for|hunt\\s+for|on\\s+the\\s+hunt\\s+for|dhundh";

const PLACE_WORDS =
  "rooms?|bedrooms?|master\\s+bedrooms?|flats?|apartments?|villas?|houses?|\\d+rks?|\\d+bhks?|pgs?|accommodations?|" +
  "occupanc(?:y|ies)|beds?|space|place\\s+to\\s+(?:stay|live)|" +
  "rented?\\s+place|rental\\s+(?:flat|room|apartment|place|property)|" +
  "(?:single|double|triple)\\s+seater";

const PERSON_WORDS =
  "(?:\\d+bhk\\s+|\\d+rk\\s+)?flatmates?|(?:\\d+bhk\\s+|\\d+rk\\s+)?roommates?|roomies?|tenants?|lodgers?|" +
  "occupants?|co-?livers?|(?:paying\\s+)?guests?|partners?|" +
  "(?:female|male|working|3rd|2nd|4th)\\s+roommates?|" +
  "(?:female|male|working)\\s+replacement|replacement";

const AVAILABLE_WORDS =
  "available|vacant|up\\s+for\\s+grabs|free\\s+to\\s+(?:move|occupy)";

const CLAUSE_STOP = "(?!\\.|!|\\?)";
const FILLER = `(?:${CLAUSE_STOP}\\S+\\s+){0,5}?`;

// Matches "looking for room/flatmate", BUT ignores when preceded by "if you are looking for" or "is anyone looking for"
const DIRECT_OBJECT_RE = new RegExp(
  `(?<!\\b(?:if|is)\\s+(?:anyone|you)(?:'re|\\s+are)?\\s+(?:also\\s+)?)\\b(?:${INTENT_VERBS})\\b\\s+${FILLER}\\b(?:(?<place>${PLACE_WORDS})|(?<person>${PERSON_WORDS}))\\b`,
  "gi",
);

// ------------------------------------------------------------------
// 3. STRONG SEEKING PATTERNS
// ------------------------------------------------------------------

const SEEKING_PATTERNS: RegExp[] = [
  // "Looking for vacancy in [place]" / "looking for female vacancy"
  new RegExp(`\\b(?:${INTENT_VERBS})\\b\\s+${FILLER}\\b(?:female\\s+|male\\s+)?vacanc(?:y|ies)\\b`, "i"),

  // "Required for room / PG" / "Urgent requirement of room / flat" / "Flat requirement"
  new RegExp(`\\b(?:required|requirement)\\s+(?:for|of)\\s+(?:room|pg|flat|apartment|\\d+bhk|\\d+rk|bed|accommodation|place)\\b`, "i"),
  /\bflat\s+(?:\/\s+flatmate\s+)?requirement\b/i,
  /\burgent\s+requirement\s+(?:for|of|near)\b/i,

  // "Looking for flat / flatmate to hunt together / team up"
  /\b(?:hunt\s+for\s+a\s+flat\s+together|team\s+up|join\s+together\s+and\s+share|find\s+someone\s+who's\s+also\s+looking)\b/i,
  /\blooking\\s+for\\s+(?:a\\s+)?flatmate\\b.{0,60}\\b(?:hunt|find|explore|search)\\b.{0,30}\\b(?:together|place|flat)\\b/i,

  // "Anyone has / knows any room/flat/pg leads"
  /\b(?:does\\s+anyone\\s+know|anybody\\s+knows?|if\\s+(?:anyone|anybody)\\s+knows?|any\\s+references?|any\\s+leads?)\\b.{0,40}\\b(?:room|flat|pg|\\d+bhk|place|stay|accommodation)\\b/i,
  /\bif\\s+(?:anyone|you)\\s+have\\s+(?:any\\s+)?(?:leads?|details?|references?|direct\\s+owner|options?)\\b/i,
  /\bplease\\s+dm\\s+me\\b.{0,40}\b(?:leads?|details?|urgency|requirement|rent|photos)\b/i,
  /\bplease\\s+let\\s+me\\s+know\\s+if\\s+you\\s+have\\s+(?:any\\s+)?leads\b/i,
  /\bleads?\\s+appreciated\b/i,

  // "I am looking for a flat / room / 1bhk"
  /\b(?:i(?:'m| am)|we\s+are|me\s+and\s+my\s+friend\s+are)\s+(?:looking|searching|finding)\s+for\b.{0,30}\b(?:room|flat|pg|\d+bhk|\d+rk|house|place|accommodation)\b/i,
  /\blooking\s+(?:for|4)\s+(?:a\s+)?(?:shitty|decent|good|clean|affordable|female|male)?\s*(?:room|flat|pg|\d+bhk|\d+rk|apartment|house|place|roommate)\b/i,

  // "Looking for female shared flats to shift into" / "Looking to rent"
  /\blooking\s+for\s+(?:female|male|shared)?\s*(?:flats?|rooms?|pgs?)\s+to\s+(?:shift|move)\s+into\b/i,
  /\bneed\s+(?:a\s+)?(?:two|three|1|2|3)\s*(?:or\s+(?:two|three|1|2|3))?\s*bhk\b/i,
  /\bneed\s+(?:flat|room|pg|accommodation)\s+in\b/i,

  // "Suggestions / recommendations for PG / flat"
  /\b(?:need|please\s+suggest|give)\s+(?:recommendations?|suggestions?|good)?\s*(?:for\s+)?(?:a\s+)?(?:good\s+)?(?:ladies\s+|womens?\s+|girls?\s+|boys?\s+|mens?\s+)?(?:pg|flat|room|hostel)\b/i,
  /\bany\s+(?:1rk|1bhk|2bhk|pg|flat|room|flatmates?)\s+(?:for\s+\d+\s+months|near|in|around)\b/i,
  /\bis\s+anyone\s+looking\s+for\s+(?:a\s+)?(?:female\s+|male\s+)?flatmate\b/i,
  /\bif\s+anybody\s+knows\b/i,
];

// ------------------------------------------------------------------
// 4. STRONG OFFERING PATTERNS
// ------------------------------------------------------------------

const OFFERING_PATTERNS: RegExp[] = [
  // "[Place] for rent / on rent" (WHEN NOT preceded by "looking for / need / search / hunt")
  new RegExp(
    `(?<!\\b(?:looking\\s+for|need|want|seeking|search(?:ing)?\\s+for|hunt(?:ing)?\\s+for)\\s+${FILLER})` +
    `\\b(?:\\d+bhk|\\d+rk|bhk|rk|flat|apartment|villa|property|house|room|pg|hostel|accommodation)\\b` +
    `\\s+(?:(?:\\S+\\s+){0,4}?)?(?:for|on|available\\s+for)\\s+(?:rent|lease|sublet|sale|renting)\\b`,
    "i",
  ),
  /\bflat\s+for\s+renting\b/i,
  /\brent\s+flat\b/i,
  /\bfor\s+\d+k\s+rent\b/i,
  /\b\d+k\s+rent\b/i,

  // Availability / Ready to Move
  new RegExp(
    `\\b(?:${PLACE_WORDS})\\b\\s+${FILLER}\\b(?:is\\s+)?(?:${AVAILABLE_WORDS})\\b` +
    `|\\b(?:${AVAILABLE_WORDS})\\b\\s+${FILLER}\\b(?:${PLACE_WORDS})\\b` +
    `|\\bavailable\\s+from\\s+\\d+(?:st|nd|rd|th)?\\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\\b` +
    `|\\bavailable\\s+on\\s+immediate\\s+basis\\b` +
    `|\\bavailable\\s+immediately\\b` +
    `|\\bready\\s+to\\s+move(?:\\s+in)?\\b` +
    `|\\bimmediate\\s+(?:possession|move[- ]in|occupancy)\\b`,
    "i",
  ),

  // If you are looking for ... (advertisement addressing prospective tenant)
  /\bif\s+you(?:'re|\s+are)?\s+(?:also\s+)?looking\s+for\b/i,
  /\bif\s+anyone\s+interested\b/i,
  /\bfeel\s+free\s+to\s+come\s+see\b/i,
  /\bdoes\s+anyone\s+wants?\s+a\s+flatmate\b/i,

  // Spec Sheet & Pricing in Listing
  /\brent\s*[:\-]\s*(?:rs\.?|₹|inr)?\s*\d+/i,
  /\brent\s+(?:is\\s+|would\\s+be\\s+)?(?:rs\.?|₹|inr)?\\s*\\d+(?:k|\/|\b)/i,
  /\b(?:deposit|security\\s+deposit)\\s*[:\\-]?\s*(?:rs\.?|₹|inr)?\s*\d+/i,
  /\bcarpet\\s+area\\s*[:\\-]?\\s*\\d+\\s*(?:sq\.?\s*ft|sqft)/i,
  /\b(?:standalone|gated)\\s+(?:building|society)\\b/i,
  /\b(?:first\\s+tenant|brand\\s+new\\s+property|luxury\\s+of\\s+extra\\s+space)\\b/i,
  /\bno\\s+brokerage\b.{0,40}\b(?:single|double|hall)\s+occupancy\b/i,
  /\b(?:single|double|hall)\\s+occupancy\s+(?:in|available|near)\b/i,
  /\bprivate\\s+room\\s+\\d+k\\s+rental\b/i,
  /\bsteal\\s+deal\b.{0,30}\bsingle\\s+occupancy\b/i,
  /\boption\\s+1\s*[-—]?\s*empty\\s+flat\b/i,

  // Replacement / Takeover
  /\b(?:looking\\s+for|need|want|require)\\s+(?:a\s+)?(?:female\\s+|male\\s+|my\\s+)?replacement\b/i,
  /\breplacement\s+(?:needed|required|wanted)\b/i,
  /\bneed\\s+a\\s+replacement\\s+for\b/i,
  /\btake\\s+over\\s+(?:my|our|the)\\s+(?:room|flat|bed|spot)\\b/i,
  /\breplace\\s+me\\b/i,
  /\bvacating\\s+my\\s+(?:hostel|room|flat|pg)\b/i,

  // "I took / booked a flat" / "Two of us live in 2BHK... one room free"
  /\b(?:i|we)\s+(?:took|booked|have|got)\\s+(?:a\s+)?(?:flat|apartment|\d+bhk|room|house|place)\b/i,
  /\b(?:one|1)\s+room(?:'s| is)?\s+(?:free|vacant|available)\b/i,
  /\b(?:two|three|\d+)\s+of\\s+us\\s+(?:live|stay)\\s+in\\s+(?:a\\s+)?\d+bhk\b/i,
  /\blooking\\s+for\\s+(?:1\\s+more|my\\s+2nd|another)\\s+(?:flatmate|partner|roommate)\b/i,

  // "Flatmate sharing available in [locality] call for details"
  /\b(?:flatmate\\s+sharing|single\\s+occupancy|room|rooms)\\s+available\b/i,
  /\bflatmate\\s+sharing\s+(?:available|in|at|near)\b/i,
  /\bcall\\s+for\\s+(?:more\\s+)?details\b.{0,30}\d{10}\b/i,
  /\bcall\\s+for\\s+more\b.{0,30}\d{10}\b/i,
  /\b(?:whatsapp|call)\\s+for\\s+photos\b/i,
  /\bimmediate\\s+vacancy\s+(?:for|in)\b/i,
  /\bthe\\s+flat\\s+is\\s+well\\s+furnished\b/i,
  /\byou\\s+will\\s+get\\s+(?:a\\s+)?(?:separate|private)\\s+room\b/i,
  /\byou\\s+can\\s+visit\\s+flat\b/i,
  /\bupdated\\s+rental\\s+properties\\s+available\b/i,
];

// ------------------------------------------------------------------
// 5. EVALUATE
// ------------------------------------------------------------------

export function getListingType(post: RawPost): ListingType {
  const text = normalize(post.content);

  // 1. Immediate non-housing filters
  if (NON_HOUSING_ITEM_RE.test(text)) {
    return "not_housing";
  }

  const matchedNonListing = NON_LISTING_DISCUSSIONS.find((re) => re.test(text));
  if (matchedNonListing) {
    return "not_housing";
  }

  if (!HOUSING_SIGNAL.test(text)) {
    return "not_housing";
  }

  let seekScore = 0;
  let offerScore = 0;

  // Direct objects from verbs
  for (const m of text.matchAll(DIRECT_OBJECT_RE)) {
    if (m.groups?.place) {
      seekScore += 6;
    } else if (m.groups?.person) {
      offerScore += 6;
    }
  }

  // Seeking patterns
  for (const pat of SEEKING_PATTERNS) {
    if (pat.test(text)) {
      seekScore += 8;
    }
  }

  // Offering patterns
  for (const pat of OFFERING_PATTERNS) {
    if (pat.test(text)) {
      offerScore += 8;
    }
  }

  // Budget vs Rent specs
  if (/\bbudget\b\s*[:\-]?\s*(?:rs\.?|₹|inr)?\s*\d/i.test(text)) {
    seekScore += 3;
  }

  if (seekScore === 0 && offerScore === 0) {
    // Check short title-only listings (e.g. "Furnished Room Kalyani Nagar", "Single Hall occupancy Andheri West", "Affordable 3RK Fully Furnished")
    // If it mentions a property/occupancy type + locality and NO seeker intent, it is an offering listing
    if (
      /^(?:affordable\s+|furnished\s+|single\s+|double\s+)?(?:\d+bhk|\d+rk|\d+rks?|\d+bhks?|room|flat|apartment|single\s+hall\s+occupancy|hall\s+occupancy|occupancy)\b/i.test(
        text,
      ) &&
      text.length < 120
    ) {
      offerScore += 6;
    } else {
      return "ambiguous";
    }
  }

  const diff = seekScore - offerScore;
  if (Math.abs(diff) < 3) {
    return "ambiguous";
  }

  return diff > 0 ? "seeking_room" : "offering_room";
}
