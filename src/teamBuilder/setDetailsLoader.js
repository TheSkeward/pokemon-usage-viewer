import {
  createPrecomputedSetDetailsLoader,
  describePrecomputedSetSource,
} from "../setDetails/precomputedSetDetails";

/**
 * @param {{getFamily: function(): string, getSelection: function(): Object,
 *     onUpdate: function(): void}} hooks
 * @return {Object} Precomputed set-details loader with `describeSource`
 *     attached.
 */
export function createTeamBuilderSetDetailsLoader({
  getFamily,
  getSelection,
  onUpdate,
}) {
  const loader = createPrecomputedSetDetailsLoader({
    getFamily,
    getSelection,
    onUpdate,
  });

  return {
    ...loader,
    describeSource: describePrecomputedSetSource,
  };
}
