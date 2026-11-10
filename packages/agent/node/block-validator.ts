import { EditorPage, withTimeout } from './browser-utils';
import type { Page } from 'playwright';

const BLOCK_EVALUATION_TIMEOUT_MS = 60_000;

interface BlockValidationResult {
	blockName: string;
	/** The block's place in the content, as `/0/2` for the third block in the first. */
	place?: string;
	isValid: boolean;
	issues: string[];
	/** Attributes the parser ignored, even when the resulting markup can be fixed. */
	attributeIssues?: string[];
	originalContent: string;
	expectedContent?: string;
}

export interface ValidationReportBase {
	totalBlocks: number;
	validBlocks: number;
	invalidBlocks: number;
	results: BlockValidationResult[];
	error?: string;
}

interface BlockFixProposal {
	/** What the editor saves for every block that loses nothing; the rest stay as written. */
	fixedContent: string;
	report: ValidationReportBase;
	/** The blocks the fix loses something from, and what. */
	losses: BlockLoss[];
	/**
	 * The blocks the fix gives a block style, `is-style-<slug>` in className,
	 * for the styles written on their own element that no attribute saves:
	 * `css`, those styles, for the theme's block style to hold.
	 */
	blockStyles?: BlockStyle[];
}

export interface BlockStyle {
	place: string;
	blockName: string;
	slug: string;
	css: string;
}

export interface BlockLoss {
	place: string;
	blockName: string;
	/** What the fix loses, as `drop the styles position:sticky`. */
	lost: string;
	/**
	 * What the fix loses, with the element it loses each style and class
	 * from, as `drop opacity:0.68 from span.wp-block-cover__background`.
	 */
	note: string;
	/**
	 * The text written in the comment attributes of a block the server renders
	 * that the fix drops, as `"Your name" (label)`, where the editor reads the
	 * block without them.
	 */
	droppedText?: string;
}

export interface ValidationReport extends ValidationReportBase {
	proposedFix?: BlockFixProposal;
}

/**
 * The editor that edits the content: a post's, or the Site Editor for a
 * template or template part. A plugin can register a block in one only, as
 * WooCommerce unregisters its template blocks (woocommerce/legacy-template,
 * breadcrumbs, catalog-sorting, ...) where window.adminpage is post-php or
 * post-new-php (wc-block-library.js), so a template is validated where it is
 * edited.
 */
export type BlockEditor = 'post' | 'site';

const EDITOR_PATHS: Record< BlockEditor, string > = {
	post: '/wp-admin/post-new.php',
	site: '/wp-admin/site-editor.php',
};

// Cache one EditorPage per site URL and editor so repeated validations reuse the same
// browser tab instead of navigating and loading the block editor each time.
const editorPages = new Map< string, EditorPage >();

function getEditorPage( siteUrl: string, editor: BlockEditor ): EditorPage {
	const key = `${ editor } ${ siteUrl }`;
	let ep = editorPages.get( key );
	if ( ! ep ) {
		ep = new EditorPage( siteUrl, EDITOR_PATHS[ editor ] );
		editorPages.set( key, ep );
	}
	return ep;
}

/** The block names that block comments in content name, `core/` for those without a namespace. */
export function blockNames( content: string ): string[] {
	return [
		...new Set(
			[ ...content.matchAll( /<!--\s*wp:([a-z][a-z0-9_-]*(?:\/[a-z][a-z0-9_-]*)?)/g ) ].map(
				( [ , name ] ) => ( name.includes( '/' ) ? name : `core/${ name }` )
			)
		),
	];
}

/**
 * Runs `fn` on the site's block editor, loaded again when it lacks a block
 * that the names name: the editor registers the blocks of the plugins active
 * when it loaded, and a plugin activated since adds its own. Other calls on
 * the editor finish on the page they started on.
 */
function withEditor< T >(
	siteUrl: string,
	names: string[],
	editor: BlockEditor,
	fn: ( page: Page ) => Promise< T >
): Promise< T > {
	const editorPage = getEditorPage( siteUrl, editor );
	return editorPage.use( async ( page ) => {
		const knows = await page.evaluate(
			( wanted ) =>
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				wanted.every( ( name ) => ( window as any ).wp.blocks.getBlockType( name ) ),
			names
		);
		if ( knows ) {
			return fn( page );
		}
		await editorPage.replace();
		return editorPage.use( fn );
	} );
}

/**
 * The block types of `names` the site's block editor does not register, as
 * wp.blocks.getBlockType() reads its registry once the editor has loaded
 * every script WordPress enqueues for it.
 */
export async function unregisteredInEditor(
	names: string[],
	siteUrl: string
): Promise< string[] > {
	return withEditor( siteUrl, names, 'post', ( page ) =>
		page.evaluate(
			( wanted ) =>
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				wanted.filter( ( name ) => ! ( window as any ).wp.blocks.getBlockType( name ) ),
			names
		)
	);
}

/**
 * Validate WordPress block content using the site's own block editor in a
 * real browser.
 *
 * Navigates to the editor of the content, `post-new.php` or `site-editor.php`
 * (which load wp.blocks with the blocks registered there — core + plugins) and parses the content with `wp.blocks.parse()`,
 * reusing the parser's per-block verdict — the same save-function comparison
 * the Gutenberg editor performs on load. `wp.blocks.validateBlock()` is only
 * called on older WordPress versions whose parser does not report one.
 */
export async function validateBlocks(
	content: string,
	siteUrl: string,
	editor: BlockEditor = 'post',
	rendersAlike?: RendersAlike,
	blockStyles = false
): Promise< ValidationReport > {
	return validateAsWritten( content, siteUrl, editor, rendersAlike, blockStyles );
}

/**
 * Whether each pair of block markup, `[ as stored, with the editor's fix ]`,
 * renders the same on the site's server.
 */
export type RendersAlike = ( pairs: Array< [ string, string ] > ) => Promise< boolean[] >;

// A block WordPress renders on the server is shown to visitors as its render
// callback renders it (render_block() in wp-includes/class-wp-block.php), so
// the fix of one that renders as it is stored loses nothing: `alike`, those
// places, validated again without their losses.
async function validateAsWritten(
	content: string,
	siteUrl: string,
	editor: BlockEditor,
	rendersAlike?: RendersAlike,
	blockStyles = false,
	alike: string[] = []
): Promise< ValidationReport > {
	try {
		const evaluated = await withEditor( siteUrl, blockNames( content ), editor, async ( page ) => {
			// What the editor threw beside the content, for a block it did not register.
			const input = [
				content,
				getEditorPage( siteUrl, editor ).loadErrors,
				!! rendersAlike,
				alike,
				blockStyles,
			] as const;

			const evaluation = page.evaluate( async ( [ html, thrown, judge, renderAlike, styling ] ) => {
				/* eslint-disable @typescript-eslint/no-explicit-any */
				const wpBlocks = ( window as any ).wp?.blocks;
				if ( ! wpBlocks ) {
					return {
						report: {
							totalBlocks: 0,
							validBlocks: 0,
							invalidBlocks: 0,
							results: [] as any[],
							error: 'wp.blocks is not available on this page.',
						},
					};
				}

				// Each block the editor does not register that the site renders on
				// the server, from the block types the REST API lists, on a WordPress
				// whose editor registers such a block from its supports'
				// autoRegister (_wp_enqueue_auto_register_blocks(), WordPress 7.0).
				const serverRendered = new Set< string >();
				const branch = /\bbranch-(\d+)-(\d+)\b/.exec( document.body.className );
				const apiFetch = ( window as any ).wp?.apiFetch;
				const typeOf = ( name: string ): Promise< any > =>
					typeof apiFetch === 'function'
						? apiFetch( { path: `/wp/v2/block-types/${ name }?context=edit` } ).catch(
								() => undefined
						  )
						: Promise.resolve( undefined );
				if ( branch && Number( branch[ 1 ] ) >= 7 && typeof apiFetch === 'function' ) {
					const missing = new Set< string >();
					const collect = ( list: any[] ) =>
						list.forEach( ( block: any ) => {
							if ( block.name === 'core/missing' && block.attributes?.originalName ) {
								missing.add( String( block.attributes.originalName ) );
							}
							collect( block.innerBlocks ?? [] );
						} );
					collect( wpBlocks.parse( html ) );
					await Promise.all(
						[ ...missing ].map( ( name ) =>
							typeOf( name ).then( ( type: any ) => {
								if ( type?.is_dynamic && ! type.supports?.autoRegister ) {
									serverRendered.add( name );
								}
							} )
						)
					);
				}

				// Block validation logs console-style messages: a format string whose
				// %s / %o / %d placeholders take the arguments that follow it.
				function formatIssue( args: any[] ): string {
					const show = ( value: any ) =>
						typeof value === 'object' ? JSON.stringify( value ) : String( value );
					const rest = args.slice( 1 );
					const text = String( args[ 0 ] ?? '' ).replace( /%[sodif]/g, ( placeholder ) =>
						rest.length ? show( rest.shift() ) : placeholder
					);
					return [ text, ...rest.map( show ) ].join( ' ' ).slice( 0, 600 );
				}

				function extractIssues( validationIssues: any[] ): string[] {
					const issues: string[] = [];
					for ( const issue of validationIssues ) {
						if ( issue?.args ) {
							const msg = String( issue.args[ 0 ] || '' );
							// Skip the verbose "Block validation failed for `name`" summary —
							// the per-attribute messages that follow are more useful.
							if ( ! msg.startsWith( 'Block validation failed' ) ) {
								issues.push( formatIssue( issue.args ) );
							}
						}
					}
					return issues;
				}

				// The JSON types a block attribute schema names, as wp.blocks checks them.
				function hasType( value: any, type: any ): boolean {
					if ( type === undefined ) {
						return true;
					}
					return [ type ].flat().some( ( one: string ) => {
						switch ( one ) {
							case 'null':
								return value === null;
							case 'boolean':
							case 'string':
							case 'number':
								return typeof value === one;
							case 'integer':
								return Number.isInteger( value );
							case 'array':
								return Array.isArray( value );
							case 'object':
								return value !== null && typeof value === 'object' && ! Array.isArray( value );
							default:
								return true;
						}
					} );
				}

				// Attributes in a block's comment delimiter that its type does not
				// declare (in its current or deprecated versions), or values outside a
				// declared enum. wp.blocks.parse drops both without a word, so they are
				// read from the raw delimiter.
				function attributeIssues( name: string, blockType: any, attrs: any ): string[] {
					const known = Object.assign(
						{},
						...[ ...( blockType.deprecated ?? [] ) ].reverse().map( ( v: any ) => v.attributes ),
						blockType.attributes
					);
					const issues: string[] = [];
					for ( const [ key, value ] of Object.entries( attrs ?? {} ) ) {
						const schema = known[ key ];
						if ( ! schema ) {
							issues.push(
								`"${ key }" is not an attribute of ${ name }, so WordPress ignores it.`
							);
						} else if ( ! hasType( value, schema.type ) ) {
							issues.push(
								`${ name }'s "${ key }" is of type ${ [ schema.type ]
									.flat()
									.join( ' or ' ) }, so WordPress ignores ${ JSON.stringify( value ) }.`
							);
						} else if ( Array.isArray( schema.enum ) && ! schema.enum.includes( value ) ) {
							issues.push(
								`${ JSON.stringify(
									value
								) } is not a value of ${ name }'s "${ key }", so WordPress ignores it.`
							);
						}
					}
					if ( issues.length ) {
						const attributes = Object.entries( blockType.attributes ?? {} )
							.filter( ( [ , schema ]: [ string, any ] ) => ! schema?.source )
							.map( ( [ key, schema ]: [ string, any ] ) =>
								Array.isArray( schema?.enum )
									? `${ key } (${ schema.enum
											.map( ( v: unknown ) => JSON.stringify( v ) )
											.join( ' | ' ) })`
									: key
							);
						issues.push( `${ name } attributes: ${ attributes.join( ', ' ) }.` );
					}
					return issues;
				}

				// The strings a value holds, at any depth.
				const stringsIn = ( value: any ): string[] =>
					typeof value === 'string'
						? [ value ]
						: value && typeof value === 'object'
						? Object.values( value ).flatMap( stringsIn )
						: [];
				// The strings a block and its inner blocks hold in their attributes.
				const heldStrings = ( block: any ): Set< string > =>
					new Set( [
						...stringsIn( block?.attributes ?? {} ),
						...( block?.innerBlocks ?? [] ).flatMap( ( one: any ) => [ ...heldStrings( one ) ] ),
					] );
				// The text in the comment attributes written on a block, of those its
				// current or an older version reads, that `held` lacks: `[ key, text ]`
				// each. The editor reads a block as the version its markup matches, so
				// an attribute only an older version declares is dropped from a block
				// that matches the current one (jetpack/field-name's "label" beside an
				// empty <div>), and a migration can drop one. className is classes,
				// which are compared as such.
				function droppedText( blockType: any, attrs: any, held: Set< string > ) {
					const known = Object.assign(
						{},
						...[ ...( blockType.deprecated ?? [] ) ].reverse().map( ( v: any ) => v.attributes ),
						blockType.attributes
					);
					return Object.entries( attrs ?? {} ).flatMap( ( [ key, value ] ) => {
						const schema = known[ key ];
						if (
							key === 'className' ||
							! schema ||
							schema.source ||
							! hasType( value, schema.type ) ||
							( Array.isArray( schema.enum ) && ! schema.enum.includes( value ) ) ||
							JSON.stringify( value ) === JSON.stringify( schema.default )
						) {
							return [];
						}
						return stringsIn( value )
							.filter( ( text ) => /\p{L}/u.test( text ) && ! held.has( text ) )
							.map( ( text ): [ string, string ] => [ key, text ] );
					} );
				}
				// Whether WordPress renders each block type on the server, by name, as
				// the REST API lists it; a name not yet asked about is in `unasked`. A
				// block it renders shows visitors its render, from its attributes. Of
				// a block the editor reads as valid, which it saves without a word, the
				// text its comment holds that `held` lacks; the fix of an invalid one
				// is compared as it saves.
				const rendersOnServer = new Map< string, boolean >();
				const unasked = new Set< string >();
				function droppedRenderedText( block: any, attrs: any, held: Set< string > ) {
					const { name } = block;
					const blockType = wpBlocks.getBlockType( name );
					if ( ! blockType || block.isValid === false ) {
						return [];
					}
					const dropped = droppedText( blockType, attrs, held );
					if ( dropped.length && ! rendersOnServer.has( name ) ) {
						unasked.add( name );
					}
					return rendersOnServer.get( name ) ? dropped : [];
				}
				const listDropped = ( dropped: Array< [ string, string ] > ) =>
					dropped.map( ( [ key, text ] ) => `${ JSON.stringify( text ) } (${ key })` ).join( ', ' );

				const rawParse = ( window as any ).wp?.blockSerializationDefaultParser?.parse;
				const rawName = ( raw: any ) =>
					raw?.blockName?.includes( '/' ) ? raw.blockName : `core/${ raw?.blockName }`;

				const verdict = ( result: any ) =>
					Array.isArray( result )
						? { isValid: result[ 0 ], issues: result[ 1 ] ?? [] }
						: { isValid: result.isValid, issues: result.validationIssues ?? [] };

				// The kind of probe value an attribute's schema takes, if any.
				const kindOf = ( schema: any ): 'string' | 'number' | undefined =>
					schema.type === 'string'
						? 'string'
						: [ 'number', 'integer' ].includes( schema.type )
						? 'number'
						: undefined;

				// A block's own saved markup, without its inner blocks.
				const ownHtml = ( one: any ) =>
					String( rawParse( wpBlocks.serialize( [ one ] ) )?.[ 0 ]?.innerHTML ?? '' );

				// The own markup of a block made with an attribute holding the probe
				// value of its kind; undefined when the block cannot be made so.
				function probed( block: any, key: string, kind: 'string' | 'number' ) {
					try {
						return ownHtml(
							wpBlocks.createBlock(
								block.name,
								{ ...block.attributes, [ key ]: PROBE[ kind ] },
								block.innerBlocks
							)
						);
					} catch {
						return undefined;
					}
				}

				// The parser accepts a block that matches an older version of it and
				// migrates it, which can produce markup the block no longer parses
				// (an old paragraph reads its whole <p> as its text, and saves a <p>
				// inside a <p>). Such a block is checked against the current version:
				// the attributes it reads from what was written, and what it saves.
				function currentVersion( block: any, raw: any ) {
					const blockType = wpBlocks.getBlockType( block.name );
					if (
						! blockType?.deprecated?.length ||
						rawName( raw ) !== block.name ||
						typeof wpBlocks.getBlockAttributes !== 'function' ||
						typeof wpBlocks.validateBlock !== 'function'
					) {
						return { isValid: true, issues: [] as any[], attributes: block.attributes };
					}
					const attributes = wpBlocks.getBlockAttributes(
						blockType,
						block.originalContent,
						raw.attrs
					);
					return {
						...verdict( wpBlocks.validateBlock( { ...block, attributes }, blockType ) ),
						attributes,
					};
				}

				// A migrated block whose saved markup is itself invalid, by the
				// attributes the current version reads from what was written.
				function brokenMigration( block: any, raw: any ) {
					const current = currentVersion( block, raw );
					return current.isValid ||
						wpBlocks.parse( wpBlocks.serialize( [ block ] ) )[ 0 ]?.isValid !== false
						? undefined
						: current;
				}

				function validateContent( blockHtml: string ) {
					const blocks = wpBlocks.parse( blockHtml );
					const results: any[] = [];
					// Each block as written, by place, for a block that stays as written.
					const written = new Map< string, any >();

					// `raw` is the block as written, from the default parser; it is
					// only checked when it is the same block type.
					function validateRecursive( block: any, raw: any, place: string ) {
						if ( ! block.name ) {
							return;
						}
						if ( block.name === 'core/freeform' ) {
							return;
						}
						if ( block.name === 'core/missing' ) {
							// The parser reads a block whose type is not registered as core/missing.
							const name = String( block.attributes?.originalName ?? '' );
							const prefix = `${ name.split( '/' )[ 0 ] }/`;
							const registered = wpBlocks
								.getBlockTypes()
								.map( ( type: any ) => type.name )
								.filter( ( registeredName: string ) => registeredName.startsWith( prefix ) );
							results.push( {
								blockName: name,
								place,
								isValid: false,
								issues: [
									serverRendered.has( name )
										? `${ name } is registered on the site in PHP but not in the block editor, so the editor shows it as an unsupported block. A block with a render_callback whose supports include 'autoRegister' => true is registered in the editor by WordPress, which previews it with the server's render (_wp_enqueue_auto_register_blocks() in wp-includes/blocks.php).`
										: `${ name } is not registered on the site, so the editor shows it as an unsupported block. ${
												registered.length
													? `The registered ${ prefix } blocks are ${ registered.join( ', ' ) }.`
													: `No ${ prefix } blocks are registered in the site's block editor.`
										  }${
												thrown.length
													? ` The site's block editor threw: ${ thrown.join( '; ' ) }.`
													: ''
										  }`,
								],
								originalContent: block.attributes?.originalContent ?? '',
							} );
							return;
						}

						const blockType = wpBlocks.getBlockType( block.name );
						let issues: string[] = [];
						let isValid = true;
						let expectedContent: string | undefined;
						const sameBlock = rawName( raw ) === block.name;

						if ( typeof block.isValid === 'boolean' ) {
							// The parser already ran the save-function comparison. Reuse its
							// verdict: it knows about blocks like core/html whose save returns
							// null and whose content lives in the raw inner HTML, which a
							// second validateBlock() call would wrongly flag as invalid.
							isValid = block.isValid;
							const migration = isValid && sameBlock ? brokenMigration( block, raw ) : undefined;
							// A block only an older version accepts the editor saves as the
							// current one, from what that version migrates it to: a paragraph
							// with typography.textAlign written without has-text-align-center
							// matches a version from before the support, and the editor saves
							// the class the page renders until then without.
							const older =
								isValid && sameBlock && ! migration ? currentVersion( block, raw ) : undefined;
							if ( ! isValid ) {
								issues = extractIssues( block.validationIssues || [] );
							} else if ( migration ) {
								isValid = false;
								issues = extractIssues( migration.issues );
								expectedContent = wpBlocks.getSaveContent(
									blockType,
									migration.attributes,
									block.innerBlocks
								);
							} else if ( older && ! older.isValid ) {
								isValid = false;
								issues = extractIssues( older.issues );
								expectedContent = wpBlocks.getSaveContent(
									blockType,
									block.attributes,
									block.innerBlocks
								);
							}
						} else if ( typeof wpBlocks.validateBlock === 'function' ) {
							// validateBlock performs the save-function comparison.
							// Handle both return formats:
							//   WP 6.3+: { isValid: boolean, validationIssues: Array }
							//   Older:   [boolean, Array]
							const validation = verdict( wpBlocks.validateBlock( block, blockType ) );
							isValid = validation.isValid;
							if ( ! isValid ) {
								issues = extractIssues( validation.issues );
							}
						}

						if ( blockType && ! isValid && expectedContent === undefined ) {
							// Re-render expected HTML including inner blocks for comparison
							try {
								expectedContent = wpBlocks.getSaveContent(
									blockType,
									block.attributes,
									block.innerBlocks
								);
							} catch {
								// If re-rendering fails, skip expected content
							}
						}

						// After expectedContent: an ignored attribute changes no markup.
						const attributeProblems =
							blockType && sameBlock ? attributeIssues( block.name, blockType, raw.attrs ) : [];
						if ( attributeProblems.length ) {
							isValid = false;
							issues = [ ...issues, ...attributeProblems ];
						}
						// Text written in the comment of a block the server renders, which
						// the editor reads the block without and saves it without.
						const dropped =
							blockType && sameBlock
								? droppedRenderedText( block, raw.attrs, heldStrings( block ) )
								: [];
						if ( dropped.length ) {
							isValid = false;
							issues = [
								...issues,
								`The editor reads ${ block.name } without ${ listDropped(
									dropped
								) } written in its comment, and WordPress renders the block on the server from its attributes, so saving it in the editor drops that text from the page.`,
							];
							// What the older version that reads them migrates the block to,
							// as the editor migrates a block that matches it.
							const keys = dropped.map( ( [ key ] ) => key );
							const older = ( blockType.deprecated ?? [] ).find(
								( version: any ) =>
									version.migrate && keys.every( ( key ) => version.attributes?.[ key ] )
							);
							try {
								const [ attributes, innerBlocks = block.innerBlocks ] = [
									older?.migrate( { ...block.attributes, ...raw.attrs }, block.innerBlocks ),
								].flat();
								const held = heldStrings( { attributes, innerBlocks } );
								if ( older && dropped.every( ( [ , text ] ) => held.has( text ) ) ) {
									expectedContent = wpBlocks.getSaveContent( blockType, attributes, innerBlocks );
								}
							} catch {
								// Nothing to show.
							}
						}

						written.set( place, raw );
						results.push( {
							blockName: block.name,
							place,
							isValid,
							issues,
							attributeIssues: attributeProblems,
							originalContent: block.originalContent || '',
							expectedContent: isValid ? undefined : expectedContent,
						} );

						( block.innerBlocks ?? [] ).forEach( ( inner: any, i: number ) =>
							validateRecursive(
								inner,
								sameBlock ? raw.innerBlocks?.[ i ] : undefined,
								`${ place }/${ i }`
							)
						);
					}

					// Text between blocks is a raw entry without a name and a core/freeform
					// block; pair the rest in order.
					const rawEntries = typeof rawParse === 'function' ? rawParse( blockHtml ) : [];
					const rawBlocks = rawEntries.filter( ( raw: any ) => raw.blockName );
					// Markup outside any block is a Classic block in the editor, edited
					// as one blob of HTML.
					for ( const raw of rawEntries ) {
						const outside = raw.blockName ? '' : String( raw.innerHTML ?? '' ).trim();
						if ( /<[a-z]/i.test( outside ) ) {
							results.push( {
								blockName: 'core/freeform',
								isValid: false,
								issues: [
									'This HTML is outside any block, so the editor shows it as one Classic block. convert_to_blocks converts it to blocks, or write it as blocks: core/group for each section, with core/heading, core/paragraph, core/image and core/buttons inside.',
								],
								originalContent: outside,
							} );
						}
					}
					let named = 0;
					blocks.forEach( ( block: any, i: number ) => {
						if ( block.name !== 'core/freeform' ) {
							validateRecursive( block, rawBlocks[ named++ ], `/${ i }` );
						}
					} );

					const validCount = results.filter( ( r: any ) => r.isValid ).length;
					return {
						blocks,
						rawBlocks,
						written,
						report: {
							totalBlocks: results.length,
							validBlocks: validCount,
							invalidBlocks: results.length - validCount,
							results,
						},
					};
				}

				// What the editor saves for a block it cannot parse as written: the
				// block made again from its attributes, if that block is valid; the
				// block as written otherwise. `raw` is the block from the default
				// parser, whose comment attributes the editor drops when it reads
				// them from markup that is not there, such as a missing wrapper's class.
				function normalizeBlock( block: any, raw?: any ): any {
					if ( ! block.name || block.name === 'core/freeform' || block.name === 'core/missing' ) {
						return block;
					}

					const blockType = wpBlocks.getBlockType( block.name );
					if ( ! blockType || typeof wpBlocks.createBlock !== 'function' ) {
						return block;
					}

					const sameBlock = rawName( raw ) === block.name;
					const fixedInnerBlocks = Array.isArray( block.innerBlocks )
						? block.innerBlocks.map( ( inner: any, i: number ) =>
								normalizeBlock( inner, sameBlock ? raw.innerBlocks?.[ i ] : undefined )
						  )
						: [];

					const migration =
						block.isValid === true && sameBlock ? brokenMigration( block, raw ) : undefined;
					const parsed = migration?.attributes ?? block.attributes;
					const withComment = { ...parsed };
					for ( const [ key, value ] of Object.entries( sameBlock ? raw.attrs ?? {} : {} ) ) {
						// A value of the wrong type WordPress ignores, and so does the fix.
						const schema = blockType.attributes?.[ key ];
						if ( withComment[ key ] === undefined && schema && hasType( value, schema.type ) ) {
							withComment[ key ] = value;
						}
					}
					// WordPress 7.0 moved `textAlign` to the typography.textAlign block
					// support, and the blocks that declared it migrate it there
					// (migrate-text-align in @wordpress/block-library). A block with the
					// support that never declared it reads it from there the same way.
					const textAlign = sameBlock ? raw.attrs?.textAlign : undefined;
					if (
						typeof textAlign === 'string' &&
						! blockType.attributes?.textAlign &&
						blockType.supports?.typography?.textAlign &&
						withComment.style?.typography?.textAlign === undefined
					) {
						withComment.style = {
							...withComment.style,
							typography: { ...withComment.style?.typography, textAlign },
						};
					}
					const inner = fixedInnerBlocks.length > 0 ? fixedInnerBlocks : undefined;

					// Re-creating a block the parser accepted can only lose content —
					// createBlock() drops the raw inner HTML of core/html, whose save
					// returns null — so keep it as parsed and only fix its children.
					if ( block.isValid === true && ! migration ) {
						return { ...block, attributes: withComment, innerBlocks: fixedInnerBlocks };
					}
					// Made again with every attribute its comment names, or with those
					// the block reads when one of them is invalid, or with what each
					// older version the block registers migrates what was written to
					// (its deprecated migrate, as the editor runs it when a block
					// matches that version): the first that keeps all that was written,
					// else the first that saves valid markup; as written otherwise.
					let best: any;
					let bestRank = -1;
					for ( const { attributes, innerBlocks = inner } of attributeSets( block, raw, sameBlock, [
						withComment,
						parsed,
					] ) ) {
						try {
							const created = wpBlocks.createBlock( block.name, attributes, innerBlocks );
							if ( wpBlocks.parse( wpBlocks.serialize( [ created ] ) )[ 0 ]?.isValid === false ) {
								continue;
							}
							const made = sameBlock
								? withWrittenClasses(
										withWrittenStyles( withWrittenSources( created, raw ), raw ),
										raw
								  )
								: created;
							if ( ! sameBlock ) {
								return made;
							}
							const rank = keepsRank( made, block, raw );
							if ( rank === KEEPS_ALL ) {
								return made;
							}
							if ( rank > bestRank ) {
								best = made;
								bestRank = rank;
							}
						} catch {
							// The next set of attributes.
						}
					}
					return best ?? block;
				}

				// The attribute sets to make a block again from, the deprecated
				// versions' migrations last and only once asked for. A migration
				// that makes inner blocks for a block written with none, as core/list
				// makes its items from the old values (list/deprecated.js), makes
				// the block with them.
				function* attributeSets(
					block: any,
					raw: any,
					sameBlock: boolean,
					first: any[]
				): Generator< { attributes: any; innerBlocks?: any[] } > {
					yield* first.map( ( attributes ) => ( { attributes } ) );
					const blockType = wpBlocks.getBlockType( block.name );
					if ( ! sameBlock || typeof wpBlocks.getBlockAttributes !== 'function' ) {
						return;
					}
					for ( const version of blockType?.deprecated ?? [] ) {
						if ( typeof version.migrate !== 'function' ) {
							continue;
						}
						const read = wpBlocks.getBlockAttributes(
							// As the editor reads a block by an older version
							// (applyBlockDeprecatedVersions in @wordpress/blocks).
							{ ...blockType, ...version },
							block.originalContent,
							raw.attrs
						);
						const migrated = version.migrate( read, block.innerBlocks ?? [] );
						yield {
							attributes: {
								...first[ 0 ],
								...( Array.isArray( migrated ) ? migrated[ 0 ] : migrated ),
							},
							innerBlocks:
								Array.isArray( migrated ) && migrated[ 1 ]?.length && ! block.innerBlocks?.length
									? migrated[ 1 ]
									: undefined,
						};
					}
				}

				// How much of what was written a block made again keeps, the first
				// that keeps more being the fix: every class written in its own
				// markup, then the text it holds with its inner blocks, then each
				// value its comment wrote, wherever the block saves it, as a
				// migration moves a value into an inner block's comment.
				const KEEPS_ALL = 7;
				function keepsRank( made: any, block: any, raw: any ) {
					const text = ( markup: string ) =>
						(
							new DOMParser().parseFromString( markup, 'text/html' ).body.textContent ?? ''
						).replace( /\s+/g, '' );
					const saved = wpBlocks.serialize( [ made ] );
					const leaves = ( value: unknown ): unknown[] =>
						value && typeof value === 'object'
							? Object.values( value ).flatMap( leaves )
							: [ value ];
					const keepsComment = leaves( raw.attrs ?? {} ).every( ( value ) =>
						saved.includes( JSON.stringify( value ) )
					);
					return (
						( keepsWritten( made, raw ) ? 4 : 0 ) +
						( text( saved ) === text( wpBlocks.serialize( [ block ] ) ) ? 2 : 0 ) +
						( keepsComment ? 1 : 0 )
					);
				}

				// Whether a block made again saves every class written in its own
				// markup: the styles written on it withWrittenStyles stores, and what
				// a fix loses otherwise its losses tell.
				function keepsWritten( made: any, raw: any ) {
					const saved = ownMarkup( ownHtml( made ) ).classes;
					return [ ...ownMarkup( String( raw.innerHTML ?? '' ) ).classes ].every( ( name ) =>
						saved.has( name )
					);
				}

				// The block made again with each value written in an attribute of
				// an element in its own markup that it would drop, as an image's src
				// or alt, stored in the comment attribute the block saves that value
				// from: core/cover saves its background image's src from url and its
				// alt from alt (cover/save.js). As withWrittenClasses reads classes,
				// each attribute is made with a probe value, and the element
				// attribute holding it read; one a stored value brings in, as alt
				// with the image url brings, the next round reads.
				function withWrittenSources( made: any, raw: any ) {
					if ( typeof rawParse !== 'function' ) {
						return made;
					}
					const valuesOf = ( html: string ) =>
						elementsOf( html ).flatMap( ( element ) =>
							Array.from( element.attributes )
								.filter( ( { name, value } ) => value && name !== 'class' && name !== 'style' )
								.map( ( { name, value } ) => ( {
									place: `${ element.tagName } ${ name }`,
									value,
								} ) )
						);
					const written = valuesOf( String( raw.innerHTML ?? '' ) );
					const attributes = Object.entries( wpBlocks.getBlockType( made.name )?.attributes ?? {} );
					let result = made;
					for ( let round = 0; round < 3; round++ ) {
						const saved = new Set(
							valuesOf( ownHtml( result ) ).map( ( { place, value } ) => `${ place }=${ value }` )
						);
						const dropped = written.filter(
							( { place, value } ) => ! saved.has( `${ place }=${ value }` )
						);
						let stored = false;
						for ( const [ key, schema ] of attributes as Array< [ string, any ] > ) {
							const kind = kindOf( schema );
							// The comment's own value stands, as the editor makes a block
							// from its comment.
							if ( ! kind || key === 'className' || raw.attrs?.[ key ] !== undefined ) {
								continue;
							}
							const probe = String( PROBE[ kind ] );
							const html = probed( result, key, kind );
							if ( html === undefined ) {
								continue;
							}
							for ( const { place, value: template } of valuesOf( html ) ) {
								const at = template.indexOf( probe );
								if ( at < 0 ) {
									continue;
								}
								const before = template.slice( 0, at );
								const after = template.slice( at + probe.length );
								const value = dropped
									.filter( ( one ) => one.place === place )
									.map( ( one ) =>
										one.value.startsWith( before ) && one.value.endsWith( after )
											? one.value.slice( before.length, one.value.length - after.length )
											: ''
									)
									.find( ( one ) => one && ( kind === 'string' || /^\d+$/.test( one ) ) );
								if ( value && String( result.attributes[ key ] ?? '' ) !== value ) {
									result = wpBlocks.createBlock(
										result.name,
										{
											...result.attributes,
											[ key ]: kind === 'number' ? Number( value ) : value,
										},
										result.innerBlocks
									);
									stored = true;
									break;
								}
							}
						}
						if ( ! stored ) {
							break;
						}
					}
					return result;
				}

				// The block made again with each class written in its own markup that
				// it would drop stored in the comment attribute the block saves that
				// class from, as the editor stores it: core/image saves wp-image-<id>
				// from its id (image/save.js), and a color or font size preset saves
				// has-<slug>-color or has-<slug>-font-size from textColor or fontSize
				// (getColorClassName, getFontSizeClass in @wordpress/block-editor).
				// Which class each attribute saves, the block's own save tells: each
				// is made with a probe value, and the class holding it read. A value
				// stored where the block does not save the class from loses the class,
				// so the fix keeps the block as written.
				const PROBE = { string: 'studioprobe', number: 424242 };
				function withWrittenClasses( made: any, raw: any ) {
					if ( typeof rawParse !== 'function' ) {
						return made;
					}
					const classesOf = ( html: string ) =>
						new Set( elementsOf( html ).flatMap( ( element ) => [ ...element.classList ] ) );
					const ownClasses = ( one: any ) => classesOf( ownHtml( one ) );
					const saved = ownClasses( made );
					const dropped = [
						...new Set(
							elementsOf( String( raw.innerHTML ?? '' ) ).flatMap( ( element ) => [
								...element.classList,
							] )
						),
					].filter( ( name ) => ! saved.has( name ) );
					if ( ! dropped.length ) {
						return made;
					}
					const templates = Object.entries( wpBlocks.getBlockType( made.name )?.attributes ?? {} )
						.filter( ( [ key ] ) => key !== 'className' )
						.flatMap( ( [ key, schema ]: [ string, any ] ) => {
							const kind = kindOf( schema );
							if ( ! kind ) {
								return [];
							}
							const probe = String( PROBE[ kind ] );
							const html = probed( made, key, kind );
							if ( html === undefined ) {
								return [];
							}
							const classes = classesOf( html );
							// The classes it saves for any value, as has-text-color
							// beside has-<slug>-color, which name no value.
							const fixed = [ ...classes ].filter(
								( name ) => ! name.includes( probe ) && ! saved.has( name )
							);
							return [ ...classes ].flatMap( ( name ) => {
								const at = name.indexOf( probe );
								return at < 0
									? []
									: [
											{
												key,
												kind,
												fixed,
												before: name.slice( 0, at ),
												after: name.slice( at + probe.length ),
											},
									  ];
							} );
						} )
						// The most specific first: has-<slug>-border-color is
						// borderColor's, though textColor's has-<slug>-color matches it.
						.sort(
							( a, b ) => b.before.length + b.after.length - ( a.before.length + a.after.length )
						);
					let result = made;
					for ( const name of dropped ) {
						// As has-text-color, which storing the color already saves.
						if ( ownClasses( result ).has( name ) ) {
							continue;
						}
						for ( const { key, kind, fixed, before, after } of templates ) {
							const value =
								! fixed.includes( name ) && name.startsWith( before ) && name.endsWith( after )
									? name.slice( before.length, name.length - after.length )
									: '';
							if ( ! value ) {
								continue;
							}
							// The comment's own value stands, as the editor makes a
							// block from its comment, and the class is lost.
							if ( raw.attrs?.[ key ] !== undefined && String( raw.attrs[ key ] ) !== value ) {
								break;
							}
							result = wpBlocks.createBlock(
								result.name,
								{ ...result.attributes, [ key ]: kind === 'number' ? Number( value ) : value },
								result.innerBlocks
							);
							break;
						}
					}
					return result;
				}

				// The style attribute path the style engine saves each CSS property
				// from, as getCSSRules in @wordpress/style-engine reads them: it is
				// handed a style whose every value names its own path.
				let stylePaths: Map< string, string[] > | undefined;
				function stylePathOf( property: string ) {
					if ( ! stylePaths ) {
						const PATH = Symbol( 'path' );
						const at = ( path: string[] ): any =>
							new Proxy( function () {}, {
								get: ( _target, key ) =>
									key === PATH
										? path
										: typeof key === 'symbol'
										? undefined
										: at( [ ...path, key ] ),
								apply: () => undefined,
							} );
						const rules = ( window as any ).wp?.styleEngine?.getCSSRules?.( at( [] ) ) ?? [];
						stylePaths = new Map(
							rules
								.filter( ( rule: any ) => rule.value?.[ PATH ] )
								.map( ( rule: any ) => [ rule.key, rule.value[ PATH ] ] )
						);
					}
					return stylePaths.get(
						property.replace( /-([a-z])/g, ( _m, letter ) => letter.toUpperCase() )
					);
				}

				// The style attribute path of a shorthand the browser sets a property
				// with, for a property the style engine saves only through one: a
				// gradient is written as background-image, and the style engine saves
				// color.gradient as background.
				function shorthandPathOf( property: string, value: string ) {
					stylePathOf( property );
					for ( const [ key, path ] of stylePaths ?? [] ) {
						const shorthand = key.replace( /[A-Z]/g, ( letter ) => `-${ letter.toLowerCase() }` );
						const scratch = document.createElement( 'div' );
						scratch.style.setProperty( shorthand, value );
						if ( scratch.style.getPropertyValue( property ) === value ) {
							return path;
						}
					}
					return undefined;
				}

				// The inline styles a block saves from its own attributes rather than
				// from its style attribute, as core/image saves scale as object-fit
				// and aspectRatio as aspect-ratio (image/save.js). As withWrittenClasses
				// reads classes: each attribute is made with a probe value, and the
				// declaration holding it read.
				const attributeStyles = new Map< string, any[] >();
				function attributeStylesOf( made: any ) {
					const known = attributeStyles.get( made.name );
					if ( known ) {
						return known;
					}
					const found = Object.entries(
						wpBlocks.getBlockType( made.name )?.attributes ?? {}
					).flatMap( ( [ key, schema ]: [ string, any ] ) => {
						const kind = kindOf( schema );
						if ( ! kind ) {
							return [];
						}
						const probe = String( PROBE[ kind ] );
						const html = probed( made, key, kind );
						if ( html === undefined ) {
							return [];
						}
						return elementsOf( html ).flatMap( ( element ) =>
							String( element.getAttribute( 'style' ) ?? '' )
								.split( ';' )
								.map( ( declaration ) => declaration.split( ':' ) )
								.filter( ( parts ) => parts.length === 2 && parts[ 1 ].includes( probe ) )
								.map( ( [ property, value ] ) => ( {
									key,
									kind,
									property: property.trim().toLowerCase(),
									before: value.trim().slice( 0, value.trim().indexOf( probe ) ),
									after: value.trim().slice( value.trim().indexOf( probe ) + probe.length ),
								} ) )
						);
					} );
					attributeStyles.set( made.name, found );
					return found;
				}

				// The elements of a block's own markup, without its inner blocks.
				function elementsOf( ownHtml: string ) {
					return Array.from(
						new DOMParser()
							.parseFromString( ownHtml, 'text/html' )
							.body.querySelectorAll< HTMLElement >( '*' )
					);
				}

				// An element's inline styles as the browser reads them, so .85rem is
				// 0.85rem. A shorthand sets each longhand it leaves out to initial,
				// which is what an unset longhand is, so those are left out.
				// A shorthand holding a var() sets its longhands only once the
				// variable is computed, so the browser reads them as empty: it stands
				// as written, as border-color:var(--wp--preset--color--accent).
				function declarations( element: HTMLElement ) {
					const read = new Map(
						Array.from( element.style )
							.map(
								( property ) => [ property, element.style.getPropertyValue( property ) ] as const
							)
							.filter( ( [ , value ] ) => value !== 'initial' )
					);
					for ( const declaration of String( element.getAttribute( 'style' ) ?? '' ).split(
						';'
					) ) {
						const colon = declaration.indexOf( ':' );
						const property = declaration.slice( 0, colon ).trim().toLowerCase();
						const value = element.style.getPropertyValue( property );
						const scratch = document.createElement( 'div' );
						scratch.style.setProperty( property, value );
						const longhands = Array.from( scratch.style );
						if (
							colon > 0 &&
							value &&
							longhands.length > 1 &&
							longhands.every( ( longhand ) => scratch.style.getPropertyValue( longhand ) === '' )
						) {
							longhands.forEach( ( longhand ) => read.delete( longhand ) );
							read.set( property, value );
						}
					}
					return read;
				}

				// The block made again with the inline styles written in its own markup
				// that it would drop, stored where the block saves them from: the style
				// attribute the block saves that style from, else the style attribute
				// path the style engine reads, or a shorthand's that sets it, holding
				// a preset as var:preset|… the way the editor stores one. Kept when it
				// holds more of the styles written on each element; what it loses
				// still, the fix's losses tell.
				function withWrittenStyles( made: any, raw: any ) {
					if ( typeof rawParse !== 'function' ) {
						return made;
					}
					const written = elementsOf( String( raw.innerHTML ?? '' ) );
					const holdsWritten = ( saved: HTMLElement[] ) =>
						written.map( ( element, i ) => {
							const there = saved[ i ] ? declarations( saved[ i ] ) : new Map();
							return [ ...declarations( element ) ].filter(
								( [ property, value ] ) => there.get( property ) !== value
							);
						} );
					const dropped = holdsWritten( elementsOf( ownHtml( made ) ) );
					if ( ! dropped.flat().length ) {
						return made;
					}
					const style = structuredClone( made.attributes.style ?? {} );
					const attributes: Record< string, unknown > = {};
					for ( const [ i, missing ] of dropped.entries() ) {
						// Each value as written, so a color stays as it was written.
						const asWritten = new Map(
							String( written[ i ].getAttribute( 'style' ) ?? '' )
								.split( ';' )
								.map( ( declaration ) => declaration.split( ':' ) )
								.filter( ( parts ) => parts.length === 2 )
								.map( ( [ property, value ] ) => [ property.trim().toLowerCase(), value.trim() ] )
						);
						for ( const [ property, value ] of missing ) {
							// Of a shorthand too, as background:#efe6d8 writes background-color.
							const text =
								[ asWritten.get( property ), ...asWritten.values() ].find( ( candidate ) => {
									const scratch = document.createElement( 'div' );
									scratch.style.setProperty( property, candidate ?? '' );
									return scratch.style.getPropertyValue( property ) === value;
								} ) ?? value;
							// The attribute the block's own save holds that style from first,
							// as core/image saves object-fit on its img from scale, where the
							// style engine's dimensions.objectFit would save it on the figure.
							const saving = attributeStylesOf( made ).find( ( one ) => one.property === property );
							if ( saving ) {
								const held = text.slice( saving.before.length, text.length - saving.after.length );
								attributes[ saving.key ] = saving.kind === 'number' ? Number( held ) : held;
								continue;
							}
							const path = stylePathOf( property ) ?? shorthandPathOf( property, value );
							if ( ! path ) {
								continue;
							}
							const preset = /^var\(--wp--(preset--.+)\)$/.exec( text )?.[ 1 ];
							const stored = preset ? `var:${ preset.split( '--' ).join( '|' ) }` : text;
							const leaf = path
								.slice( 0, -1 )
								.reduce( ( at: any, key: string ) => ( at[ key ] ??= {} ), style );
							leaf[ path[ path.length - 1 ] ] =
								( window as any ).wp.styleEngine.getCSSValueFromRawStyle( stored ) === text
									? stored
									: text;
						}
					}
					const restyled = wpBlocks.createBlock(
						made.name,
						{
							...made.attributes,
							...attributes,
							style: Object.keys( style ).length ? style : made.attributes.style,
						},
						made.innerBlocks
					);
					return holdsWritten( elementsOf( ownHtml( restyled ) ) ).flat().length <
						dropped.flat().length
						? restyled
						: made;
				}

				let initial = validateContent( html );
				if ( unasked.size ) {
					const names = [ ...unasked ];
					unasked.clear();
					( await Promise.all( names.map( typeOf ) ) ).forEach( ( type, i ) =>
						rendersOnServer.set( names[ i ], !! type?.is_dynamic )
					);
					initial = validateContent( html );
				}

				// The block at a place, `/0/1` being the second inner block of the first.
				const blockAt = ( blocks: any[], place: string ) =>
					place
						.split( '/' )
						.slice( 1 )
						.reduce< any >(
							( at, index ) => ( at === null ? blocks : at?.innerBlocks ?? [] )[ Number( index ) ],
							null
						);

				if ( initial.report.invalidBlocks === 0 ) {
					return { report: initial.report };
				}

				let named = 0;
				const fixedBlocks = initial.blocks.map( ( block: any ) =>
					block.name === 'core/freeform'
						? block
						: normalizeBlock( block, initial.rawBlocks[ named++ ] )
				);
				let fixedContent = wpBlocks.serialize( fixedBlocks );

				if ( fixedContent === html ) {
					return { report: initial.report };
				}

				let fixed = validateContent( fixedContent );

				// A block's own markup, without its inner blocks: its classes, inline
				// style declarations and text, as the browser reads them.
				function ownMarkup( markup: string ) {
					const body = new DOMParser().parseFromString( markup, 'text/html' ).body;
					const classes = new Set< string >();
					const styles = new Set< string >();
					body.querySelectorAll< HTMLElement >( '*' ).forEach( ( element ) => {
						element.classList.forEach( ( name ) => classes.add( name ) );
						for ( const [ property, value ] of declarations( element ) ) {
							styles.add( `${ property }:${ value }` );
						}
					} );
					// Entities and whitespace the serializer rewrites are the same text.
					return {
						classes,
						styles,
						text: ( body.textContent ?? '' ).replace( /\s+/g, ' ' ).trim(),
					};
				}

				// Whether the inner blocks are those written: the parser makes them
				// when it migrates a block, and the fix when it makes it again.
				const sameInnerBlocks = ( block: any, fix: any, place: string ) =>
					( initial.written.get( place )?.innerBlocks ?? block.innerBlocks ?? [] ).length ===
						( block.innerBlocks ?? [] ).length &&
					( block.innerBlocks ?? [] ).length === ( fix.innerBlocks ?? [] ).length &&
					( block.innerBlocks ?? [] ).every(
						( inner: any, i: number ) => inner.name === fix.innerBlocks[ i ].name
					);

				// What a block holds with its inner blocks: their classes, styles and text.
				function holds( block: any ): ReturnType< typeof ownMarkup > {
					const all = [ block, ...( block.innerBlocks ?? [] ) ].map( ( one: any, i: number ) =>
						i === 0 ? ownMarkup( one.originalContent ?? '' ) : holds( one )
					);
					return {
						classes: new Set( all.flatMap( ( one ) => [ ...one.classes ] ) ),
						styles: new Set( all.flatMap( ( one ) => [ ...one.styles ] ) ),
						text: all.map( ( one ) => one.text.replace( /\s+/g, '' ) ).join( '' ),
					};
				}

				// A block's own markup with a slot for each inner block: its elements,
				// and the elements around each slot, outermost first.
				function slots( raw: any ) {
					const parts = ( raw?.innerContent ?? [] ).map( ( part: unknown ) =>
						typeof part === 'string' ? part : '<studio-slot></studio-slot>'
					);
					const body = new DOMParser().parseFromString( parts.join( '' ), 'text/html' ).body;
					const around = [ ...body.querySelectorAll( 'studio-slot' ) ].map( ( slot ) => {
						const elements: HTMLElement[] = [];
						for ( let at = slot.parentElement; at && at !== body; at = at.parentElement ) {
							elements.unshift( at );
						}
						return elements;
					} );
					const elements = [ ...body.querySelectorAll< HTMLElement >( ':not(studio-slot)' ) ];
					return { elements, around };
				}
				// The same element in another save: its tag, with the classes written
				// on it. An element written without classes has nothing to know it by.
				const same = ( written: HTMLElement, saved: HTMLElement ) =>
					written.classList.length > 0 &&
					written.tagName === saved.tagName &&
					[ ...written.classList ].every( ( name ) => saved.classList.contains( name ) );
				const elementName = ( at: HTMLElement ) =>
					at.tagName.toLowerCase() + [ ...at.classList ].map( ( name ) => `.${ name }` ).join( '' );

				// The inner blocks the fix moves into or out of an element the block was
				// written with, as a cover's save moves everything into its inner
				// container. Elements the fix adds are not moves.
				function moves( place: string, block: any ): string[] {
					const before = slots( initial.written.get( place ) );
					const after = slots( fixed.written.get( place ) );
					return ( block.innerBlocks ?? [] ).flatMap( ( inner: any, i: number ) => {
						const was = before.around[ i ] ?? [];
						const is = after.around[ i ] ?? [];
						const into = before.elements.filter(
							( written ) =>
								! was.includes( written ) && is.some( ( saved ) => same( written, saved ) )
						);
						// An element written without classes is known by its tag and how
						// many elements with that tag are around the inner block outside it,
						// as a list's <ul> written without wp-block-list.
						const sameTag = ( chain: HTMLElement[], at: HTMLElement ) =>
							chain.filter( ( element ) => element.tagName === at.tagName );
						const outOf = was.filter( ( written ) =>
							written.classList.length
								? ! is.some( ( saved ) => same( written, saved ) )
								: sameTag( is, written ).length <= sameTag( was, written ).indexOf( written )
						);
						return [
							...into.map( ( at ) => `move ${ inner.name } into ${ elementName( at ) }` ),
							...outOf.map( ( at ) => `move ${ inner.name } out of ${ elementName( at ) }` ),
						];
					} );
				}

				// The style a preset's class gives, has-<slug>-<property>
				// (getFontSizeClass and getColorClassName in @wordpress/block-editor),
				// with its kind of preset and the site's presets as the editor reads them.
				const PRESET_STYLES = [
					[ 'font-size', 'font-size', 'fontSizes', 'size' ],
					[ 'color', 'color', 'colors', 'color' ],
					[ 'background-color', 'color', 'colors', 'color' ],
				] as const;
				const editorSettings =
					( window as any ).wp?.data?.select( 'core/block-editor' )?.getSettings?.() ?? {};
				// A preset's value as the browser reads it, as an inline style is read.
				const asRead = ( property: string, value: string ) => {
					const scratch = document.createElement( 'div' );
					scratch.style.setProperty( property, value );
					return scratch.style.getPropertyValue( property );
				};
				// A style written on a block that a preset class its fix saves already
				// gives it, as font-size:1.05rem on a button saved with
				// has-medium-font-size for a medium of 1.05rem, or
				// color:var(--wp--preset--color--surface) saved as has-surface-color.
				function presetShows( classes: Set< string >, style: string ): boolean {
					return PRESET_STYLES.some( ( [ property, kind, list, key ] ) =>
						( editorSettings[ list ] ?? [] ).some(
							( preset: any ) =>
								classes.has( `has-${ preset.slug }-${ property }` ) &&
								[ preset[ key ], `var(--wp--preset--${ kind }--${ preset.slug })` ].some(
									( value ) =>
										typeof value === 'string' &&
										style === `${ property }:${ asRead( property, value ) }`
								)
						)
					);
				}

				// What the fix loses from each block as written, block by block: its
				// text, classes, styles and where its inner blocks sit. Its attributes
				// it keeps, being made from them, apart from the editor's own migrations
				// and those only an older version reads: the text of those of a block
				// the server renders, which renders from them, the fix loses as well.
				function losses( written: any[], fixes: any[], at = '' ): any[] {
					return written.flatMap( ( block: any, i: number ) => {
						const place = `${ at }/${ i }`;
						const fix = fixes[ i ];
						if ( ! block.name || ! fix || fix.name !== block.name ) {
							return [];
						}
						// When the editor makes the inner blocks again, as a list written
						// with bare <li> items migrates to core/list-item blocks
						// (core/list deprecations in @wordpress/block-library), what the
						// block holds moves between it and its inner blocks: what it holds
						// as a whole is compared, and spaces between the blocks are not
						// text.
						const reshaped = ! sameInnerBlocks( block, fix, place );
						const before = reshaped ? holds( block ) : ownMarkup( block.originalContent ?? '' );
						const after = reshaped ? holds( fix ) : ownMarkup( fix.originalContent ?? '' );
						const missing = ( names: Set< string >, kept: Set< string > ) =>
							[ ...names ].filter( ( name ) => ! kept.has( name ) );
						const classes = missing( before.classes, after.classes );
						const styles = missing( before.styles, after.styles ).filter(
							( style ) => ! presetShows( after.classes, style )
						);
						const lost = {
							text: before.text !== after.text ? [ 'change the text' ] : [],
							classes,
							styles,
							moves: reshaped ? [] : moves( place, block ),
							attributes: droppedRenderedText(
								block,
								initial.written.get( place )?.attrs,
								heldStrings( fix )
							),
						};
						const root = reshaped ? undefined : elementsOf( block.originalContent ?? '' )[ 0 ];
						// An element known by its tag and its first wp-block class, or
						// its first class, of those the fix keeps.
						const nameOf = ( element: HTMLElement ) => {
							const names = [ ...element.classList ].filter(
								( name ) => ! classes.includes( name )
							);
							const name = names.find( ( one ) => one.startsWith( 'wp-block' ) ) ?? names[ 0 ];
							return element.tagName.toLowerCase() + ( name ? `.${ name }` : '' );
						};
						return [
							...( Object.values( lost ).some( ( one ) => one.length )
								? [
										{
											place,
											blockName: block.name,
											lost,
											onRoot: root
												? [ ...declarations( root ) ].filter(
														( [ property, value ] ) =>
															styles.includes( `${ property }:${ value }` ) &&
															// The preview is as tall as its blocks, so a length of
															// the viewport's height there is theirs.
															! /\d[dsl]?vh\b/.test( value )
												  )
												: [],
											rootStyle: root?.getAttribute( 'style' ) ?? '',
											// The styles the fix drops from each element, known by its
											// tag and the classes written on it.
											stylesOn: reshaped
												? []
												: elementsOf( block.originalContent ?? '' ).flatMap( ( element, index ) => {
														const dropped = [ ...declarations( element ) ]
															.map( ( [ property, value ] ) => `${ property }:${ value }` )
															.filter( ( style ) => styles.includes( style ) );
														return dropped.length
															? [
																	{
																		root: index === 0,
																		index,
																		name: nameOf( element ),
																		tag: element.tagName,
																		classes: [ ...element.classList ],
																		styles: dropped,
																	},
															  ]
															: [];
												  } ),
											classesOn: reshaped
												? []
												: elementsOf( block.originalContent ?? '' ).flatMap( ( element, index ) => {
														const names = [ ...element.classList ];
														const gone = names.filter( ( name ) => classes.includes( name ) );
														return gone.length
															? [
																	{
																		root: index === 0,
																		index,
																		name: nameOf( element ),
																		kept: names.filter( ( name ) => ! gone.includes( name ) ),
																		gone,
																		added: [ ...after.classes ].filter(
																			( name ) => ! names.includes( name )
																		),
																	},
															  ]
															: [];
												  } ),
										},
								  ]
								: [] ),
							...( reshaped
								? []
								: losses( block.innerBlocks ?? [], fix.innerBlocks ?? [], place ) ),
						];
					} );
				}

				// The inline styles written on each block's own element that its fix
				// already shows, as display:flex on a group whose layout attribute is
				// flex, which the layout support renders (wp_render_layout_support_flag
				// in wp-includes/block-supports/layout.php). The fixes are rendered as
				// the editor previews blocks (BlockPreview in @wordpress/block-editor),
				// each inside the outermost block around it so it sits in the layout it
				// has on the page. The style written on a block's element is then set on
				// it again, and each property whose computed value stays the same is
				// kept. The editor's own classes come off the element first, so the
				// editor's styles for its blocks count for nothing.
				//
				// The classes the fix drops from an element, as a cover's
				// has-background-dim-45 when its save rounds the dim to
				// has-background-dim-50, are set on that element in place of the
				// classes the fix gives it, and kept when nothing the block's elements
				// compute changes.
				const numbered = ( name: string ) => name.replace( /\d+/g, '#' );

				// What an element and the elements in it paint: each color they
				// show, its alpha times the opacity of the element and of those
				// between it and the target, as CSS composites a layer over what is
				// behind it (CSS Compositing 1, simple alpha compositing). A color
				// shows where its box, text, border or outline does. Each is read by
				// painting it, whatever syntax the browser computes it in.
				const SIDES = [ 'top', 'right', 'bottom', 'left' ];
				const ownText = ( inner: Element ) =>
					[ ...inner.childNodes ].some(
						( node ) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()
					);
				const drawn = ( style: CSSStyleDeclaration, line: string ) =>
					! [ 'none', 'hidden' ].includes( style.getPropertyValue( `${ line }-style` ) ) &&
					parseFloat( style.getPropertyValue( `${ line }-width` ) ) > 0;
				const svg = ( inner: Element ) => inner.namespaceURI === 'http://www.w3.org/2000/svg';
				const PAINTED: Record< string, ( style: CSSStyleDeclaration, inner: Element ) => boolean > =
					{
						'background-color': () => true,
						color: ( _style, inner ) => ownText( inner ),
						'text-decoration-color': ( style, inner ) =>
							style.textDecorationLine !== 'none' && ownText( inner ),
						'outline-color': ( style ) => drawn( style, 'outline' ),
						fill: ( _style, inner ) => svg( inner ),
						stroke: ( _style, inner ) => svg( inner ),
						...Object.fromEntries(
							SIDES.map( ( side ) => [
								`border-${ side }-color`,
								( style: CSSStyleDeclaration ) => drawn( style, `border-${ side }` ),
							] )
						),
					};
				const paints = ( property: string ) => property === 'opacity' || property in PAINTED;
				const pixel = document
					.createElement( 'canvas' )
					.getContext( '2d', { willReadFrequently: true } )!;
				function painted( target: HTMLElement ): number[][] {
					const view = target.ownerDocument.defaultView!;
					return [ target, ...target.querySelectorAll( '*' ) ].flatMap( ( inner ) => {
						let opacity = 1;
						for ( let at: Element | null = inner; at; at = at.parentElement ) {
							opacity *= Number( view.getComputedStyle( at ).opacity );
							if ( at === target ) {
								break;
							}
						}
						return [ null, '::before', '::after' ].flatMap( ( pseudo ) => {
							const style = view.getComputedStyle( inner, pseudo );
							if ( pseudo && [ 'none', 'normal' ].includes( style.content ) ) {
								return [];
							}
							return Object.entries( PAINTED ).map( ( [ property, shows ] ) => {
								pixel.clearRect( 0, 0, 1, 1 );
								pixel.fillStyle = 'transparent';
								if ( shows( style, inner ) ) {
									pixel.fillStyle = style.getPropertyValue( property );
								}
								pixel.fillRect( 0, 0, 1, 1 );
								const [ r, g, b, a ] = pixel.getImageData( 0, 0, 1, 1 ).data;
								return [ r, g, b, ( a / 255 ) * opacity ];
							} );
						} );
					} );
				}
				// CIELAB of an sRGB color (IEC 61966-2-1; CIE 15, D65).
				function lab( rgb: number[] ): number[] {
					const [ r, g, b ] = rgb.map( ( channel ) => {
						const c = channel / 255;
						return c <= 0.04045 ? c / 12.92 : ( ( c + 0.055 ) / 1.055 ) ** 2.4;
					} );
					const f = ( t: number ) =>
						t > 216 / 24389 ? Math.cbrt( t ) : ( ( 24389 / 27 ) * t + 16 ) / 116;
					const x = f( ( 0.4124 * r + 0.3576 * g + 0.1805 * b ) / 0.95047 );
					const y = f( 0.2126 * r + 0.7152 * g + 0.0722 * b );
					const z = f( ( 0.0193 * r + 0.1192 * g + 0.9505 * b ) / 1.08883 );
					return [ 116 * y - 16, 500 * ( x - y ), 200 * ( y - z ) ];
				}
				// The most two paints differ by, over black and over white, the
				// backdrops between which what is behind them lies: CIE76 ΔE*ab, of
				// which 2.3 is a just noticeable difference (Sharma, Digital Color
				// Imaging Handbook, 2003).
				const NOTICEABLE = 2.3;
				const paintDifference = ( one: number[][], other: number[][] ) =>
					one.length !== other.length
						? Infinity
						: Math.max(
								0,
								...one.flatMap( ( color, i ) =>
									[ 0, 255 ].map( ( backdrop ) => {
										const over = ( [ r, g, b, a ]: number[] ) =>
											lab( [ r, g, b ].map( ( c ) => c * a + backdrop * ( 1 - a ) ) );
										const [ l1, a1, b1 ] = over( color );
										const [ l2, a2, b2 ] = over( other[ i ] );
										return Math.hypot( l1 - l2, a1 - a2, b1 - b2 );
									} )
								)
						  );

				// The block style, by place, that shows the styles written on a
				// block's own element as they show inline: `css`, the styles.
				const styledByBlockStyle = new Map< string, { slug: string; css: string } >();
				// A block style's slug from its css, as max-width-640px, in the kebab
				// case WordPress gives a style's name (_wp_to_kebab_case()), one per css.
				const blockStyleSlug = ( css: string ) => {
					const slug = css
						.toLowerCase()
						.replace( /[^a-z0-9]+/g, '-' )
						.replace( /^-|-$/g, '' );
					let hashed = 0;
					for ( const char of css ) {
						hashed = ( Math.imul( hashed, 31 ) + char.charCodeAt( 0 ) ) >>> 0;
					}
					return slug.length > 48
						? `${ slug.slice( 0, 40 ).replace( /-$/, '' ) }-${ hashed.toString( 36 ) }`
						: slug;
				};

				async function renderedAlready( lossy: any[] ) {
					const kept = new Map< string, Set< string > >();
					const outermost = [
						...new Set( lossy.map( ( loss ) => Number( loss.place.split( '/' )[ 1 ] ) ) ),
					];
					const { blockEditor, element: wpElement } = ( window as any ).wp ?? {};
					if ( ! lossy.length || ! blockEditor?.BlockPreview || ! wpElement?.createRoot ) {
						return kept;
					}
					const host = document.createElement( 'div' );
					host.style.cssText = 'position:absolute;left:-10000px;top:0;width:1200px';
					document.body.append( host );
					const root = wpElement.createRoot( host );
					try {
						root.render(
							wpElement.createElement( blockEditor.BlockPreview, {
								blocks: outermost.map( ( at ) => fixed.blocks[ at ] ),
								viewportWidth: 1200,
							} )
						);
						const rendered = () =>
							host
								.querySelector( 'iframe' )
								?.contentDocument?.querySelectorAll< HTMLElement >(
									'.is-root-container > [data-block]'
								) ?? [];
						// The blocks are read once they have held still for a few frames:
						// a block's supports give it their classes and styles from an
						// effect, a render after the block shows (BlockProps in
						// @wordpress/block-editor's hooks/utils.js), and the preview's
						// frame can unmount its blocks and mount them again on its next
						// load. Its styles load beside the blocks.
						const settled = () =>
							rendered().length < outermost.length
								? ''
								: [
										...( host
											.querySelector( 'iframe' )
											?.contentDocument?.querySelectorAll< HTMLElement >( '[data-block]' ) ?? [] ),
								  ]
										.map( ( block ) => `${ block.className }\n${ block.style.cssText }` )
										.join( '\n' );
						for ( let wait = 0, still = 0, last = ''; still < 3 && wait < 300; wait++ ) {
							await new Promise( ( resolve ) => requestAnimationFrame( () => resolve( null ) ) );
							const now = settled();
							still = now && now === last ? still + 1 : 0;
							last = now;
						}
						const top = [ ...rendered() ];
						if ( top.length !== outermost.length ) {
							return kept;
						}
						const named = new Set< string >();
						const readRules = ( rules: CSSRuleList ) => {
							for ( const rule of [ ...rules ] ) {
								// The preview's rules are of its own window's CSSStyleRule.
								if ( 'selectorText' in rule ) {
									for ( const [ , name ] of ( rule as CSSStyleRule ).selectorText.matchAll(
										/\.((?:\\.|[\w-])+)/g
									) ) {
										named.add( name.replace( /\\(.)/g, '$1' ) );
									}
								}
								if ( 'cssRules' in rule ) {
									readRules( ( rule as CSSGroupingRule ).cssRules );
								}
							}
						};
						for ( const sheet of [ ...( top[ 0 ]?.ownerDocument.styleSheets ?? [] ) ] ) {
							try {
								readRules( sheet.cssRules );
							} catch {
								// A stylesheet from another origin cannot be read.
							}
						}
						// The element of the block at a place, through the blocks around it.
						const at = ( place: string ) =>
							place
								.split( '/' )
								.slice( 2 )
								.reduce< HTMLElement | undefined >(
									( element, index ) =>
										element &&
										[ ...element.querySelectorAll< HTMLElement >( '[data-block]' ) ].filter(
											( inner ) => inner.parentElement?.closest( '[data-block]' ) === element
										)[ Number( index ) ],
									top[ outermost.indexOf( Number( place.split( '/' )[ 1 ] ) ) ]
								);
						for ( const loss of lossy ) {
							const element = at( loss.place );
							if ( ! element || element.dataset.type !== loss.blockName ) {
								continue;
							}
							const asRendered = {
								className: element.className,
								style: element.style.cssText,
							};
							for ( const name of [ ...element.classList ] ) {
								if ( name === 'wp-block' || name.startsWith( 'block-editor-' ) ) {
									element.classList.remove( name );
								}
							}
							const view = element.ownerDocument.defaultView!;
							const read = ( inner: Element, property: string ) =>
								view.getComputedStyle( inner ).getPropertyValue( property );
							// A style the block's elements inherit shows on those with text
							// of their own: it changes nothing when none of them reads it
							// differently and nothing in the block moves.
							const inside = [ element, ...element.querySelectorAll< HTMLElement >( '*' ) ];
							const textual = inside.filter( ( inner ) =>
								[ ...inner.childNodes ].some(
									( node ) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()
								)
							);
							const inherits = ( property: string, value: string ) => {
								const parent = element.ownerDocument.body.appendChild(
									element.ownerDocument.createElement( 'div' )
								);
								const child = parent.appendChild( element.ownerDocument.createElement( 'span' ) );
								const before = read( child, property );
								parent.style.setProperty( property, value );
								const after = read( child, property );
								parent.remove();
								return before !== after;
							};
							const shownAs = ( property: string ) =>
								[ element, ...textual ].map( ( inner ) => read( inner, property ) );
							const where = () =>
								inside.map( ( inner ) => JSON.stringify( inner.getBoundingClientRect() ) ).join();
							const placed = where();
							const shown = new Map< string, string[] >(
								loss.onRoot.map(
									( [ property ]: string[] ) => [ property, shownAs( property ) ] as const
								)
							);
							element.style.cssText += `;${ loss.rootStyle }`;
							const stays = where() === placed;
							kept.set(
								loss.place,
								new Set(
									loss.onRoot
										.filter( ( [ property, value ]: string[] ) => {
											const [ onBlock, ...onText ] = shownAs( property );
											const [ wasOnBlock, ...wasOnText ] = shown.get( property )!;
											return (
												onBlock === wasOnBlock ||
												( stays &&
													onText.length > 0 &&
													onText.join() === wasOnText.join() &&
													inherits( property, value ) )
											);
										} )
										.map( ( [ property, value ]: string[] ) => `${ property }:${ value }` )
								)
							);
							element.style.cssText = asRendered.style;
							// The block's own elements, without its inner blocks'.
							const own = [ element, ...element.querySelectorAll< HTMLElement >( '*' ) ].filter(
								( inner ) => inner === element || inner.closest( '[data-block]' ) === element
							);
							const looks = () =>
								own
									.flatMap( ( inner ) =>
										[ null, '::before', '::after' ].map( ( pseudo ) => {
											const style = view.getComputedStyle( inner, pseudo );
											return [ ...style ]
												.map( ( property ) => style.getPropertyValue( property ) )
												.join( ';' );
										} )
									)
									.join( '|' );
							for ( const { root, kept: keeps, gone, added } of loss.classesOn ) {
								// Known by the classes it keeps.
								const matches = root
									? [ element ]
									: own.filter(
											( inner ) =>
												keeps.length > 0 &&
												keeps.every( ( name: string ) => inner.classList.contains( name ) )
									  );
								if ( matches.length !== 1 ) {
									continue;
								}
								// The element as written: the classes the fix gives it in place of
								// those it drops. A class no loaded stylesheet names changes
								// nothing here, but may on the site's pages or to a script, so it
								// is kept only when the fix saves it with another number, as a
								// cover's save names its dim rounded to tens (cover/shared.js),
								// in its place or kept from beside it, as has-background-dim-42
								// written beside the has-background-dim-40 the save names.
								const swap = added.filter( ( name: string ) =>
									matches[ 0 ].classList.contains( name )
								);
								const saved = [ ...swap, ...keeps ];
								const back = gone.filter(
									( name: string ) => ! matches[ 0 ].classList.contains( name )
								);
								const fixedLook = looks();
								matches[ 0 ].classList.remove( ...swap );
								matches[ 0 ].classList.add( ...back );
								const same = looks() === fixedLook;
								matches[ 0 ].classList.remove( ...back );
								matches[ 0 ].classList.add( ...swap );
								for ( const name of gone ) {
									if (
										same &&
										( named.has( name ) ||
											( /\d/.test( name ) &&
												saved.some( ( one: string ) => numbered( one ) === numbered( name ) ) ) )
									) {
										kept.get( loss.place )!.add( name );
									}
								}
							}
							// The styles the fix drops from an element that set only what it
							// paints, as a cover's overlay written at an opacity
							// of 0.68 that its save shows at 0.7, from has-background-dim-70
							// (dimRatioToClass rounds to tens, cover/shared.js): kept when
							// nothing moves, nothing else computes otherwise, and no color it
							// and what is in it paint differs noticeably.
							const unpainted = () =>
								own
									.flatMap( ( inner ) =>
										[ null, '::before', '::after' ].map( ( pseudo ) => {
											const style = view.getComputedStyle( inner, pseudo );
											return [ ...style ]
												.filter( ( property ) => ! paints( property ) )
												.map( ( property ) => style.getPropertyValue( property ) )
												.join( ';' );
										} )
									)
									.join( '|' ) + where();
							const keeps = kept.get( loss.place )!;
							for ( const { root, tag, classes, styles } of loss.stylesOn ) {
								const dropped = styles.filter( ( style: string ) => ! keeps.has( style ) );
								const matches = root
									? [ element ]
									: own.filter(
											( inner ) =>
												inner !== element &&
												inner.tagName === tag &&
												classes.length > 0 &&
												classes.every( ( name: string ) => inner.classList.contains( name ) )
									  );
								if (
									! dropped.length ||
									matches.length !== 1 ||
									! dropped.every( ( style: string ) => paints( style.split( ':' )[ 0 ] ) )
								) {
									continue;
								}
								const [ target ] = matches;
								const before = { rest: unpainted(), paint: painted( target ) };
								const style = target.style.cssText;
								target.style.cssText += `;${ dropped.join( ';' ) }`;
								const unseen =
									unpainted() === before.rest &&
									paintDifference( before.paint, painted( target ) ) < NOTICEABLE;
								target.style.cssText = style;
								if ( unseen ) {
									dropped.forEach( ( one: string ) => keeps.add( one ) );
								}
							}
							// The styles left on the block's own element, as a block style:
							// WordPress prints its css as `:root :where(<selector>)`
							// (WP_Theme_JSON::process_blocks_custom_css() in
							// wp-includes/class-wp-theme-json.php) after the global styles
							// (wp_render_block_style_variation_support_styles() in
							// wp-includes/block-supports/block-style-variations.php): its
							// stylesheet depends on global-styles, so prints after it, and
							// before core-block-supports-inline-css, a block's own layout
							// (`.wp-container-… > :where(…) { max-width }`), whose weight
							// it shares, as the layout's global rule's. The preview prints
							// the global styles in its body, then a rule of its own,
							// `body{height:auto;…}`, then the blocks' supports
							// (ScaledBlockPreview and EditorStyles in
							// @wordpress/block-editor), so it is set after that rule. It
							// stands when the block's elements compute and sit as with the
							// styles inline. Its css is split at `&` and braces, so a style
							// holding them is none.
							const left = ( loss.stylesOn.find( ( one: any ) => one.root )?.styles ?? [] ).filter(
								( style: string ) => ! keeps.has( style )
							);
							const globalStylesEnd = [
								...element.ownerDocument.querySelectorAll( 'body > style' ),
							].find( ( one ) => one.textContent?.startsWith( 'body{height:auto;' ) );
							if ( styling && left.length && ! /[&{}]/.test( left.join() ) && globalStylesEnd ) {
								const css = left.join( ';' );
								const slug = blockStyleSlug( css );
								element.style.cssText += `;${ css }`;
								const inline = looks() + where();
								element.style.cssText = asRendered.style;
								const sheet = element.ownerDocument.createElement( 'style' );
								globalStylesEnd.after( sheet );
								sheet.textContent = `:root :where(.is-style-${ slug }){${ css }}`;
								element.classList.add( `is-style-${ slug }` );
								if ( looks() + where() === inline ) {
									styledByBlockStyle.set( loss.place, { slug, css } );
								}
								sheet.remove();
							}
							element.className = asRendered.className;
						}
						return kept;
					} finally {
						root.unmount();
						host.remove();
					}
				}

				// The fix for every block that loses nothing. A block that would lose
				// something stays as written, with each inner block in it as its own
				// fix makes it: the serializer keeps a block that does not validate
				// from its source, a raw block whose inner blocks are raw blocks too.
				// Where a block keeps the layout and position styles a fix drops: its
				// layout attribute and its spacing and position supports, which the
				// block renders as a class (wp_render_layout_support_flag and
				// wp_render_position_support in wp-includes/block-supports), so no
				// save holds them inline. `[ attributes, the styles they hold ]`, for
				// a block that supports them.
				function storedAs( place: string, styles: string[] ) {
					const block = blockAt( fixed.blocks, place );
					const name = block?.name;
					if ( ! name ) {
						return null;
					}
					const supports = ( feature: string ) => wpBlocks.hasBlockSupport( name, feature );
					const layoutSupport = wpBlocks.getBlockType( name )?.supports?.layout;
					const layoutType =
						block.attributes.layout?.type ??
						( typeof layoutSupport === 'object' ? layoutSupport.default?.type : undefined );
					const value = new Map(
						styles.map( ( style ) => [
							style.slice( 0, style.indexOf( ':' ) ),
							style.slice( style.indexOf( ':' ) + 1 ),
						] )
					);
					const attributes: Record< string, any > = {};
					const held: string[] = [];
					const hold = ( keys: string[], at: string[], stored: unknown ) => {
						const leaf = at
							.slice( 0, -1 )
							.reduce( ( into: any, key ) => ( into[ key ] ??= {} ), attributes );
						leaf[ at[ at.length - 1 ] ] = stored;
						held.push( ...keys.map( ( key ) => `${ key }:${ value.get( key ) }` ) );
					};
					if ( layoutSupport && layoutType !== 'flex' && value.get( 'display' ) === 'flex' ) {
						hold( [ 'display' ], [ 'layout', 'type' ], 'flex' );
					}
					const flex = layoutType === 'flex' || attributes.layout?.type === 'flex';
					const row = value.get( 'row-gap' );
					const column = value.get( 'column-gap' );
					if (
						( flex || layoutType === 'grid' ) &&
						supports( 'spacing.blockGap' ) &&
						( row || column )
					) {
						hold(
							[ 'row-gap', 'column-gap' ].filter( ( key ) => value.get( key ) ),
							[ 'style', 'spacing', 'blockGap' ],
							row === column
								? row
								: { ...( row ? { top: row } : {} ), ...( column ? { left: column } : {} ) }
						);
					}
					if ( flex && layoutSupport ) {
						const justify: Record< string, string > = {
							left: 'left',
							start: 'left',
							'flex-start': 'left',
							center: 'center',
							right: 'right',
							end: 'right',
							'flex-end': 'right',
							'space-between': 'space-between',
						};
						const align: Record< string, string > = {
							start: 'top',
							'flex-start': 'top',
							center: 'center',
							end: 'bottom',
							'flex-end': 'bottom',
							stretch: 'stretch',
						};
						const fromValue = (
							key: string,
							names: Record< string, string >,
							attribute: string
						) => {
							const stored = names[ value.get( key ) ?? '' ];
							if ( stored ) {
								hold( [ key ], [ 'layout', attribute ], stored );
							}
						};
						fromValue( 'justify-content', justify, 'justifyContent' );
						fromValue( 'align-items', align, 'verticalAlignment' );
						fromValue( 'flex-wrap', { nowrap: 'nowrap', wrap: 'wrap' }, 'flexWrap' );
						fromValue( 'flex-direction', { column: 'vertical', row: 'horizontal' }, 'orientation' );
					}
					// WordPress renders a sticky position only when the theme opts in
					// (wp_render_position_support in wp-includes/block-supports/position.php).
					const themeSticky = editorSettings.__experimentalFeatures?.position?.sticky === true;
					if (
						themeSticky &&
						supports( 'position.sticky' ) &&
						( value.get( 'position' ) === 'sticky' || value.has( 'top' ) )
					) {
						hold(
							[ 'position', 'top' ].filter( ( key ) => value.has( key ) ),
							[ 'style', 'position' ],
							{ type: 'sticky', ...( value.has( 'top' ) ? { top: value.get( 'top' ) } : {} ) }
						);
					}
					return held.length
						? ( [ JSON.stringify( attributes ).slice( 1, -1 ), held ] as const )
						: null;
				}

				// A class the fix drops for one it saves with another number, as a
				// cover written with has-background-dim-70 and a dimRatio of 78, which
				// its save names has-background-dim-80 (dimRatioToClass rounds to tens,
				// cover/shared.js), holds the value the block shows: the block is made
				// again with each number in it as each number its comment sets, and
				// the first that loses nothing is the fix.
				function renumber( loss: any ): boolean {
					const dropped = loss.classesOn.flatMap( ( { gone, added }: any ) =>
						gone.filter(
							( name: string ) =>
								/\d/.test( name ) &&
								added.some( ( saved: string ) => numbered( saved ) === numbered( name ) )
						)
					);
					if ( ! dropped.length ) {
						return false;
					}
					const fix = blockAt( fixed.blocks, loss.place );
					const attributes = wpBlocks.getBlockType( fix.name )?.attributes ?? {};
					const keys = Object.keys( initial.written.get( loss.place )?.attrs ?? {} ).filter(
						( key ) => attributes[ key ] && kindOf( attributes[ key ] ) === 'number'
					);
					const at = loss.place.lastIndexOf( '/' );
					const siblings = at
						? blockAt( fixed.blocks, loss.place.slice( 0, at ) ).innerBlocks
						: fixed.blocks;
					const index = Number( loss.place.slice( at + 1 ) );
					for ( const value of new Set< string >( dropped.join( ' ' ).match( /\d+/g ) ) ) {
						for ( const key of keys.filter(
							( one ) => fix.attributes[ one ] !== Number( value )
						) ) {
							try {
								siblings[ index ] = wpBlocks.parse(
									wpBlocks.serialize( [
										wpBlocks.createBlock(
											fix.name,
											{ ...fix.attributes, [ key ]: Number( value ) },
											fix.innerBlocks
										),
									] )
								)[ 0 ];
								const parent = at
									? blockAt( initial.blocks, loss.place.slice( 0, at ) ).innerBlocks
									: initial.blocks;
								if (
									siblings[ index ]?.isValid &&
									! losses( parent, siblings, loss.place.slice( 0, at ) ).some(
										( one ) => one.place === loss.place
									)
								) {
									return true;
								}
							} catch {
								// The next value.
							}
						}
					}
					siblings[ index ] = fix;
					return false;
				}
				let found = losses( initial.blocks, fixed.blocks );
				if ( found.map( renumber ).includes( true ) ) {
					fixedContent = wpBlocks.serialize( fixed.blocks );
					fixed = validateContent( fixedContent );
					found = losses( initial.blocks, fixed.blocks );
				}
				const rendering = await renderedAlready(
					found.filter(
						( loss ) => loss.onRoot.length || loss.classesOn.length || loss.stylesOn.length
					)
				);
				// The block made again with the block style in its className, which
				// its save keeps on its element (the customClassName support,
				// @wordpress/block-editor's hooks/custom-class-name.js), when it
				// supports one and has no block style yet: WordPress renders the
				// first of a block's styles only
				// (wp_render_block_style_variation_support_styles()).
				const blockStyles: Array< {
					place: string;
					blockName: string;
					slug: string;
					css: string;
				} > = [];
				function withBlockStyle( place: string, { slug, css }: { slug: string; css: string } ) {
					const fix = blockAt( fixed.blocks, place );
					const className = fix?.attributes?.className;
					if (
						! fix ||
						! wpBlocks.hasBlockSupport( fix.name, 'customClassName', true ) ||
						/\bis-style-/.test( className ?? '' )
					) {
						return false;
					}
					const at = place.lastIndexOf( '/' );
					const siblings = at
						? blockAt( fixed.blocks, place.slice( 0, at ) ).innerBlocks
						: fixed.blocks;
					const styled = wpBlocks.parse(
						wpBlocks.serialize( [
							wpBlocks.createBlock(
								fix.name,
								{
									...fix.attributes,
									className: [ className, `is-style-${ slug }` ].filter( Boolean ).join( ' ' ),
								},
								fix.innerBlocks
							),
						] )
					)[ 0 ];
					if ( ! styled?.isValid ) {
						return false;
					}
					siblings[ Number( place.slice( at + 1 ) ) ] = styled;
					blockStyles.push( { place, blockName: fix.name, slug, css } );
					return true;
				}
				const lossList = found
					.map( ( { place, blockName, lost, stylesOn, classesOn } ): BlockLoss => {
						const kept = rendering.get( place ) ?? new Set();
						const styles = lost.styles.filter( ( style: string ) => ! kept.has( style ) );
						const hint = ( dropped: string[] ) => {
							const stored = storedAs( place, dropped );
							if ( ! stored ) {
								return '';
							}
							// Named when the block has nowhere for the others.
							const which =
								stored[ 1 ].length < dropped.length
									? stored[ 1 ].join( '; ' )
									: stored[ 1 ].length > 1
									? 'them'
									: 'it';
							return ` — store ${ which } as ${ stored[ 0 ] }`;
						};
						const classes = lost.classes.filter( ( name: string ) => ! kept.has( name ) );
						// Styles on the block's own element only, none of which an
						// attribute holds, are its block style's.
						const blockStyle = styledByBlockStyle.get( place );
						if (
							blockStyle &&
							! lost.text.length &&
							! lost.attributes.length &&
							! classes.length &&
							! lost.moves.length &&
							styles.join( ';' ) === blockStyle.css &&
							stylesOn.every(
								( one: any ) =>
									one.root || one.styles.every( ( style: string ) => kept.has( style ) )
							) &&
							! storedAs( place, styles ) &&
							withBlockStyle( place, blockStyle )
						) {
							return { place, blockName, lost: '', note: '' };
						}
						// What is dropped from each element, in the order written; what
						// no element is known for, as in a block whose inner blocks the
						// fix makes again, is named without one.
						const elements = new Map<
							number,
							{ name: string; styles: string[]; classes: string[] }
						>();
						const on = ( index: number, name: string ) =>
							elements.get( index ) ??
							elements.set( index, { name, styles: [], classes: [] } ).get( index )!;
						for ( const one of stylesOn ) {
							on( one.index, one.name ).styles.push(
								...one.styles.filter( ( style: string ) => styles.includes( style ) )
							);
						}
						for ( const one of classesOn ) {
							on( one.index, one.name ).classes.push(
								...one.gone.filter( ( name: string ) => classes.includes( name ) )
							);
						}
						const placed = [ ...elements.values() ];
						const listed = ( some: string[], names: string[] ) =>
							[
								some.join( '; ' ),
								names.length
									? `the ${ names.length > 1 ? 'classes' : 'class' } ${ names.join( ' ' ) }`
									: '',
							]
								.filter( Boolean )
								.join( ' and ' );
						const dropped = [
							...[ ...elements.entries() ]
								.sort( ( [ a ], [ b ] ) => a - b )
								.map( ( [ , one ] ) => one )
								.filter( ( one ) => one.styles.length || one.classes.length )
								.map( ( one ) => `${ listed( one.styles, one.classes ) } from ${ one.name }` ),
							listed(
								styles.filter( ( style: string ) =>
									placed.every( ( one ) => ! one.styles.includes( style ) )
								),
								classes.filter( ( name: string ) =>
									placed.every( ( one ) => ! one.classes.includes( name ) )
								)
							),
						].filter( Boolean );
						const dropsText = listDropped( lost.attributes );
						return {
							place,
							blockName,
							...( dropsText && { droppedText: dropsText } ),
							lost: [
								dropsText ? `drop ${ dropsText } from its comment attributes` : '',
								...lost.text,
								classes.length ? `drop the classes ${ classes.join( ' ' ) }` : '',
								styles.length ? `drop the styles ${ styles.join( '; ' ) }${ hint( styles ) }` : '',
								...lost.moves,
							]
								.filter( Boolean )
								.join( ' and ' ),
							note: [
								lost.text.length ? 'change its text' : '',
								dropped.length
									? `drop ${ dropped.join( '; ' ) }${ styles.length ? hint( styles ) : '' }`
									: '',
								...lost.moves,
							]
								.filter( Boolean )
								.join( ' and ' ),
						};
					} )
					.filter( ( loss ) => loss.lost && ! renderAlike.includes( loss.place ) );
				if ( blockStyles.length ) {
					fixedContent = wpBlocks.serialize( fixed.blocks );
					fixed = validateContent( fixedContent );
				}
				const lossy = new Set( lossList.map( ( loss: any ) => loss.place ) );
				function lossless( fixes: any[], at = '' ): any[] {
					return fixes.map( ( fix: any, i: number ) => {
						const place = `${ at }/${ i }`;
						const raw = lossy.has( place ) && initial.written.get( place );
						const innerBlocks = lossless( fix.innerBlocks ?? [], place );
						if ( ! raw ) {
							return { ...fix, innerBlocks };
						}
						// Inner blocks the parser made other than those written stay as written.
						const inner = sameInnerBlocks( blockAt( initial.blocks, place ), fix, place )
							? innerBlocks.map( ( one: any ) => rawParse( wpBlocks.serialize( [ one ] ) )[ 0 ] )
							: raw.innerBlocks;
						return {
							...fix,
							isValid: false,
							__unstableBlockSource: { ...raw, innerBlocks: inner },
						};
					} );
				}
				// Each lossy block WordPress renders on the server, as stored and with
				// its fix, for the caller to render.
				const dynamic = judge
					? await Promise.all( lossList.map( ( loss ) => typeOf( loss.blockName ) ) )
					: [];
				const rendered = lossList
					.filter( ( _loss, i ) => dynamic[ i ]?.is_dynamic )
					.map( ( { place } ) => {
						const written = wpBlocks.serialize( [ blockAt( lossless( fixed.blocks ), place ) ] );
						lossy.delete( place );
						const fix = wpBlocks.serialize( [ blockAt( lossless( fixed.blocks ), place ) ] );
						lossy.add( place );
						return { place, written, fixed: fix };
					} );
				const losslessContent = lossList.length
					? wpBlocks.serialize( lossless( fixed.blocks ) )
					: fixedContent;

				// A block the fix makes with other inner blocks than those written, as
				// a deprecated version's migration makes them, saves those: what it
				// saves is shown as the fix makes it.
				for ( const result of initial.report.results ) {
					const place = result.place ?? '';
					const fix = lossy.has( place ) && blockAt( fixed.blocks, place );
					if ( fix && ! sameInnerBlocks( blockAt( initial.blocks, place ), fix, place ) ) {
						result.expectedContent = wpBlocks.getSaveContent(
							fix.name,
							fix.attributes,
							fix.innerBlocks
						);
					}
				}

				return {
					report: initial.report,
					proposedFix: {
						fixedContent: losslessContent,
						report: fixed.report,
						losses: lossList,
						...( blockStyles.length && { blockStyles } ),
					},
					rendered,
				};
				/* eslint-enable @typescript-eslint/no-explicit-any */
			}, input );
			const validation = await withTimeout(
				evaluation,
				BLOCK_EVALUATION_TIMEOUT_MS,
				'Evaluating blocks in the editor'
			);

			const report = validation.report as ValidationReport;

			if ( validation.proposedFix ) {
				report.proposedFix = { ...validation.proposedFix };
			}

			return { report, rendered: validation.rendered ?? [] };
		} );
		const { report, rendered } = evaluated;
		const same = rendered.length
			? await rendersAlike!( rendered.map( ( one ) => [ one.written, one.fixed ] ) ).catch(
					() => []
			  )
			: [];
		const places = rendered.filter( ( _one, i ) => same[ i ] ).map( ( one ) => one.place );
		return places.length
			? validateAsWritten( content, siteUrl, editor, undefined, blockStyles, places )
			: report;
	} catch ( error ) {
		// If navigation or evaluation failed, the next call loads the editor again.
		await getEditorPage( siteUrl, editor ).replace();

		return {
			totalBlocks: 0,
			validBlocks: 0,
			invalidBlocks: 0,
			results: [],
			error: error instanceof Error ? error.message : String( error ),
		};
	}
}

/** Presets by slug and value: `[ slug, value ]`. */
export interface PresetValues {
	colors: Array< [ string, string ] >;
	fontSizes: Array< [ string, string ] >;
	spacingSizes: Array< [ string, string ] >;
}

export interface PresetValuesResult {
	content: string;
	/** Each color written as a value that the palette has, with its preset. */
	colors: Array< { color: string; slug: string } >;
	/** Each font size written as a value that a font size preset has, with its preset. */
	fontSizes: Array< { size: string; slug: string } >;
	/** Each spacing written as a value that a spacing size preset has, with its preset. */
	spacingSizes: Array< { size: string; slug: string } >;
}

/**
 * Stores each value a block's style gives that a preset has as that preset,
 * as the editor does when one is picked. A palette color's value
 * (encodeColorValueWithPalette in @wordpress/block-editor) becomes the
 * block's color attribute where its color or border support has one, and
 * `var:preset|color|` elsewhere in its style; a font size preset's size
 * (getFontSizeObjectByValue) becomes the block's fontSize attribute
 * (styleToAttributes in the typography hook); a spacing size preset's size,
 * as padding, margin or block gap, becomes `var:preset|spacing|<slug>`
 * (getPresetValueFromCustomValue). The values stay the same, and
 * follow the presets when they change. Content the editor would save
 * otherwise is returned as is.
 */
export async function storePresetValues(
	content: string,
	siteUrl: string,
	{ colors: palette, fontSizes: sizes, spacingSizes: spacings }: PresetValues,
	editor: BlockEditor = 'post'
): Promise< PresetValuesResult > {
	return withEditor( siteUrl, [], editor, ( page ) =>
		page.evaluate(
			( { html, presets, fontSizePresets, spacingPresets } ) => {
				/* eslint-disable @typescript-eslint/no-explicit-any */
				const wpBlocks = ( window as any ).wp.blocks;
				const colors: Array< { color: string; slug: string } > = [];
				const fontSizes: Array< { size: string; slug: string } > = [];
				const spacingSizes: Array< { size: string; slug: string } > = [];
				const stored = () => colors.length + fontSizes.length + spacingSizes.length;
				// A spacing value, or each side of one, a spacing size preset has, as that preset.
				const spacingValue = ( value: any ): any => {
					if ( value && typeof value === 'object' && ! Array.isArray( value ) ) {
						return Object.fromEntries(
							Object.entries( value ).map( ( [ side, child ] ) => [ side, spacingValue( child ) ] )
						);
					}
					const slug = spacingPresets.find( ( [ , size ] ) => size === value )?.[ 0 ];
					if ( ! slug ) {
						return value;
					}
					spacingSizes.push( { size: value, slug } );
					return `var:preset|spacing|${ slug }`;
				};
				const slugOf = ( value: unknown ) =>
					typeof value === 'string'
						? presets.find(
								( [ , color ] ) => color.toLowerCase() === value.trim().toLowerCase()
						  )?.[ 0 ]
						: undefined;
				// The style values the color and border supports read a color from.
				const presetValues = ( value: any ): any => {
					if ( ! value || typeof value !== 'object' || Array.isArray( value ) ) {
						return value;
					}
					return Object.fromEntries(
						Object.entries( value ).map( ( [ key, child ] ) => {
							const slug = [ 'text', 'background', 'color' ].includes( key )
								? slugOf( child )
								: undefined;
							if ( ! slug ) {
								return [ key, presetValues( child ) ];
							}
							colors.push( { color: String( child ), slug } );
							return [ key, `var:preset|color|${ slug }` ];
						} )
					);
				};
				const NAMED: Array< [ string, string, string ] > = [
					[ 'color', 'background', 'backgroundColor' ],
					[ 'color', 'text', 'textColor' ],
					[ 'border', 'color', 'borderColor' ],
				];
				const visit = ( block: any ): any => {
					const innerBlocks = ( block.innerBlocks ?? [] ).map( visit );
					const before = stored();
					const types = wpBlocks.getBlockType( block.name )?.attributes ?? {};
					let style = presetValues( block.attributes?.style );
					if ( style?.spacing ) {
						const spacing = { ...style.spacing };
						for ( const key of [ 'padding', 'margin', 'blockGap' ] ) {
							if ( key in spacing ) {
								spacing[ key ] = spacingValue( spacing[ key ] );
							}
						}
						style = { ...style, spacing };
					}
					const size = style?.typography?.fontSize;
					// A block takes a preset font size where its typography support gives it the attribute.
					const sizeSlug = types.fontSize
						? fontSizePresets.find( ( [ , value ] ) => value === size )?.[ 0 ]
						: undefined;
					if ( sizeSlug ) {
						fontSizes.push( { size, slug: sizeSlug } );
						const { fontSize: _size, ...typography } = style.typography;
						style = { ...style, typography };
					}
					if ( stored() === before ) {
						return { ...block, innerBlocks };
					}
					const attributes = { ...block.attributes, style };
					if ( sizeSlug ) {
						attributes.fontSize = sizeSlug;
					}
					for ( const [ group, key, name ] of NAMED ) {
						const value = attributes.style?.[ group ]?.[ key ];
						if (
							types[ name ] &&
							typeof value === 'string' &&
							value.startsWith( 'var:preset|color|' )
						) {
							attributes[ name ] = value.slice( 'var:preset|color|'.length );
							const { [ key ]: _named, ...rest } = attributes.style[ group ];
							attributes.style = { ...attributes.style, [ group ]: rest };
						}
					}
					for ( const group of [ 'color', 'border', 'typography' ] ) {
						if (
							attributes.style?.[ group ] &&
							! Object.keys( attributes.style[ group ] ).length
						) {
							const { [ group ]: _empty, ...rest } = attributes.style;
							attributes.style = rest;
						}
					}
					if ( attributes.style && ! Object.keys( attributes.style ).length ) {
						delete attributes.style;
					}
					return { ...block, attributes, innerBlocks };
				};
				const blocks = wpBlocks.parse( html ).map( visit );
				if ( ! stored() ) {
					return { content: html, colors, fontSizes, spacingSizes };
				}
				const fixed = wpBlocks.serialize( blocks );
				const valid = ( list: any[] ): boolean =>
					list.every( ( block ) => block.isValid !== false && valid( block.innerBlocks ?? [] ) );
				return valid( wpBlocks.parse( fixed ) )
					? { content: fixed, colors, fontSizes, spacingSizes }
					: { content: html, colors: [], fontSizes: [], spacingSizes: [] };
				/* eslint-enable @typescript-eslint/no-explicit-any */
			},
			{ html: content, presets: palette, fontSizePresets: sizes, spacingPresets: spacings }
		)
	);
}

interface NavigationLinksResult {
	content: string;
	/** The label of each link bound to the entity it names. */
	links: string[];
}

interface BetweenBlockCommentsResult {
	content: string;
	/** How many runs of HTML comments between blocks were dropped. */
	comments: number;
}

/**
 * Drops HTML comments that stand between blocks, as text, so each block
 * stays as written. The editor parses text
 * outside any block as a Classic block and wraps it in paragraphs
 * (normalizeRawBlock in @wordpress/blocks runs autop on it), so a comment
 * there turns into a Classic block holding a paragraph the first time the
 * content is saved through the editor. A comment renders nothing, so
 * dropping it changes nothing on the page. Comments inside a block are left
 * to the block.
 */
export function dropCommentsBetweenBlocks( content: string ): BetweenBlockCommentsResult {
	let depth = 0;
	let from = 0;
	let comments = 0;
	const kept: string[] = [];
	// The text before each delimiter, and after the last: dropped where it
	// stands between top-level blocks and holds only comments, beside the
	// paragraph tags and line breaks autop adds.
	const keep = ( text: string, between: boolean ) => {
		const bare = text.replace( /<!--[^]*?-->/g, '' );
		if ( ! between || bare === text || ! /^(?:\s|<\/?p>|<br\s*\/?>)*$/i.test( bare ) ) {
			kept.push( text );
			return;
		}
		comments++;
		kept.push( kept.length && from < content.length ? '\n\n' : '' );
	};
	for ( const match of content.matchAll( BLOCK_DELIMITER ) ) {
		keep( content.slice( from, match.index ), depth === 0 );
		kept.push( match[ 0 ] );
		from = match.index + match[ 0 ].length;
		if ( ! match[ 6 ] ) {
			depth = Math.max( 0, depth + ( match[ 1 ] ? -1 : 1 ) );
		}
	}
	const rest = content.slice( from );
	from = content.length;
	keep( rest, true );
	return comments ? { content: kept.join( '' ), comments } : { content, comments: 0 };
}

// A block delimiter as WordPress's block parser reads one: its closer slash,
// namespace, name, attributes and void slash (the tokenizer of
// @wordpress/block-serialization-default-parser, as WP_Block_Parser::next_token()).
export const BLOCK_DELIMITER =
	/<!--\s+(\/)?wp:([a-z][a-z0-9_-]*\/)?([a-z][a-z0-9_-]*)\s+({(?:(?=([^}]+|}+(?=})|(?!}\s+\/?-->)[^]))\5)*?}\s+)?(\/)?-->/g;

/**
 * Binds the url of each navigation link that names a post or term by its id
 * but has no url to that entity's link, as the editor's link picker does
 * (useEntityBinding in @wordpress/block-library): core prints a link's href
 * only from its url (wp-includes/blocks/navigation-link.php), and fills the
 * url from the binding with the entity's permalink (core/post-data and
 * core/term-data in wp-includes/block-bindings). Content the editor would
 * save otherwise is returned as is.
 */
export async function bindNavigationLinks(
	content: string,
	siteUrl: string,
	editor: BlockEditor = 'post'
): Promise< NavigationLinksResult > {
	if ( ! /<!--\s*wp:navigation-(?:link|submenu)\s/.test( content ) ) {
		return { content, links: [] };
	}
	return withEditor( siteUrl, [], editor, ( page ) =>
		page.evaluate( ( html ) => {
			/* eslint-disable @typescript-eslint/no-explicit-any */
			const wpBlocks = ( window as any ).wp.blocks;
			const links: string[] = [];
			const TAXONOMIES = [ 'category', 'tag', 'post_tag' ];
			const visit = ( block: any ): any => {
				const innerBlocks = ( block.innerBlocks ?? [] ).map( visit );
				const { id, url, type, kind, metadata, label } = block.attributes ?? {};
				if (
					! [ 'core/navigation-link', 'core/navigation-submenu' ].includes( block.name ) ||
					! Number.isInteger( id ) ||
					url ||
					metadata?.bindings?.url ||
					kind === 'custom'
				) {
					return { ...block, innerBlocks };
				}
				const entityKind =
					kind === 'taxonomy' || ( ! kind && TAXONOMIES.includes( type ) )
						? 'taxonomy'
						: 'post-type';
				links.push( String( label ?? id ) );
				return {
					...block,
					innerBlocks,
					attributes: {
						...block.attributes,
						kind: entityKind,
						metadata: {
							...metadata,
							bindings: {
								...metadata?.bindings,
								url: {
									source: entityKind === 'taxonomy' ? 'core/term-data' : 'core/post-data',
									args: { field: 'link' },
								},
							},
						},
					},
				};
			};
			const blocks = wpBlocks.parse( html ).map( visit );
			if ( ! links.length ) {
				return { content: html, links };
			}
			const fixed = wpBlocks.serialize( blocks );
			const valid = ( list: any[] ): boolean =>
				list.every( ( block ) => block.isValid !== false && valid( block.innerBlocks ?? [] ) );
			return valid( wpBlocks.parse( fixed ) )
				? { content: fixed, links }
				: { content: html, links: [] };
			/* eslint-enable @typescript-eslint/no-explicit-any */
		}, content )
	);
}

/** A block and what the editor inserts for it. */
interface InsertedTemplate {
	name: string;
	markup: string;
}

// The blocks a note shows, enough for a form and a field it names.
const MAX_TEMPLATES = 3;

/**
 * What the site's block editor inserts for each registered block that
 * content names, where the insert brings inner blocks of its own: the
 * block's default inserter variation, built from its attributes and inner
 * blocks and serialized (createBlock and createBlocksFromInnerBlocksTemplate
 * in @wordpress/blocks, as the inserter builds it), with the blocks of the
 * site's active plugins. A block that another insert already holds is
 * left out.
 */
export async function insertedTemplates(
	names: string[],
	siteUrl: string
): Promise< InsertedTemplate[] > {
	if ( ! names.length ) {
		return [];
	}
	return withEditor( siteUrl, names, 'post', ( page ) =>
		page.evaluate(
			( { wanted, max } ) => {
				/* eslint-disable @typescript-eslint/no-explicit-any */
				const wpBlocks = ( window as any ).wp.blocks;
				const templates: Array< { name: string; markup: string } > = [];
				for ( const name of wanted ) {
					if ( ! wpBlocks.getBlockType( name ) ) {
						continue;
					}
					const variations: any[] = wpBlocks.getBlockVariations( name, 'inserter' ) ?? [];
					const chosen = variations.find( ( v ) => v.isDefault ) ?? variations[ 0 ];
					const block = wpBlocks.createBlock(
						name,
						{ ...( chosen?.attributes ?? {} ) },
						wpBlocks.createBlocksFromInnerBlocksTemplate( chosen?.innerBlocks ?? [] )
					);
					if ( block.innerBlocks.length ) {
						templates.push( { name, markup: wpBlocks.serialize( [ block ] ) } );
					}
				}
				const holds = ( outer: { markup: string }, name: string ) =>
					outer.markup.includes( `<!-- wp:${ name } ` );
				return templates
					.filter(
						( template ) =>
							! templates.some( ( other ) => other !== template && holds( other, template.name ) )
					)
					.slice( 0, max );
				/* eslint-enable @typescript-eslint/no-explicit-any */
			},
			{ wanted: names, max: MAX_TEMPLATES }
		)
	);
}

interface SavedExample {
	name: string;
	from: 'example' | 'variation' | 'defaults';
	markup: string;
}

/**
 * What the site's block editor saves for each named block, made the way its
 * inserter previews it: from the example its block type declares
 * (getBlockFromExample in @wordpress/blocks), or else with the attributes and
 * inner blocks of its default inserter variation (createBlock).
 */
export async function savedExamples( names: string[], siteUrl: string ): Promise< SavedExample[] > {
	if ( ! names.length ) {
		return [];
	}
	return withEditor( siteUrl, names, 'post', ( page ) =>
		page.evaluate( ( wanted ) => {
			/* eslint-disable @typescript-eslint/no-explicit-any */
			const wpBlocks = ( window as any ).wp.blocks;
			return wanted.flatMap( ( name ): SavedExample[] => {
				const type = wpBlocks.getBlockType( name );
				if ( ! type ) {
					return [];
				}
				if ( type.example ) {
					const block = wpBlocks.getBlockFromExample( name, type.example );
					return [ { name, from: 'example', markup: wpBlocks.serialize( [ block ] ) } ];
				}
				const variations: any[] = wpBlocks.getBlockVariations( name, 'inserter' ) ?? [];
				const chosen = variations.find( ( v ) => v.isDefault ) ?? variations[ 0 ];
				const block = wpBlocks.createBlock(
					name,
					{ ...( chosen?.attributes ?? {} ) },
					wpBlocks.createBlocksFromInnerBlocksTemplate( chosen?.innerBlocks ?? [] )
				);
				return [
					{
						name,
						from: chosen ? 'variation' : 'defaults',
						markup: wpBlocks.serialize( [ block ] ),
					},
				];
			} );
			/* eslint-enable @typescript-eslint/no-explicit-any */
		}, names )
	);
}

/**
 * The site's blocks whose save makes each element of the HTML, its outermost
 * element: each block type, created with its defaults (createBlock in
 * @wordpress/blocks), saved as the editor saves it (getSaveContent).
 */
export async function blocksSavingElements(
	html: string,
	siteUrl: string
): Promise< Array< { element: string; blocks: string[] } > > {
	return withEditor( siteUrl, [], 'post', ( page ) =>
		page.evaluate( ( markup ) => {
			/* eslint-disable @typescript-eslint/no-explicit-any */
			const wpBlocks = ( window as any ).wp.blocks;
			const elements = [
				...new Set(
					[
						...new DOMParser().parseFromString( markup, 'text/html' ).body.querySelectorAll( '*' ),
					].map( ( element ) => element.localName )
				),
			];
			const saving = new Map< string, string[] >();
			for ( const type of wpBlocks.getBlockTypes() as any[] ) {
				let root: string | undefined;
				try {
					const saved = wpBlocks.getSaveContent(
						type.name,
						wpBlocks.createBlock( type.name ).attributes
					);
					root = saved.match( /^\s*<([a-z][a-z0-9-]*)/i )?.[ 1 ]?.toLowerCase();
				} catch {
					continue;
				}
				if ( root ) {
					saving.set( root, [ ...( saving.get( root ) ?? [] ), type.name ] );
				}
			}
			return elements.map( ( element ) => ( {
				element,
				blocks: [ ...( saving.get( element ) ?? [] ) ].sort(),
			} ) );
			/* eslint-enable @typescript-eslint/no-explicit-any */
		}, html )
	);
}

/** Clean up all cached editor pages. */
export async function cleanupValidatorPages(): Promise< void > {
	for ( const ep of editorPages.values() ) {
		await ep.close();
	}
	editorPages.clear();
}
