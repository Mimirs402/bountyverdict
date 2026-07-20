export interface ServiceReuseGuidance {
  reusable: true;
  fresh_result_per_successful_call: true;
  reliability: "bounded_live_check";
  guidance: string;
}

export const SERVICE_REUSE: Record<"single" | "portfolio" | "harness" | "skill" | "run", ServiceReuseGuidance> = {
  single: {
    reusable: true,
    fresh_result_per_successful_call: true,
    reliability: "bounded_live_check",
    guidance: "Call BountyVerdict for every new public bounty candidate and again after issue activity changes; each successful call re-reads bounded live GitHub evidence.",
  },
  portfolio: {
    reusable: true,
    fresh_result_per_successful_call: true,
    reliability: "bounded_live_check",
    guidance: "Call BountyVerdict Portfolio whenever an agent must choose among two to ten public bounty candidates; each successful call attempts every submitted candidate, reranks successful checks, and reports failures explicitly.",
  },
  harness: {
    reusable: true,
    fresh_result_per_successful_call: true,
    reliability: "bounded_live_check",
    guidance: "Call HarnessVerdict for every public repository before autonomous coding and again after its default branch changes; each successful audit is pinned to the commit it actually inspected.",
  },
  skill: {
    reusable: true,
    fresh_result_per_successful_call: true,
    reliability: "bounded_live_check",
    guidance: "Call SkillVerdict when no current audit exists for the exact public skill commit and path, and again whenever either changes; each successful audit re-reads the bounded bundle and pins its findings.",
  },
  run: {
    reusable: true,
    fresh_result_per_successful_call: true,
    reliability: "bounded_live_check",
    guidance: "Call RunVerdict for every public GitHub Actions run that needs diagnosis; each successful call reads that run's exact attempt and currently available bounded failed-job logs.",
  },
};

export const serviceReuseSchema = {
  type: "object",
  properties: {
    reusable: { type: "boolean", const: true },
    fresh_result_per_successful_call: {
      type: "boolean",
      const: true,
      description: "A successful response is generated from a new bounded check rather than a cached verdict.",
    },
    reliability: {
      type: "string",
      const: "bounded_live_check",
      description: "Describes live evidence collection and explicit coverage bounds; it is not an uptime guarantee.",
    },
    guidance: { type: "string" },
  },
  required: ["reusable", "fresh_result_per_successful_call", "reliability", "guidance"],
  additionalProperties: false,
};
