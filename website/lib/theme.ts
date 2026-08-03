/**
 * The theme contract, in one place.
 *
 * Two independent readers agree on these values, and they used to agree by
 * coincidence rather than by construction: the root layout's bootstrap script
 * hard-coded the storage key and the attribute values, and
 * components/theme-toggle.ts hard-coded the same pair again. Renaming the key
 * in one and not the other would not fail a build or a test. It would just
 * silently stop restoring the reader's theme.
 *
 * The bootstrap has to stay an inline script (it runs before first paint so a
 * saved theme never flashes the wrong palette), and an inline script cannot
 * import. So the layout interpolates THEME_STORAGE_KEY into the script source
 * at SSR instead, which is a value flowing from one declaration rather than a
 * second copy of it.
 */

/** The three states the toggle cycles through. `system` follows the OS. */
export type Theme = 'system' | 'light' | 'dark';

/** localStorage key holding the reader's explicit choice. Absent means `system`. */
export const THEME_STORAGE_KEY = 'webjs_theme';

/**
 * The two values that may appear in `<html data-theme>`. `system` is
 * represented by the ABSENCE of the attribute, not by a third value, because
 * the stylesheet's default (`color-scheme: light dark` on `:root`) is what
 * follows the OS. Writing `data-theme="system"` would match neither
 * `[data-theme='dark']` nor `[data-theme='light']` and would work by accident;
 * removing the attribute is the same outcome stated on purpose.
 */
export const FORCED_THEMES = ['light', 'dark'] as const;

/** Narrow an unknown stored value to a forced theme, else `system`. */
export function readTheme(stored: string | null | undefined): Theme {
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}
