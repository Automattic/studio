import { EditorPage } from 'cli/ai/browser-utils';

interface BlockValidationResult {
	blockName: string;
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
	fixedContent: string;
	report: ValidationReportBase;
	/** Whether the fix shows the same text, read as the browser reads it. */
	sameText: boolean;
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
	const editorPage = getEditorPage( siteUrl );

	try {
		const page = await editorPage.getPage();

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

				// `raw` is the block as written, from the default parser; it is
				// only checked when it is the same block type.
				function validateRecursive( block: any, raw?: any ) {
					if ( ! block.name ) {
						return;
					}
					if ( block.name === 'core/freeform' || block.name === 'core/missing' ) {
						return;
					}

					const blockType = wpBlocks.getBlockType( block.name );
					let issues: string[] = [];
					let isValid = true;
					let expectedContent: string | undefined;
					const sameBlock = rawName( raw ) === block.name;

					if ( ! blockType ) {
						isValid = false;
						issues.push(
							`Block type "${ block.name }" is not registered. ` +
								'It may require a plugin that is not active.'
						);
					} else if ( typeof block.isValid === 'boolean' ) {
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

					results.push( {
						blockName: block.name,
						isValid,
						issues,
						originalContent: block.originalContent || '',
						expectedContent: isValid ? undefined : expectedContent,
					} );

					( block.innerBlocks ?? [] ).forEach( ( inner: any, i: number ) =>
						validateRecursive( inner, sameBlock ? raw.innerBlocks?.[ i ] : undefined )
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
				blocks
					.filter( ( block: any ) => block.name !== 'core/freeform' )
					.forEach( ( block: any, i: number ) => validateRecursive( block, rawBlocks[ i ] ) );

				const validCount = results.filter( ( r: any ) => r.isValid ).length;
				return {
					blocks,
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
					if ( withComment[ key ] === undefined && blockType.attributes?.[ key ] ) {
						withComment[ key ] = value;
					}
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
			// Entities and whitespace the serializer rewrites are the same text.
			const textOf = ( markup: string ) =>
				( new DOMParser().parseFromString( markup, 'text/html' ).body.textContent ?? '' )
					.replace( /\s+/g, ' ' )
					.trim();
			return {
				report: initial.report,
				proposedFix: {
					fixedContent,
					report: fixed.report,
					sameText: textOf( fixedContent ) === textOf( html ),
				},
			};
			/* eslint-enable @typescript-eslint/no-explicit-any */
		}, content );

		const report = validation.report as ValidationReport;

		if ( validation.proposedFix ) {
			report.proposedFix = {
				fixedContent: validation.proposedFix.fixedContent,
				report: validation.proposedFix.report as ValidationReportBase,
				sameText: validation.proposedFix.sameText,
			};
		}

		return report;
	} catch ( error ) {
		// If navigation or evaluation failed, discard the cached page so the
		// next call gets a fresh one.
		await editorPage.close();
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

/** Clean up all cached editor pages. */
export async function cleanupValidatorPages(): Promise< void > {
	for ( const ep of editorPages.values() ) {
		await ep.close();
	}
	editorPages.clear();
}
