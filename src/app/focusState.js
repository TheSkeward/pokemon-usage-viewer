const FOCUSABLE_INPUT_IDS = new Set(["search-input", "resolver-query-input"]);

/**
 * Captures which tracked search input has focus so a full re-render can hand
 * it back via restoreFocusState.
 * @return {?{id: string, selectionStart: ?number, selectionEnd: ?number}}
 *     Null when focus is outside the tracked inputs.
 */
export function captureFocusState() {
  const active = document.activeElement;

  if (!FOCUSABLE_INPUT_IDS.has(active?.id)) return null;

  return {
    id: active.id,
    selectionStart: active.selectionStart ?? null,
    selectionEnd: active.selectionEnd ?? null,
  };
}

/**
 * @param {?{id: string, selectionStart: ?number, selectionEnd: ?number}}
 *     focusState As returned by captureFocusState; null is a no-op, as is an
 *     id no longer present in the DOM.
 */
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
