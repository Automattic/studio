import { EditorPage } from 'cli/ai/browser-utils';

interface BlockValidationResult {
	blockName: string;
	/** The block's place in the content, as `/0/2` for the third block in the first. */
	place?: string;
	isValid: boolean;
	issues: string[];
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

export interface BlockFixProposal {
	/** What the editor saves for every block that loses nothing; the rest stay as written. */
	fixedContent: string;
	report: ValidationReportBase;
	/** The blocks the fix loses something from, and what. */
	losses: BlockLoss[];
}

export interface BlockLoss {
	place: string;
	blockName: string;
	/** What the fix loses, as `drop the styles position:sticky`. */
	lost: string;
}

export interface ValidationReport extends ValidationReportBase {
	proposedFix?: BlockFixProposal;
}

// Cache one EditorPage per site URL so repeated validations reuse the same
// browser tab instead of navigating and loading the block editor each time.
const editorPages = new Map< string, EditorPage >();

function getEditorPage( siteUrl: string ): EditorPage {
	let ep = editorPages.get( siteUrl );
	if ( ! ep ) {
		ep = new EditorPage( siteUrl );
		editorPages.set( siteUrl, ep );
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
 * The site's block editor, loaded again when it lacks a block that the names
 * name: the editor registers the blocks of the plugins active when it loaded,
 * and a plugin activated since adds its own.
 */
async function editorKnowing( siteUrl: string, names: string[] ) {
	const editorPage = getEditorPage( siteUrl );
	const page = await editorPage.getPage();
	const knows = ( loaded: typeof page ) =>
		loaded.evaluate(
			( wanted ) =>
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				wanted.every( ( name ) => ( window as any ).wp.blocks.getBlockType( name ) ),
			names
		);
	if ( await knows( page ) ) {
		return page;
	}
	await editorPage.close();
	return editorPage.getPage();
}

/**
 * Validate WordPress block content using the site's own block editor in a
 * real browser.
 *
 * Navigates to `post-new.php` (which loads wp.blocks with all registered
 * blocks — core + plugins) and parses the content with `wp.blocks.parse()`,
 * reusing the parser's per-block verdict — the same save-function comparison
 * the Gutenberg editor performs on load. `wp.blocks.validateBlock()` is only
 * called on older WordPress versions whose parser does not report one.
 */
export async function validateBlocks(
	content: string,
	siteUrl: string
): Promise< ValidationReport > {
	try {
		const page = await editorKnowing( siteUrl, blockNames( content ) );

		const validation = await page.evaluate( ( html: string ) => {
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
						issues.push( `"${ key }" is not an attribute of ${ name }, so WordPress ignores it.` );
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

			const rawParse = ( window as any ).wp?.blockSerializationDefaultParser?.parse;
			const rawName = ( raw: any ) =>
				raw?.blockName?.includes( '/' ) ? raw.blockName : `core/${ raw?.blockName }`;

			const verdict = ( result: any ) =>
				Array.isArray( result )
					? { isValid: result[ 0 ], issues: result[ 1 ] ?? [] }
					: { isValid: result.isValid, issues: result.validationIssues ?? [] };

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
								`${ name } is not registered on the site, so the editor shows it as an unsupported block. ${
									registered.length
										? `The registered ${ prefix } blocks are ${ registered.join( ', ' ) }.`
										: `No ${ prefix } blocks are registered: the plugin that registers them is not active.`
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
						}
					} else if ( typeof wpBlocks.validateBlock === 'function' ) {
						// validateBlock performs the save-function comparison.
						// Handle both return formats:
						//   WP 6.3+: { isValid: boolean, validationIssues: Array }
						//   Older:   [boolean, Array]
						const validationResult = wpBlocks.validateBlock( block, blockType );

						if ( Array.isArray( validationResult ) ) {
							isValid = validationResult[ 0 ];
							if ( ! isValid ) {
								issues = extractIssues( validationResult[ 1 ] || [] );
							}
						} else {
							isValid = validationResult.isValid;
							if ( ! isValid ) {
								issues = extractIssues( validationResult.validationIssues || [] );
							}
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

					written.set( place, raw );
					results.push( {
						blockName: block.name,
						place,
						isValid,
						issues,
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
								'This HTML is outside any block, so the editor shows it as one Classic block. Write it as blocks: core/group for each section, with core/heading, core/paragraph, core/image and core/buttons inside.',
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
				// the block reads when one of them is invalid; as written otherwise.
				for ( const attributes of [ withComment, parsed ] ) {
					try {
						const made = wpBlocks.createBlock( block.name, attributes, inner );
						if ( wpBlocks.parse( wpBlocks.serialize( [ made ] ) )[ 0 ]?.isValid !== false ) {
							return made;
						}
					} catch {
						// The next set of attributes.
					}
				}
				return block;
			}

			const initial = validateContent( html );

			if ( initial.report.invalidBlocks === 0 ) {
				return { report: initial.report };
			}

			const rawTop = ( typeof rawParse === 'function' ? rawParse( html ) : [] ).filter(
				( raw: any ) => raw.blockName
			);
			let named = 0;
			const fixedBlocks = initial.blocks.map( ( block: any ) =>
				block.name === 'core/freeform' ? block : normalizeBlock( block, rawTop[ named++ ] )
			);
			const fixedContent = wpBlocks.serialize( fixedBlocks );

			if ( fixedContent === html ) {
				return { report: initial.report };
			}

			const fixed = validateContent( fixedContent );

			// A block's own markup, without its inner blocks: its classes, inline
			// style declarations and text, as the browser reads them.
			function ownMarkup( markup: string ) {
				const body = new DOMParser().parseFromString( markup, 'text/html' ).body;
				const classes = new Set< string >();
				const styles = new Set< string >();
				body.querySelectorAll< HTMLElement >( '*' ).forEach( ( element ) => {
					element.classList.forEach( ( name ) => classes.add( name ) );
					// As the browser reads each declaration, so .85rem is 0.85rem.
					for ( const property of Array.from( element.style ) ) {
						styles.add( `${ property }:${ element.style.getPropertyValue( property ) }` );
					}
				} );
				// Entities and whitespace the serializer rewrites are the same text.
				return { classes, styles, text: ( body.textContent ?? '' ).replace( /\s+/g, ' ' ).trim() };
			}

			// What the fix loses from each block as written, block by block: its
			// text, classes and styles. Its attributes it keeps, being made from
			// them, apart from the editor's own migrations.
			function losses( written: any[], fixes: any[], at = '' ): any[] {
				return written.flatMap( ( block: any, i: number ) => {
					const place = `${ at }/${ i }`;
					const fix = fixes[ i ];
					if ( ! block.name || ! fix || fix.name !== block.name ) {
						return [];
					}
					const before = ownMarkup( block.originalContent ?? '' );
					const after = ownMarkup( fix.originalContent ?? '' );
					const missing = ( names: Set< string >, kept: Set< string > ) =>
						[ ...names ].filter( ( name ) => ! kept.has( name ) );
					const classes = missing( before.classes, after.classes );
					const styles = missing( before.styles, after.styles );
					const lost = [
						before.text !== after.text ? 'change the text' : '',
						classes.length ? `drop the classes ${ classes.join( ' ' ) }` : '',
						styles.length ? `drop the styles ${ styles.join( '; ' ) }` : '',
					].filter( Boolean );
					return [
						...( lost.length
							? [
									{
										place,
										blockName: block.name,
										lost: lost.join( ' and ' ),
									},
							  ]
							: [] ),
						...losses( block.innerBlocks ?? [], fix.innerBlocks ?? [], place ),
					];
				} );
			}

			// The fix for every block that loses nothing. A block that would lose
			// something stays as written, inner blocks and all: the serializer
			// keeps a block that does not validate from its source.
			const lossList = losses( initial.blocks, fixed.blocks );
			const lossy = new Set( lossList.map( ( loss: any ) => loss.place ) );
			function lossless( fixes: any[], at = '' ): any[] {
				return fixes.map( ( fix: any, i: number ) => {
					const place = `${ at }/${ i }`;
					const raw = lossy.has( place ) && initial.written.get( place );
					return raw
						? { ...fix, isValid: false, __unstableBlockSource: raw }
						: { ...fix, innerBlocks: lossless( fix.innerBlocks ?? [], place ) };
				} );
			}
			const losslessContent = lossList.length
				? wpBlocks.serialize( lossless( fixed.blocks ) )
				: fixedContent;

			return {
				report: initial.report,
				proposedFix: {
					fixedContent: losslessContent,
					report: fixed.report,
					losses: lossList,
				},
			};
			/* eslint-enable @typescript-eslint/no-explicit-any */
		}, content );

		const report = validation.report as ValidationReport;

		if ( validation.proposedFix ) {
			report.proposedFix = {
				fixedContent: validation.proposedFix.fixedContent,
				report: validation.proposedFix.report as ValidationReportBase,
				losses: validation.proposedFix.losses,
			};
		}

		return report;
	} catch ( error ) {
		// If navigation or evaluation failed, discard the cached page so the
		// next call gets a fresh one.
		await getEditorPage( siteUrl ).close();
		editorPages.delete( siteUrl );

		return {
			totalBlocks: 0,
			validBlocks: 0,
			invalidBlocks: 0,
			results: [],
			error: `Block validation error: ${
				error instanceof Error ? error.message : String( error )
			}`,
		};
	}
}

export interface PaletteColorsResult {
	content: string;
	/** Each color written as a value that the palette has, with its preset. */
	colors: Array< { color: string; slug: string } >;
}

/**
 * Stores each color a block's style gives as a palette color's value as that
 * palette color, as the editor does when one is picked
 * (encodeColorValueWithPalette in @wordpress/block-editor): the block's color
 * attribute where its color or border support has one, `var:preset|color|`
 * elsewhere in its style. The colors stay the same, and follow the palette
 * when it changes. Content the editor would save otherwise is returned as is.
 */
export async function storePaletteColors(
	content: string,
	siteUrl: string,
	palette: Array< [ string, string ] >
): Promise< PaletteColorsResult > {
	if ( ! palette.length ) {
		return { content, colors: [] };
	}
	const page = await getEditorPage( siteUrl ).getPage();
	return page.evaluate(
		( { html, presets } ) => {
			/* eslint-disable @typescript-eslint/no-explicit-any */
			const wpBlocks = ( window as any ).wp.blocks;
			const colors: Array< { color: string; slug: string } > = [];
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
				const before = colors.length;
				const style = presetValues( block.attributes?.style );
				if ( colors.length === before ) {
					return { ...block, innerBlocks };
				}
				const attributes = { ...block.attributes, style };
				const types = wpBlocks.getBlockType( block.name )?.attributes ?? {};
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
				for ( const group of [ 'color', 'border' ] ) {
					if ( attributes.style?.[ group ] && ! Object.keys( attributes.style[ group ] ).length ) {
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
			if ( ! colors.length ) {
				return { content: html, colors };
			}
			const fixed = wpBlocks.serialize( blocks );
			const valid = ( list: any[] ): boolean =>
				list.every( ( block ) => block.isValid !== false && valid( block.innerBlocks ?? [] ) );
			return valid( wpBlocks.parse( fixed ) )
				? { content: fixed, colors }
				: { content: html, colors: [] };
			/* eslint-enable @typescript-eslint/no-explicit-any */
		},
		{ html: content, presets: palette }
	);
}

export interface NavigationLinksResult {
	content: string;
	/** The label of each link bound to the entity it names. */
	links: string[];
}

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
	siteUrl: string
): Promise< NavigationLinksResult > {
	if ( ! /<!--\s*wp:navigation-(?:link|submenu)\s/.test( content ) ) {
		return { content, links: [] };
	}
	const page = await getEditorPage( siteUrl ).getPage();
	return page.evaluate( ( html ) => {
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
				kind === 'taxonomy' || ( ! kind && TAXONOMIES.includes( type ) ) ? 'taxonomy' : 'post-type';
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
	}, content );
}

/** A block and what the editor inserts for it. */
export interface InsertedTemplate {
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
	const page = await editorKnowing( siteUrl, names );
	return page.evaluate(
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
	);
}

/** Clean up all cached editor pages. */
export async function cleanupValidatorPages(): Promise< void > {
	for ( const ep of editorPages.values() ) {
		await ep.close();
	}
	editorPages.clear();
}
