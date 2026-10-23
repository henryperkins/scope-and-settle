export function isFigmaPluginMessage(event, view = window) {
  // Figma's nested UI sandbox delivers main-thread messages from the editor
  // at window.top. Older/direct iframe hosts use window.parent instead.
  return view.parent !== view && event.origin === 'https://www.figma.com' &&
    (event.source === view.top || event.source === view.parent);
}
