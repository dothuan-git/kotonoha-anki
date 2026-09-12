/**
 * Rebuilds every `card_states` row from `review_logs` (§5).
 *
 * The point is not repair — it is the check that card state really is a
 * projection. If this reports drift on a collection nobody has touched, then
 * something wrote a state the log does not imply, and that is a bug.
 *
 *   npm run recompute            # rebuild, reporting what moved
 *   npm run recompute -- --check # report only, write nothing
 *
 * Drift is expected exactly twice: after changing `request_retention` or any
 * other scheduler parameter (§4), which reschedules the whole collection by
 * design, and on rows written before the card state and its word shared one
 * creation timestamp.
 */
import { recomputeAllCardStates } from '../lib/db/review';

const check = process.argv.slice(2).includes('--check');

const report = await recomputeAllCardStates({ write: !check });

console.log(`${report.total} cards · ${report.unchanged} reproduced exactly`);

if (report.drifted.length === 0) {
  console.log('No drift. Every stored state folds out of the log.');
  process.exit(0);
}

console.log(`${report.drifted.length} ${check ? 'would change' : 'rewritten'}:`);
for (const row of report.drifted.slice(0, 20)) {
  console.log(`  ${row.cardId}  ${row.field}: ${format(row.stored)} → ${format(row.computed)}`);
}
if (report.drifted.length > 20) {
  console.log(`  … and ${report.drifted.length - 20} more`);
}

// A non-zero exit on --check makes this usable as a guard; a plain run is a
// repair and succeeds either way.
process.exit(check ? 1 : 0);

function format(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') return String(Math.fround(value));
  return String(value);
}
