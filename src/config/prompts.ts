import { RawPost } from "@/types/post";

export function buildPrompt(post: RawPost): string {
  const today = new Date().toISOString().slice(0, 10);

  return `Extract structured data from this Indian room/flat rental post.

TODAY: ${today}

RULES:
- Extract only stated or unambiguously implied facts. Never invent, infer, or hallucinate. Be deterministic: if a REQUIRED field (listed below) is missing, empty, vague, or a placeholder/fake value, set skip=true. Do not guess or fill it in.
- Set skip=true if this is a whole-flat listing: the entire flat/apartment/BHK is offered for rent/sale as a whole (e.g. "flat for rent", "2BHK available/on rent", "looking for tenants/family") with NO room/hall sharing offered and NO flatmate/roommate/sharing sought. If rental_scope cannot be resolved to "room" or "hall", set skip=true.
- Set skip=true if this is not a rental offering.
- REQUIRED fields (all must be present and real, else skip=true): property.bhk, property.city, property.locality, rental_scope.type, pricing.rent, availability.available_immediately. property.attached_washroom is also always emitted (see below) but never triggers skip.
- Allowed defaults (the ONLY ones — never skip for these): property.address defaults to the locality/society string when no fuller address is stated (see address rule); rental_scope.capacity defaults to 1 for a private room with no sharing words (see rental_scope rule); property.furnished_status defaults to "unfurnished" when unknown; rental_scope.total_occupancy may be omitted when unknown. Nothing else may be defaulted.
- pricing.rent must be a realistic positive amount actually stated in the post as an explicit number. If rent is 0, 1, missing, "DM for rent", "Call for details", or clearly a placeholder, set skip=true. Do not use fake values such as rent=0 or rent=1. Never default or infer rent from deposit, budget, or similar listings.
- property.bhk must be exactly one of "1 RK", "1 BHK", "2 BHK", "3 BHK" as stated or unambiguously implied (see normalization below). If unknown, set skip=true.
- property.city must be a supported city. If missing or unknown, set skip=true.
- property.locality must be a specific, geocodable area name (not just a city name). If missing, empty, or too vague, set skip=true.
- property.address: emit the fullest address/location string stated in the post (flat/society name, street, landmark). A society name, locality, or landmark string is sufficient — either locality or society is required, any one of them works. Never invent house/flat numbers. When only locality/society is known, emit that string as the address (the pipeline appends ", locality, city" for geocoding). Omit only if neither locality nor any society/landmark is stated — but then locality itself would be missing and skip=true already applies.
- rental_scope.type must be "room" (private room offered) or "hall" (hall/drawing-room sharing offered). If neither can be resolved, set skip=true. rental_scope.capacity: emit stated sharing (single/one person=1, double/two sharing=2, triple/three sharing=3). A private room with no sharing words implies single occupancy — emit capacity 1 rather than skipping. Only hall-sharing with unknown occupancy may be omitted (then the pipeline defaults it to 1).
- availability.available_immediately is a required boolean, always emit it. Future availability -> availability.available_from ISO date + availability.available_immediately=false. Now/immediately OR no date -> availability.available_immediately=true.
- skip=true -> return ONLY {"skip":true}.
- skip=false -> return all required schema fields (property, rental_scope, pricing, availability, services, add_ons, amenities, house_rules, nearby_places). Optional unknown fields: omit. Never emit null. Never emit placeholder/fake values.
- Prices: 15k=15000, 1.2L=120000.
- Only extract pricing.rent/pricing.deposit/pricing.brokerage/pricing.setup_cost/pricing.move_in_charges when stated. "No brokerage"=0.
- property.carpet_area only when explicitly stated.
- property.furnished_status: emit exactly one of "unfurnished", "semi-furnished", "fully-furnished". Emit "unfurnished" when unknown. Never skip for this field.
- property.attached_washroom is a required boolean, always emit it. true only if an attached/private/dedicated bathroom/washroom for the offered room/hall is explicitly stated or unambiguously implied. false for shared/common washroom, no mention, or unknown (default). Never omit or emit null.
- property.bhk normalization: "1RK"/"1-RK"/"1 RK" -> "1 RK"; "1BHK"/"1-BHK" -> "1 BHK"; same for 2/3 BHK. Output exactly one of "1 RK", "1 BHK", "2 BHK", "3 BHK".
- rental_scope: type "room" for a private room, "hall" for hall/drawing-room sharing. capacity = people sharing the offered room/hall (single=1, double/two sharing=2, triple=3); a private room with no sharing words means capacity 1. total_occupancy = total people in the whole flat when stated, else omit.
- preferences: omit entirely if gender unknown. Never default. Output exactly "Male" or "Female" (capitalized), not "male"/"female".
- services=paid/unpaid help (cook, maid, housekeeping, laundry, other) with price/included when stated. add_ons=room/home features, furniture, appliances — never put cook/maid/housekeeping/laundry in add_ons.
- amenities=building/society/security/parking facilities.
- house_rules=restrictions/permissions.
- nearby_places=only supported types (Railway Station, Metro, Bus Stop, Airport) with stated name. Output type+name only, never distance.
- Use the most specific enum. "Others" only when explicitly stated and no enum matches.
- Never confuse Gas Stove/Gas Pipeline, Attached Bathroom/Others, Balcony/Others, Car Parking/Bike Parking.
- Use comments to resolve ambiguities. If the OP says "taken", "rented", "booked", or "filled" in comments, set skip=true.
- If the OP clarifies details in comments (rent amount, availability, gender preference, etc.), prefer the comment over the post body.

MAPPINGS:
"attached/private/dedicated bathroom/washroom (to the offered room/hall)" -> property.attached_washroom: true (canonical; do NOT emit add_ons "Attached Bathroom" for this case)
"shared/common bathroom/washroom" -> property.attached_washroom: false
"balcony/private/attached balcony" -> add_ons: "Balcony"
NOTE: add_ons "Attached Bathroom" is reserved for whole-flat attached baths explicitly not tied to the offered room; room-attached cases use property.attached_washroom only.
"gas stove/burner" -> add_ons: "Gas Stove"
"gas pipeline" -> amenities: "Gas Pipeline"
"modular kitchen" -> add_ons: "Modular Kitchen"
"fridge/refrigerator" -> add_ons: "Refrigerator"
"lift/elevator" -> amenities: "Lift"
"covered parking" -> amenities: "Covered Parking"
"car parking" -> amenities: "Car Parking"
"bike/two-wheeler parking" -> amenities: "Bike Parking"
"24x7/24/7 security" -> amenities: "24x7 Security"
"cook/food/tiffin/meals" -> services: "cook"
"bai/cleaning/safai/house help" -> services: "maid"
"laundry/washing clothes" -> services: "laundry"
"single occupancy/one person" -> rental_scope.capacity 1
"double occupancy/two sharing" -> rental_scope.capacity 2
"triple occupancy/three sharing" -> rental_scope.capacity 3
"hall/drawing room sharing" -> rental_scope.type "hall"
"private room" with no sharing words -> rental_scope.type "room", rental_scope.capacity 1

POST:
"""
${post.content}
"""

COMMENTS:
"""
${post.comments?.map((c) => `u/${c.author}: ${c.body}`).join("\n") ?? "No comments available."}
"""`;
}
