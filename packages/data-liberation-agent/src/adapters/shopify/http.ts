/**
 * Attempt to fetch a Shopify JSON endpoint. Returns null if the store blocks it.
 */
export async function fetchShopifyJson<T>(url: string): Promise<T | null> {
  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DataLiberation/1.0)',
        Accept: 'application/json',
      },
    });
    if (!resp.ok) {
      await resp.body?.cancel();
      return null;
    }
    return (await resp.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Paginate through a Shopify JSON list endpoint (?limit=250&page=N).
 */
export async function fetchShopifyPaginated<T>(baseUrl: string, key: string): Promise<T[]> {
  const items: T[] = [];
  let page = 1;
  const maxPages = 20; // safety limit
  while (page <= maxPages) {
    const sep = baseUrl.includes('?') ? '&' : '?';
    const url = `${baseUrl}${sep}limit=250&page=${page}`;
    const data = await fetchShopifyJson<Record<string, T[]>>(url);
    if (!data || !data[key] || data[key].length === 0) break;
    items.push(...data[key]);
    if (data[key].length < 250) break;
    page++;
  }
  return items;
}
