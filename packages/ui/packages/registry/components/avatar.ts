/**
 * Avatar: circular user image with fallback. Tier-1 class helpers;
 * compose with a native `<span>` or `<img>`. The fallback shows when the
 * `<img>` is missing or fails to load (`onerror`).
 *
 * shadcn parity:
 *   Avatar (size: default | sm | lg)  → avatarClass({ size }) with `data-size`
 *   AvatarImage                       → avatarImageClass()
 *   AvatarFallback                    → avatarFallbackClass()
 *   AvatarBadge                       → avatarBadgeClass()
 *   AvatarGroup                       → avatarGroupClass()
 *   AvatarGroupCount                  → avatarGroupCountClass()
 *
 * A11y (required for accessible output): the <img> MUST have an alt that
 * names the person (alt="Vivek Khandelwal"), or alt="" when a visible text
 * fallback already names them. Always provide the fallback <span> so the
 * avatar is still named if the image fails to load.
 *
 * Design tokens used: --muted, --muted-foreground, --primary, --background.
 *
 * @example
 * ```html
 * <span class=${avatarClass()} data-size="default" data-slot="avatar">
 *   <img class=${avatarImageClass()} src="/avatars/vivek.jpg" alt="Vivek Khandelwal">
 *   <span class=${avatarFallbackClass()}>VK</span>
 * </span>
 *
 * <div class=${avatarGroupClass()}>
 *   <span class=${avatarClass()} data-size="default" data-slot="avatar">
 *     <img class=${avatarImageClass()} src="/avatars/vivek.jpg" alt="Vivek Khandelwal">
 *     <span class=${avatarFallbackClass()}>VK</span>
 *   </span>
 *   <span class=${avatarClass()} data-size="default" data-slot="avatar">
 *     <img class=${avatarImageClass()} src="/avatars/amir.jpg" alt="Amir Rao">
 *     <span class=${avatarFallbackClass()}>AR</span>
 *   </span>
 *   <div class=${avatarGroupCountClass()}>+3</div>
 * </div>
 * ```
 */
import { cn } from '../lib/utils.ts';

export type AvatarSize = 'default' | 'sm' | 'lg';

const AVATAR_BASE =
  'group/avatar relative flex size-8 shrink-0 overflow-hidden rounded-full select-none data-[size=lg]:size-10 data-[size=sm]:size-6';

export function avatarClass(_opts: { size?: AvatarSize } = {}): string {
  // Size driven by data-size attribute on the element (matches shadcn).
  return cn(AVATAR_BASE);
}

export const avatarImageClass = (): string => 'aspect-square size-full';

export const avatarFallbackClass = (): string =>
  'flex size-full items-center justify-center rounded-full bg-muted text-sm text-muted-foreground group-data-[size=sm]/avatar:text-xs';

export const avatarBadgeClass = (): string =>
  'absolute right-0 bottom-0 z-10 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background select-none group-data-[size=sm]/avatar:size-2 group-data-[size=sm]/avatar:[&>svg]:hidden group-data-[size=default]/avatar:size-2.5 group-data-[size=default]/avatar:[&>svg]:size-2 group-data-[size=lg]/avatar:size-3 group-data-[size=lg]/avatar:[&>svg]:size-2';

export const avatarGroupClass = (): string =>
  'group/avatar-group flex -space-x-2 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-background';

export const avatarGroupCountClass = (): string =>
  'relative flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm text-muted-foreground ring-2 ring-background group-has-data-[size=lg]/avatar-group:size-10 group-has-data-[size=sm]/avatar-group:size-6 [&>svg]:size-4 group-has-data-[size=lg]/avatar-group:[&>svg]:size-5 group-has-data-[size=sm]/avatar-group:[&>svg]:size-3';
