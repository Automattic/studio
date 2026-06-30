import { describe, expect, it } from 'vitest';
import { buildInteractivityPlugin, PLUGIN_SLUG } from './interactivity-plugin.js';

const byPath = (files: Array<{ relativePath: string; content: string }>) =>
  Object.fromEntries(files.map((f) => [f.relativePath, f.content]));

describe('buildInteractivityPlugin', () => {
  it('emits the full file set for all five blocks', () => {
    const plugin = buildInteractivityPlugin();
    expect(plugin.slug).toBe(PLUGIN_SLUG);
    const paths = plugin.files.map((f) => f.relativePath).sort();
    // NO style.css for tabs/slider/modal — source CSS owns all visuals; the
    // view modules only toggle source-authored classes.
    expect(paths).toEqual([
      'blocks/modal/block.json',
      'blocks/modal/editor.asset.php',
      'blocks/modal/editor.js',
      'blocks/modal/view.asset.php',
      'blocks/modal/view.js',
      'blocks/reveal/block.json',
      'blocks/reveal/editor.asset.php',
      'blocks/reveal/editor.js',
      'blocks/reveal/style.css',
      'blocks/reveal/view.asset.php',
      'blocks/reveal/view.js',
      'blocks/slider/block.json',
      'blocks/slider/editor.asset.php',
      'blocks/slider/editor.js',
      'blocks/slider/view.asset.php',
      'blocks/slider/view.js',
      'blocks/sticky/block.json',
      'blocks/sticky/editor.asset.php',
      'blocks/sticky/editor.js',
      'blocks/sticky/view.asset.php',
      'blocks/sticky/view.js',
      'blocks/tabs/block.json',
      'blocks/tabs/editor.asset.php',
      'blocks/tabs/editor.js',
      'blocks/tabs/view.asset.php',
      'blocks/tabs/view.js',
      'plugin.php',
    ]);
  });

  it('plugin.php registers all five block dirs and nothing else dynamic', () => {
    const php = byPath(buildInteractivityPlugin().files)['plugin.php'];
    expect(php).toContain(`register_block_type( __DIR__ . '/blocks/reveal' )`);
    expect(php).toContain(`register_block_type( __DIR__ . '/blocks/sticky' )`);
    expect(php).toContain(`register_block_type( __DIR__ . '/blocks/tabs' )`);
    expect(php).toContain(`register_block_type( __DIR__ . '/blocks/slider' )`);
    expect(php).toContain(`register_block_type( __DIR__ . '/blocks/modal' )`);
    expect(php).toContain('Plugin Name:');
  });

  it('block.json declares interactivity support + viewScriptModule + style', () => {
    const files = byPath(buildInteractivityPlugin().files);
    const reveal = JSON.parse(files['blocks/reveal/block.json']);
    expect(reveal.name).toBe('dla/reveal');
    expect(reveal.supports.interactivity).toBe(true);
    expect(reveal.editorScript).toBe('file:./editor.js');
    expect(reveal.viewScriptModule).toBe('file:./view.js');
    expect(reveal.style).toBe('file:./style.css');
    // reveal has NO content attribute — its inner is nested BLOCKS, owned by
    // InnerBlocks (html-sourcing would see only inter-placeholder whitespace).
    expect(reveal.attributes.content).toBeUndefined();
    const sticky = JSON.parse(files['blocks/sticky/block.json']);
    expect(sticky.name).toBe('dla/sticky');
    expect(sticky.supports.interactivity).toBe(true);
    expect(sticky.editorScript).toBe('file:./editor.js');
  });

  it('tabs/slider/modal block.json: interactivity support + viewScriptModule, NO style', () => {
    const files = byPath(buildInteractivityPlugin().files);
    const tabs = JSON.parse(files['blocks/tabs/block.json']);
    expect(tabs.name).toBe('dla/tabs');
    expect(tabs.supports.interactivity).toBe(true);
    expect(tabs.editorScript).toBe('file:./editor.js');
    expect(tabs.viewScriptModule).toBe('file:./view.js');
    expect(tabs.style).toBeUndefined();
    expect(tabs.attributes.activeClass.default).toBe('is-active');
    expect(tabs.attributes.content.selector).toBe('.wp-block-dla-tabs');
    const slider = JSON.parse(files['blocks/slider/block.json']);
    expect(slider.name).toBe('dla/slider');
    expect(slider.supports.interactivity).toBe(true);
    expect(slider.editorScript).toBe('file:./editor.js');
    expect(slider.viewScriptModule).toBe('file:./view.js');
    expect(slider.style).toBeUndefined();
    expect(slider.attributes.activeClass.default).toBe('is-current');
    expect(slider.attributes.intervalMs.type).toBe('number');
    expect(slider.attributes.content.selector).toBe('.wp-block-dla-slider');
    const modal = JSON.parse(files['blocks/modal/block.json']);
    expect(modal.name).toBe('dla/modal');
    expect(modal.supports.interactivity).toBe(true);
    expect(modal.editorScript).toBe('file:./editor.js');
    expect(modal.viewScriptModule).toBe('file:./view.js');
    expect(modal.style).toBeUndefined();
    expect(modal.attributes.content.selector).toBe('.wp-block-dla-modal');
  });

  it('view.asset.php declares the interactivity module dependency (import-map requirement)', () => {
    const files = byPath(buildInteractivityPlugin().files);
    for (const p of [
      'blocks/reveal/view.asset.php',
      'blocks/sticky/view.asset.php',
      'blocks/tabs/view.asset.php',
      'blocks/slider/view.asset.php',
      'blocks/modal/view.asset.php',
    ]) {
      expect(files[p]).toContain(`'dependencies' => array( '@wordpress/interactivity' )`);
    }
  });

  it('editor.asset.php declares classic editor dependencies for build-less editorScript files', () => {
    const files = byPath(buildInteractivityPlugin().files);
    for (const p of [
      'blocks/reveal/editor.asset.php',
      'blocks/sticky/editor.asset.php',
      'blocks/tabs/editor.asset.php',
      'blocks/slider/editor.asset.php',
      'blocks/modal/editor.asset.php',
    ]) {
      expect(files[p]).toContain(`'wp-blocks'`);
      expect(files[p]).toContain(`'wp-block-editor'`);
      expect(files[p]).toContain(`'wp-element'`);
    }
  });

  it('editor.js registers each block with globals only and preserves saved HTML content', () => {
    const files = byPath(buildInteractivityPlugin().files);
    for (const name of ['reveal', 'sticky', 'tabs', 'slider', 'modal']) {
      const js = files[`blocks/${name}/editor.js`];
      expect(js).toContain(`registerBlockType( 'dla/${name}'`);
      expect(js).toContain('window.wp.blocks');
      expect(js).toContain('window.wp.blockEditor');
      expect(js).toContain('window.wp.element');
      expect(js).toContain('RawHTML');
      expect(js).toContain('attributes.content');
      expect(js).not.toContain('import ');
    }
  });

  it('reveal editor.js uses InnerBlocks (nested-block inner); verbatim kinds never do', () => {
    const files = byPath(buildInteractivityPlugin().files);
    const reveal = files['blocks/reveal/editor.js'];
    // edit renders editable children; save re-emits them — html-sourcing
    // cannot see nested block comments (review finding: empty canvas +
    // destructive Block Recovery without this).
    expect(reveal).toContain('blockEditor.InnerBlocks');
    expect(reveal).toContain('InnerBlocks.Content');
    for (const name of ['sticky', 'tabs', 'slider', 'modal']) {
      // isReveal is false for these — the InnerBlocks branch is dead code by
      // the shared template, and the runtime path is RawHTML content.
      expect(files[`blocks/${name}/editor.js`]).toContain(`var isReveal = blockName === 'dla/reveal';`);
    }
  });

  it('editor.js guards falsy-legitimate numeric attrs and editor-only pointer events', () => {
    const files = byPath(buildInteractivityPlugin().files);
    const reveal = files['blocks/reveal/editor.js'];
    // typeof checks, NOT ||: threshold 0 / offset 0 / durationMs 0 are real
    // source values; || drift would invalidate the block (review finding).
    expect(reveal).toContain("typeof value === 'number'");
    expect(reveal).toContain('numberOr( attributes.threshold, 0.12 )');
    expect(reveal).toContain("numberOr( attributes.durationMs, 600 ) + 'ms'");
    expect(files['blocks/sticky/editor.js']).toContain('numberOr( attributes.offset, 8 )');
    // RawHTML preview sits behind pointer-events:none in EDIT only.
    expect(files['blocks/tabs/editor.js']).toContain("pointerEvents: 'none'");
    expect(files['blocks/tabs/editor.js']).toContain('savedContent');
  });

  it('reveal view.js: store namespace, IO from context, is-visible class, no html.js global', () => {
    const js = byPath(buildInteractivityPlugin().files)['blocks/reveal/view.js'];
    expect(js).toContain(`store( 'dla/reveal'`);
    expect(js).toContain('IntersectionObserver');
    expect(js).toContain('getContext');
    expect(js).not.toContain(`classList.add('js')`);
    expect(js).not.toContain(`documentElement.classList.add( 'js' )`);
  });

  it('reveal style.css: scoped gate class, reduced-motion guard, no bare section selector', () => {
    const css = byPath(buildInteractivityPlugin().files)['blocks/reveal/style.css'];
    expect(css).toContain('.dla-reveal-js .wp-block-dla-reveal:not(.is-visible)');
    expect(css).toContain('prefers-reduced-motion');
    expect(css).not.toMatch(/(^|[\s,{])section[\s.,{:]/);
  });

  it('reveal style.css: transition rides the is-visible state only (no post-load fade-out flash)', () => {
    // The gate class lands at MODULE time (post-first-paint): a transition on
    // the BASE rule ANIMATED below-fold sections visible→hidden when the gate
    // arrived (probe: opacity 0.0088 mid-fade on a below-fold section). State-
    // scoped, hide snaps instantly and only the 0→1 reveal animates.
    const css = byPath(buildInteractivityPlugin().files)['blocks/reveal/style.css'];
    expect(css).toContain('.dla-reveal-js .wp-block-dla-reveal.is-visible');
    expect(css).toMatch(/\.wp-block-dla-reveal\.is-visible \{\n\ttransition: opacity/);
    // No bare base rule — nothing may transition on gate-class arrival.
    expect(css).not.toMatch(/\.wp-block-dla-reveal \{/);
  });

  it('sticky view.js toggles the configured class on the closest header', () => {
    const js = byPath(buildInteractivityPlugin().files)['blocks/sticky/view.js'];
    expect(js).toContain(`store( 'dla/sticky'`);
    expect(js).toContain(`closest( 'header' )`);
    expect(js).toContain('scrollY');
  });

  it('tabs view.js: store namespace, role queries, source class + aria wiring, arrow keys', () => {
    const js = byPath(buildInteractivityPlugin().files)['blocks/tabs/view.js'];
    expect(js).toContain(`store( 'dla/tabs'`);
    expect(js).toContain('ctx.activeClass');
    expect(js).toContain(`'[role="tab"]'`);
    expect(js).toContain(`'[role="tabpanel"]'`);
    expect(js).toContain('aria-selected');
    expect(js).toContain('aria-controls');
    expect(js).toContain('ArrowRight');
    expect(js).toContain('ArrowLeft');
  });

  it('slider view.js: store namespace, structural slide list, reduced-motion-guarded autoplay', () => {
    const js = byPath(buildInteractivityPlugin().files)['blocks/slider/view.js'];
    expect(js).toContain(`store( 'dla/slider'`);
    expect(js).toContain('ctx.activeClass');
    expect(js).toContain('ctx.intervalMs');
    expect(js).toContain('setInterval');
    expect(js).toContain(`matchMedia( '(prefers-reduced-motion`);
    expect(js).toContain('.next, [data-next]');
    expect(js).toContain('.prev, [data-prev]');
  });

  it('modal view.js: store namespace, native dialog wiring, sync backdrop close', () => {
    const js = byPath(buildInteractivityPlugin().files)['blocks/modal/view.js'];
    expect(js).toContain(`store( 'dla/modal'`);
    expect(js).toContain('showModal');
    expect(js).toContain('withSyncEvent');
    expect(js).toContain(`querySelector( 'dialog' )`);
    expect(js).toContain('[data-close], .close');
    expect(js).toContain('dialog.close()');
  });

  it('is deterministic — two builds emit identical bytes', () => {
    const a = buildInteractivityPlugin();
    const b = buildInteractivityPlugin();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('locks the cross-file contract names the emitter targets (rename = instant failure)', () => {
    // These names are consumed by the EMITTED markup (emit-blocks/chrome-parts:
    // data-wp-init="callbacks.init", data-wp-context keys, inline custom
    // properties). A silent rename here would no-op on the frontend with zero
    // unit-test signal — lock them.
    const files = byPath(buildInteractivityPlugin().files);
    const revealJs = files['blocks/reveal/view.js'];
    expect(revealJs).toContain('init()');
    expect(revealJs).toContain('ctx.visible');
    // The gate class is the last silently-breakable cross-module name: a
    // view.js rename keeps style.css + FREEZE_MOTION_CSS consistent with each
    // other while the gate never arms — reveal degrades to always-visible and
    // parity cannot catch it (always-visible == the forced capture state).
    expect(revealJs).toContain("classList.add( 'dla-reveal-js' )");
    const stickyJs = files['blocks/sticky/view.js'];
    expect(stickyJs).toContain('ctx.toggleClass');
    expect(stickyJs).toContain('ctx.offset');
    const revealCss = files['blocks/reveal/style.css'];
    expect(revealCss).toContain('--dla-reveal-y');
    expect(revealCss).toContain('--dla-reveal-ms');
    // B1 blocks: the same init() rename hole — data-wp-init="callbacks.init"
    // in the emitted markup silently no-ops if a view.js renames the callback.
    for (const name of ['tabs', 'slider', 'modal']) {
      expect(files[`blocks/${name}/view.js`]).toContain('init()');
    }
  });

  it('slider view.js is keyboard-operable (spec §6 a11y: ArrowLeft/Right)', () => {
    const js = byPath(buildInteractivityPlugin().files)['blocks/slider/view.js'];
    expect(js).toContain("e.key === 'ArrowRight'");
    expect(js).toContain("e.key === 'ArrowLeft'");
    // Delegated on the block root — arrows work wherever focus lands inside
    // the slider (prev/next buttons are already focusable); no tabindex is
    // injected into the verbatim inner markup.
    expect(js).toContain("ref.addEventListener( 'keydown'");
  });
});
