import { EditorPage } from 'cli/ai/browser-utils';

interface HtmlBlockIssue {
	index: number;
	originalContent: string;
	wrapperTag: string;
	maxDepth: number;
	totalElements: number;
	reason: 'structural_tag' | 'deep_nesting';
	suggestedBlocks: string[];
}

export interface HtmlBlockReport {
	totalBlocks: number;
	htmlBlocks: number;
	problematicBlocks: number;
	allowedBlocks: number;
	passed: boolean;
	issues: HtmlBlockIssue[];
	error?: string;
}

/**
 * The check fails when the number of problematic HTML blocks exceeds this.
 */
const STRUCTURAL_BLOCK_THRESHOLD = 0;

/**
 * Maximum DOM nesting depth allowed inside a single HTML block before it is
 * flagged. A depth of 4 means: wrapper > child > grandchild > great-grandchild.
 */
const MAX_NESTING_DEPTH = 4;

// Cache one EditorPage per site URL so repeated checks reuse the same
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
 * Tags that indicate acceptable use of core/html blocks when they are the
 * outermost wrapper element.
 */
const ALLOWED_WRAPPER_TAGS = new Set( [
	'svg',
	'form',
	'script',
	'canvas',
	'iframe',
	'video',
	'audio',
	'style',
	'input',
	'select',
	'textarea',
] );

/**
 * Tags whose content can be expressed with native Gutenberg blocks.
 * If ALL descendant elements are in this set, the HTML block is convertible.
 */
const CONVERTIBLE_TAGS = new Set( [
	'div',
	'section',
	'header',
	'footer',
	'main',
	'article',
	'aside',
	'nav',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'p',
	'ul',
	'ol',
	'li',
	'dl',
	'dt',
	'dd',
	'table',
	'thead',
	'tbody',
	'tfoot',
	'tr',
	'th',
	'td',
	'img',
	'figure',
	'figcaption',
	'blockquote',
	'a',
	'span',
	'em',
	'strong',
	'b',
	'i',
	'u',
	'br',
	'hr',
	'small',
	'mark',
	'sub',
	'sup',
	'abbr',
	'cite',
	'code',
	'pre',
	'time',
] );

/**
 * Maps structural wrapper tags to suggested Gutenberg block replacements.
 */
const REPLACEMENT_MAP: Record< string, string[] > = {
	div: [ 'core/group (with inner blocks for children)' ],
	section: [ 'core/group with tagName="section"' ],
	header: [ 'core/group with tagName="header"' ],
	footer: [ 'core/group with tagName="footer"' ],
	main: [ 'core/group with tagName="main"' ],
	article: [ 'core/group with tagName="article"' ],
	aside: [ 'core/group with tagName="aside"' ],
	nav: [ 'core/navigation' ],
	h1: [ 'core/heading with level=1' ],
	h2: [ 'core/heading with level=2' ],
	h3: [ 'core/heading with level=3' ],
	h4: [ 'core/heading with level=4' ],
	h5: [ 'core/heading with level=5' ],
	h6: [ 'core/heading with level=6' ],
	p: [ 'core/paragraph' ],
	ul: [ 'core/list' ],
	ol: [ 'core/list' ],
	li: [ 'core/list-item (inside core/list)' ],
	table: [ 'core/table' ],
	img: [ 'core/image' ],
	figure: [ 'core/image or core/media-text' ],
	figcaption: [ 'core/image caption or core/media-text' ],
	blockquote: [ 'core/quote' ],
	a: [ 'core/button or inline link in core/paragraph' ],
	dl: [ 'core/list or core/group with core/paragraph items' ],
	span: [ 'core/paragraph or core/group' ],
};

/**
 * Check WordPress block content for misuse of core/html blocks.
 *
 * Navigates to `post-new.php` (which loads wp.blocks with all registered
 * blocks) and runs `wp.blocks.parse()` to identify core/html blocks. Each
 * HTML block is analysed for structural tags and deep nesting.
 */
export async function checkHtmlBlocks(
	content: string,
	siteUrl: string
): Promise< HtmlBlockReport > {
	const editorPage = getEditorPage( siteUrl );

	try {
		const page = await editorPage.getPage();

		const report = await page.evaluate(
			( params: {
				html: string;
				allowedWrapperTags: string[];
				convertibleTags: string[];
				replacementMap: Record< string, string[] >;
				structuralThreshold: number;
				maxDepth: number;
			} ) => {
				/* eslint-disable @typescript-eslint/no-explicit-any */
				const wpBlocks = ( window as any ).wp?.blocks;
				if ( ! wpBlocks ) {
					return {
						totalBlocks: 0,
						htmlBlocks: 0,
						problematicBlocks: 0,
						allowedBlocks: 0,
						passed: false,
						issues: [] as any[],
						error: 'wp.blocks is not available on this page.',
					};
				}

				const allowedWrapperSet = new Set( params.allowedWrapperTags );
				const convertibleSet = new Set( params.convertibleTags );
				const blocks = wpBlocks.parse( params.html );
				const issues: any[] = [];
				let htmlBlockCount = 0;
				let allowedCount = 0;
				let totalBlockCount = 0;

				function computeDepthAndCount( el: Element ): {
					depth: number;
					count: number;
				} {
					let maxChildDepth = 0;
					let count = 1;
					for ( const child of Array.from( el.children ) ) {
						const result = computeDepthAndCount( child );
						if ( result.depth > maxChildDepth ) {
							maxChildDepth = result.depth;
						}
						count += result.count;
					}
					return { depth: 1 + maxChildDepth, count };
				}

				/**
				 * Returns true if ALL element descendants of `el` (including
				 * `el` itself) are tags that have native Gutenberg block
				 * equivalents.
				 *
				 * When this returns true the HTML block is "convertible" —
				 * its content can be fully expressed with core blocks.
				 * When false the block contains SVGs, form elements,
				 * or other non-block content and is considered an
				 * acceptable use of core/html.
				 *
				 * Note: data-* attributes are NOT considered — they can
				 * be replaced by className on core/group blocks and JS
				 * can target those class names instead.
				 */
				function isConvertibleContent( el: Element ): boolean {
					const tag = el.tagName.toLowerCase();
					if ( ! convertibleSet.has( tag ) ) {
						return false;
					}
					for ( const child of Array.from( el.children ) ) {
						if ( ! isConvertibleContent( child ) ) {
							return false;
						}
					}
					return true;
				}

				function walkBlocks( blockList: any[] ) {
					for ( const block of blockList ) {
						totalBlockCount++;

						if ( block.blockName === 'core/html' || block.name === 'core/html' ) {
							htmlBlockCount++;
							const rawHtml = block.originalContent || block.innerHTML || '';

							const doc = new DOMParser().parseFromString( rawHtml, 'text/html' );
							const wrapper = doc.body.firstElementChild;

							if ( ! wrapper ) {
								// Text-only or empty HTML block — skip
								allowedCount++;
							} else {
								const tag = wrapper.tagName.toLowerCase();

								if ( allowedWrapperSet.has( tag ) ) {
									// Wrapper is an explicitly allowed tag (svg, form, script, …)
									allowedCount++;
								} else if ( ! isConvertibleContent( wrapper ) ) {
									// Contains non-convertible content (SVGs, data-* attrs,
									// form elements, canvas, etc.) — acceptable HTML usage
									allowedCount++;
								} else {
									// All content is convertible to native blocks — flag it
									const { depth, count } = computeDepthAndCount( wrapper );
									const reason = depth >= params.maxDepth ? 'deep_nesting' : 'structural_tag';
									const suggestions = params.replacementMap[ tag ] || [
										'core/group or appropriate core block',
									];

									issues.push( {
										index: totalBlockCount - 1,
										originalContent: rawHtml.slice( 0, 300 ),
										wrapperTag: tag,
										maxDepth: depth,
										totalElements: count,
										reason,
										suggestedBlocks: suggestions,
									} );
								}
							}
						}

						// Recurse into inner blocks
						const innerBlocks = block.innerBlocks || [];
						if ( innerBlocks.length > 0 ) {
							walkBlocks( innerBlocks );
						}
					}
				}

				walkBlocks( blocks );

				const problematicCount = issues.length;
				const passed = problematicCount <= params.structuralThreshold;

				return {
					totalBlocks: totalBlockCount,
					htmlBlocks: htmlBlockCount,
					problematicBlocks: problematicCount,
					allowedBlocks: allowedCount,
					passed,
					issues,
				};
				/* eslint-enable @typescript-eslint/no-explicit-any */
			},
			{
				html: content,
				allowedWrapperTags: [ ...ALLOWED_WRAPPER_TAGS ],
				convertibleTags: [ ...CONVERTIBLE_TAGS ],
				replacementMap: REPLACEMENT_MAP,
				structuralThreshold: STRUCTURAL_BLOCK_THRESHOLD,
				maxDepth: MAX_NESTING_DEPTH,
			}
		);

		return report as HtmlBlockReport;
	} catch ( error ) {
		// If navigation or evaluation failed, discard the cached page so the
		// next call gets a fresh one.
		await editorPage.close();
		editorPages.delete( siteUrl );

		return {
			totalBlocks: 0,
			htmlBlocks: 0,
			problematicBlocks: 0,
			allowedBlocks: 0,
			passed: false,
			issues: [],
			error: `HTML block check error: ${
				error instanceof Error ? error.message : String( error )
			}`,
		};
	}
}

/** Clean up all cached editor pages. */
export async function cleanupCheckerPages(): Promise< void > {
	for ( const ep of editorPages.values() ) {
		await ep.close();
	}
	editorPages.clear();
}
