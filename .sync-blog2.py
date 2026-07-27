"""Re-sync examples/blog's copied dialog with the registry source.

The blog owns its copy (the shadcn model), and it has its own local divergences,
so this ports ONLY the pieces #1144 changed: the lock block, and the per-instance
guard in _setup / _teardown.
"""
import pathlib

src = pathlib.Path('packages/ui/packages/registry/components/dialog.ts').read_text()
dst_path = pathlib.Path('examples/blog/components/ui/dialog.ts')
dst = dst_path.read_text()


def block(text, start, end_marker):
    a = text.index(start)
    b = text.index(end_marker, a)
    return text[a:b]


# 1. The lock block, verbatim.
canon_lock = block(src, '// Page scroll lock, refcounted', 'function unlockScroll')
canon_lock += src[src.index('function unlockScroll'):]
canon_lock = canon_lock[: canon_lock.index('\n}\n') + 2]

old_lock = block(dst, '// Page scroll lock, refcounted', 'function unlockScroll')
old_lock += dst[dst.index('function unlockScroll'):]
old_lock = old_lock[: old_lock.index('\n}\n') + 2]
dst = dst.replace(old_lock, canon_lock)

# 2. The per-instance guard.
old_setup = """  _setup(): void {
    const content = this._content;
    if (!content) return;
    lockScroll();
    content.showModal();
  }"""
new_setup = """  _setup(): void {
    const content = this._content;
    if (!content) return;
    lockScroll();
    this._scrollLocked = true;
    content.showModal();
  }"""
assert dst.count(old_setup) == 1
dst = dst.replace(old_setup, new_setup)

old_td = """  _teardown(): void {
    unlockScroll();
    this._content?.close();
  }"""
new_td = """  _teardown(): void {
    // Release only what THIS element locked. _setup() returns before locking
    // when there is no content child, so an unconditional unlock here would
    // consume ANOTHER open dialog's count and restore the page out from under
    // it, dropping its compensation while it is still open.
    if (this._scrollLocked) {
      this._scrollLocked = false;
      unlockScroll();
    }
    this._content?.close();
  }"""
assert dst.count(old_td) == 1
dst = dst.replace(old_td, new_td)

if '_scrollLocked?: boolean;' not in dst:
    marker = '  _disposeBeforeCache?: () => void;'
    assert dst.count(marker) >= 1
    dst = dst.replace(marker, marker + '\n  _scrollLocked?: boolean;', 1)

dst_path.write_text(dst)
print('blog copy re-synced')
