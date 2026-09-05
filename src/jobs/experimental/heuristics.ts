import { RawPost } from "@/types/post";
import { getListingType as getProdListingType } from "@/parsing/heuristics";

export type CandidateListingType =
  | "candidate_offering_room"
  | "candidate_seeking_room"
  | "candidate_ambiguous"
  | "candidate_not_housing";

export function getListingType(post: RawPost): CandidateListingType {
  const prodType = getProdListingType(post);
  switch (prodType) {
    case "offering_room":
      return "candidate_offering_room";
    case "seeking_room":
      return "candidate_seeking_room";
    case "ambiguous":
      return "candidate_ambiguous";
    case "not_housing":
      return "candidate_not_housing";
  }
}
