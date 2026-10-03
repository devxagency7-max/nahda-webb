/* --------------------------------------------------------------------------
   PAGING HELPER
   The backend caps every paged list at 100 rows per request
   (FRONTEND_COMPLETE_GUIDE.md §1: "limit أقصاه 100"), so asking for a bigger
   `limit` is not a bigger page. fetchAllPages() walks the pages instead and
   hands back the whole list; screens that only want to *draw* part of it
   (first 50 + "تحميل المزيد") slice it client-side.
   -------------------------------------------------------------------------- */

export const MAX_PAGE_LIMIT = 100;
// Runaway guard only (5,000 rows at the max page size) — a real roster is far below it.
const MAX_PAGES = 50;

/**
 * @template T
 * @param {(page: number, limit: number) => Promise<{items?: T[], total?: number, totalCount?: number, totalPages?: number}>} fetchPage
 * @returns {Promise<{items: T[], total: number}>}
 *   Every item across all pages, de-duplicated by `id` (a row added/removed
 *   between two page requests can shift across a page boundary).
 */
export async function fetchAllPages(fetchPage) {
  const first = await fetchPage(1, MAX_PAGE_LIMIT);
  const items = [...((first && first.items) || [])];

  const reportedTotal = (first && (first.total ?? first.totalCount)) ?? items.length;
  const totalPages = Math.min(
    (first && first.totalPages) || Math.ceil(reportedTotal / MAX_PAGE_LIMIT) || 1,
    MAX_PAGES
  );

  if (totalPages > 1) {
    // Pages 2..N together, not one after another — the rate limit (600/min/user)
    // leaves plenty of room for a handful of requests.
    const rest = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, i) => fetchPage(i + 2, MAX_PAGE_LIMIT))
    );
    rest.forEach(result => items.push(...((result && result.items) || [])));
  }

  const seen = new Set();
  const unique = items.filter(item => !seen.has(item.id) && seen.add(item.id));
  return { items: unique, total: unique.length };
}
