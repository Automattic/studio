/**
 * WSG eval harness — deterministic, agent-free runner.
 *
 * Drives the WordPress site-generator pipeline (manifest → design → theme →
 * companion plugin → seed → images → validate → screenshot) end-to-end against
 * throwaway `wsg-eval-*` sites by calling the tool handlers directly (no LLM
 * deciding steps), and writes a quality + timing scorecard per spec.
 *
 * Run with `npm run eval:wsg` (builds the CLI, then executes this entry).
 * Requires WordPress.com login (`studio auth login`) or `STUDIO_WPCOM_TOKEN`.
 */

import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { resolveAiEnvironment, resolveInitialAiProvider } from 'cli/ai/auth';
import { runCase } from './pipeline';
import { summarize, type CaseResult } from './scorecard';
import { loadSpecs } from './specs';

interface CliArgs {
	caseIds: string[];
	dryRun: boolean;
	withImages: boolean;
	merged: boolean;
	keepSite: boolean;
	specsDir: string;
	outDir: string;
	help: boolean;
}

function parseArgs( argv: string[] ): CliArgs {
	const args: CliArgs = {
		caseIds: [],
		dryRun: false,
		withImages: true,
		merged: false,
		keepSite: false,
		specsDir: path.resolve( process.cwd(), 'eval/wsg/specs' ),
		outDir: path.resolve( process.cwd(), 'eval/wsg/results' ),
		help: false,
	};
	for ( let i = 0; i < argv.length; i++ ) {
		const arg = argv[ i ];
		switch ( arg ) {
			case '--dry-run':
				args.dryRun = true;
				break;
			case '--no-images':
				args.withImages = false;
				break;
			case '--merged':
				args.merged = true;
				break;
			case '--keep-site':
				args.keepSite = true;
				break;
			case '--specs-dir':
				args.specsDir = path.resolve( process.cwd(), argv[ ++i ] ?? '' );
				break;
			case '--out-dir':
				args.outDir = path.resolve( process.cwd(), argv[ ++i ] ?? '' );
				break;
			case '-h':
			case '--help':
				args.help = true;
				break;
			default:
				if ( arg.startsWith( '--' ) ) {
					throw new Error( `Unknown flag: ${ arg }` );
				}
				args.caseIds.push( arg );
		}
	}
	return args;
}

const HELP = `WSG eval harness — runs the site-generator pipeline against throwaway sites.

Usage: node apps/cli/dist/cli/eval-wsg.mjs [caseId...] [flags]

Args:
  caseId...        Run only these spec caseIds (default: all specs in --specs-dir)

Flags:
  --dry-run        Validate specs and print the plan; do not create sites or call tools (no login needed)
  --no-images      Skip AI image generation (faster, cheaper iteration loops)
  --keep-site      Do not delete the throwaway site after a run (for debugging)
  --specs-dir DIR  Specs directory (default: eval/wsg/specs)
  --out-dir DIR    Results directory (default: eval/wsg/results)
  -h, --help       Show this help

Prerequisites: npm run cli:build, then logged into WordPress.com (or STUDIO_WPCOM_TOKEN set).`;

async function preflightAuth(): Promise< void > {
	const provider = await resolveInitialAiProvider();
	const env = await resolveAiEnvironment( provider );
	if ( ! env.ANTHROPIC_AUTH_TOKEN?.trim() && ! env.ANTHROPIC_API_KEY?.trim() ) {
		throw new Error(
			'No AI credentials resolved. Run `studio auth login` (or set STUDIO_WPCOM_TOKEN), then retry. Use --dry-run to validate specs without credentials.'
		);
	}
}

function printSummaryTable( cases: CaseResult[] ): void {
	const rows = cases.map( ( c ) => ( {
		case: c.caseId,
		ok: c.ok ? 'yes' : 'NO',
		wpHtml: c.coreBlocks?.totalWpHtml ?? 0,
		coreBlocks: c.coreBlocks?.totalBlocks ?? 0,
		customBlocks: `${ c.customBlocks?.generated.length ?? 0 }/${
			c.customBlocks?.planned.length ?? 0
		}`,
		inputCptGaps: c.customBlocks?.inputCptsWithoutBlock.length ?? 0,
		idViolations: c.identifierViolations?.length ?? 0,
		cptUnreg: c.cptsNotRegistered?.length ?? 0,
		expectFails: c.expectationsFailed?.length ?? 0,
		errors: c.errors.length,
		seconds: Math.round( Object.values( c.stageTimingsMs ).reduce( ( a, b ) => a + b, 0 ) / 1000 ),
	} ) );

	console.table( rows );
}

async function main(): Promise< void > {
	const args = parseArgs( process.argv.slice( 2 ) );
	if ( args.help ) {
		process.stdout.write( HELP + '\n' );
		return;
	}

	const specs = loadSpecs( args.specsDir, args.caseIds );
	if ( specs.length === 0 ) {
		throw new Error( `No specs found in ${ args.specsDir }.` );
	}

	if ( args.dryRun ) {
		process.stdout.write( `Dry run — ${ specs.length } spec(s) validated:\n` );
		for ( const spec of specs ) {
			process.stdout.write(
				`  - ${ spec.caseId }: "${ spec.spec.name }" (${ spec.spec.type ?? 'site' }), ${
					spec.spec.pages?.length ?? 0
				} page(s)${ spec.expects ? `, expects ${ JSON.stringify( spec.expects ) }` : '' }\n`
			);
		}
		process.stdout.write(
			`\nPlan per spec: createSite → manifest → designPreviews → theme → companionPlugin → seed${
				args.withImages ? ' → images' : ' (images skipped)'
			} → validate → screenshot → teardown\n`
		);
		return;
	}

	await preflightAuth();

	const runId = new Date().toISOString().replace( /[:.]/g, '-' );
	const runDir = path.join( args.outDir, runId );
	await mkdir( runDir, { recursive: true } );
	process.stdout.write( `WSG eval run ${ runId } — ${ specs.length } spec(s) → ${ runDir }\n` );

	const results: CaseResult[] = [];
	for ( const spec of specs ) {
		const result = await runCase( spec, {
			runId,
			withImages: args.withImages,
			merged: args.merged,
			keepSite: args.keepSite,
			artifactsDir: runDir,
			log: ( message ) => process.stdout.write( message + '\n' ),
		} );
		results.push( result );
		await writeFile(
			path.join( runDir, `${ spec.caseId }.json` ),
			JSON.stringify( result, null, 2 )
		);
	}

	const summary = summarize( runId, results );
	await writeFile( path.join( runDir, 'summary.json' ), JSON.stringify( summary, null, 2 ) );

	process.stdout.write(
		`\nWSG eval summary (${ summary.passed }/${ summary.total } ran clean):\n`
	);
	printSummaryTable( results );
	process.stdout.write( `\nScorecards: ${ runDir }\n` );

	// Tools hold daemon/socket handles open past completion; exit explicitly so
	// the process doesn't hang (mirrors eval-runner.ts).
	process.exit( summary.failed > 0 ? 1 : 0 );
}

main().catch( ( error ) => {
	process.stderr.write(
		`[eval-wsg] ${ error instanceof Error ? error.stack ?? error.message : String( error ) }\n`
	);
	process.exit( 1 );
} );
