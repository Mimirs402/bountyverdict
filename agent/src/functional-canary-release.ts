const SEMANTIC_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+$/;

export type ActiveReleaseIdentity = {
  release_version: string;
  worker_version_id: string;
  updated_at: string;
  production_api: string;
};

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is missing or malformed.`);
  }
  return value as Record<string, unknown>;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validWorkerVersionId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
}

export function activeReleaseIdentity(manifest: unknown, productionApi: string): ActiveReleaseIdentity {
  const state = record(manifest, "Active agent manifest");
  if (state.status !== "active") throw new Error("Agent manifest is not active.");
  if (state.production_api !== productionApi) throw new Error("Agent manifest belongs to another production API.");
  if (typeof state.release_version !== "string" || !SEMANTIC_VERSION.test(state.release_version)) {
    throw new Error("Agent manifest has no valid release version.");
  }
  if (!validWorkerVersionId(state.worker_version_id)) {
    throw new Error("Agent manifest has no valid Worker version ID.");
  }
  if (!validTimestamp(state.updated_at)) throw new Error("Agent manifest has no valid activation timestamp.");
  return {
    release_version: state.release_version,
    worker_version_id: state.worker_version_id,
    updated_at: state.updated_at,
    production_api: productionApi,
  };
}

export function validateFunctionalCanaryRelease(
  canary: unknown,
  manifest: unknown,
  productionApi: string,
): ActiveReleaseIdentity {
  const identity = activeReleaseIdentity(manifest, productionApi);
  const state = record(canary, "Functional canary state");
  const release = record(state.release, "Functional canary release evidence");
  if (!validTimestamp(state.checked_at) || Date.parse(state.checked_at) < Date.parse(identity.updated_at)) {
    throw new Error("Functional canary evidence predates the active manifest.");
  }
  if (release.verified !== true || release.release_version !== identity.release_version ||
    release.mcp_server_version !== identity.release_version || release.worker_version_id !== identity.worker_version_id ||
    release.mcp_worker_version_id !== identity.worker_version_id || release.manifest_updated_at !== identity.updated_at) {
    throw new Error("Functional canary release evidence does not match the active manifest and live MCP server.");
  }
  return identity;
}
