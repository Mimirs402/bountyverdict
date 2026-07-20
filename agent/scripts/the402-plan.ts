import {
  THE402_API,
  THE402_PROVIDER_ID,
  THE402_SUBSCRIPTION_PLAN,
} from "../src/the402-catalog.ts";

const apiKey = process.env.THE402_API_KEY;
const enabled = process.env.THE402_PLAN === "YES";

if (!enabled) throw new Error("Set THE402_PLAN=YES to create or update the subscription plan.");
if (!apiKey || !/^sk_[A-Za-z0-9_-]{8,}$/.test(apiKey)) {
  throw new Error("THE402_API_KEY is missing or invalid.");
}

async function platformFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${THE402_API}${path}`, {
    ...init,
    redirect: "error",
    headers: {
      "X-API-Key": apiKey!,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
}

const catalog = await fetch(`${THE402_API}/plans?limit=100`, {
  redirect: "error",
  signal: AbortSignal.timeout(30_000),
});
if (!catalog.ok) throw new Error(`the402 plan catalog returned HTTP ${catalog.status}.`);
const catalogPayload = await catalog.json() as Record<string, any>;
const plans = Array.isArray(catalogPayload.plans) ? catalogPayload.plans : [];
const existing = plans.filter((plan: any) =>
  plan?.provider_id === THE402_PROVIDER_ID && plan?.name === THE402_SUBSCRIPTION_PLAN.name
);
if (existing.length > 1) throw new Error("the402 contains duplicate BountyVerdict subscription plans.");
const previous = existing[0];
if (previous && (typeof previous.id !== "string" || !/^plan_[A-Za-z0-9_-]{1,160}$/.test(previous.id))) {
  throw new Error("the402 returned an invalid existing plan ID.");
}

const payload = {
  name: THE402_SUBSCRIPTION_PLAN.name,
  description: THE402_SUBSCRIPTION_PLAN.description,
  interval: THE402_SUBSCRIPTION_PLAN.interval,
  price_usd: THE402_SUBSCRIPTION_PLAN.provider_price_usd,
  service_ids: THE402_SUBSCRIPTION_PLAN.service_ids,
  max_requests: THE402_SUBSCRIPTION_PLAN.max_requests,
};
const response = await platformFetch(previous ? `/plans/${previous.id}` : "/plans", {
  method: previous ? "PUT" : "POST",
  body: JSON.stringify(payload),
});
if (!response.ok) {
  throw new Error(`the402 subscription plan returned HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
}
const result = await response.json() as Record<string, any>;
const planId = previous?.id || result.plan?.id || result.data?.id || result.id;
if (typeof planId !== "string" || !/^plan_[A-Za-z0-9_-]{1,160}$/.test(planId)) {
  throw new Error("the402 did not return a valid subscription plan ID.");
}
console.log(JSON.stringify({
  action: previous ? "updated" : "created",
  plan_id: planId,
  name: THE402_SUBSCRIPTION_PLAN.name,
  provider_price_usd: THE402_SUBSCRIPTION_PLAN.provider_price_usd,
  maximum_monthly_requests: THE402_SUBSCRIPTION_PLAN.max_requests,
  service_count: THE402_SUBSCRIPTION_PLAN.service_ids.length,
}, null, 2));

export {};
