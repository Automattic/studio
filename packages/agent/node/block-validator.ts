import { EditorPage, withTimeout } from './browser-utils';

const BLOCK_EVALUATION_TIMEOUT_MS = 60_000;

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

interface BlockFixProposal {
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

		const evaluation = page.evaluate( ( html: string ) => {
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
				// block, which is not checked; pair the rest in order.
				const rawBlocks = ( typeof rawParse === 'function' ? rawParse( blockHtml ) : [] ).filter(
					( raw: any ) => raw.blockName
				);
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
		const validation = await withTimeout(
			evaluation,
			BLOCK_EVALUATION_TIMEOUT_MS,
			'Block validation evaluating blocks in the editor'
		);

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
