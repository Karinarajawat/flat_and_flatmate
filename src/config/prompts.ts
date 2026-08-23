import { RawPost } from "@/types/post";

export function buildPrompt(post: RawPost): string {
  const today = new Date().toISOString().slice(0, 10);

  return `Extract structured data from this Indian room/flat rental post.

TODAY: ${today}

RULES:
- Extract only stated or unambiguously implied facts. Never invent.
- Set skip=true ONLY if this is not a rental offering OR a CORE field (rent, city, locality) is genuinely missing.
- Do NOT skip because optional/property details are missing. Keep incomplete but useful listings.
- If bhk, occupancy, gender, furnishing, address, amenities, rules, etc. are unknown, use a valid default only when safe; otherwise skip ONLY if the missing field prevents a useful listing.
- Do not use fake values such as rent=0.
- skip=true -> return ONLY {"skip":true}.
- skip=false -> return all required schema fields.
- Optional unknown fields: omit.
- Prices: 15k=15000, 1.2L=120000.
- Only extract rent/deposit/brokerage/setup_cost when stated. "No brokerage"=0.
- Future availability -> ISO date + available_immediately=false.
- Now/immediately OR no date -> available_immediately=true.
- carpet_area only when explicitly stated.
- add_ons=room/home features, furniture, appliances, services.
- amenities=building/society/security/parking facilities.
- house_rules=restrictions/permissions.
- neighborhood=only supported types with stated km distance.
- Use the most specific enum. "Others" only when explicitly stated and no enum matches.
- Never confuse Gas Stove/Gas Pipeline, Attached Bathroom/Others, Balcony/Others, Car Parking/Bike Parking.

MAPPINGS:
"attached/private/dedicated bathroom/washroom" -> add_ons: "Attached Bathroom"
"balcony/private/attached balcony" -> add_ons: "Balcony"
"gas stove/burner" -> add_ons: "Gas Stove"
"gas pipeline" -> amenities: "Gas Pipeline"
"modular kitchen" -> add_ons: "Modular Kitchen"
"fridge/refrigerator" -> add_ons: "Refrigerator"
"lift/elevator" -> amenities: "Lift"
"covered parking" -> amenities: "Covered Parking"
"car parking" -> amenities: "Car Parking"
"bike/two-wheeler parking" -> amenities: "Bike Parking"
"24x7/24/7 security" -> amenities: "24x7 Security"

POST:
"""
${post.content}
"""`;
}
