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

			// The block's registered attributes, with those of its deprecated
			// versions, which the editor migrates.
			function knownAttributes( blockType: any ): Record< string, any > {
				const known: Record< string, any > = {};
				for ( const version of [ ...( blockType.deprecated ?? [] ) ].reverse() ) {
					Object.assign( known, version.attributes );
				}
				return Object.assign( known, blockType.attributes );
			}

			function describeAttribute( name: string, schema: any ): string {
				return Array.isArray( schema?.enum )
					? `${ name } (${ schema.enum
							.map( ( value: unknown ) =>
								typeof value === 'string' && value ? value : JSON.stringify( value )
							)
							.join( ' | ' ) })`
					: name;
			}

			// Attributes in a block's comment delimiter that its type does not
			// declare, or values outside a declared enum. wp.blocks.parse drops
			// both without a word, so they are read from the raw delimiters. One
			// entry per registered block, in the order validateRecursive meets them.
			function attributeIssues( blockHtml: string ): string[][] {
				const rawParse = ( window as any ).wp?.blockSerializationDefaultParser?.parse;
				if ( typeof rawParse !== 'function' ) {
					return [];
				}
				const perBlock: string[][] = [];
				const walk = ( raw: any ) => {
					if ( ! raw.blockName ) return;
					const name = raw.blockName.includes( '/' ) ? raw.blockName : `core/${ raw.blockName }`;
					const blockType = wpBlocks.getBlockType( name );
					// Unregistered blocks parse to core/missing, which is not checked.
					if ( ! blockType || name === 'core/freeform' ) return;
					const known = knownAttributes( blockType );
					const issues: string[] = [];
					for ( const [ key, value ] of Object.entries( raw.attrs ?? {} ) ) {
						const schema = known[ key ];
						if ( ! schema ) {
							issues.push(
								`"${ key }" is not an attribute of ${ name }, so WordPress ignores it.`
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
							.map( ( [ key, schema ] ) => describeAttribute( key, schema ) );
						issues.push( `${ name } attributes: ${ attributes.join( ', ' ) }.` );
					}
					perBlock.push( issues );
					( raw.innerBlocks ?? [] ).forEach( walk );
				};
				rawParse( blockHtml ).forEach( walk );
				return perBlock;
			}

			function validateContent( blockHtml: string ) {
				const blocks = wpBlocks.parse( blockHtml );
				const results: any[] = [];
				const rawIssues = attributeIssues( blockHtml );
				let blockIndex = 0;

				function validateRecursive( block: any ) {
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
					const unknownAttributeIssues = rawIssues[ blockIndex++ ] ?? [];

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
						if ( ! isValid ) {
							issues = extractIssues( block.validationIssues || [] );
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

					// Expected content shows how the save output differs, so only a
					// failed save comparison gets it.
					if ( blockType && ! isValid ) {
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

					if ( unknownAttributeIssues.length ) {
						isValid = false;
						issues = [ ...issues, ...unknownAttributeIssues ];
					}

					results.push( {
						blockName: block.name,
						isValid,
						issues,
						originalContent: block.originalContent || '',
						expectedContent: isValid ? undefined : expectedContent,
					} );

					if ( block.innerBlocks ) {
						for ( const inner of block.innerBlocks ) {
							validateRecursive( inner );
						}
					}
				}

				for ( const block of blocks ) {
					validateRecursive( block );
				}

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

			function normalizeBlock( block: any ): any {
				if ( ! block.name || block.name === 'core/freeform' || block.name === 'core/missing' ) {
					return block;
				}

				const blockType = wpBlocks.getBlockType( block.name );
				if ( ! blockType || typeof wpBlocks.createBlock !== 'function' ) {
					return block;
				}

				const fixedInnerBlocks = Array.isArray( block.innerBlocks )
					? block.innerBlocks.map( normalizeBlock )
					: [];

				// Re-creating a block the parser accepted can only lose content —
				// createBlock() drops the raw inner HTML of core/html, whose save
				// returns null — so keep it as parsed and only fix its children.
				if ( block.isValid === true ) {
					return { ...block, innerBlocks: fixedInnerBlocks };
				}

				try {
					return wpBlocks.createBlock(
						block.name,
						block.attributes,
						fixedInnerBlocks.length > 0 ? fixedInnerBlocks : undefined
					);
				} catch {
					return block;
				}
			}

			const initial = validateContent( html );

			if ( initial.report.invalidBlocks === 0 ) {
				return { report: initial.report };
			}

			const fixedBlocks = initial.blocks.map( normalizeBlock );
			const fixedContent = wpBlocks.serialize( fixedBlocks );

			if ( fixedContent === html ) {
				return { report: initial.report };
			}

			const fixed = validateContent( fixedContent );
			return {
				report: initial.report,
				proposedFix: {
					fixedContent,
					report: fixed.report,
				},
			};
			/* eslint-enable @typescript-eslint/no-explicit-any */
		}, content );

		const report = validation.report as ValidationReport;

		if ( validation.proposedFix ) {
			report.proposedFix = {
				fixedContent: validation.proposedFix.fixedContent,
				report: validation.proposedFix.report as ValidationReportBase,
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
