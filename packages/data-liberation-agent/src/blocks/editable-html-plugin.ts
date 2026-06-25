import type { ReplicaBlockPlugin } from '../lib/preview/types.js';
import { analyzeFrameJsSource, serializeFrameJsSource } from '../lib/replicate/normalize/island-bindings.js';

export const EDITABLE_PLUGIN_SLUG = 'dla-editable-html';

const PLUGIN_PHP = `<?php
/**
 * Plugin Name: DLA Editable HTML Block
 * Description: Editable HTML island block emitted by the data-liberation local-site converter.
 * Version: 1.0.0
 * Requires at least: 6.7
 */

defined( 'ABSPATH' ) || exit;

add_action( 'init', function () {
    register_block_type( __DIR__ . '/blocks/editable-html' );
} );
`;

const EDITOR_ASSET_PHP = `<?php return array( 'dependencies' => array( 'wp-blocks', 'wp-block-editor', 'wp-element', 'wp-components' ), 'version' => '1.0.0' );
`;

const BLOCK_JSON =
  JSON.stringify(
    {
      $schema: 'https://schemas.wp.org/trunk/block.json',
      apiVersion: 3,
      name: 'dla/editable-html',
      title: 'Editable HTML',
      category: 'design',
      description: 'Editable carried HTML island with source-faithful static save output.',
      supports: { html: false, customClassName: false },
      attributes: {
        frame: { type: 'array', default: [] },
      },
      editorScript: 'file:./editor.js',
    },
    null,
    '\t',
  ) + '\n';

function editorJs(): string {
  return `( function ( blocks, blockEditor, element, components ) {
\tvar el = element.createElement;
\tvar RawHTML = element.RawHTML;
\tvar Fragment = element.Fragment;
\tvar useState = element.useState;
\tvar InspectorControls = blockEditor.InspectorControls;
\tvar RichText = blockEditor.RichText;
\tvar MediaUpload = blockEditor.MediaUpload;
\tvar PanelBody = components.PanelBody;
\tvar TextareaControl = components.TextareaControl;
\tvar Button = components.Button;
\tvar serializeFrame = ${serializeFrameJsSource()};
\tvar analyzeHtmlToFrame = ${analyzeFrameJsSource()};

\tfunction parseStyle( style ) {
\t\tif ( ! style ) return undefined;
\t\treturn style.split( ';' ).reduce( function ( acc, part ) {
\t\t\tvar idx = part.indexOf( ':' );
\t\t\tif ( idx < 0 ) return acc;
\t\t\tvar key = part.slice( 0, idx ).trim();
\t\t\tvar value = part.slice( idx + 1 ).trim();
\t\t\tif ( ! key || ! value ) return acc;
\t\t\tvar prop = key.replace( /-([a-z])/g, function ( _m, c ) { return c.toUpperCase(); } );
\t\t\tacc[ prop ] = value;
\t\t\treturn acc;
\t\t}, {} );
\t}

\tfunction attrsToProps( attrs, tag ) {
\t\t// Custom elements (hyphenated tags, e.g. Wix <wow-image>): React assigns
\t\t// \`className\` as a JS PROPERTY, which does NOT reflect to the \`class\` ATTRIBUTE
\t\t// on a custom element — so CSS selectors / getComputedStyle never see the class
\t\t// and the carried styling (sizing, absolute positioning of bg-layer images) is
\t\t// lost in the editor canvas. Pass \`class\` as a real attribute for custom elements
\t\t// (React forwards string-valued unknown props on custom elements verbatim).
\t\tvar isCustom = !! tag && tag.indexOf( '-' ) > 0;
\t\tvar props = {};
\t\tObject.keys( attrs || {} ).forEach( function ( key ) {
\t\t\tvar value = attrs[ key ];
\t\t\tif ( key === 'class' ) { if ( isCustom ) props[ 'class' ] = value; else props.className = value; }
\t\t\telse if ( key === 'for' ) props.htmlFor = value;
\t\t\telse if ( key === 'style' ) props.style = parseStyle( value );
\t\t\telse props[ key ] = value;
\t\t} );
\t\treturn props;
\t}

\tfunction updateFrameNode( nodes, id, patcher ) {
\t\treturn ( nodes || [] ).map( function ( node ) {
\t\t\tif ( node.id === id ) {
\t\t\t\treturn Object.assign( {}, node, patcher( node ) );
\t\t\t}
\t\t\tif ( node.children ) {
\t\t\t\treturn Object.assign( {}, node, { children: updateFrameNode( node.children, id, patcher ) } );
\t\t\t}
\t\t\treturn node;
\t\t} );
\t}

\tfunction withKey( props, key ) {
\t\treturn Object.assign( { key: key }, props || {} );
\t}

\tfunction renderFrame( nodes, options ) {
\t\treturn ( nodes || [] ).map( function ( node, index ) {
\t\t\tvar key = node.kind + '-' + index + '-' + ( node.id || node.tag || '' );
\t\t\tif ( node.kind === 'text' ) return node.text || '';
\t\t\tif ( node.kind === 'raw' ) {
\t\t\t\tvar raw = el( RawHTML, { children: node.html || '' } );
\t\t\t\treturn options.editable ? el( 'div', { key: key, style: { pointerEvents: 'none' } }, raw ) : raw;
\t\t\t}
\t\t\tif ( node.kind === 'element' ) {
\t\t\t\tvar props = withKey( attrsToProps( node.attrs, node.tag ), key );
\t\t\t\treturn el.apply( null, [ node.tag, props ].concat( renderFrame( node.children, options ) ) );
\t\t\t}
\t\t\tif ( node.kind === 'bindText' ) {
\t\t\t\tif ( options.editable ) {
\t\t\t\t\treturn el( RichText, Object.assign( withKey( attrsToProps( node.attrs, node.tag ), key ), {
\t\t\t\t\t\ttagName: node.tag,
\t\t\t\t\t\tvalue: node.html || '',
\t\t\t\t\t\tonChange: function ( html ) {
\t\t\t\t\t\t\toptions.updateNode( node.id, function () { return { html: html }; } );
\t\t\t\t\t\t},
\t\t\t\t\t} ) );
\t\t\t\t}
\t\t\t\treturn el( node.tag, withKey( attrsToProps( node.attrs, node.tag ), key ), el( RichText.Content, { value: node.html || '' } ) );
\t\t\t}
\t\t\tif ( node.kind === 'bindImage' ) {
\t\t\t\tif ( options.editable ) {
\t\t\t\t\treturn el( MediaUpload, {
\t\t\t\t\t\tkey: key,
\t\t\t\t\t\tonSelect: function ( media ) {
\t\t\t\t\t\t\toptions.updateNode( node.id, function ( current ) {
\t\t\t\t\t\t\t\tvar attrs = Object.assign( {}, current.attrs || {} );
\t\t\t\t\t\t\t\tif ( media.url ) attrs.src = media.url;
\t\t\t\t\t\t\t\tif ( typeof media.alt !== 'undefined' ) attrs.alt = media.alt;
\t\t\t\t\t\t\t\treturn { attrs: attrs };
\t\t\t\t\t\t\t} );
\t\t\t\t\t\t},
\t\t\t\t\t\trender: function ( picker ) {
\t\t\t\t\t\t\treturn el( 'img', Object.assign( attrsToProps( node.attrs ), {
\t\t\t\t\t\t\t\tonClick: picker.open,
\t\t\t\t\t\t\t\trole: 'button',
\t\t\t\t\t\t\t\ttabIndex: 0,
\t\t\t\t\t\t\t} ) );
\t\t\t\t\t\t},
\t\t\t\t\t} );
\t\t\t\t}
\t\t\t\treturn el( 'img', withKey( attrsToProps( node.attrs ), key ) );
\t\t\t}
\t\t\treturn null;
\t\t} );
\t}

\tblocks.registerBlockType( 'dla/editable-html', {
\t\tedit: function ( props ) {
\t\t\tvar attributes = props.attributes;
\t\t\tvar frame = attributes.frame || [];
\t\t\tvar draftState = useState( serializeFrame( frame ) );
\t\t\tvar draftHtml = draftState[ 0 ];
\t\t\tvar setDraftHtml = draftState[ 1 ];
\t\t\tvar blockProps = blockEditor.useBlockProps( { className: 'wp-block-dla-editable-html' } );
\t\t\treturn el( Fragment, null,
\t\t\t\tel( 'div', blockProps, renderFrame( frame, {
\t\t\t\t\teditable: true,
\t\t\t\t\tupdateNode: function ( id, patcher ) {
\t\t\t\t\t\tprops.setAttributes( { frame: updateFrameNode( frame, id, patcher ) } );
\t\t\t\t\t},
\t\t\t\t} ) ),
\t\t\t\tel( InspectorControls, null,
\t\t\t\t\tel( PanelBody, { title: 'HTML Source', initialOpen: false },
\t\t\t\t\t\tel( TextareaControl, {
\t\t\t\t\t\t\tvalue: draftHtml,
\t\t\t\t\t\t\tonChange: setDraftHtml,
\t\t\t\t\t\t} ),
\t\t\t\t\t\tel( 'div', { className: 'dla-editable-html-source-actions' },
\t\t\t\t\t\t\tel( Button, {
\t\t\t\t\t\t\t\tvariant: 'primary',
\t\t\t\t\t\t\t\tonClick: function () {
\t\t\t\t\t\t\t\t\tvar analyzed = analyzeHtmlToFrame( draftHtml );
\t\t\t\t\t\t\t\t\tprops.setAttributes( { frame: analyzed.frame || [] } );
\t\t\t\t\t\t\t\t},
\t\t\t\t\t\t\t}, 'Apply' ),
\t\t\t\t\t\t\tel( Button, {
\t\t\t\t\t\t\t\tvariant: 'secondary',
\t\t\t\t\t\t\t\tonClick: function () {
\t\t\t\t\t\t\t\t\tsetDraftHtml( serializeFrame( attributes.frame || [] ) );
\t\t\t\t\t\t\t\t},
\t\t\t\t\t\t\t}, 'Reset' )
\t\t\t\t\t\t)
\t\t\t\t\t)
\t\t\t\t)
\t\t\t);
\t\t},
\t\tsave: function ( props ) {
\t\t\tvar attributes = props.attributes;
\t\t\treturn el( RawHTML, { children: serializeFrame( attributes.frame || [] ) } );
\t\t},
\t} );
} )( window.wp.blocks, window.wp.blockEditor, window.wp.element, window.wp.components );
`;
}

export function buildEditableHtmlPlugin(): ReplicaBlockPlugin {
  return {
    slug: EDITABLE_PLUGIN_SLUG,
    files: [
      { relativePath: 'plugin.php', content: PLUGIN_PHP },
      { relativePath: 'blocks/editable-html/block.json', content: BLOCK_JSON },
      { relativePath: 'blocks/editable-html/editor.js', content: editorJs() },
      { relativePath: 'blocks/editable-html/editor.asset.php', content: EDITOR_ASSET_PHP },
    ],
  };
}
