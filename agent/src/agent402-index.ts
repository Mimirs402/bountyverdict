export const AGENT402_INDEX_PAGE_LIMIT = 250;
export const AGENT402_INDEX_MAX_PAGES = 50;
export const AGENT402_INDEX_MAX_PAGE_BYTES = 2_000_000;

export type Agent402Seller = Record<string, unknown> & {
  origin: string;
};

type Agent402IndexPage = {
  page: number;
  pages: number;
  perPage: number;
  totalSellers: number | null;
  sellers: Agent402Seller[];
};

function boundedInteger(value: unknown, label: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) {
    throw new Error(`Agent402 ${label} is malformed or unbounded.`);
  }
  return Number(value);
}

export function parseAgent402IndexPage(value: unknown, expectedPage: number): Agent402IndexPage {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Agent402 index response is malformed.");
  }
  const payload = value as Record<string, unknown>;
  const page = boundedInteger(payload.page, "page", AGENT402_INDEX_MAX_PAGES - 1);
  const pages = boundedInteger(payload.pages, "page count", AGENT402_INDEX_MAX_PAGES);
  const perPage = boundedInteger(payload.perPage, "page size", AGENT402_INDEX_PAGE_LIMIT);
  if (page !== expectedPage || pages === 0 || page >= pages || perPage === 0) {
    throw new Error("Agent402 pagination contract drifted.");
  }
  if (!Array.isArray(payload.sellers) || payload.sellers.length > perPage) {
    throw new Error("Agent402 seller page is malformed or unbounded.");
  }
  const sellers = payload.sellers.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || typeof (entry as Record<string, unknown>).origin !== "string") {
      throw new Error("Agent402 seller entry is malformed.");
    }
    return entry as Agent402Seller;
  });
  const totals = payload.totals;
  const totalSellers = totals && typeof totals === "object" && !Array.isArray(totals)
    ? boundedInteger((totals as Record<string, unknown>).sellers, "seller total", 100_000)
    : null;
  return { page, pages, perPage, totalSellers, sellers };
}

export async function readAgent402SellerIndex(input: {
  apiUrl: string;
  targetOrigin: string;
  timeoutMs: number;
  fetchFn?: typeof fetch;
}): Promise<{
  seller: Agent402Seller | null;
  pagesScanned: number;
  sellersScanned: number;
  ecosystemSellers: number | null;
}> {
  const fetchFn = input.fetchFn || fetch;
  let expectedPages: number | null = null;
  let ecosystemSellers: number | null = null;
  let sellersScanned = 0;
  let seller: Agent402Seller | null = null;

  for (let pageNumber = 0; pageNumber < (expectedPages ?? 1); pageNumber += 1) {
    const url = new URL(input.apiUrl);
    url.searchParams.set("page", String(pageNumber));
    url.searchParams.set("limit", String(AGENT402_INDEX_PAGE_LIMIT));
    const response = await fetchFn(url, {
      headers: { "User-Agent": "bountyverdict-directory-monitor" },
      signal: AbortSignal.timeout(input.timeoutMs),
    });
    if (!response.ok) throw new Error(`Agent402 index page ${pageNumber} returned HTTP ${response.status}.`);
    const body = await response.text();
    if (body.length > AGENT402_INDEX_MAX_PAGE_BYTES) throw new Error("Agent402 index page is unbounded.");
    const page = parseAgent402IndexPage(JSON.parse(body), pageNumber);
    if (expectedPages === null) {
      expectedPages = page.pages;
      ecosystemSellers = page.totalSellers;
    } else if (page.pages !== expectedPages || page.perPage !== AGENT402_INDEX_PAGE_LIMIT) {
      throw new Error("Agent402 pagination changed during the bounded scan.");
    }
    sellersScanned += page.sellers.length;
    const matches = page.sellers.filter((entry) => entry.origin === input.targetOrigin);
    if (matches.length > 1 || (matches.length === 1 && seller)) {
      throw new Error("Agent402 index contains a duplicate target origin.");
    }
    if (matches.length === 1) seller = matches[0];
  }

  return {
    seller,
    pagesScanned: expectedPages ?? 0,
    sellersScanned,
    ecosystemSellers,
  };
}
