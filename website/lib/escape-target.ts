/**
 * Does this Escape press belong to the field the reader is editing?
 *
 * Shared by every dismissible surface on the site, because the decision has to
 * be the SAME in all of them. If only one surface defers to the field, the
 * others still dismiss on that press, so the reader clears their search box and
 * loses the header menu at the same time.
 *
 * The rule is narrow on purpose, and it is narrow because of a measurement
 * rather than a guess. Escape natively clears exactly ONE kind of field, an
 * `<input type="search">`. Measured in Chromium with real key presses:
 *
 *   input[type=search]  "hello" -> ""       (cleared)
 *   input[type=text]    "hello" -> "hello"  (untouched)
 *   textarea            "note"  -> "note"   (untouched)
 *
 * That measurement is the whole design constraint. Deferring in a field where
 * Escape does nothing would be a trap: nothing native ever empties the value,
 * so this would keep returning true and the surface would become permanently
 * undismissable by keyboard while focus stayed in that field. Only defer where
 * a press actually accomplishes something.
 *
 * An EMPTY search box has nothing left to clear, so it does not claim the
 * press, which is what gives the reader a second Escape that dismisses the
 * surface rather than stranding them.
 */
export function escapeBelongsToField(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement
    && target.type === 'search'
    && target.value !== '';
}
