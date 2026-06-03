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
 * blocks — core + plugins) and runs `wp.blocks.validateBlock()` for each
 * parsed block. This is the same save-function comparison the Gutenberg
 * editor performs on load.
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

			function extractIssues( validationIssues: any[] ): string[] {
				const issues: string[] = [];
				for ( const issue of validationIssues ) {
					if ( issue?.args ) {
						const msg = String( issue.args[ 0 ] || '' );
						// Skip the verbose "Block validation failed for `name`" summary —
						// the per-attribute messages that follow are more useful.
						if ( ! msg.startsWith( 'Block validation failed' ) ) {
							issues.push(
								issue.args
									.map( ( a: any ) =>
										typeof a === 'object'
											? JSON.stringify( a ).slice( 0, 200 )
											: String( a ).slice( 0, 500 )
									)
									.join( ' ' )
							);
						}
					}
				}
				return issues;
			}

			function validateContent( blockHtml: string ) {
				const blocks = wpBlocks.parse( blockHtml );
				const results: any[] = [];

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

					if ( ! blockType ) {
						isValid = false;
						issues.push(
							`Block type "${ block.name }" is not registered. ` +
								'It may require a plugin that is not active.'
						);
					} else {
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

						if ( ! isValid ) {
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
