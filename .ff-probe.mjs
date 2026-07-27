import { firefox } from 'playwright';
const PAGE = `<!doctype html><html><head><style>
* { margin:0; padding:0; box-sizing:border-box }
body { min-height: 10px }
#hdr { position: fixed; inset: 0 0 auto 0; height: 40px; background:#333 }
</style></head><body><div id="hdr"></div></body></html>`;
const CFGS = [
  ['default', {}],
  ['gtk overlay off', { 'widget.gtk.overlay-scrollbars.enabled': false }],
  ['non-native theme', { 'widget.non-native-theme.enabled': true, 'widget.gtk.overlay-scrollbars.enabled': false }],
  ['ui.useOverlayScrollbars 0', { 'ui.useOverlayScrollbars': 0 }],
];
for (const [name, prefs] of CFGS) {
  const b = await firefox.launch({ firefoxUserPrefs: prefs, ignoreDefaultArgs: ['--hide-scrollbars'] });
  const p = await b.newPage({ viewport: { width: 1000, height: 600 } });
  await p.setContent(PAGE);
  const before = await p.evaluate(() => ({ sb: innerWidth - document.documentElement.clientWidth, hdr: document.getElementById('hdr').getBoundingClientRect().width }));
  await p.evaluate(() => { document.documentElement.style.scrollbarGutter = 'stable'; });
  const after = await p.evaluate(() => ({ hdr: document.getElementById('hdr').getBoundingClientRect().width }));
  console.log(`${name.padEnd(26)} scrollbarProbe=${before.sb} hdr ${before.hdr} -> ${after.hdr}  gutterHonoured=${after.hdr !== before.hdr}`);
  await b.close();
}
