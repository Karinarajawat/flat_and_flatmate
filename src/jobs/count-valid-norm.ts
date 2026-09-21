import fs from "fs";
import path from "path";

import { getListingType } from "@/parsing/heuristics";
import {
  getListingType as getCandidateListingType,
  CandidateListingType,
} from "@/jobs/experimental/heuristics";

import { FacebookPost, RedditPost } from "@/types/post";
import { configDotenv } from "dotenv";
import {
  COUNT_VALID_NORM_INPUT_FILES,
  COUNT_VALID_NORM_TARGET_COMMUNITIES,
} from "@/jobs/constants";

type NormalizedPost = RedditPost | FacebookPost;

type Stats = {
  total: number;
  valid: number;
  invalid: number;

  // Production heuristic
  offering: number;
  seeking: number;
  ambiguous: number;

  // Experimental heuristic
  candidateOffering: number;
  candidateSeeking: number;
  candidateAmbiguous: number;
  candidateNotHousing: number;
};

const candidateAmbiguousPosts: NormalizedPost[] = [];

function isValidRawPost(post: unknown): post is NormalizedPost {
  if (!post || typeof post !== "object") {
    return false;
  }

  const value = post as Record<string, unknown>;

  const hasCommonFields =
    (value.platform === "reddit" || value.platform === "facebook") &&
    typeof value.postId === "string" &&
    value.postId.length > 0 &&
    typeof value.author === "string" &&
    typeof value.content === "string" &&
    typeof value.timestamp === "string" &&
    typeof value.postUrl === "string" &&
    value.postUrl.length > 0 &&
    (value.imageUrls === undefined ||
      (Array.isArray(value.imageUrls) &&
        value.imageUrls.every((image) => typeof image === "string")));

  if (!hasCommonFields) {
    return false;
  }

  if (value.platform === "reddit") {
    return typeof value.subreddit === "string" && value.subreddit.length > 0;
  }

  return typeof value.groupId === "string" && value.groupId.length > 0;
}

function loadPosts(filePath: string): unknown[] {
  const absolutePath = path.resolve(filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found: ${absolutePath}`);
  }

  const raw = JSON.parse(fs.readFileSync(absolutePath, "utf8"));

  if (!Array.isArray(raw)) {
    throw new Error(`Expected ${absolutePath} to contain an array`);
  }

  return raw;
}

function getCommunityKey(post: NormalizedPost): string {
  if (post.platform === "reddit") {
    return `r/${post.subreddit}`;
  }

  return `group/${post.groupId}`;
}

function createStats(): Stats {
  return {
    total: 0,
    valid: 0,
    invalid: 0,

    offering: 0,
    seeking: 0,
    ambiguous: 0,

    candidateOffering: 0,
    candidateSeeking: 0,
    candidateAmbiguous: 0,
    candidateNotHousing: 0,
  };
}

/**
 * Percentage helper.
 *
 * All classification percentages should normally use VALID posts
 * as the denominator, because invalid posts are not classified.
 */
function percentage(value: number, total: number): string {
  if (total === 0) {
    return "0.00%";
  }

  return `${((value / total) * 100).toFixed(2)}%`;
}

function updateCandidateStats(
  stats: Stats,
  candidateType: CandidateListingType,
): void {
  switch (candidateType) {
    case "candidate_offering_room":
      stats.candidateOffering++;
      break;

    case "candidate_seeking_room":
      stats.candidateSeeking++;
      break;

    case "candidate_ambiguous":
      stats.candidateAmbiguous++;
      break;

    case "candidate_not_housing":
      stats.candidateNotHousing++;
      break;
  }
}

function main() {
  const overallStats = createStats();

  const communityStats = new Map<string, Stats>();

  for (const filePath of COUNT_VALID_NORM_INPUT_FILES) {
    let posts: unknown[];

    try {
      posts = loadPosts(filePath);
    } catch (error) {
      console.error(
        `[ERROR] ${filePath}:`,
        error instanceof Error ? error.message : String(error),
      );

      continue;
    }

    const fileStats = createStats();

    for (const rawPost of posts) {
      fileStats.total++;
      overallStats.total++;

      if (!isValidRawPost(rawPost)) {
        fileStats.invalid++;
        overallStats.invalid++;
        continue;
      }

      const communityKey = getCommunityKey(rawPost);

      if (
        COUNT_VALID_NORM_TARGET_COMMUNITIES.length > 0 &&
        !COUNT_VALID_NORM_TARGET_COMMUNITIES.includes(communityKey)
      ) {
        fileStats.invalid++;
        overallStats.invalid++;
        continue;
      }

      if (!communityStats.has(communityKey)) {
        communityStats.set(communityKey, createStats());
      }

      const community = communityStats.get(communityKey)!;

      fileStats.valid++;
      overallStats.valid++;

      community.total++;
      community.valid++;

      // --------------------------------
      // Production heuristic
      // --------------------------------

      const listingType = getListingType(rawPost);

      switch (listingType) {
        case "offering_room":
          fileStats.offering++;
          overallStats.offering++;
          community.offering++;
          break;

        case "seeking_room":
          fileStats.seeking++;
          overallStats.seeking++;
          community.seeking++;
          break;

        case "ambiguous":
          fileStats.ambiguous++;
          overallStats.ambiguous++;
          community.ambiguous++;
          break;
      }

      // --------------------------------
      // Experimental heuristic
      // --------------------------------

      const candidateResult = getCandidateListingType(rawPost);

      updateCandidateStats(fileStats, candidateResult.type);
      updateCandidateStats(overallStats, candidateResult.type);
      updateCandidateStats(community, candidateResult.type);

      if (
        candidateResult.type === "candidate_ambiguous" &&
        candidateAmbiguousPosts.length < 100
      ) {
        candidateAmbiguousPosts.push(rawPost);
      }
    }

    console.log(
      `${filePath}:\n` +
        `total=${fileStats.total}, ` +
        `valid=${fileStats.valid} (${percentage(
          fileStats.valid,
          fileStats.total,
        )}), ` +
        `invalid=${fileStats.invalid} (${percentage(
          fileStats.invalid,
          fileStats.total,
        )}), ` +
        `offering=${fileStats.offering} (${percentage(
          fileStats.offering,
          fileStats.valid,
        )}), ` +
        `seeking=${fileStats.seeking} (${percentage(
          fileStats.seeking,
          fileStats.valid,
        )}), ` +
        `ambiguous=${fileStats.ambiguous} (${percentage(
          fileStats.ambiguous,
          fileStats.valid,
        )}), ` +
        `candidateOffering=${fileStats.candidateOffering} (${percentage(
          fileStats.candidateOffering,
          fileStats.valid - fileStats.candidateNotHousing,
        )}), ` +
        `candidateSeeking=${fileStats.candidateSeeking} (${percentage(
          fileStats.candidateSeeking,
          fileStats.valid - fileStats.candidateNotHousing,
        )}), ` +
        `candidateAmbiguous=${fileStats.candidateAmbiguous} (${percentage(
          fileStats.candidateAmbiguous,
          fileStats.valid - fileStats.candidateNotHousing,
        )}), ` +
        `candidateNotHousing=${fileStats.candidateNotHousing} (${percentage(
          fileStats.candidateNotHousing,
          fileStats.valid,
        )})`,
    );
  }

  // --------------------------------
  // Community summary
  // --------------------------------

  console.log("\n--- Community Summary ---");

  const sortedCommunities = [...communityStats.entries()].sort(
    ([, a], [, b]) => b.candidateOffering - a.candidateOffering,
  );

  for (const [community, stats] of sortedCommunities) {
    console.log(
      `${community}:\n` +
        `total=${stats.total}, ` +
        `valid=${stats.valid} (${percentage(stats.valid, stats.total)}), ` +
        `invalid=${stats.invalid} (${percentage(
          stats.invalid,
          stats.total,
        )}), ` +
        `offering=${stats.offering} (${percentage(
          stats.offering,
          stats.valid,
        )}), ` +
        `seeking=${stats.seeking} (${percentage(
          stats.seeking,
          stats.valid,
        )}), ` +
        `ambiguous=${stats.ambiguous} (${percentage(
          stats.ambiguous,
          stats.valid,
        )}), ` +
        `candidateOffering=${stats.candidateOffering} (${percentage(
          stats.candidateOffering,
          stats.valid - stats.candidateNotHousing,
        )}), ` +
        `candidateSeeking=${stats.candidateSeeking} (${percentage(
          stats.candidateSeeking,
          stats.valid - stats.candidateNotHousing,
        )}), ` +
        `candidateAmbiguous=${stats.candidateAmbiguous} (${percentage(
          stats.candidateAmbiguous,
          stats.valid - stats.candidateNotHousing,
        )}), ` +
        `candidateNotHousing=${stats.candidateNotHousing} (${percentage(
          stats.candidateNotHousing,
          stats.valid,
        )})`,
    );
  }

  //   console.log("Ambigious posts");
  //   candidateAmbiguousPosts.forEach((post, index) => {
  //     console.log(`[${index}] ${JSON.stringify(post)}\n`);
  //   });
  // --------------------------------
  // Overall summary
  // --------------------------------

  console.log("\n--- Summary ---");

  console.log(`Total posts:          ${overallStats.total}`);

  console.log(
    `Valid posts:          ${overallStats.valid} (${percentage(
      overallStats.valid,
      overallStats.total,
    )})`,
  );

  console.log(
    `Invalid posts:        ${overallStats.invalid} (${percentage(
      overallStats.invalid,
      overallStats.total,
    )})`,
  );

  // --------------------------------
  // Production
  // --------------------------------

  console.log(
    `Offering:             ${overallStats.offering} (${percentage(
      overallStats.offering,
      overallStats.valid,
    )})`,
  );

  console.log(
    `Seeking:              ${overallStats.seeking} (${percentage(
      overallStats.seeking,
      overallStats.valid,
    )})`,
  );

  console.log(
    `Ambiguous:            ${overallStats.ambiguous} (${percentage(
      overallStats.ambiguous,
      overallStats.valid,
    )})`,
  );

  // --------------------------------
  // Experimental
  // --------------------------------

  console.log(
    `Candidate offering:   ${overallStats.candidateOffering} (${percentage(
      overallStats.candidateOffering,
      overallStats.valid - overallStats.candidateNotHousing,
    )})`,
  );

  console.log(
    `Candidate seeking:    ${overallStats.candidateSeeking} (${percentage(
      overallStats.candidateSeeking,
      overallStats.valid - overallStats.candidateNotHousing,
    )})`,
  );

  console.log(
    `Candidate ambiguous:  ${overallStats.candidateAmbiguous} (${percentage(
      overallStats.candidateAmbiguous,
      overallStats.valid - overallStats.candidateNotHousing,
    )})`,
  );

  console.log(
    `Candidate not housing:${overallStats.candidateNotHousing} (${percentage(
      overallStats.candidateNotHousing,
      overallStats.valid,
    )})`,
  );
}

main();
