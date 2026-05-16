import {
  createPrecomputedSetDetailsLoader,
  describePrecomputedSetSource,
} from "../setDetails/precomputedSetDetails";

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
