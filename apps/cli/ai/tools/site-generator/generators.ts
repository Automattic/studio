import fs from 'fs';
import path from 'path';
import { getSkillsRoot } from 'cli/ai/skills';
import { completeText, extractJson, stripCodeFences } from './llm';
import { parseManifest, type SiteManifest } from './manifest';
import { assertCompleteBlockMarkup, normalizeGeneratedThemeJson } from './theme-guards';

/**
 * Loads and runs the generator prompt fragments bundled under
 * `skills/site-generator/generators/`. Each fragment is a system-prompt body
 * adapted from a Telex generator; the tool appends the site spec + chosen
 * design + a per-call task. `_shared` is prepended to every call.
 */

function generatorsDir(): string {
	return path.join( getSkillsRoot(), 'site-generator', 'generators' );
}

const fragmentCache = new Map< string, string >();

function loadFragment( name: string ): string {
	const cached = fragmentCache.get( name );
	if ( cached !== undefined ) {
		return cached;
	}
	const file = path.join( generatorsDir(), `${ name }.md` );
	if ( ! fs.existsSync( file ) ) {
		throw new Error(
			`Generator prompt fragment not found: ${ name } (${ file }). Is the wordpress-site-generator bundle installed?`
		);
	}
	const content = fs.readFileSync( file, 'utf8' );
	fragmentCache.set( name, content );
	return content;
}

export interface RunGeneratorInput {
	name: string;
	specJson: string;
	design?: string;
	themeJson?: string;
	task?: string;
	maxTokens?: number;
	temperature?: number;
}

export async function runGenerator( input: RunGeneratorInput ): Promise< string > {
	const shared = loadFragment( '_shared' );
	const fragment = loadFragment( input.name );
	const system = `${ shared }\n\n----------\n\n${ fragment }`;

	let user = `SITE SPEC (JSON):\n${ input.specJson }`;
	if ( input.design ) {
		user += `\n\nCHOSEN DESIGN DIRECTION:\n${ input.design }`;
	}
	if ( input.themeJson ) {
		user += `\n\nGENERATED THEME.JSON (AUTHORITATIVE DESIGN TOKENS):\n${ input.themeJson }`;
	}
	if ( input.task ) {
		user += `\n\nTASK:\n${ input.task }`;
	}

	return stripCodeFences(
		await completeText( {
			system,
			user,
			maxTokens: input.maxTokens,
			temperature: input.temperature,
		} )
	);
}

export const THEME_JSON_MAX_TOKENS = 12_000;
export const PAGE_CONTENT_MAX_TOKENS = 16_000;

function isInvalidThemeJsonError( error: unknown ): boolean {
	return (
		error instanceof Error && error.message.startsWith( 'Generated theme.json is invalid JSON:' )
	);
}

export async function runThemeJsonGenerator(
	specJson: string,
	design?: string
): Promise< string > {
	const attempts: Array< { task?: string; temperature: number } > = [
		{ temperature: 0.4 },
		{
			temperature: 0.2,
			task: 'The previous theme.json output did not parse, likely because it was too long or truncated. Return a compact, complete, valid JSON document only. Keep the required semantic tokens and required high-impact block defaults, drop optional embellishments, and close every object/array.',
		},
	];
	let lastInvalidJsonError: unknown;

	for ( const attempt of attempts ) {
		try {
			return normalizeGeneratedThemeJson(
				await runGenerator( {
					name: 'theme-json',
					specJson,
					design,
					task: attempt.task,
					maxTokens: THEME_JSON_MAX_TOKENS,
					temperature: attempt.temperature,
				} )
			).json;
		} catch ( error ) {
			if ( ! isInvalidThemeJsonError( error ) ) {
				throw error;
			}
			lastInvalidJsonError = error;
		}
	}

	throw lastInvalidJsonError;
}

function isIncompleteBlockMarkupError( error: unknown ): boolean {
	return error instanceof Error && error.message.startsWith( 'Generated page content ' );
}

export async function runPageContentGenerator( input: {
	specJson: string;
	design?: string;
	themeJson?: string;
	task: string;
} ): Promise< string > {
	const retryTask =
		'The previous page body was incomplete or structurally invalid, likely because it was too long or truncated. Return compact but complete WordPress block markup only: 4-5 finished sections, every wp:block opened must be closed, no dangling HTML comments or tags.';
	const attempts: Array< { task: string; temperature: number } > = [
		{ task: input.task, temperature: 0.6 },
		{ task: `${ input.task }\n\n${ retryTask }`, temperature: 0.4 },
	];
	let lastIncompleteMarkupError: unknown;

	for ( const attempt of attempts ) {
		try {
			const markup = await runGenerator( {
				name: 'page-content',
				specJson: input.specJson,
				design: input.design,
				themeJson: input.themeJson,
				task: attempt.task,
				maxTokens: PAGE_CONTENT_MAX_TOKENS,
				temperature: attempt.temperature,
			} );
			assertCompleteBlockMarkup( markup, 'Generated page content' );
			return markup;
		} catch ( error ) {
			if ( ! isIncompleteBlockMarkupError( error ) ) {
				throw error;
			}
			lastIncompleteMarkupError = error;
		}
	}

	throw lastIncompleteMarkupError;
}

export async function runManifest( specJson: string ): Promise< SiteManifest > {
	// Generous budget: the manifest carries a cinematic composition brief per
	// page, so a small cap truncates the JSON mid-stream (no closing fence/brace)
	// and the parse fails.
	const raw = await runGenerator( {
		name: 'manifest',
		specJson,
		maxTokens: 16_000,
		temperature: 0.2,
	} );
	return parseManifest( raw );
}

export interface GeneratedBlockFiles {
	files: Record< string, string >;
}

export async function runBlockGenerator(
	specJson: string,
	blockTask: string,
	themeJson?: string
): Promise< GeneratedBlockFiles > {
	const raw = await runGenerator( {
		name: 'block',
		specJson,
		themeJson,
		task: blockTask,
		maxTokens: 16_000,
		temperature: 0.3,
	} );
	let data: unknown;
	try {
		data = JSON.parse( extractJson( raw ) );
	} catch ( error ) {
		throw new Error(
			`Block generator did not return valid JSON: ${
				error instanceof Error ? error.message : String( error )
			}`
		);
	}
	const filesValue = ( data as { files?: unknown } )?.files;
	if ( ! filesValue || typeof filesValue !== 'object' ) {
		throw new Error( 'Block generator JSON is missing a "files" object.' );
	}
	const files: Record< string, string > = {};
	for ( const [ key, value ] of Object.entries( filesValue as Record< string, unknown > ) ) {
		if ( typeof value === 'string' ) {
			files[ key ] = value;
		}
	}
	if ( ! Object.keys( files ).length ) {
		throw new Error( 'Block generator produced no files.' );
	}
	return { files };
}
