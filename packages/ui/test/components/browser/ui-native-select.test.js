/**
 * Browser tests for the native-select <option> colour rule (#1320).
 *
 * The rule used to be injected from `native-select.ts` at module scope, which
 * made the module client-effecting and pinned every page that imported it. It
 * now lives in the theme stylesheet the kit installs, so two things need
 * proving in a real browser: importing the module injects nothing, and the CSS
 * that replaced the injection actually paints the options.
 *
 * The rule text here is pinned against `themes/index.css` by the node test in
 * `packages/ui/test/base-colors.test.js`, so a drift between the two shows up
 * there rather than silently making this test assert an obsolete rule.
 */
import { html } from '../../../../core/src/html.js';
import { render } from '../../../../core/src/render-client.js';

import { assert } from '../../../../../test/browser-assert.js';

const COMPONENTS_DIR = '/packages/ui/packages/registry/components';

const tick = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

async function mount(tpl) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(tpl, root);
  await tick();
  return root;
}

suite('ui native-select', () => {
  let mod;
  let styleCountBeforeImport;
  let themeStyle;

  suiteSetup(async () => {
    styleCountBeforeImport = document.head.querySelectorAll('style').length;
    mod = await import(`${COMPONENTS_DIR}/native-select.ts`);
    await tick();
  });

  suiteTeardown(() => {
    themeStyle?.remove();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.colorScheme = '';
  });

  test('importing the module injects no stylesheet', () => {
    // The regression that matters: this fails against the pre-#1320 module,
    // which appended a <style id="ui-native-select-styles"> on import.
    assert.equal(document.getElementById('ui-native-select-styles'), null);
    assert.equal(document.head.querySelectorAll('style').length, styleCountBeforeImport);
    assert.equal(mod.installNativeSelectStyles, undefined, 'the injector is gone');
  });

  test('the theme rule paints options, wrapped and bare, in both themes', async () => {
    // Stand in for the theme block the kit writes, which this test environment
    // has no `webjs ui init` to install.
    themeStyle = document.createElement('style');
    themeStyle.textContent = `
      select option,
      select optgroup {
        background-color: Canvas;
        color: CanvasText;
      }
    `;
    document.head.appendChild(themeStyle);

    const root = await mount(html`
      <div class=${mod.nativeSelectWrapperClass()}>
        <select id="wrapped" class=${mod.nativeSelectClass()}>
          <optgroup label="Plans"><option value="a">A</option></optgroup>
        </select>
      </div>
      <select id="bare" class=${mod.nativeSelectClass()}>
        <option value="b">B</option>
      </select>
    `);

    // The bare case is the one the original wrapper-scoped selector missed, so
    // both are asserted. Transparent is precisely the bug: an <option> with no
    // background lets the browser's dark popup through and disappears.
    for (const theme of ['light', 'dark']) {
      document.documentElement.setAttribute('data-theme', theme);
      document.documentElement.style.colorScheme = theme;
      await tick();
      for (const id of ['wrapped', 'bare']) {
        const option = root.querySelector(`#${id} option`);
        const style = getComputedStyle(option);
        assert.notEqual(style.backgroundColor, 'rgba(0, 0, 0, 0)', `${id} @ ${theme}: transparent option`);
        assert.notEqual(style.backgroundColor, style.color, `${id} @ ${theme}: option text matches its background`);
      }
      const optgroup = root.querySelector('#wrapped optgroup');
      assert.notEqual(getComputedStyle(optgroup).backgroundColor, 'rgba(0, 0, 0, 0)', `optgroup @ ${theme}`);
    }

    root.remove();
  });
});
