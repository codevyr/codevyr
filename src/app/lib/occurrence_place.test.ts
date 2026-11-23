import { describe, expect, it } from 'vitest';
import type { EdgeOccurrenceRowJson } from '../askld';
import { occurrencePlace, occurrenceSitesLabel } from './occurrence_place';

/** `file_operations.read ⇢ bt_bmc_read`: the row lies on the field in fs.h. */
const row: EdgeOccurrenceRowJson = {
  ref_id: '7',
  from_instance_id: '10',
  object_id: '1',
  path: '/linux/include/linux/fs.h',
  project_id: '86',
  start_offset: 58801,
  end_offset: 58865,
};

/** ...and it was made so by `.read = bt_bmc_read` in bt-bmc.c. */
const witnessed = (sites: number): EdgeOccurrenceRowJson => ({
  ...row,
  kinds: ['holds'],
  witness: {
    object_id: '2',
    path: '/linux/drivers/char/ipmi/bt-bmc.c',
    start_offset: 7135,
    end_offset: 7155,
    sites,
  },
});

describe('occurrencePlace: an occurrence is shown where it happened', () => {
  it('is the occurrence\'s own place when it has no witness', () => {
    const own = {
      object_id: '1',
      path: '/linux/include/linux/fs.h',
      project_id: '86',
      start_offset: 58801,
      end_offset: 58865,
    };
    expect(occurrencePlace(row)).toEqual(own);
    // What an engine that sends a null would mean, and a reference that
    // states what it does.
    expect(occurrencePlace({ ...row, witness: null })).toEqual(own);
    expect(occurrencePlace({ ...row, kinds: ['calls'] })).toEqual(own);
  });

  it('is the witness when it has one: its object, its path, its span', () => {
    expect(occurrencePlace(witnessed(1))).toEqual({
      object_id: '2',
      path: '/linux/drivers/char/ipmi/bt-bmc.c',
      // A witness is a place in an object of the same project.
      project_id: '86',
      start_offset: 7135,
      end_offset: 7155,
    });
  });

  it('keeps the project of a row that has none', () => {
    expect(occurrencePlace({ ...witnessed(1), project_id: null }).project_id).toBeNull();
  });

  it('does not change the row it reads', () => {
    const before = witnessed(3);
    const copy = JSON.parse(JSON.stringify(before));
    occurrencePlace(before);
    expect(before).toEqual(copy);
  });
});

describe('occurrenceSitesLabel: the place shown is the first of how many', () => {
  it('says nothing of an occurrence that has no witness', () => {
    expect(occurrenceSitesLabel(row)).toBeNull();
    expect(occurrenceSitesLabel({ ...row, witness: null })).toBeNull();
  });

  it('says nothing when the witness is the only place', () => {
    expect(occurrenceSitesLabel(witnessed(1))).toBeNull();
  });

  it('says the place is the first of several', () => {
    expect(occurrenceSitesLabel(witnessed(2))).toBe('first of 2');
    expect(occurrenceSitesLabel(witnessed(8))).toBe('first of 8');
    expect(occurrenceSitesLabel(witnessed(353))).toBe('first of 353');
  });

  it('says nothing of a count that is no count', () => {
    expect(occurrenceSitesLabel(witnessed(0))).toBeNull();
    expect(occurrenceSitesLabel(witnessed(Number.NaN))).toBeNull();
  });
});
