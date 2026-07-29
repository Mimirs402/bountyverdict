import {
  buildOpportunityTrigger,
  type OpportunityCandidate,
} from "./opportunity-agent-workflow.ts";

type TriggerEvent = ReturnType<typeof buildOpportunityTrigger>;

export async function coordinateOpportunityTrigger({
  candidates,
  rememberedOpportunityFingerprints,
  checkedAt,
  pendingTriggerId,
  writeTrigger,
}: {
  candidates: readonly OpportunityCandidate[];
  rememberedOpportunityFingerprints: unknown;
  checkedAt: string;
  pendingTriggerId: string | null;
  writeTrigger: (trigger: NonNullable<TriggerEvent["trigger"]>) => Promise<void>;
}): Promise<TriggerEvent> {
  const event = buildOpportunityTrigger(
    pendingTriggerId === null ? candidates : [],
    rememberedOpportunityFingerprints,
    checkedAt,
  );
  if (event.trigger) await writeTrigger(event.trigger);
  return event;
}
