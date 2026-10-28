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

interface BlockFixProposal {
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
 * The block types of `names` the site's block editor does not register, as
 * wp.blocks.getBlockType() reads its registry once the editor has loaded
 * every script WordPress enqueues for it.
 */
export async function unregisteredInEditor(
	names: string[],
	siteUrl: string
): Promise< string[] > {
	const page = await editorKnowing( siteUrl, names );
	return page.evaluate(
		( wanted ) =>
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			wanted.filter( ( name ) => ! ( window as any ).wp.blocks.getBlockType( name ) ),
		names
	);
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
		// What the editor threw beside the content, for a block it did not register.
		const input = [ content, getEditorPage( siteUrl ).loadErrors ] as const;

		const validation = await page.evaluate( async ( [ html, thrown ] ) => {
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
										: `No ${ prefix } blocks are registered in the site's block editor.`
								}${
									thrown.length ? ` The site's block editor threw: ${ thrown.join( '; ' ) }.` : ''
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
				let firstValid: any;
				for ( const attributes of attributeSets( block, raw, sameBlock, [
					withComment,
					parsed,
				] ) ) {
					try {
						const created = wpBlocks.createBlock( block.name, attributes, inner );
						if ( wpBlocks.parse( wpBlocks.serialize( [ created ] ) )[ 0 ]?.isValid === false ) {
							continue;
						}
						const made = sameBlock
							? withWrittenClasses( withWrittenStyles( created, raw ), raw )
							: created;
						if ( ! sameBlock || keepsWritten( made, raw ) ) {
							return made;
						}
						firstValid ??= made;
					} catch {
						// The next set of attributes.
					}
				}
				return firstValid ?? block;
			}

			// The attribute sets to make a block again from, the deprecated
			// versions' migrations last and only once asked for.
			function* attributeSets( block: any, raw: any, sameBlock: boolean, first: any[] ) {
				yield* first;
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
					yield { ...first[ 0 ], ...( Array.isArray( migrated ) ? migrated[ 0 ] : migrated ) };
				}
			}

			// Whether a block made again saves every class written in its own
			// markup: the styles written on it withWrittenStyles stores, and what
			// a fix loses otherwise its losses tell.
			function keepsWritten( made: any, raw: any ) {
				const saved = ownMarkup(
					String( rawParse( wpBlocks.serialize( [ made ] ) )?.[ 0 ]?.innerHTML ?? '' )
				).classes;
				return [ ...ownMarkup( String( raw.innerHTML ?? '' ) ).classes ].every( ( name ) =>
					saved.has( name )
				);
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
				const ownClasses = ( one: any ) =>
					new Set(
						elementsOf(
							String( rawParse( wpBlocks.serialize( [ one ] ) )?.[ 0 ]?.innerHTML ?? '' )
						).flatMap( ( element ) => [ ...element.classList ] )
					);
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
						const kind =
							schema.type === 'string'
								? 'string'
								: [ 'number', 'integer' ].includes( schema.type )
								? 'number'
								: undefined;
						if ( ! kind ) {
							return [];
						}
						const probe = String( PROBE[ kind ] );
						let classes: Set< string >;
						try {
							classes = ownClasses(
								wpBlocks.createBlock(
									made.name,
									{ ...made.attributes, [ key ]: PROBE[ kind ] },
									made.innerBlocks
								)
							);
						} catch {
							return [];
						}
						return [ ...classes ].flatMap( ( name ) => {
							const at = name.indexOf( probe );
							return at < 0
								? []
								: [
										{
											key,
											kind,
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
					for ( const { key, kind, before, after } of templates ) {
						const value =
							name.startsWith( before ) && name.endsWith( after )
								? name.slice( before.length, name.length - after.length )
								: '';
						if ( ! value ) {
							continue;
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
								key === PATH ? path : typeof key === 'symbol' ? undefined : at( [ ...path, key ] ),
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
					const kind =
						schema.type === 'string'
							? 'string'
							: [ 'number', 'integer' ].includes( schema.type )
							? 'number'
							: undefined;
					if ( ! kind ) {
						return [];
					}
					const probe = String( PROBE[ kind ] );
					let saved: HTMLElement[];
					try {
						saved = elementsOf(
							String(
								rawParse(
									wpBlocks.serialize( [
										wpBlocks.createBlock(
											made.name,
											{ ...made.attributes, [ key ]: PROBE[ kind ] },
											made.innerBlocks
										),
									] )
								)?.[ 0 ]?.innerHTML ?? ''
							)
						);
					} catch {
						return [];
					}
					return saved.flatMap( ( element ) =>
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
			function declarations( element: HTMLElement ) {
				return new Map(
					Array.from( element.style )
						.map(
							( property ) => [ property, element.style.getPropertyValue( property ) ] as const
						)
						.filter( ( [ , value ] ) => value !== 'initial' )
				);
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
				const ownHtml = ( one: any ) =>
					String( rawParse( wpBlocks.serialize( [ one ] ) )?.[ 0 ]?.innerHTML ?? '' );
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
					for ( const [ property, value ] of declarations( element ) ) {
						styles.add( `${ property }:${ value }` );
					}
				} );
				// Entities and whitespace the serializer rewrites are the same text.
				return { classes, styles, text: ( body.textContent ?? '' ).replace( /\s+/g, ' ' ).trim() };
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

			// What the fix loses from each block as written, block by block: its
			// text, classes, styles and where its inner blocks sit. Its attributes
			// it keeps, being made from them, apart from the editor's own migrations.
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
					const styles = missing( before.styles, after.styles );
					const lost = {
						text: before.text !== after.text ? [ 'change the text' ] : [],
						classes,
						styles,
						moves: reshaped ? [] : moves( place, block ),
					};
					const root = reshaped ? undefined : elementsOf( block.originalContent ?? '' )[ 0 ];
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
									},
							  ]
							: [] ),
						...( reshaped ? [] : losses( block.innerBlocks ?? [], fix.innerBlocks ?? [], place ) ),
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
					for ( let wait = 0; rendered().length < outermost.length && wait < 100; wait++ ) {
						await new Promise( ( resolve ) => setTimeout( resolve, 50 ) );
					}
					// Its styles load beside the blocks.
					await new Promise( ( resolve ) => requestAnimationFrame( () => resolve( null ) ) );
					const top = [ ...rendered() ];
					if ( top.length !== outermost.length ) {
						return kept;
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
						const computed = element.ownerDocument.defaultView!.getComputedStyle( element );
						const shown = new Map(
							loss.onRoot.map( ( [ property ]: string[] ) => [
								property,
								computed.getPropertyValue( property ),
							] )
						);
						element.style.cssText += `;${ loss.rootStyle }`;
						kept.set(
							loss.place,
							new Set(
								loss.onRoot
									.filter(
										( [ property ]: string[] ) =>
											computed.getPropertyValue( property ) === shown.get( property )
									)
									.map( ( [ property, value ]: string[] ) => `${ property }:${ value }` )
							)
						);
						element.className = asRendered.className;
						element.style.cssText = asRendered.style;
					}
					return kept;
				} finally {
					root.unmount();
					host.remove();
				}
			}

			// The fix for every block that loses nothing. A block that would lose
			// something stays as written, inner blocks and all: the serializer
			// keeps a block that does not validate from its source.
			const found = losses( initial.blocks, fixed.blocks );
			const rendering = await renderedAlready( found.filter( ( loss ) => loss.onRoot.length ) );
			const lossList = found
				.map( ( { place, blockName, lost } ) => {
					const kept = rendering.get( place ) ?? new Set();
					const styles = lost.styles.filter( ( style: string ) => ! kept.has( style ) );
					return {
						place,
						blockName,
						lost: [
							...lost.text,
							lost.classes.length ? `drop the classes ${ lost.classes.join( ' ' ) }` : '',
							styles.length ? `drop the styles ${ styles.join( '; ' ) }` : '',
							...lost.moves,
						]
							.filter( Boolean )
							.join( ' and ' ),
					};
				} )
				.filter( ( loss ) => loss.lost );
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
		}, input );

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
	{ colors: palette, fontSizes: sizes, spacingSizes: spacings }: PresetValues
): Promise< PresetValuesResult > {
	const page = await getEditorPage( siteUrl ).getPage();
	return page.evaluate(
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
	);
}

export interface NavigationLinksResult {
	content: string;
	/** The label of each link bound to the entity it names. */
	links: string[];
}

export interface BetweenBlockCommentsResult {
	content: string;
	/** How many runs of HTML comments between blocks were dropped. */
	comments: number;
}

/**
 * Drops HTML comments that stand between blocks. The editor parses text
 * outside any block as a Classic block and wraps it in paragraphs
 * (normalizeRawBlock in @wordpress/blocks runs autop on it), so a comment
 * there turns into a Classic block holding a paragraph the first time the
 * content is saved through the editor. A comment renders nothing, so
 * dropping it changes nothing on the page. Comments inside a block are left
 * to the block.
 */
export async function dropCommentsBetweenBlocks(
	content: string,
	siteUrl: string
): Promise< BetweenBlockCommentsResult > {
	if ( ! /<!--(?!\s*\/?wp:)/.test( content ) ) {
		return { content, comments: 0 };
	}
	const page = await getEditorPage( siteUrl ).getPage();
	return page.evaluate( ( html ) => {
		/* eslint-disable @typescript-eslint/no-explicit-any */
		const wpBlocks = ( window as any ).wp.blocks;
		// Classic content of nothing but HTML comments, with the paragraphs and
		// line breaks wpautop() wraps them in, as the browser parses it.
		const onlyComments = ( block: any ) => {
			if ( block.name !== 'core/freeform' ) {
				return false;
			}
			const parsed = document.createElement( 'template' );
			parsed.innerHTML = String( block.attributes?.content ?? '' );
			const nodes = document.createTreeWalker( parsed.content );
			let comments = 0;
			for ( let node = nodes.nextNode(); node; node = nodes.nextNode() ) {
				if ( node.nodeType === Node.COMMENT_NODE ) {
					comments++;
				} else if (
					node.nodeType === Node.TEXT_NODE
						? node.textContent?.trim()
						: ! [ 'P', 'BR' ].includes( node.nodeName )
				) {
					return false;
				}
			}
			return comments > 0;
		};
		const blocks = wpBlocks.parse( html );
		const kept = blocks.filter( ( block: any ) => ! onlyComments( block ) );
		return kept.length === blocks.length
			? { content: html, comments: 0 }
			: { content: wpBlocks.serialize( kept ), comments: blocks.length - kept.length };
		/* eslint-enable @typescript-eslint/no-explicit-any */
	}, content );
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
	const page = await editorKnowing( siteUrl, names );
	return page.evaluate( ( wanted ) => {
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
	}, names );
}

/** Clean up all cached editor pages. */
/**
 * The site's blocks whose save makes each element of the HTML, its outermost
 * element: each block type, created with its defaults (createBlock in
 * @wordpress/blocks), saved as the editor saves it (getSaveContent).
 */
export async function blocksSavingElements(
	html: string,
	siteUrl: string
): Promise< Array< { element: string; blocks: string[] } > > {
	const page = await editorKnowing( siteUrl, [] );
	return page.evaluate( ( markup ) => {
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
	}, html );
}

export async function cleanupValidatorPages(): Promise< void > {
	for ( const ep of editorPages.values() ) {
		await ep.close();
	}
	editorPages.clear();
}
