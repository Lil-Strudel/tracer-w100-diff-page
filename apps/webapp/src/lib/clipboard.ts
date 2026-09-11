// Copying a time so it can be pasted into the W100 form.
//
// navigator.clipboard needs a secure context and a user gesture, and several
// in-app browsers (the ones a volunteer hits a link from) withhold it outright,
// so a dead button is a real possibility. The execCommand path is deprecated
// but still works in exactly those browsers, and a failed copy is reported
// rather than silently swallowed -- a volunteer who thinks they copied a time
// and pastes the previous one has been made worse off than by no button.

export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Denied, or a non-secure origin -- fall through and try the old way.
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  try {
    const area = document.createElement("textarea");
    area.value = text;
    // readonly keeps the mobile keyboard down; display:none would make the
    // selection impossible, so it is parked offscreen instead.
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    // iOS ignores select() on a readonly field without an explicit range.
    area.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}
