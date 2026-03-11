let initialized = false;
let initError: string | null = null;

function withSuppressedConsole< T >( fn: () => T ): T {
	const orig = {
		log: console.log,
		info: console.info,
		warn: console.warn,
		error: console.error,
	};
	console.log = () => {};
	console.info = () => {};
	console.warn = () => {};
	console.error = () => {};
	try {
		return fn();
	} finally {
		Object.assign( console, orig );
	}
}

interface BlockValidationResult {
	blockName: string;
	isValid: boolean;
	issues: string[];
	originalContent: string;
	expectedContent?: string;
}

export interface ValidationReport {
	totalBlocks: number;
	validBlocks: number;
	invalidBlocks: number;
	results: BlockValidationResult[];
	error?: string;
}

/**
 * Set up jsdom globals so WordPress packages (especially hpq) can use DOM APIs.
 * Must be called before importing any @wordpress/* packages.
 */
function setupDomEnvironment(): void {
	const { JSDOM } = require( 'jsdom' );
	const dom = new JSDOM( '<!DOCTYPE html><html><body></body></html>', {
		// Suppress CSS parsing errors from @wordpress/ui CSS modules
		pretendToBeVisual: false,
	} );

	const g = global as Record< string, unknown >;

	// Helper to set global properties, using Object.defineProperty for read-only ones
	// (e.g., `navigator` is getter-only in Node.js 21+)
	function setGlobal( key: string, value: unknown ): void {
		try {
			g[ key ] = value;
		} catch {
			Object.defineProperty( globalThis, key, {
				value,
				writable: true,
				configurable: true,
			} );
		}
	}

	setGlobal( 'window', dom.window );
	setGlobal( 'document', dom.window.document );
	setGlobal( 'navigator', dom.window.navigator );
	setGlobal( 'MutationObserver', dom.window.MutationObserver );
	setGlobal( 'Node', dom.window.Node );
	setGlobal( 'HTMLElement', dom.window.HTMLElement );
	setGlobal( 'CustomEvent', dom.window.CustomEvent );
	setGlobal( 'URL', dom.window.URL );
	setGlobal( 'Element', dom.window.Element );

	// Mock matchMedia (used by @wordpress/components and others)
	if ( ! dom.window.matchMedia ) {
		dom.window.matchMedia = () =>
			( {
				matches: false,
				media: '',
				onchange: null,
				addListener: () => {},
				removeListener: () => {},
				addEventListener: () => {},
				removeEventListener: () => {},
				dispatchEvent: () => false,
			} ) as unknown as MediaQueryList;
	}

	// Mock requestAnimationFrame / requestIdleCallback
	if ( ! g.requestAnimationFrame ) {
		g.requestAnimationFrame = ( cb: () => void ) => setTimeout( cb, 0 );
		g.cancelAnimationFrame = ( id: number ) => clearTimeout( id );
	}
	if ( ! g.requestIdleCallback ) {
		g.requestIdleCallback = ( cb: ( deadline: { timeRemaining: () => number } ) => void ) =>
			setTimeout( () => cb( { timeRemaining: () => 50 } ), 0 );
		g.cancelIdleCallback = ( id: number ) => clearTimeout( id );
	}

	// Some WP packages check for ResizeObserver
	if ( ! g.ResizeObserver ) {
		g.ResizeObserver = class {
			observe() {}
			unobserve() {}
			disconnect() {}
		};
	}

	// IntersectionObserver mock
	if ( ! g.IntersectionObserver ) {
		g.IntersectionObserver = class {
			observe() {}
			unobserve() {}
			disconnect() {}
		};
	}
}

/**
 * Lazy initialization: set up DOM environment and register blocks on first use.
 */
function ensureInitialized(): void {
	if ( initialized ) {
		return;
	}

	try {
		setupDomEnvironment();
	} catch ( error ) {
		initError = `Failed to set up DOM environment: ${
			error instanceof Error ? error.stack || error.message : String( error )
		}. Make sure 'jsdom' is installed.`;
		initialized = true;
		return;
	}

	// Suppress jsdom CSS parsing errors during @wordpress/block-library import
	// (jsdom can't parse CSS modules used by @wordpress/ui and @wordpress/components)
	const origError = console.error;
	console.error = ( ...args: unknown[] ) => {
		const msg = String( args[ 0 ] );
		if ( msg.includes( 'Could not parse CSS stylesheet' ) ) {
			return;
		}
		origError( ...args );
	};

	try {
		const { registerCoreBlocks } = require( '@wordpress/block-library' );
		registerCoreBlocks();
	} catch ( error ) {
		initError = `Failed to register core blocks: ${
			error instanceof Error ? error.stack || error.message : String( error )
		}. Make sure '@wordpress/block-library' is installed.`;
	} finally {
		console.error = origError;
	}

	// Verify that blocks were actually registered
	if ( ! initError ) {
		try {
			const { getBlockTypes } = require( '@wordpress/blocks' );
			const types = getBlockTypes();
			if ( ! types || types.length === 0 ) {
				initError = 'No block types were registered. Block validation will not work correctly.';
			}
		} catch {
			initError = 'Failed to verify block registration.';
		}
	}

	initialized = true;
}

function formatLogItem( item: { args?: unknown[] } ): string {
	if ( ! item.args || item.args.length === 0 ) {
		return '';
	}

	const formatStr = String( item.args[ 0 ] );

	// Skip the verbose "Block validation failed for `name` (blockType)" message —
	// we already show the block name and the per-attribute issues are more useful.
	if ( formatStr.startsWith( 'Block validation failed' ) ) {
		return '';
	}

	let message = formatStr;
	let argIndex = 1;
	message = message.replace( /%[so]/g, () => {
		if ( argIndex < ( item.args?.length ?? 0 ) ) {
			const val = item.args![ argIndex++ ];
			if ( typeof val === 'object' ) {
				return JSON.stringify( val ).slice( 0, 200 );
			}
			return String( val ).slice( 0, 500 );
		}
		return '';
	} );

	return message;
}

function tryGetSaveContent( block: {
	name: string;
	attributes: Record< string, unknown >;
} ): string | undefined {
	try {
		const { getSaveContent, getBlockType } = require( '@wordpress/blocks' );
		const blockType = getBlockType( block.name );
		if ( blockType ) {
			return getSaveContent( blockType, block.attributes );
		}
	} catch {
		// If save content generation fails, skip
	}
	return undefined;
}

interface ParsedBlock {
	name: string | null;
	attributes: Record< string, unknown >;
	originalContent?: string;
	innerBlocks?: ParsedBlock[];
}

function validateBlockList( blocks: ParsedBlock[], results: BlockValidationResult[] ): void {
	const { validateBlock } = require( '@wordpress/blocks' );

	for ( const block of blocks ) {
		// Skip freeform blocks (raw HTML) and missing blocks (unregistered/PHP content)
		if ( ! block.name || block.name === 'core/freeform' || block.name === 'core/missing' ) {
			continue;
		}

		try {
			const [ isValid, logItems ] = validateBlock( block ) as [
				boolean,
				Array< { args?: unknown[] } >,
			];

			const issues: string[] = [];
			for ( const item of logItems ) {
				const msg = formatLogItem( item );
				if ( msg ) {
					issues.push( msg );
				}
			}

			results.push( {
				blockName: block.name,
				isValid,
				issues,
				originalContent: block.originalContent || '',
				expectedContent: isValid
					? undefined
					: tryGetSaveContent( block as { name: string; attributes: Record< string, unknown > } ),
			} );
		} catch ( error ) {
			results.push( {
				blockName: block.name,
				isValid: false,
				issues: [
					`Validation error: ${ error instanceof Error ? error.message : String( error ) }`,
				],
				originalContent: block.originalContent || '',
			} );
		}

		if ( block.innerBlocks && block.innerBlocks.length > 0 ) {
			validateBlockList( block.innerBlocks, results );
		}
	}
}

/**
 * Validate WordPress block content.
 * Parses the content into blocks and validates each one against its registered save() function.
 */
export function validateBlocks( content: string ): ValidationReport {
	ensureInitialized();

	if ( initError ) {
		return {
			totalBlocks: 0,
			validBlocks: 0,
			invalidBlocks: 0,
			results: [],
			error: initError,
		};
	}

	return withSuppressedConsole( () => {
		const { parse } = require( '@wordpress/blocks' );
		const blocks = parse( content ) as ParsedBlock[];
		const results: BlockValidationResult[] = [];

		validateBlockList( blocks, results );

		const validCount = results.filter( ( r ) => r.isValid ).length;

		return {
			totalBlocks: results.length,
			validBlocks: validCount,
			invalidBlocks: results.length - validCount,
			results,
		};
	} );
}
