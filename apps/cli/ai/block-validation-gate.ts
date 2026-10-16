/**
 * Block validation as a gate the harness runs, not a tool the model must
 * remember to call.
 *
 * Writing block markup (a theme template or part, or a page scratch file in the
 * site's tmp/) queues that file. Validation starts in the background at once,
 * and the tools that put content on the site or render it (wp_cli,
 * take_screenshot, inspect_design) wait for it first. A fix the block editor
 * can make losslessly is applied to the file silently; the model hears only
 * about what it has to change itself.
 */
import { createHash } from 'crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'fs/promises';
import path from 'path';
import { validateHtmlBlockPolicy } from 'cli/ai/block-content-policy';
import { validateBlocks, type ValidationReportBase } from 'cli/ai/block-validator';
import { splitCommandArgs } from 'cli/ai/wp-cli-args';
import { getSiteByFolder, getSiteUrl } from 'cli/lib/cli-config/sites';
import { isServerRunning } from 'cli/lib/wordpress-server-manager';

const SHARED_THEME_MARKUP =
	/[\\/]wp-content[\\/]themes[\\/][^\\/]+[\\/](parts[\\/][^\\/]+|templates[\\/](?!front-page|home)[^\\/]+)\.html$/;
const THEME_MARKUP =
	/[\\/]wp-content[\\/]themes[\\/][^\\/]+[\\/](templates|parts)[\\/][^\\/]+\.html$/;
const SCRATCH_MARKUP = /[\\/]tmp[\\/][^\\/]+\.html$/;
const POST_CONTENT = '--post_content=';

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

function isJsonContent( content: string ): boolean {
	return /^\s*{/.test( content );
}

/**
 * Post content that opens as JSON — global styles, navigation data — must
 * parse: WordPress drops content it cannot decode without saying so.
 */
function jsonContentProblem( content: string, source: string ): string | undefined {
	if ( ! isJsonContent( content ) ) {
		return undefined;
	}
	try {
		JSON.parse( content );
		return undefined;
	} catch ( error ) {
		return `${ source } is not valid JSON, and WordPress ignores content it cannot decode: ${
			error instanceof Error ? error.message : String( error )
		}`;
	}
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
	const fix = report.proposedFix;
	const fixIsValid = !! fix && ! fix.report.error && fix.report.invalidBlocks === 0;
	if ( report.invalidBlocks === 0 && ! fixIsValid ) {
		return {
			contentHash: hash( content ),
			summary: `${ label }: ${ report.totalBlocks }/${ report.totalBlocks } blocks valid${
				notes.length ? `; ${ notes.join( '; ' ) }` : ''
			}`,
		};
	}

	if ( fix && fixIsValid ) {
		const lostText = visibleText( fix.fixedContent ) !== visibleText( content );
		const originalClasses = classTokens( content );
		const fixedClasses = classTokens( fix.fixedContent );
		const droppedClasses = [ ...originalClasses ].filter(
			( token ) => ! fixedClasses.has( token )
		);
		const fixedAttributes = attributePaths( fix.fixedContent );
		const droppedAttributes = [ ...attributePaths( content ) ].filter(
			( attribute ) => ! fixedAttributes.has( attribute )
		);
		if ( ! lostText && droppedClasses.length === 0 && droppedAttributes.length === 0 ) {
			await writeFile( filePath, fix.fixedContent, 'utf8' );
			const addedClasses = [ ...fixedClasses ].filter(
				( token ) => ! originalClasses.has( token )
			);
			if ( report.invalidBlocks > 0 || addedClasses.length > 0 ) {
				notes.push(
					`saved through the block editor${
						report.invalidBlocks ? `, fixing ${ report.invalidBlocks } block(s)` : ''
					}${ addedClasses.length ? `, adding classes ${ addedClasses.join( ' ' ) }` : '' }`
				);
			}
			return {
				contentHash: hash( fix.fixedContent ),
				summary: `${ label }: ${ report.totalBlocks }/${ report.totalBlocks } blocks valid${
					notes.length ? `; ${ notes.join( '; ' ) }` : ''
				}`,
			};
		}
		if ( report.invalidBlocks === 0 ) {
			return {
				contentHash: hash( content ),
				summary: `${ label }: ${ report.totalBlocks }/${ report.totalBlocks } blocks valid`,
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

	return {
		contentHash: hash( content ),
		summary: `${ label }: ${ report.invalidBlocks } invalid block(s)`,
		problem: [
			`${ label }: ${ report.invalidBlocks } block(s) do not match what the block saves, and the editor cannot fix them:`,
			...describeInvalidBlocks( report ),
		].join( '\n' ),
	};
}

interface Tracked {
	siteRoot: string;
	running?: Promise< FileValidation | undefined >;
	result?: FileValidation;
	reported?: string;
}

export class BlockValidationGate {
	private readonly files = new Map< string, Tracked >();

	constructor(
		private readonly validateFile: (
			filePath: string,
			siteRoot: string
		) => Promise< FileValidation | undefined > = validateWithRunningSite
	) {}

	/** Queues a written file and starts validating it in the background. */
	track( filePath: string, siteRoot: string ): void {
		if ( ! isBlockMarkupFile( filePath ) ) {
			return;
		}
		const tracked: Tracked = { siteRoot };
		tracked.running = this.validateFile( filePath, siteRoot ).catch( ( error: unknown ) =>
			notValidated( filePath, undefined, error )
		);
		this.files.set( filePath, tracked );
	}

	/**
	 * Waits for every queued file, revalidating any that changed since its
	 * validation started, and returns what is new to report.
	 */
	async settle(): Promise< { summaries: string[]; problems: string[] } > {
		const summaries: string[] = [];
		const problems: string[] = [];
		for ( const [ filePath, tracked ] of this.files ) {
			let result = tracked.running ? await tracked.running : tracked.result;
			const current = await readFile( filePath, 'utf8' ).catch( () => undefined );
			if ( current === undefined ) {
				this.files.delete( filePath );
				continue;
			}
			if ( ! result || result.contentHash !== hash( current ) ) {
				tracked.running = undefined;
				result = await this.validateFile( filePath, tracked.siteRoot ).catch( ( error: unknown ) =>
					notValidated( filePath, current, error )
				);
			}
			tracked.running = undefined;
			tracked.result = result;
			const reportKey = result && `${ result.contentHash } ${ result.summary }`;
			if ( ! result || reportKey === tracked.reported ) {
				continue;
			}
			tracked.reported = reportKey;
			summaries.push( result.summary );
			if ( result.problem ) {
				problems.push( result.problem );
			}
		}
		return { summaries, problems };
	}

	/**
	 * Drops every result: activating a theme or plugin changes which blocks the
	 * editor recognizes, so earlier validations no longer hold.
	 */
	invalidate(): void {
		for ( const tracked of this.files.values() ) {
			tracked.running = undefined;
			tracked.result = undefined;
			tracked.reported = undefined;
		}
	}

	/**
	 * Validates the block markup a WP-CLI command would save as post content —
	 * every file `post create` or `post update` reads, wherever it lives, and
	 * inline `--post_content` — and returns the problems that keep it off the
	 * site. A lossless editor fix to inline content comes back as the command
	 * to run instead.
	 */
	async checkCommand(
		command: string,
		siteRoot: string
	): Promise< { problems: string[]; command: string } > {
		const args = splitCommandArgs( command );
		if ( args[ 0 ] !== 'post' || ! [ 'create', 'update' ].includes( args[ 1 ] ) ) {
			return { problems: [], command };
		}
		const problems: string[] = [];
		for ( const arg of args.slice( 2 ).filter( ( value ) => ! value.startsWith( '-' ) ) ) {
			const filePath = path.resolve( siteRoot, arg );
			if ( ! ( await stat( filePath ).catch( () => undefined ) )?.isFile() ) {
				continue;
			}
			const content = await readFile( filePath, 'utf8' );
			if ( isJsonContent( content ) ) {
				const jsonProblem = jsonContentProblem( content, arg );
				problems.push( ...( jsonProblem ? [ jsonProblem ] : [] ) );
				continue;
			}
			const result = await this.resultFor( filePath, siteRoot );
			if ( result?.problem ) {
				problems.push( result.problem );
			}
		}

		const inline = args
			.find( ( value ) => value.startsWith( POST_CONTENT ) )
			?.slice( POST_CONTENT.length );
		const jsonProblem = inline !== undefined && jsonContentProblem( inline, '--post_content' );
		if ( jsonProblem ) {
			return { problems: [ ...problems, jsonProblem ], command };
		}
		if ( ! inline?.includes( '<!-- wp:' ) || ! command.includes( inline ) ) {
			return { problems, command };
		}
		await mkdir( path.join( siteRoot, 'tmp' ), { recursive: true } );
		const scratch = path.join(
			siteRoot,
			'tmp',
			`post-content-${ hash( inline ).slice( 0, 12 ) }.html`
		);
		await writeFile( scratch, inline, 'utf8' );
		try {
			const result = await this.validateFile( scratch, siteRoot ).catch( () => undefined );
			if ( result?.problem ) {
				problems.push( result.problem.split( path.basename( scratch ) ).join( '--post_content' ) );
			}
			const fixed = await readFile( scratch, 'utf8' );
			return { problems, command: fixed === inline ? command : command.replace( inline, fixed ) };
		} finally {
			await rm( scratch, { force: true } );
		}
	}

	/** The validation of a file's current content, reusing the last one when it still holds. */
	private async resultFor(
		filePath: string,
		siteRoot: string
	): Promise< FileValidation | undefined > {
		const tracked = this.files.get( filePath ) ?? { siteRoot };
		let result = tracked.running ? await tracked.running : tracked.result;
		const current = await readFile( filePath, 'utf8' );
		if ( ! result || result.contentHash !== hash( current ) ) {
			result = await this.validateFile( filePath, siteRoot ).catch( () => undefined );
		}
		tracked.running = undefined;
		tracked.result = result;
		tracked.reported = result && `${ result.contentHash } ${ result.summary }`;
		this.files.set( filePath, tracked );
		return result;
	}
}

async function validateWithRunningSite(
	filePath: string,
	siteRoot: string
): Promise< FileValidation | undefined > {
	const site = await getSiteByFolder( siteRoot );
	if ( ! ( await isServerRunning( site.id ) ) ) {
		return undefined;
	}
	return validateBlockMarkupFile( filePath, getSiteUrl( site ) );
}

/** A validation that could not run is reported, so a file is never passed over in silence. */
function notValidated(
	filePath: string,
	content: string | undefined,
	error: unknown
): FileValidation {
	const label = filePath.split( path.sep ).slice( -2 ).join( '/' );
	return {
		contentHash: hash( content ?? '' ),
		summary: `${ label }: not validated (${
			error instanceof Error ? error.message : String( error )
		})`,
	};
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
