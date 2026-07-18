const FOCUSABLE_INPUT_IDS = new Set(["search-input", "resolver-query-input"]);

export function captureFocusState() {
  const active = document.activeElement;

  if (!FOCUSABLE_INPUT_IDS.has(active?.id)) return null;

  return {
    id: active.id,
    selectionStart: active.selectionStart ?? null,
    selectionEnd: active.selectionEnd ?? null,
  };
}

export function restoreFocusState(focusState) {
  if (!focusState?.id) return;

  // getElementById, not querySelector(`#${id}`): ids never need CSS escaping
  // this way, so an id with a colon/period can't throw.
  const input = document.getElementById(focusState.id);
  if (!input) return;

  input.focus();

  if (
    typeof focusState.selectionStart === "number" &&
    typeof focusState.selectionEnd === "number"
  ) {
    input.setSelectionRange(focusState.selectionStart, focusState.selectionEnd);
  }
}
