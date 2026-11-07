/**
 * Host half of the sidebar-enhance bundle.
 *
 * Both features are browser-side: the width guard reads the frame geometry the
 * web client already renders, and the scroll component contributes a stylesheet
 * to the same document. The Host registers nothing — no tool, no prompt section,
 * no session event — but the row still exists so Plugin Manager can list,
 * enable, and describe the bundle.
 */
export function apply() {}
