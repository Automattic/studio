/**
 * Block validation as a gate the harness runs, not a tool the model must
 * remember to call.
 *
 * Writing block markup (a theme template or part, or a page scratch file in the
 * site's tmp/) queues that file. Validation starts in the background at once,
 * and what puts content on the site or renders it (a shell command, which
 * runs WP-CLI, take_screenshot, inspect_design) waits for it first. A fix the block editor
 * can make losslessly is applied to the file silently; the model hears only
 * about what it has to change itself.
 */
import { createHash } from 'crypto';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { validateHtmlBlockPolicy } from 'cli/ai/block-content-policy';
import { validateBlocks, type ValidationReportBase } from 'cli/ai/block-validator';
import { getSiteByFolder, getSiteUrl } from 'cli/lib/cli-config/sites';

const SHARED_THEME_MARKUP =
	/[\\/]wp-content[\\/]themes[\\/][^\\/]+[\\/](parts[\\/][^\\/]+|templates[\\/](?!front-page|home)[^\\/]+)\.html$/;
const THEME_MARKUP =
	/[\\/]wp-content[\\/]themes[\\/][^\\/]+[\\/](templates|parts)[\\/][^\\/]+\.html$/;
const SCRATCH_MARKUP = /[\\/]tmp[\\/][^\\/]+\.html$/;

/** Whether a file holds block markup the gate validates. */
export function isBlockMarkupFile( filePath: string ): boolean {
	return THEME_MARKUP.test( filePath ) || SCRATCH_MARKUP.test( filePath );
}

/**
 * Template parts and shared templates render on every URL that uses them,
 * where a bare `#anchor` points at the current page rather than the home
 * page section it names.
 */
export function makeAnchorsHomeRelative( content: string ): { content: string; count: number } {
	let count = 0;
	const rewrite = ( _match: string, prefix: string ) => {
		count++;
		return `${ prefix }/#`;
	};
	const rewritten = content
		.replace( /(href=")#(?=[A-Za-z])/g, rewrite )
		.replace( /("url"\s*:\s*")#(?=[A-Za-z])/g, rewrite );
	return { content: rewritten, count };
}

function hash( content: string ): string {
	return createHash( 'sha1' ).update( content ).digest( 'hex' );
}

function visibleText( html: string ): string {
	return html
		.replace( /<!--[\s\S]*?-->/g, ' ' )
		.replace( /<[^>]+>/g, ' ' )
		.replace( /\s+/g, ' ' )
		.trim();
}

function classTokens( html: string ): Set< string > {
	const tokens = new Set< string >();
	for ( const match of html.matchAll( /\sclass="([^"]*)"/g ) ) {
		match[ 1 ].split( /\s+/ ).forEach( ( token ) => token && tokens.add( token ) );
	}
	return tokens;
}

/** Every block comment attribute path, e.g. `core/group:layout.type`. */
function attributePaths( html: string ): Set< string > {
	const paths = new Set< string >();
	const walk = ( prefix: string, value: unknown ) => {
		if ( value && typeof value === 'object' && ! Array.isArray( value ) ) {
			for ( const [ key, child ] of Object.entries( value ) ) {
				walk( prefix ? `${ prefix }.${ key }` : key, child );
			}
		} else if ( ! prefix.endsWith( 'className' ) ) {
			paths.add( prefix );
		}
	};
	for ( const match of html.matchAll( /<!--\s+wp:([a-z0-9/-]+)\s+(\{[\s\S]*?\})\s+\/?-->/g ) ) {
		try {
			walk( `${ match[ 1 ] }:`, JSON.parse( match[ 2 ] ) );
		} catch {
			// Unparseable attributes are the editor's to report.
		}
	}
	return paths;
}

function oneLine( html: string, length: number ): string {
	const flat = html.replace( /\s+/g, ' ' ).trim();
	return flat.length > length ? `${ flat.slice( 0, length ) }…` : flat;
}

/**
 * Each invalid block with every mismatch the editor found, and the HTML the
 * block saves from its comment attributes — the markup that validates.
 */
function describeInvalidBlocks( report: ValidationReportBase ): string[] {
	return report.results
		.filter( ( result ) => ! result.isValid )
		.slice( 0, 5 )
		.flatMap( ( result ) => [
			`  - ${ result.blockName }: ${
				result.issues.slice( 0, 3 ).join( '; ' ) || 'does not match what the block saves'
			}`,
			...( result.originalContent
				? [ `    written: ${ oneLine( result.originalContent, 700 ) }` ]
				: [] ),
			...( result.expectedContent
				? [ `    the block saves: ${ oneLine( result.expectedContent, 700 ) }` ]
				: [] ),
		] );
}

interface FileValidation {
	contentHash: string;
	summary: string;
	problem?: string;
}

/** Validates one block markup file, fixing it in place when that is lossless. */
export async function validateBlockMarkupFile(
	filePath: string,
	siteUrl: string
): Promise< FileValidation > {
	const label = filePath.split( path.sep ).slice( -2 ).join( '/' );
	let content = await readFile( filePath, 'utf8' );
	const notes: string[] = [];

	if ( SHARED_THEME_MARKUP.test( filePath ) ) {
		const homeRelative = makeAnchorsHomeRelative( content );
		if ( homeRelative.count > 0 ) {
			content = homeRelative.content;
			await writeFile( filePath, content, 'utf8' );
			notes.push( `${ homeRelative.count } in-page link(s) made home-relative (/#anchor)` );
		}
	}

	const policy = validateHtmlBlockPolicy( content );
	if ( policy.invalidHtmlBlocks.length > 0 ) {
		return {
			contentHash: hash( content ),
			summary: `${ label }: core/html policy failed`,
			problem: [
				`${ label }: ${ policy.invalidHtmlBlocks.length } core/html block(s) must become editable blocks:`,
				...policy.invalidHtmlBlocks.map(
					( block ) => `  - line ${ block.line }: ${ block.issues[ 0 ] }`
				),
			].join( '\n' ),
		};
	}

	const report = await validateBlocks( content, siteUrl );
	if ( report.error ) {
		return {
			contentHash: hash( content ),
			summary: `${ label }: not validated (${ report.error })`,
		};
	}
	if ( report.invalidBlocks === 0 ) {
		return {
			contentHash: hash( content ),
			summary: `${ label }: ${ report.totalBlocks }/${ report.totalBlocks } blocks valid${
				notes.length ? `; ${ notes.join( '; ' ) }` : ''
			}`,
		};
	}

	const fix = report.proposedFix;
	if ( ! fix || fix.report.error || fix.report.invalidBlocks > 0 ) {
		return {
			contentHash: hash( content ),
			summary: `${ label }: ${ report.invalidBlocks } invalid block(s)`,
			problem: [
				`${ label }: ${ report.invalidBlocks } block(s) do not match what the block saves, and the editor cannot fix them:`,
				...describeInvalidBlocks( report ),
			].join( '\n' ),
		};
	}

	const lostText = visibleText( fix.fixedContent ) !== visibleText( content );
	const fixedClasses = classTokens( fix.fixedContent );
	const droppedClasses = [ ...classTokens( content ) ].filter(
		( token ) => ! fixedClasses.has( token )
	);
	const fixedAttributes = attributePaths( fix.fixedContent );
	const droppedAttributes = [ ...attributePaths( content ) ].filter(
		( attribute ) => ! fixedAttributes.has( attribute )
	);
	if ( ! lostText && droppedClasses.length === 0 && droppedAttributes.length === 0 ) {
		await writeFile( filePath, fix.fixedContent, 'utf8' );
		notes.push( `saved through the block editor, fixing ${ report.invalidBlocks } block(s)` );
		return {
			contentHash: hash( fix.fixedContent ),
			summary: `${ label }: ${ report.totalBlocks }/${
				report.totalBlocks
			} blocks valid; ${ notes.join( '; ' ) }`,
		};
	}
	return {
		contentHash: hash( content ),
		summary: `${ label }: ${ report.invalidBlocks } invalid block(s)`,
		problem: [
			`${ label }: ${
				report.invalidBlocks
			} block(s) do not match what the block saves, and the editor's fix would ${
				lostText
					? 'change the text'
					: droppedClasses.length
					? `drop the classes ${ droppedClasses.join( ' ' ) }`
					: `drop the attributes ${ droppedAttributes.join( ', ' ) }`
			}. Change the HTML to what the block saves, or change the comment attributes the block saves it from (className and style carry extra classes and styles):`,
			...describeInvalidBlocks( report ),
		].join( '\n' ),
	};
}

interface Tracked {
	siteRoot: string;
	result: Promise< FileValidation >;
	reported?: string;
}

export class BlockValidationGate {
	private readonly files = new Map< string, Tracked >();

	constructor(
		private readonly validateFile: (
			filePath: string,
			siteRoot: string
		) => Promise< FileValidation > = validateWithSite
	) {}

	/** Queues a written file and starts validating it in the background. */
	track( filePath: string, siteRoot: string ): void {
		if ( isBlockMarkupFile( filePath ) ) {
			this.files.set( filePath, { siteRoot, result: this.validate( filePath, siteRoot ) } );
		}
	}

	/** Waits for every queued file and returns what is new to report. */
	async settle(): Promise< { summaries: string[]; problems: string[] } > {
		const summaries: string[] = [];
		const problems: string[] = [];
		for ( const [ filePath, tracked ] of this.files ) {
			const result = await this.current( filePath, tracked.siteRoot );
			if ( ! result ) {
				this.files.delete( filePath );
				continue;
			}
			const reportKey = `${ result.contentHash } ${ result.summary }`;
			if ( reportKey !== tracked.reported ) {
				tracked.reported = reportKey;
				summaries.push( result.summary );
				problems.push( ...( result.problem ? [ result.problem ] : [] ) );
			}
		}
		return { summaries, problems };
	}

	/**
	 * The validation of a file's current content, reusing the last one while
	 * the file is unchanged; undefined once the file is gone.
	 */
	private async current(
		filePath: string,
		siteRoot: string
	): Promise< FileValidation | undefined > {
		const content = await readFile( filePath, 'utf8' ).catch( () => undefined );
		if ( content === undefined ) {
			return undefined;
		}
		const tracked = this.files.get( filePath ) ?? {
			siteRoot,
			result: this.validate( filePath, siteRoot ),
		};
		let result = await tracked.result;
		if ( result.contentHash !== hash( content ) ) {
			tracked.result = this.validate( filePath, siteRoot );
			result = await tracked.result;
		}
		this.files.set( filePath, tracked );
		return result;
	}

	/** Validates a file; a validation that cannot run is reported, never skipped. */
	private validate( filePath: string, siteRoot: string ): Promise< FileValidation > {
		return this.validateFile( filePath, siteRoot ).catch( async ( error: unknown ) => ( {
			contentHash: hash( ( await readFile( filePath, 'utf8' ).catch( () => '' ) ) ?? '' ),
			summary: `${ filePath.split( path.sep ).slice( -2 ).join( '/' ) }: not validated (${
				error instanceof Error ? error.message : String( error )
			})`,
		} ) );
	}
}

async function validateWithSite( filePath: string, siteRoot: string ): Promise< FileValidation > {
	return validateBlockMarkupFile( filePath, getSiteUrl( await getSiteByFolder( siteRoot ) ) );
}

const gates = new WeakMap< object, BlockValidationGate >();

export function getBlockValidationGate( session: object ): BlockValidationGate {
	let gate = gates.get( session );
	if ( ! gate ) {
		gate = new BlockValidationGate();
		gates.set( session, gate );
	}
	return gate;
}
