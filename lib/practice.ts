/**
 * Which page of the collection a practice session deals.
 *
 * Practice ignores due dates, so it needs an ordering of its own and a way to
 * walk it: the newest words first, then the fifty behind those, and so on.
 *
 * The position is a page number rather than a row offset because the
 * collection grows underneath it. Add ten words overnight and a stored offset
 * would deal a window straddling two of yesterday's pages; a page number
 * simply re-anchors to whatever is newest now.
 *
 * It wraps rather than ending. There is no "done" state to reach — finishing
 * the oldest page means starting again at the newest, which by then is a page
 * last seen several sessions ago.
 *
 * Pure, so the arithmetic is testable without a database. The boundaries are
 * the part worth pinning: an empty collection, a collection shorter than one
 * page, and a page number from a stored session the collection has since
 * outgrown.
 */
export function practicePage(
  requested: number,
  seenWords: number,
  cap: number,
): { page: number; pages: number } {
  const size = Math.max(1, Math.trunc(cap));
  // At least one page even with nothing to deal: a session of zero cards is a
  // finish screen, and `page 0 of 0` is not a thing to render.
  const pages = Math.max(1, Math.ceil(Math.max(0, seenWords) / size));
  // Two modulos with an addition between, so a negative page — from a corrupt
  // stored session, or `page - 1` walked off the front — lands inside the
  // range rather than staying negative.
  const page = ((Math.trunc(requested) % pages) + pages) % pages;
  return { page, pages };
}
