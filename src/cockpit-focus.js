export function returnFocusAfterPointer(event, button) {
  if (event.detail > 0) button.blur();
}
