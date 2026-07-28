import pathlib

# ------------------------------------------------------------------ finding 2
# The leading probe was `position: absolute; left: 0` inside a header whose left
# edge is viewport 0, so its edge could never move and the probe could not catch
# the placement bug its comment cited. Mirror the real site's shape instead: a
# viewport-width painting header wrapping a max-width centring bar, with the
# leading child IN FLOW inside that bar. Now the bar re-centres when the viewport
# widens, which is what actually moved the logo.
p = pathlib.Path('packages/ui/test/components/browser/ui-overlay.test.js')
s = p.read_text()
old = """  // A centred child AND a left-aligned one. They move for different reasons, and
  // measuring only the centred one is how a wrong placement passed review: the
  // website opt-in sat on a max-width bar, which held the centred nav still while
  // the left-aligned logo kept shifting the full scrollbar width.
  const inner = document.createElement('div');
  inner.style.cssText = 'max-width:400px;margin:0 auto;height:40px;';
  const leading = document.createElement('div');
  leading.style.cssText = 'position:absolute;left:0;top:0;width:20px;height:40px;';
  header.appendChild(leading);
  header.appendChild(inner);
  document.body.appendChild(header);"""
new = """  // Mirrors the real site's shape, because the shape is what the placement bug
  // turned on: a viewport-width painting header wrapping a `max-width` centring
  // bar, with a LEADING child in flow inside that bar.
  //
  // Both probes are load-bearing and they move for different reasons. When the
  // viewport widens, the bar re-centres, which shifts its centre AND its leading
  // child. Insetting the header undoes both. Insetting the BAR would hold its
  // centre while its leading child kept moving, since the bar's own box is capped
  // by max-width, and that is exactly the wrong placement that reached review.
  // A leading child positioned against the header rather than the bar would be
  // inert here, because the header's left edge never moves.
  const inner = document.createElement('div');
  inner.style.cssText =
    'max-width:400px;margin:0 auto;height:40px;display:flex;justify-content:space-between;';
  const leading = document.createElement('div');
  leading.style.cssText = 'width:20px;height:40px;';
  const trailing = document.createElement('div');
  trailing.style.cssText = 'width:20px;height:40px;';
  inner.appendChild(leading);
  inner.appendChild(trailing);
  header.appendChild(inner);
  document.body.appendChild(header);"""
assert s.count(old) == 1
s = s.replace(old, new)
p.write_text(s)
print('fixture restructured so the leading probe can actually move')

# ------------------------------------------------------------------ finding 3
p = pathlib.Path('examples/blog/test/layout/fixed-header-scroll-lock.test.ts')
s = p.read_text()
old = """ * This app owns its copy of the kit's dialog (`components/ui/dialog.ts`, the
 * shadcn model), so the header and the lock have to stay in step by hand. That is
 * exactly how this app kept the #1144 shift for two review rounds after the kit
 * was fixed: the marketing site's copy is a gitignored mirror and tracked
 * automatically, this one did not."""
new = """ * This app owns its copy of the kit's dialog (`components/ui/dialog.ts`, the
 * shadcn model), so the header and the lock have to stay in step by hand. That is
 * exactly how this app kept the #1144 shift for two review rounds after the kit
 * was fixed. The marketing site's copy is a gitignored mirror, so it picked the
 * fix up automatically; this one is real tracked source and did not."""
assert old in s
s = s.replace(old, new)
p.write_text(s)
print('blog test docblock sentence fixed')

# ------------------------------------------------------------------ finding 1
# The new comment and rule landed between an existing comment and the rule it
# documents, so the glow-layer comment now read as a preamble to .site-header.
p = pathlib.Path('examples/blog/app/layout.ts')
s = p.read_text()
start = s.index('      /* #1144: while a modal holds the page scroll lock')
end = s.index('.site-header { border-right: var(--wj-scrollbar-compensation, 0px) solid transparent; }\n', start)
end += len('.site-header { border-right: var(--wj-scrollbar-compensation, 0px) solid transparent; }\n')
block = s[start:end]
s = s[:start] + s[end:]
# Re-insert AFTER the glow-layer rules, so nothing sits between a comment and its
# own rule.
anchor = s.index('      .glow-layer::before {')
close = s.index('      }\n', anchor) + len('      }\n')
s = s[:close] + block + s[close:]
p.write_text(s)
print('blog comment block moved below the glow-layer rules')
