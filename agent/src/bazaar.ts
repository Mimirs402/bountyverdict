/**
 * The Bazaar helper normally adds the HTTP method through its resource-server
 * extension. That extension validates schemas with runtime code generation,
 * which Cloudflare Workers intentionally disallow. Enriching this one static
 * declaration at build time produces the same wire format without eval.
 */
export function addHttpMethod<T extends Record<string, unknown>>(
  declaration: T,
  method: "GET" | "HEAD" | "DELETE" | "POST" | "PUT" | "PATCH",
): T {
  const bazaar = declaration.bazaar as {
    info?: { input?: { method?: string } };
  } | undefined;
  if (!bazaar?.info?.input) {
    throw new Error("Bazaar declaration is missing info.input.");
  }
  bazaar.info.input.method = method;
  return declaration;
}
