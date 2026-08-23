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
  [/\broomate(s)?\b/gi, "roommate$1"],
  [/\bflatmmate(s)?\b/gi, "flatmate$1"],
  [/\bflatmet(s)?\b/gi, "flatmate$1"],
  [/\bvaccan(t|cy)\b/gi, "vacan$1"],
  [/\baccomodation(s)?\b/gi, "accommodation$1"],
  [/\bappartment(s)?\b/gi, "apartment$1"],
  [/\btennant(s)?\b/gi, "tenant$1"],
  [/\bavailble\b/gi, "available"],
  [/\bavailabe\b/gi, "available"],
];

// Covers most emoji blocks used in these listings (🏠🚨📍💰🔐🛏️🍗📩 etc.)
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu;

// "2 BHK" / "2-BHK" / "1 RK" -> "2bhk" / "1rk" so every pattern that treats
// "Nbhk" as a single token (place noun) works regardless of the source
// spacing. Without this, "Available 2 BHK" silently fails to match because
// the digit gets consumed as filler before the BHK pattern can claim it.
const UNIT_RE = /(\d)\s*[-/]?\s*(bhk|rk)\b/gi;

function normalize(rawContent: string): string {
  let t = rawContent;
  t = t.replace(/&amp;/gi, "&").replace(/&#x200b;/gi, " ");
  t = t.replace(/\u2019/g, "'").replace(/\u2018/g, "'");
  t = t.replace(EMOJI_RE, " ");
  t = t.replace(/https?:\/\/\S+/g, " ");
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
  "rented?\\s+place|rental\\s+(?:flat|room|apartment|place)";

const PERSON_WORDS =
  "flatmates?|roommates?|room\\s*mates?|roomies?|tenants?|lodgers?|" +
  "occupants?|co-?livers?|(?:paying\\s+)?guests?";

const AVAILABLE_WORDS =
  "available|vacant|up\\s+for\\s+grabs|free\\s+to\\s+(?:move|occupy)";

// up to 4 filler words, but never crosses a real sentence boundary
const CLAUSE_STOP = "(?!\\.|!|\\?)";
const FILLER = `(?:${CLAUSE_STOP}\\S+\\s+){0,4}?`;

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
    `|\\bknows?\\s+of\\s+(?:one|any)\\b`,
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

const BUDGET_RE = /\bbudget\b\s*[:\-]?\s*(?:rs\.?|₹|inr)?\s*\d/i;
const RENT_LISTING_RE = /\brent\s*[:\-]\s*(?:rs\.?|₹|inr)?\s*\d/i;

const FIRST_PERSON_SEEKER_RE = new RegExp(
  `\\bi(?:'m| am)\\s+(?:a\\s+)?(?:working\\s+professional|bachelor|student|male|female|\\d{2}[mf])\\b.{0,100}` +
    `\\b(?:looking\\s+for|need|want|seeking|searching\\s+for|shifted|moving|relocat\\w+)\\b`,
  "i",
);

const RELOCATING_RE = new RegExp(
  `\\b(?:moving|shifted|relocating|shifting)\\s+to\\s+\\w+.{0,60}` +
    `\\b(?:looking\\s+for|need|want|searching|finding)\\b`,
  "i",
);

const DM_LEADS_RE =
  /\bdm\b.{0,25}\b(?:if\s+(?:you\s+have\s+)?(?:any\s+)?leads?|leads?\s+appreciated|any\s+leads?)\b/i;
const DM_INTERESTED_RE =
  /\bdm\b.{0,20}\b(?:if\s+interested|for\s+(?:more\s+)?(?:details|info|video)|to\s+know\s+more)\b/i;

const NON_LISTING_RE: RegExp[] = [
  /\bwhich\s+area\b.{0,20}\b(?:stay|rent|live|better)\b/i,
  /\bwhat\s+is\s+cheaper\b/i,
  /\bhow(?:'s| is)\s+(?:the\s+)?rent\b/i,
  /\bwhat(?:'s| is)\s+the\s+(?:rent|price)\b/i,
  /\bhow\s+much\s+(?:is|does)\b.{0,20}\brent\b/i,
  /\bdoes\s+it\s+make\s+sense\b/i,
  /\bhelp\s+me\s+decide\b/i,
  /\banyone\s+(?:stayed?|staying|lived?|living|has\s+experience)\s+(?:at|in|with)\b/i,
  /\bworth\s+it\b/i,
  /\bguide\b/i,
  /^\s*review\b/i,
];

// ------------------------------------------------------------------
// 3. CLASSIFY
// ------------------------------------------------------------------

export function getListingType(post: RawPost): ListingType {
  const text = normalize(post.content);

  if (!HOUSING_SIGNAL.test(text)) {
    return "not_housing";
  }

  let seekScore = 0;
  let offerScore = 0;

  for (const m of text.matchAll(DIRECT_OBJECT_RE)) {
    if (m.groups?.place) seekScore += 6;
    else if (m.groups?.person) offerScore += 6;
  }

  if (REQUEST_AVAILABILITY_RE.test(text)) {
    seekScore += 6;
  } else if (AVAILABILITY_RE.test(text)) {
    offerScore += 8;
  }
  if (NEEDED_PERSON_RE.test(text)) offerScore += 8;
  if (NEEDED_PLACE_RE.test(text)) seekScore += 8;
  if (REPLACEMENT_RE.test(text)) offerScore += 8;
  if (JOIN_EXISTING_RE.test(text)) offerScore += 7;
  if (ALREADY_STAYING_RE.test(text)) offerScore += 7;
  if (OWNER_DIRECT_RE.test(text)) offerScore += 5;
  if (BUDGET_RE.test(text)) seekScore += 2;
  if (RENT_LISTING_RE.test(text)) offerScore += 2;
  if (FIRST_PERSON_SEEKER_RE.test(text)) seekScore += 3;
  if (RELOCATING_RE.test(text)) seekScore += 3;
  if (DM_LEADS_RE.test(text)) seekScore += 3;
  if (DM_INTERESTED_RE.test(text)) offerScore += 2;

  if (seekScore === 0 && offerScore === 0) {
    return "ambiguous";
  }

  const isNonListing = NON_LISTING_RE.some((re) => re.test(text));
  if (isNonListing && Math.max(seekScore, offerScore) < 8) {
    return "ambiguous";
  }

  const diff = seekScore - offerScore;
  if (Math.abs(diff) < 3) {
    return "ambiguous";
  }

  return diff > 0 ? "seeking_room" : "offering_room";
}
