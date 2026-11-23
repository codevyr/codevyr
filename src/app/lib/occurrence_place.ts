/**
 * Where an occurrence of an edge is shown.
 *
 * AN OCCURRENCE IS SHOWN WHERE IT HAPPENED: AT ITS WITNESS WHEN IT HAS ONE,
 * AT ITS OWN PLACE OTHERWISE.
 *
 * A reference lies on the token that names the target, and that is where it
 * happened.  A relation (`declares`, `holds`) lies on the declaration of its
 * source: `file_operations.read ⇢ bt_bmc_read` over the field in fs.h, the
 * same line for every function the slot holds.  Its witness is one place in
 * the code that made it so (`.read = bt_bmc_read` in bt-bmc.c), the first in
 * file order, with how many there are.
 *
 * This file is the only place that knows a witness from a row.  Whatever
 * lists an occurrence, opens it, loads its file or copies its path asks
 * here, and never reads the row's own `object_id`, `path` or offsets.
 */
import type { EdgeOccurrenceRowJson } from '../askld';

/** One span of one file: what the code view is pointed at. */
export interface OccurrencePlace {
  object_id: string;
  path: string;
  project_id: string | null;
  start_offset: number;
  end_offset: number;
}

/** The place an occurrence is listed at and opens at. */
export function occurrencePlace(row: EdgeOccurrenceRowJson): OccurrencePlace {
  // A witness is a place in an object of the row's own project.
  const at = row.witness ?? row;
  return {
    object_id: at.object_id,
    path: at.path,
    project_id: row.project_id,
    start_offset: at.start_offset,
    end_offset: at.end_offset,
  };
}

/**
 * What to say beside that place when it stands for several: `first of 8`.
 * Null when the place is the occurrence's own, or the only one.
 */
export function occurrenceSitesLabel(row: EdgeOccurrenceRowJson): string | null {
  const sites = row.witness?.sites;
  if (sites === undefined || !(sites > 1)) {
    return null;
  }
  return `first of ${sites}`;
}
