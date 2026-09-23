import { RawPost } from "@/types/post";

export type CandidateListingType =
  | "candidate_offering_room"
  | "candidate_seeking_room"
  | "candidate_ambiguous"
  | "candidate_not_housing";

export interface ClassificationResult {
  type: CandidateListingType;
  offerScore: number;
  seekScore: number;
}

// ------------------------------------------------------------------
// 0. NORMALIZATION
// ------------------------------------------------------------------

const TYPO_MAP: [RegExp, string][] = [
  [/\broomate(s)?\b/gi, "roommate$1"],
  [/\bflatmmate(s)?\b/gi, "flatmate$1"],
  [/\bflatmet(s)?\b/gi, "flatmate$1"],
  [/\bfaltmate(s)?\b/gi, "flatmate$1"],
  [/\bvaccan(t|cy)\b/gi, "vacan$1"],
  [/\baccomodation(s)?\b/gi, "accommodation$1"],
  [/\bappartment(s)?\b/gi, "apartment$1"],
  [/\btennant(s)?\b/gi, "tenant$1"],
  [/\btenent(s)?\b/gi, "tenant$1"],
  [/\bavailble\b/gi, "available"],
  [/\bavailabe\b/gi, "available"],
  [/\brecomm?endation(s)?\b/gi, "recommendation$1"],
  [/\brecco(s)?\b/gi, "recommendation$1"],
  [/\bintrested\b/gi, "interested"],
  [/\bfurnised\b/gi, "furnished"],
];

// Covers most emoji blocks used in these listings (🏠🚨📍💰🔐🛏️🍗📩 etc.)
const EMOJI_RE =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu;

// "2 BHK" / "2-BHK" / "1 RK" -> "2bhk" / "1rk" so every pattern that treats
// "Nbhk" as a single token (place noun) works regardless of the source
// spacing. Without this, "Available 2 BHK" silently fails to match because
// the digit gets consumed as filler before the BHK pattern can claim it.
const UNIT_RE = /(\d)\s*[-/]?\s*(bhk|rk)\b/gi;

// Strip parenthetical inserts like "(male)" / "(female)" that break word boundaries.
const PAREN_RE = /\(([^)]*)\)/g;

function normalize(rawContent: string): string {
  let t = rawContent;
  t = t.replace(/&amp;/gi, "&").replace(/&#x200b;/gi, " ");
  t = t.replace(/\u2019/g, "'").replace(/\u2018/g, "'");
  t = t.replace(EMOJI_RE, " ");
  t = t.replace(/https?:\/\/\S+/g, " ");
  // Decode common HTML entities
  t = t.replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'");
  // Strip parenthetical inserts — they break word boundaries
  // "flatmate(male)" -> "flatmate male"
  t = t.replace(PAREN_RE, " $1 ");
  // Markdown listings put one attribute per line ("Rent: X" / "Deposit: Y"
  // / "Available: Z") that belong together — newlines must NOT become hard
  // clause breaks, or those get read as unrelated sentences. Only real
  // sentence punctuation (. ! ?) acts as a clause boundary below.
  t = t.replace(/\s+/g, " ").trim().toLowerCase();
  for (const [pat, repl] of TYPO_MAP) t = t.replace(pat, repl);
  t = t.replace(UNIT_RE, (_, d, unit) => `${d}${unit}`);
  return t;
}

// ------------------------------------------------------------------
// 1. RELEVANCE — is this even a housing post?
// ------------------------------------------------------------------

const HOUSING_SIGNAL = new RegExp(
  "\\b(?:" +
    "\\d+bhk|\\d+rk|bhk|rk|pg|flat(?:mate)?s?|room(?:mate)?s?|roomie(?:s)?|" +
    "apartment|accommodation|tenant(?:s)?|landlord|brokerage|broker|sublet|" +
    "lease|co-?living|hostel|vacant|vacancy|occupancy|paying\\s+guest|" +
    "rent(?:ed|ing|al)?" +
    ")\\b",
  "i",
);

// ------------------------------------------------------------------
// 2. VOCAB
// ------------------------------------------------------------------

// NOTE: deliberately excludes past-tense/passive forms (needed, wanted,
// required). "Flatmate required" is a passive construction ("required"
// describes the flatmate), not a verb reaching forward for an object.
// Treating "required" as a forward-looking verb made it falsely latch
// onto an unrelated noun later in the sentence (e.g. "...required in a
// spacious 1BHK..." was misread as "required [something] ... 1bhk", i.e.
// seeking). Passive forms are handled separately by NEEDED_PERSON_RE /
// NEEDED_PLACE_RE below.
const INTENT_VERBS =
  "looking\\s+(?:out\\s+)?for|look(?:ing)?\\s+for|need|want|" +
  "seeking|search(?:ing)?\\s+for|in\\s+search\\s+of|require|requires|finding|" +
  "find|hunting\\s+for|hunt\\s+for|on\\s+the\\s+hunt\\s+for";

const PLACE_WORDS =
  "rooms?|bedrooms?|flats?|apartments?|\\d+rks?|\\d+bhks?|pgs?|accommodations?|" +
  "occupanc(?:y|ies)|beds?|space|place\\s+to\\s+(?:stay|live)|" +
  "rented?\\s+place|rental\\s+(?:flat|room|apartment|place)|" +
  "hostels?|co-?living|stays?|vacanc(?:y|ies)";

const PERSON_WORDS =
  "flatmates?|roommates?|room\\s*mates?|roomies?|tenants?|lodgers?|" +
  "occupants?|co-?livers?|(?:paying\\s+)?guests?|replacements?";

const AVAILABLE_WORDS =
  "available|vacant|up\\s+for\\s+grabs|free\\s+to\\s+(?:move|occupy)";

// up to 4 filler words, but never crosses a real sentence boundary
const CLAUSE_STOP = "(?!\\.|!|\\?)";
const FILLER = `(?:${CLAUSE_STOP}\\S+\\s+){0,4}?`;
const FILLER_6 = `(?:${CLAUSE_STOP}\\S+\\s+){0,6}?`;

// Single regex, non-greedy filler: whichever noun-class (place vs person)
// is CLOSEST to the intent verb wins the "direct object" role. This is
// what correctly separates "need a flatmate for a 2BHK" (offering — the
// nearest noun to "need" is "flatmate") from "looking for a room in a
// shared 2/3BHK flat" (seeking — nearest noun is "room"), instead of the
// old approach where both nouns anywhere nearby scored equally and
// cancelled each other out.
const DIRECT_OBJECT_RE = new RegExp(
  `\\b(?:${INTENT_VERBS})\\b\\s+${FILLER}\\b(?:(?<place>${PLACE_WORDS})|(?<person>${PERSON_WORDS}))\\b`,
  "gi",
);

const AVAILABILITY_RE = new RegExp(
  `\\b(?:${PLACE_WORDS})\\b\\s+${FILLER}\\b(?:is\\s+)?(?:${AVAILABLE_WORDS})\\b` +
    `|\\b(?:${AVAILABLE_WORDS})\\b\\s+${FILLER}\\b(?:${PLACE_WORDS})\\b`,
  "i",
);

// "if anyone HAS an available room, DM me" / "if you have a room
// available" — grammatically this is the SEEKER asking whether someone
// else possesses a place, not a description of the author's own listing.
// Checked before AVAILABILITY_RE or it gets misread as an offer.
const REQUEST_AVAILABILITY_RE = new RegExp(
  `\\bif\\s+(?:anyone|you)\\s+(?:has|have)\\b\\s+${FILLER}\\b(?:an?\\s+)?(?:${AVAILABLE_WORDS})\\b` +
    `|\\bif\\s+(?:anyone|you)\\s+(?:has|have)\\b\\s+${FILLER}\\b(?:${PLACE_WORDS})\\b\\s+${FILLER}\\b(?:${AVAILABLE_WORDS})\\b` +
    `|\\bknows?\\s+of\\s+(?:one|any)\\b` +
    `|\\bhmu\\s+if\\s+you\\s+have\\b`,
  "i",
);

const NEEDED_PERSON_RE = new RegExp(
  `\\b(?:${PERSON_WORDS})\\b\\s+${FILLER}\\b(?:needed|required|wanted)\\b`,
  "i",
);

const NEEDED_PLACE_RE = new RegExp(
  `\\b(?:${PLACE_WORDS})\\b\\s+${FILLER}\\b(?:needed|required|wanted)\\b`,
  "i",
);

const REPLACEMENT_RE = new RegExp(
  `\\b(?:replacement|someone|person)\\b\\s+(?:${CLAUSE_STOP}\\S+\\s+){0,3}?\\b(?:required|needed|wanted|to\\s+take\\s+over)\\b` +
    `|\\btake\\s+over\\s+(?:my|our|the)\\s+(?:room|flat|bed|spot)\\b` +
    `|\\breplace\\s+me\\b`,
  "i",
);

const JOIN_EXISTING_RE = new RegExp(
  `\\b(?:join|share)\\s+(?:my|our)\\s+(?:flat|room|apartment|place)\\b` +
    `|\\b(?:my|our)\\s+(?:flat|room|apartment)\\b\\s+(?:${CLAUSE_STOP}\\S+\\s+){0,4}?\\b(?:available|vacant|join)\\b`,
  "i",
);

const ALREADY_STAYING_RE = new RegExp(
  `\\b\\d+\\s*(?:people|person|guys?|girls?|boys?|of\\s+us)\\s+(?:already\\s+)?(?:staying|living)\\b` +
    `.{0,60}\\b(?:need|looking\\s+for|require)\\b.{0,25}\\b(?:room\\s*mate|flatmate|person|people)s?\\b`,
  "i",
);

const OWNER_DIRECT_RE = new RegExp(
  `\\b(?:direct(?:ly)?\\s+)?(?:deal|contact)\\s+(?:with\\s+)?owner\\b` +
    `|\\bno\\s+brokerage\\b.{0,60}\\bowner\\b` +
    `|\\bowner\\s*[:\\-]`,
  "i",
);

const BUDGET_RE = /\bbudget\b\s*[:\-]?\s*(?:of\s+)?(?:rs\.?|₹|inr)?\s*\d/i;
// Relaxed rent listing: "rent 6.5k" / "rent: 6.5k" / "rent is 10.5k"
const RENT_LISTING_RE =
  /\brent\s*(?:[:\-]|is|would\s+be)?\s*(?:rs\.?|₹|inr)?\s*\d/i;

const FIRST_PERSON_SEEKER_RE = new RegExp(
  `\\bi(?:'m| am)\\s+(?:a\\s+)?(?:working\\s+professional|bachelor|student|male|female|\\d{2}[mf])\\b.{0,100}` +
    `\\b(?:looking\\s+for|need|want|seeking|searching\\s+for|shifted|moving|relocat\\w+)\\b`,
  "i",
);

// "moving to pune" / "shifted to delhi" / "relocating to mumbai" / "looking to move"
// — seeking signal (author is relocating and needs housing)
const RELOCATING_RE = new RegExp(
  `\\b(?:moving|shifted|relocating|shifting)\\s+to\\s+\\w+.{0,60}` +
    `\\b(?:looking\\s+for|need|want|searching|finding)\\b` +
  `|\\b(?:moving|relocating|shifting|coming)\\s+to\\s+(?:pune|mumbai|bangalore|delhi|hyderabad|chennai)\\b`,
  "i",
);

// "DM if interested" / "DM for details" — offering signal.
const DM_OFFERING_RE =
  /\bdm\s+(?:if\s+(?:anyone\s+is\s+)?interested|for\s+(?:more\s+)?(?:details|info|video|pics|photos)|to\s+know\s+more)\b/i;

// "2BHK for rent" / "Flat for Sale" / "2bhk on rent" — clear offering signals.
// But NOT when preceded by "looking for" context.
const FOR_RENT_SALE_RE =
  /\b(?:flat|apartment|bhk|rk|pg|hostel|accommodation|property|\d+bhk|\d+rk)\s+(?:for|on)\s+(?:rent|sale)\b/i;

// "looking for X for rent" — this is seeking, not offering
const LOOKING_FOR_RENT_RE = new RegExp(
  `\\b(?:${INTENT_VERBS})\\b\\s+${FILLER_6}\\b(?:for|on)\\s+rent\\b`,
  "i",
);

// "Vacancy available" — clear offering signal.
// But NOT "vacancy near X" where the person is looking for a vacancy nearby.
// Only fires when "available" / "in" comes right after vacancy-word.
const VACANCY_RE = /\bvacanc(?:y|ies)\s+(?:available)\b/i;

// "need tenants" / "require tenants" / "genuine tenants" / "immediate ... tenants"
const TENANTS_RE =
  /\b(?:need|want|require|genuine|immediate)\s+(?:\S+\s+){0,2}(?:tenants?|tenents?)\b/i;

// "I have a room/flat" / "we have a room" — offering signals.
const HAVE_PLACE_RE =
  /\b(?:i|we)\s+have\s+(?:a|an|the)\s+(?:room|flat|apartment|bhk|rk|place|accommodation)\b/i;

// "Requirement of room" / "Requirement for flat" — seeking signals.
const REQUIREMENT_RE =
  /\brequirement\s+(?:of|for)\s+(?:a\s+)?(?:room|flat|apartment|bhk|accommodation)\b/i;

// "wanted a flatmate" / "wanted a roommate" — offering signals (past tense of want).
const WANTED_PERSON_RE =
  /\bwanted\s+(?:a|an|the)?\s*(?:flatmate|roommate|room\s*mate|tenant|person|people)\b/i;

// --- NEW PATTERNS ---

// "rent out" / "want to rent out" — offering signal
const RENT_OUT_RE = /\b(?:want|going|looking)\s+to\s+rent\s+out\b/i;

// "planning to rent" / "going to rent" — offering signals.
const PLANNING_TO_RENT_RE =
  /\b(?:planning|going)\s+to\s+(?:rent|rental|sublet)\b/i;

// Price in text: "@ 33k" / "₹8500" / "55k negotiable" / "8500/-" / "8.5k"
// These are strong offering signals — seekers use "budget" not prices.
const PRICE_TAG_RE =
  /(?:@|₹|rs\.?|inr)\s*\d[\d,]*\.?\d*k?\b|\b\d[\d,]*\.?\d*k?\s*(?:\/[-\s]*(?:month|person)?|per\s*(?:month|person)|pm|negotiable)\b/i;

// "one room free" / "room is free" / "room's free" — offering
const FREE_PLACE_RE =
  /\b(?:one|1|a)\s+(?:room|bed|space|seat)\s+(?:is\s+)?free\b|\broom'?s?\s+free\b/i;

// "anyone looking for" + place-word — the author is offering
const ANYONE_LOOKING_FOR_PLACE_RE = new RegExp(
  `\\banyone\\s+looking\\s+(?:for)?\\s+${FILLER}\\b(?:${PLACE_WORDS})\\b`,
  "i",
);

// "is anyone looking for" + person-word — the author is seeking
const ANYONE_LOOKING_FOR_PERSON_RE = new RegExp(
  `\\b(?:is\\s+)?anyone\\s+looking\\s+for\\s+${FILLER}\\b(?:${PERSON_WORDS})\\b`,
  "i",
);

// "help me" / "please help" / "pls share" — seeking signal
const SEEKING_HELP_RE =
  /\b(?:help\s+me|please\s+help|pls\s+help|kindly\s+help|can\s+(?:anyone|someone)\s+help|(?:pls|please)\s+share)\b/i;

// "any leads" / "share leads" / "leads appreciated" / "DM if you have leads" — seeking
const LEADS_RE =
  /\b(?:any\s+leads?|share\s+(?:leads?|contacts?)|leads?\s+(?:appreciated|welcome|would\s+help)|\bdm\b.{0,25}\b(?:if\s+(?:you\s+have\s+)?(?:any\s+)?leads?|leads?\s+appreciated|any\s+leads?)\b)/i;

// "DM me" / "DM for" broad offering signal (only boosts when other offer signals present)
const DM_BROAD_RE = /\bdm\b.{0,30}\b(?:me|for)\b/i;

// Structured listing detection: posts with multiple structured fields like
// "Rent: X" / "Deposit: X" / "Location: X" are almost always offerings.
const STRUCTURED_FIELD_RE =
  /\b(?:rent|deposit|security|location|furnish(?:ed|ing)|amenities|move[\s-]?in|possession|carpet\s*area|society)\s*[:\-]\s*/gi;

// Short posts that are just a title-like offering: "2bhk on rent in dighi"
// or "1bhk Magarpatta" — contain a place unit but no verb signals.
const SHORT_PLACE_TITLE_RE =
  /^\s*(?:\d+bhk|\d+rk|flat|apartment|pg|hostel)\b.{0,80}$/i;

// "can anyone give me" / "give me a room" — seeking
const GIVE_ME_RE =
  /\b(?:can\s+(?:anyone|someone)\s+give\s+me|give\s+me\s+(?:a\s+)?(?:room|flat|place|pg))\b/i;

// "looking for recommendation" / "suggest" / "suggestions" — not a listing
const RECOMMENDATION_RE =
  /\b(?:recommendation|suggest(?:ion)?s?|advic?e|tips?|guidance|opinion)\b/i;

// Selling items pattern — not housing
const SELLING_RE =
  /\b(?:selling|for\s+sale|sell(?:ing)?)\s+(?:my|a|an|the|few|some)?\s*(?:table|chair|bed|laptop|cooler|sofa|fridge|ac|mattress|furniture|items?|samsung|lg)\b/i;

// "complete guide" / blog post pattern — not housing
const BLOG_RE =
  /\b(?:complete\s+guide|guide\s+to|tips\s+for|review)\b/i;

// Comparison/advice questions — not housing
const COMPARISON_RE =
  /\b(?:vs|versus)\b|\bwhat\s+would\s+you\s+choose\b|\bwhich\s+(?:is|one)\s+better\b/i;

// "is it normal" / "should I" — question, not listing
const QUESTION_RE =
  /\b(?:is\s+it\s+normal|should\s+i\b|do\s+i\s+(?:have|need)\s+to)\b/i;

// "wanna ask" / "want to ask" / "question about" — question, not a listing
const ASKING_RE = /\b(?:wanna|want\s+to)\s+ask\b|\bquestion\s+(?:about|regarding)\b/i;

// App/service promo posts
const PROMO_RE =
  /\b(?:my\s+app|our\s+app|i\s+(?:made|built|created)\s+(?:a|an)\s+app|flatmate\s+finder\s+app)\b/i;

// "adopt" / "puppy" / "kitten" — clearly not housing
const PET_RE = /\b(?:adopt(?:ing)?|puppy|puppies|kitten|dog\b)/i;

// "we are N guys/people" looking for a flat — seeking (group of people)
const GROUP_SEEKING_RE =
  /\b(?:we\s+are|i\s+am\s+with)\s+(?:\d+|two|three|four)\s+(?:guys?|people|persons?|boys?|girls?|friends?|males?|females?)\b/i;

// "N guys for Xbhk" — seeking pattern (common in flat/flatmate subreddits)
const N_PEOPLE_FOR_PLACE_RE =
  /\b(?:\d+|two|three|four)\s+(?:guys?|people|persons?|boys?|girls?|friends?)\s+for\s+(?:\d+bhk|\d+rk|flat|apartment)\b/i;

// "you will get" — offering pattern (landlord/roommate describing amenities)
const YOU_WILL_GET_RE =
  /\byou\s+will\s+get\b/i;

// "available rental properties" / "properties available" — offering
const AVAILABLE_RENTAL_RE =
  /\b(?:available\s+)?rental\s+(?:properties|flats?|rooms?|apartments?)\b|\b(?:properties|flats?|rooms?)\s+available\b/i;

// Very short posts (<20 chars) that are just a single word or fragment
// These are too ambiguous to classify — treat as not housing
const MIN_CONTENT_LENGTH = 15;

// --- FALSE POSITIVE REJECTION PATTERNS ---

// Subscription / plan sales: "Nobroker Subscription", "NoBroker Freedom Plan"
// These are not housing listings — someone selling their subscription credits.
const SUBSCRIPTION_RE =
  /\b(?:subscription|subscri[bp]tion|freedom\s+plan|lite\s+plan|basic\s+plan)\b/i;

// Broker bulk ads: "1 & 2 BHK Flats Available for Rent", "Contact for details & site visit"
// Multiple unit types listed together + contact CTA = agent/broker bulk ad.
const BROKER_BULK_RE = new RegExp(
  "\\b(?:\\d+\\s*(?:&|and)\\s*\\d+\\s*bhk|flats?\\s+available\\s+for\\s+rent)\\b"
  + ".{0,60}\\b(?:contact\\s+(?:for|for\\s+details|for\\s+more)|site\\s+visit|budget.friendly\\s+options)\\b",
  "i",
);

// Ultra-short title-only posts: "Searching for a roommate" with no rent/location/bhk details.
// These are too vague to classify as offering — treat as not_housing.
// Used with a length check: text.length < 40 && !ULTRA_SHORT_HAS_DETAILS_RE.test(text)
const ULTRA_SHORT_HAS_DETAILS_RE =
  /\b(?:rent|deposit|₹|rs\.?|inr|\d+bhk|bhk|location|move[\s-]?in|furnish)\b/i;

// --- FALSE NEGATIVE FIX PATTERNS ---

// "still looking for a flat" / "haven't found a flat" / "I do not have a flat"
// When the author explicitly says they don't have a flat, they're a SEEKER regardless
// of other flatmate-related words in the post.
const STILL_LOOKING_FOR_FLAT_RE =
  /\b(?:still\s+(?:looking|searching|seeking)\s+(?:for\s+)?(?:a\s+)?(?:flat|room|apartment|place|accommodation)|haven'?t\s+(?:found|got)\s+(?:a\s+)?(?:flat|room|apartment)|don'?t\s+(?:have|has)\s+(?:a\s+)?(?:flat|room|apartment|place)|i\s+do\s+not\s+have\s+(?:a\s+)?(?:flat|room|apartment|place))\b/i;

// "join in our apartment" / "join us" — author HAS a flat and needs people.
// Broader than JOIN_EXISTING_RE which requires "join my/our <place>".
const JOIN_IN_OUR_RE =
  /\bjoin\s+(?:in\s+)?(?:us|our)\b|\b(?:us|our)\s+(?:flat|room|apartment|place)\s+(?:is|are)\s+(?:available|vacant|free)\b/i;

// "bed beside mine is empty" / "bed is free" / "seat is empty" — PG/hostel offering.
// The author has a bed/seat available and needs a roommate.
const BED_EMPTY_RE =
  /\b(?:bed|seat|cot)\s+(?:beside|next\s+to)\s+(?:mine|my\s+bed)\s+(?:is\s+)?(?:empty|free|available)\b|\b(?:bed|seat|cot)\s+(?:is\s+)?(?:empty|free|available)\b/i;

// Whole-flat rental without flatmate context: "Flat for rent", "2 BHK on rent",
// "2BHK... rent 80k". Only rejects when NO flatmate/roommate/sharing language is present.
// Uses a gap-tolerant pattern since "flat" and "rent" may be separated by descriptions.
const WHOLE_FLAT_RENT_RE =
  /\b(?:flat|apartment|bhk|rk|pg|hostel|1rk|1bhk|2bhk|3bhk)\b.{0,50}\b(?:for|on|rent(?:ing|al)?)\b\s*\w+\b|\b(?:flat|apartment|bhk|rk|pg|hostel|1rk|1bhk|2bhk|3bhk)\b.{0,30}\brent\b/i;

// "looking for decent tenants" / "need tenants" — whole-flat rental seeking tenants,
// NOT flatmate context. The word "tenants" alone doesn't make it a flatmate listing.
const WHOLE_FLAT_TENANTS_RE =
  /\b(?:looking|searching)\s+(?:for|out\s+for)\s+(?:decent\s+)?tenants?\b/i;

// "found a flat/2bhk... need people" — offering (they have a place, need people)
const FOUND_PLACE_RE = new RegExp(
  `\\bfound\\s+${FILLER}\\b(?:${PLACE_WORDS})\\b`,
  "i",
);

// "looking to move" / "looking to shift" — seeking
const LOOKING_TO_MOVE_RE =
  /\b(?:looking|planning|going)\s+to\s+(?:move|shift|relocate)\b/i;

// "our flatmates is leaving" / "flatmate leaving" — offering (they need replacement)
const FLATMATE_LEAVING_RE =
  /\b(?:flatmate|roommate)\s+(?:is\s+)?(?:leaving|moving\s+out|vacating)\b/i;

// "need some advice" / "need advice" — not a listing
const NEED_ADVICE_RE =
  /\bneed\s+(?:some\s+)?(?:advice|help|guidance|tips|suggestion)\b/i;

const NON_LISTING_RE: RegExp[] = [
  /\bwhich\s+area\b.{0,20}\b(?:stay|rent|live|better)\b/i,
  /\b(?:what(?:'s|\s+is)\s+(?:the\s+)?(?:rent|price)|how(?:'s|\s+is)\s+(?:the\s+)?rent|what\s+is\s+cheaper|how\s+much\s+(?:is|does)\b.{0,20}\brent)\b/i,
  /\bdoes\s+it\s+make\s+sense\b/i,
  /\bhelp\s+me\s+decide\b/i,
  /\banyone\s+(?:stayed?|staying|lived?|living|has\s+experience)\s+(?:at|in|with)\b/i,
  /\bworth\s+it\b/i,
  /^\s*review\b/i,
  /\bany\s+(?:whatsapp|telegram)\s+group\b/i,
  /\bhow\s+(?:is|'s)\s+(?:the\s+)?(?:area|locality|neighborhood|neighbourhood)\b/i,
  SELLING_RE,
  BLOG_RE,
  COMPARISON_RE,
  QUESTION_RE,
  ASKING_RE,
  PROMO_RE,
  PET_RE,
  NEED_ADVICE_RE,
  /\bwhat\s+percentage\b/i,
  /\bout\s+of\s+curiosity\b/i,
  /\bhow\s+much\s+(?:do|does|should)\s+(?:you|i|one)\s+(?:spend|pay)\b/i,
  /\bhow'?s?\s+(?:it|the\s+experience)\b/i,
  /\bcan\s+i\s+get\b.{0,30}\b(?:flat|room|pg|bhk|accommodation)\b/i,
  /\bi'?m?\s+(?:evaluating|considering)\b/i,
];

// ------------------------------------------------------------------
// 3. CLASSIFY
// ------------------------------------------------------------------

export function getListingType(post: RawPost): ClassificationResult {
  const text = normalize(post.content);
  const zero: ClassificationResult = { type: "candidate_not_housing", offerScore: 0, seekScore: 0 };

  if (!HOUSING_SIGNAL.test(text)) {
    return zero;
  }

  // Very short posts (single word, fragments) are too ambiguous
  if (text.length < MIN_CONTENT_LENGTH) {
    return zero;
  }

  // --- EARLY REJECTION GATES ---

  // Subscription / plan sales: "Nobroker Subscription", "Freedom Plan"
  if (SUBSCRIPTION_RE.test(text)) {
    return zero;
  }

  // Broker bulk ads: "1 & 2 BHK Flats Available for Rent", "Contact for details & site visit"
  if (BROKER_BULK_RE.test(text)) {
    return zero;
  }

  const isNonListing = NON_LISTING_RE.some((re) => re.test(text));

  let seekScore = 0;
  let offerScore = 0;

  for (const m of text.matchAll(DIRECT_OBJECT_RE)) {
    if (m.groups?.place) seekScore += 6;
    else if (m.groups?.person) offerScore += 6;
  }

  // REQUEST_AVAILABILITY_RE must be checked before AVAILABILITY_RE —
  // "if anyone has an available room" is a seeker asking, not an offer.
  if (REQUEST_AVAILABILITY_RE.test(text)) {
    seekScore += 6;
  } else if (AVAILABILITY_RE.test(text)) {
    offerScore += 8;
  }

  // --- OFFERING SIGNALS ---
  const offerSignals: [RegExp, number][] = [
    [NEEDED_PERSON_RE, 8],
    [REPLACEMENT_RE, 8],
    [JOIN_EXISTING_RE, 7],
    [ALREADY_STAYING_RE, 7],
    [JOIN_IN_OUR_RE, 7],
    [VACANCY_RE, 6],
    [TENANTS_RE, 6],
    [RENT_OUT_RE, 6],
    [WANTED_PERSON_RE, 6],
    [FREE_PLACE_RE, 6],
    [BED_EMPTY_RE, 6],
    [OWNER_DIRECT_RE, 5],
    [RENT_LISTING_RE, 5],
    [HAVE_PLACE_RE, 5],
    [PLANNING_TO_RENT_RE, 5],
    [ANYONE_LOOKING_FOR_PLACE_RE, 5],
    [STRUCTURED_FIELD_RE, 5],
    [AVAILABLE_RENTAL_RE, 5],
    [FLATMATE_LEAVING_RE, 5],
    [DM_OFFERING_RE, 4],
    [YOU_WILL_GET_RE, 4],
    [FOUND_PLACE_RE, 4],
  ];

  for (const [re, pts] of offerSignals) {
    if (re === STRUCTURED_FIELD_RE) {
      const m = text.match(re);
      if (m && m.length >= 2) offerScore += pts;
    } else if (re.test(text)) {
      offerScore += pts;
    }
  }

  // "for rent" / "for sale" — offering signal, BUT if preceded by "looking for" it's seeking
  if (FOR_RENT_SALE_RE.test(text)) {
    if (LOOKING_FOR_RENT_RE.test(text)) {
      seekScore += 4;
    } else {
      offerScore += 6;
    }
  }

  // Price tag without "budget" context — offering signal
  if (PRICE_TAG_RE.test(text) && !BUDGET_RE.test(text)) offerScore += 4;

  // "DM me" / "DM for" in offering context — mild boost (needs existing offer signals)
  if (DM_BROAD_RE.test(text) && offerScore > 0) offerScore += 2;

  // Short title-like posts: "2bhk on rent in dighi", "1bhk Magarpatta"
  if (text.length < 80 && SHORT_PLACE_TITLE_RE.test(text) && seekScore === 0) {
    offerScore += 4;
  }

  // --- SEEKING SIGNALS ---
  const seekSignals: [RegExp, number][] = [
    [NEEDED_PLACE_RE, 8],
    [REQUIREMENT_RE, 6],
    [GIVE_ME_RE, 6],
    [ANYONE_LOOKING_FOR_PERSON_RE, 5],
    [N_PEOPLE_FOR_PLACE_RE, 5],
    [BUDGET_RE, 4],
    [LEADS_RE, 4],
    [GROUP_SEEKING_RE, 4],
    [FIRST_PERSON_SEEKER_RE, 3],
    [RELOCATING_RE, 3],
    [SEEKING_HELP_RE, 3],
    [LOOKING_TO_MOVE_RE, 3],
  ];

  for (const [re, pts] of seekSignals) {
    if (re.test(text)) seekScore += pts;
  }

  // --- FALSE POSITIVE REJECTION ---
  // "still looking for a flat" / "haven't found a flat" — override offer signals.
  if (STILL_LOOKING_FOR_FLAT_RE.test(text)) {
    seekScore += 10;
    offerScore = Math.max(0, offerScore - 8);
  }

  // ---------------------------------------------------------------
  // Non-listing gate
  // ---------------------------------------------------------------

  // Ultra-short title-only posts: "Searching for a roommate" with no rent/location/bhk
  // details. These are too vague to classify as offering.
  if (text.length < 40 && !ULTRA_SHORT_HAS_DETAILS_RE.test(text)) {
    return { type: "candidate_not_housing", offerScore, seekScore };
  }

  // Whole-flat rental without flatmate context: "Flat for rent", "2 BHK on rent"
  // Only rejects when NO flatmate/roommate/sharing language is present.
  if (
    WHOLE_FLAT_RENT_RE.test(text) &&
    !/\b(?:flatmate|roommate|room\s*mate|sharing|occupancy|join)s?\b/i.test(text)
  ) {
    return { type: "candidate_not_housing", offerScore, seekScore };
  }

  // "looking for decent tenants" — whole-flat rental, not flatmate context
  if (WHOLE_FLAT_TENANTS_RE.test(text)) {
    return { type: "candidate_not_housing", offerScore, seekScore };
  }

  if (isNonListing && seekScore === 0 && offerScore === 0) {
    return { type: "candidate_not_housing", offerScore, seekScore };
  }

  if (isNonListing && Math.max(seekScore, offerScore) < 6) {
    return { type: "candidate_not_housing", offerScore, seekScore };
  }

  if (seekScore === 0 && offerScore === 0) {
    return { type: "candidate_ambiguous", offerScore, seekScore };
  }

  const diff = seekScore - offerScore;
  if (Math.abs(diff) < 3) {
    return { type: "candidate_ambiguous", offerScore, seekScore };
  }

  const type = diff > 0 ? "candidate_seeking_room" : "candidate_offering_room";
  return { type, offerScore, seekScore };
}
