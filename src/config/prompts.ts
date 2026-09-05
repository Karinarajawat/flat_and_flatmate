import { RawPost } from "@/types/post";

export function buildPrompt(post: RawPost): string {
  const today = new Date().toISOString().slice(0, 10);

  return `Extract structured data from this Indian room/flat rental post.

TODAY: ${today}

RULES:
- Extract only stated or unambiguously implied facts. Never invent.
- If any detail or field (such as rent, deposit, brokerage, setup_cost, floor, carpet_area, total_occupancy, contact_number, etc.) is not present in the post, simply skip/omit that field.
- Set skip=true ONLY if this is not a rental offering OR a core location field (city, locality) is genuinely missing.
- Do NOT skip because rent or optional property details are missing. Keep incomplete but useful listings and omit the missing fields.
- Do not use fake or default values such as rent=0. If rent is not stated in the post, omit the rent field entirely.
- Only extract rent/deposit/brokerage/setup_cost when stated. "No brokerage"=0. If brokerage is not mentioned, omit brokerage.
- skip=true -> return ONLY {"skip":true}.
- skip=false -> return valid extracted data omitting unstated optional fields.
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
