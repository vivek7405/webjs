/**
 * Does this Escape press belong to the field the reader is editing?
 *
 * Shared by every dismissible surface on the site, because the decision has to
 * be the SAME in all of them. If only one surface defers to the field, the
 * others still dismiss on that press, so the reader clears their search box and
 * loses the header menu at the same time.
 *
 * The rule is narrow on purpose, and it is narrow because of a measurement
 * rather than a guess. Escape natively clears exactly ONE kind of field, a
 * mutable non-empty `<input type="search">`. Measured in Chromium with real key
 * presses:
 *
 *   input[type=search]  "hello" -> ""       (cleared)
 *   input[type=text]    "hello" -> "hello"  (untouched)
 *   textarea            "note"  -> "note"   (untouched)
 *
 * That measurement is the whole design constraint. Deferring in a field where
 * Escape does nothing would be a trap: nothing native ever empties the value,
 * so this would keep returning true and the surface would become permanently
 * undismissable by keyboard while focus stayed in that field. Only defer where
 * a press actually accomplishes something. The same reasoning excludes a
 * `readonly` field, which Blink also refuses to clear, and an EMPTY search box,
 * which has nothing left to clear and so leaves the reader a second Escape that
 * dismisses the surface rather than stranding them.
 *
 * SCOPE, deliberately document-wide. An earlier version of this lived on the
 * drawer and was scoped with `this.contains(target)`. That scoping cannot be
 * kept once the rule is shared, because the whole point is that a field inside
 * ONE surface must also stop the OTHER surface dismissing on the same press,
 * and a containment test in the other surface answers false for exactly that
 * case. The visible consequence is a widening: a non-empty search box anywhere
 * in the document now holds Escape for every open surface, not just the surface
 * containing it. One press, one effect, which is the behaviour worth having.
 */
export function escapeBelongsToField(target: EventTarget | null): boolean {
  // composedPath()[0] rather than `target` at the call site: an event crossing a
  // shadow boundary is RETARGETED to the host, so a search field inside any
  // shadow-DOM component would report the host here and the rule would answer
  // false. Callers pass the composed target; this stays a pure predicate.
  return target instanceof HTMLInputElement
    && target.type === 'search'
    && !target.readOnly
    && !target.disabled
    && target.value !== '';
}

/**
 * The composed origin of an event, which is what the rule above must be given.
 *
 * `event.target` is retargeted at every shadow boundary, so it reports the host
 * rather than the field the reader is actually typing in. `composedPath()[0]`
 * is the real origin, and it falls back to `target` for an event that does not
 * carry a path.
 */
export function composedTarget(event: Event): EventTarget | null {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  return path.length > 0 ? path[0] : event.target;
}
