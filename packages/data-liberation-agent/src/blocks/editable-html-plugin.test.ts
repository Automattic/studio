import { describe, it, expect } from 'vitest';
import { buildEditableHtmlPlugin, EDITABLE_PLUGIN_SLUG } from './editable-html-plugin.js';
import {
  analyzeFrameJsSource,
  analyzeIsland,
  serializeFrame,
  serializeFrameJsSource,
} from '../lib/replicate/normalize/island-bindings.js';

const byPath = (files: { relativePath: string; content: string }[]) =>
  Object.fromEntries(files.map((f) => [f.relativePath, f.content]));

describe('buildEditableHtmlPlugin', () => {
  it('emits a no-build block package registered via register_block_type', () => {
    const plugin = buildEditableHtmlPlugin();
    expect(plugin.slug).toBe(EDITABLE_PLUGIN_SLUG);
    const files = byPath(plugin.files);
    expect(files['plugin.php']).toContain("register_block_type( __DIR__ . '/blocks/editable-html' )");
    const blockJson = JSON.parse(files['blocks/editable-html/block.json']);
    expect(blockJson.name).toBe('dla/editable-html');
    expect(blockJson.apiVersion).toBe(3);
    expect(blockJson.editorScript).toBe('file:./editor.js');
    expect(blockJson.viewScriptModule).toBeUndefined();
    expect(blockJson.style).toBeUndefined();
    expect(blockJson.attributes.frame.type).toBe('array');
    expect(blockJson.attributes.frame.default).toEqual([]);
    expect(blockJson.supports).toEqual({ html: false, customClassName: false });
  });

  it('editor.js declares the bindable block and is build-less (uses window.wp.*)', () => {
    const files = byPath(buildEditableHtmlPlugin().files);
    const editor = files['blocks/editable-html/editor.js'];
    expect(editor).toContain("registerBlockType( 'dla/editable-html'");
    expect(editor).toContain('window.wp.blocks');
    expect(editor).toContain('window.wp.blockEditor');
    expect(editor).toContain('window.wp.element');
    expect(editor).toContain('window.wp.components');
    expect(editor).not.toContain('import ');
    expect(files['blocks/editable-html/editor.asset.php']).toContain("'wp-components'");
    expect(files['blocks/editable-html/editor.asset.php']).toContain("'wp-element'");
    expect(files['blocks/editable-html/editor.asset.php']).toContain("'wp-block-editor'");
  });

  it('emits only the editable-html block package files', () => {
    expect(buildEditableHtmlPlugin().files.map((f) => f.relativePath).sort()).toEqual([
      'blocks/editable-html/block.json',
      'blocks/editable-html/editor.asset.php',
      'blocks/editable-html/editor.js',
      'plugin.php',
    ]);
  });

  it('embeds the shared serializer in editor.js save()', () => {
    const editor = byPath(buildEditableHtmlPlugin().files)['blocks/editable-html/editor.js'];
    expect(editor).toContain(serializeFrameJsSource());
    expect(editor).toMatch(
      /save:\s*function\s*\(\s*props\s*\)\s*\{[\s\S]*?return\s+el\(\s*RawHTML,\s*\{\s*children:\s*serializeFrame\(\s*attributes\.frame\s*\|\|\s*\[\]\s*\)\s*\}\s*\);[\s\S]*?\}/,
    );
  });

  it('embeds the browser analyzer and HTML Source inspector panel', () => {
    const editor = byPath(buildEditableHtmlPlugin().files)['blocks/editable-html/editor.js'];
    expect(editor).toContain(analyzeFrameJsSource());
    expect(editor).toContain('InspectorControls');
    expect(editor).toContain('PanelBody');
    expect(editor).toContain('TextareaControl');
    expect(editor).toContain("title: 'HTML Source'");
    expect(editor).toContain('analyzeHtmlToFrame( draftHtml )');
    expect(editor).toContain('props.setAttributes( { frame: analyzed.frame || [] } )');
    expect(editor).toContain('setDraftHtml( serializeFrame( attributes.frame || [] ) )');
  });

  it('emits syntactically valid editor.js', () => {
    const editor = byPath(buildEditableHtmlPlugin().files)['blocks/editable-html/editor.js'];
    expect(() => new Function(editor)).not.toThrow();
  });

  it('preserves class as a real attribute on custom elements (React drops className on custom tags)', () => {
    // Wix <wow-image> & friends are custom elements: React assigns `className` as a JS
    // property that does NOT reflect to the `class` attribute, so carried CSS (image
    // sizing + absolute bg-layer positioning) silently no-ops in the editor canvas.
    // attrsToProps must take the tag and emit `class` directly for hyphenated tags.
    const editor = byPath(buildEditableHtmlPlugin().files)['blocks/editable-html/editor.js'];
    expect(editor).toContain("tag.indexOf( '-' )");
    expect(editor).toContain("props[ 'class' ] = value");
    expect(editor).toContain('attrsToProps( node.attrs, node.tag )');
  });
});

describe('editable-html serializer parity', () => {
  it('JS save serializer matches the TS server serializer for fixtures', () => {
    const jsSerialize = eval(`(${serializeFrameJsSource()})`) as (f: unknown) => string;
    for (const html of [
      '<div class="card"><p>Body <a href="/x/">l</a></p></div>',
      '<span class="icon"><svg><path d="M0 0"/></svg></span>',
      '<figure><img src="a.png" alt="A"/></figure>',
    ]) {
      const { frame } = analyzeIsland(html);
      expect(jsSerialize(frame)).toBe(serializeFrame(frame));
    }
  });
});
