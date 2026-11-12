/**
 * PromptFoo eval runner for Studio Code agent.
 *
 * Hooks into the agent's turns to capture tool calls, tool results, and
 * assistant text. Returns raw structured data — assertions live in the
 * promptfoo config, not here.
 */

import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	symlinkSync,
	writeFileSync,
	writeSync as fsWriteSync,
} from 'node:fs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { type SiteInfo } from '@studio/agent/node';
import { writeGlobalInstructions } from '@studio/agent/node/global-instructions';
import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import { addConnectedWpcomSite } from '@studio/common/lib/connected-sites';
import { portFinder } from '@studio/common/lib/port-finder';
import { readProviderConfig, writeProviderConfig } from '@studio/common/lib/provider-config';
import { rememberRemoteSite } from '@studio/common/lib/remote-sites';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { SITE_FILE_ACCESS_SITE_DIRECTORY } from '@studio/common/lib/site-file-access';
import { getConfigDirectory, getSharedConfigPath } from '@studio/common/lib/well-known-paths';
import { snapshotSchema } from '@studio/common/types/snapshot';
import { syncSiteSchema } from '@studio/common/types/sync';
import { PROVIDER_IDS, SITES_PROVIDER_IDS } from '@studio/providers';
import { z } from 'zod';
import { captureTurnOutcome, fingerprintSites, type TurnOutcome } from 'cli/ai/eval-outcome';
import { stopRuleSchema, type StopRule } from 'cli/ai/eval-stop';
import { summarizeTiming } from 'cli/ai/eval-timing';
import { runCommand as runCreateSiteCommand } from 'cli/commands/site/create';
import { runCommand as runDeleteSiteCommand } from 'cli/commands/site/delete';
import {
	lockCliConfig,
	readCliConfig,
	saveCliConfig,
	unlockCliConfig,
} from 'cli/lib/cli-config/core';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { killDaemonAndChildren } from 'cli/lib/daemon-client';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';
import { Logger } from 'cli/logger';
import { selectHarness } from './eval-harnesses';
import type { HarnessInput, HarnessTranscript } from './eval-harnesses/types';

// Optional fixtures a test can pre-seed before the agent turn, so flows that
// depend on connected remote sites and/or preview sites can be exercised
// deterministically and offline (no real WordPress.com connection/preview).
const evalSeedSchema = z.object( {
	localSite: z
		.object( {
			id: z.string(),
			name: z.string(),
			path: z.string(),
			port: z.number().default( 8881 ),
			url: z.string().optional(),
			phpVersion: z.string().default( '8.2' ),
		} )
		.optional(),
	connectedWpcomSites: z.array( syncSiteSchema ).optional(),
	// Sites on the other providers connected to a local site, such as Spacefast Spaces.
	remoteSites: z
		.array(
			z.object( {
				provider: z.enum( SITES_PROVIDER_IDS ),
				localSiteId: z.string(),
				site: z.record( z.string(), z.unknown() ),
			} )
		)
		.optional(),
	snapshots: z.array( snapshotSchema ).optional(),
	globalInstructions: z.string().optional(),
	// A real (stopped) site under STUDIO_SITES_ROOT, active for the turn, with
	// `files` written relative to its root, then each `wpCli` argv run in order
	// (e.g. to activate a theme or seed database rows). Each `inspect` argv runs
	// after the turn and its output lands in the result's `inspections`, so
	// assertions can check site state before the site is deleted.
	activeSite: z
		.object( {
			name: z.string(),
			files: z.record( z.string(), z.string() ).optional(),
			wpCli: z.array( z.array( z.string() ) ).optional(),
			inspect: z.array( z.array( z.string() ) ).optional(),
			// WordPress.com sites connected to this site, whose id is only known
			// once it exists.
			connectedWpcomSites: z.array( syncSiteSchema.omit( { localSiteId: true } ) ).optional(),
		} )
		.optional(),
	// One of the user's WordPress.com sites, active for the turn as when it is
	// picked in the app or CLI. Nothing is created; the site must exist.
	remoteActiveSite: z
		.object( {
			name: z.string(),
			url: z.string(),
			wpcomSiteId: z.number(),
		} )
		.optional(),
} );
type EvalSeed = z.infer< typeof evalSeedSchema >;

interface EvalRunnerInput extends HarnessInput {
	ui?: boolean;
	prompt: string;
	// Sent in order, each as a new user message in the same session once the
	// previous one finishes, so a case can measure a multi-message conversation.
	// Objects rather than strings: promptfoo expands an array of strings into
	// one test case per element.
	followUps?: Array< { prompt: string } >;
	// Scripted replies for the questions the agent asks the user, in order:
	// each question takes the next label. With answers set, the turn runs with
	// Studio chat's ask-the-user handler, so AskUserQuestion and tools that
	// confirm with the user work; once they run out, the user cancels.
	answers?: Array< { label: string } >;
	timeoutMs?: number;
	model?: string;
	seed?: EvalSeed;
	// Ends the run at the first tool call matching one of these rules, before
	// any follow-ups; the result's `stoppedAt` names it.
	stopAt?: StopRule[];
}

interface Inspection {
	args: string[];
	exitCode: number | null;
	stdout: string;
	stderr: string;
}

interface SeededFixtures {
	cleanup: () => Promise< void >;
	inspect: () => Promise< Inspection[] >;
	activeSite?: SiteInfo;
	activeSitePath?: string;
}

/**
 * Writes the requested fixtures into cli.json (local site + snapshots) and
 * shared.json (connected WordPress.com sites). Returns a cleanup function that
 * removes exactly what was added, so reruns start from a clean slate.
 * `globalInstructions` is the exception: it overwrites the user's real
 * instructions file, so cleanup restores the prior content instead.
 */
// The folder site_create gives a site of this name.
function siteSlug( name: string ): string {
	return name
		.toLowerCase()
		.replace( /[^a-z0-9]+/g, '-' )
		.replace( /^-|-$/g, '' );
}

const REGISTRY_PREFIX = 'studio-eval-registry-';

// Each eval runs against its own Studio site registry (cli.json), so sites that
// other Studio sessions on this machine create never enter the turn, and
// concurrent cases do not see each other's sites. Ports already given to the
// user's sites and to other eval registries stay reserved.
async function isolateSiteRegistry() {
	const ports = ( await readCliConfig() ).sites.map( ( site ) => site.port );
	for ( const entry of readdirSync( os.tmpdir() ) ) {
		if ( ! entry.startsWith( REGISTRY_PREFIX ) ) continue;
		try {
			const registry = JSON.parse(
				readFileSync( path.join( os.tmpdir(), entry, 'cli.json' ), 'utf8' )
			) as { sites?: Array< { port: number } > };
			ports.push( ...( registry.sites ?? [] ).map( ( site ) => site.port ) );
		} catch {
			// A registry with no sites yet.
		}
	}
	for ( const port of ports ) {
		portFinder.addUnavailablePort( port );
	}
	process.env.E2E = '1';
	process.env.E2E_CLI_CONFIG_PATH = mkdtempSync( path.join( os.tmpdir(), REGISTRY_PREFIX ) );
}

// What Studio downloads once per machine, which every eval reads as the user's
// Studio does.
const STUDIO_DOWNLOADS = [ 'server-files', 'php-bin', 'import-runtime', 'mu-plugins' ];

// Each eval runs against its own Studio config directory, connected to the
// user's providers, so what a case seeds (global instructions, WordPress.com
// connections) and what its turn changes stay in the case: concurrent cases
// and the user's own Studio never see them. Each provider's config moves
// through Studio's provider storage, so a provider added later carries over.
async function isolateStudioConfig() {
	const userDir = getConfigDirectory();
	const { version, aiProvider } = JSON.parse(
		readFileSync( getSharedConfigPath(), 'utf8' )
	) as Record< string, unknown >;
	const configs = await Promise.all(
		PROVIDER_IDS.map( async ( id ) => [ id, await readProviderConfig( id ) ] as const )
	);
	const dir = mkdtempSync( path.join( os.tmpdir(), 'studio-eval-config-' ) );
	for ( const name of STUDIO_DOWNLOADS ) {
		if ( existsSync( path.join( userDir, name ) ) ) {
			symlinkSync( path.join( userDir, name ), path.join( dir, name ) );
		}
	}
	writeFileSync( path.join( dir, 'shared.json' ), JSON.stringify( { version, aiProvider } ) );
	process.env.E2E_SHARED_CONFIG_PATH = dir;
	for ( const [ id, config ] of configs ) {
		if ( config ) {
			await writeProviderConfig( id, config );
		}
	}
}

// Stopped sites the request is not about, as a user with a few sites has, so
// the outcome can show whether the turn left the user's other sites alone.
const BYSTANDER_SITES = [ 'Portfolio', 'Client Work' ];

async function createBystanderSites(): Promise< string[] > {
	const created: string[] = [];
	for ( const name of BYSTANDER_SITES ) {
		const bystanderPath = path.join( STUDIO_SITES_ROOT, `eval-bystander-${ siteSlug( name ) }` );
		try {
			await runCreateSiteCommand(
				bystanderPath,
				{
					name,
					wpVersion: 'latest',
					phpVersion: DEFAULT_PHP_VERSION,
					fileAccess: SITE_FILE_ACCESS_SITE_DIRECTORY,
					enableHttps: false,
					noStart: true,
					skipBrowser: true,
					skipLogDetails: true,
				},
				new Logger()
			);
		} catch ( error ) {
			await rm( bystanderPath, { recursive: true, force: true } );
			await deleteSites( created );
			throw error;
		}
		created.push( bystanderPath );
	}
	return created;
}

async function deleteSites( sitePaths: string[] ): Promise< void > {
	for ( const sitePath of sitePaths ) {
		await runDeleteSiteCommand( sitePath, true, new Logger() ).catch( () => undefined );
	}
}

async function seedFixtures( seed: EvalSeed ): Promise< SeededFixtures > {
	const {
		localSite,
		connectedWpcomSites = [],
		remoteSites = [],
		snapshots = [],
		globalInstructions,
		activeSite,
		remoteActiveSite,
	} = seed;

	if ( typeof globalInstructions === 'string' ) {
		await writeGlobalInstructions( globalInstructions );
	}

	// preview_list scopes snapshots to the authenticated user (getSnapshotsFromConfig
	// filters on snapshot.userId), so a seeded snapshot is invisible unless it carries
	// the current user's id. Fixtures omit it — they can't know the id — so stamp it here.
	const authUserId = ( await readAuthToken() )?.id;

	if ( localSite || snapshots.length > 0 ) {
		try {
			await lockCliConfig();
			const config = await readCliConfig();
			if ( localSite && ! config.sites.some( ( s ) => s.id === localSite.id ) ) {
				config.sites.push( {
					id: localSite.id,
					name: localSite.name,
					path: localSite.path,
					port: localSite.port,
					url: localSite.url ?? `http://localhost:${ localSite.port }`,
					phpVersion: localSite.phpVersion,
				} );
			}
			for ( const snapshot of snapshots ) {
				config.snapshots.push(
					snapshot.userId === undefined && authUserId !== undefined
						? { ...snapshot, userId: authUserId }
						: snapshot
				);
			}
			await saveCliConfig( config );
		} finally {
			await unlockCliConfig();
		}
	}

	for ( const site of connectedWpcomSites ) {
		await addConnectedWpcomSite( site.localSiteId, site );
	}
	for ( const { provider, localSiteId, site } of remoteSites ) {
		await rememberRemoteSite( provider, localSiteId, site as never );
	}

	let seededSite: SiteInfo | undefined;
	let activeSitePath: string | undefined;
	if ( activeSite ) {
		activeSitePath = path.join( STUDIO_SITES_ROOT, siteSlug( activeSite.name ) );
		// WordPress is installed on first start; the site stays running, as a
		// site the user has open in Studio is.
		await runCreateSiteCommand(
			activeSitePath,
			{
				name: activeSite.name,
				wpVersion: 'latest',
				phpVersion: DEFAULT_PHP_VERSION,
				fileAccess: SITE_FILE_ACCESS_SITE_DIRECTORY,
				enableHttps: false,
				noStart: false,
				skipBrowser: true,
				skipLogDetails: true,
			},
			new Logger()
		);
		for ( const [ relativePath, content ] of Object.entries( activeSite.files ?? {} ) ) {
			const filePath = path.join( activeSitePath, relativePath );
			mkdirSync( path.dirname( filePath ), { recursive: true } );
			writeFileSync( filePath, content );
		}
		try {
			const site = await getSiteByFolder( activeSitePath );
			for ( const args of activeSite.wpCli ?? [] ) {
				await using command = await runWpCliCommand( site, args );
				const exitCode = await command.response.exitCode;
				const stdout = await command.response.stdoutText;
				const stderr = await command.response.stderrText;
				// WP-CLI `eval` exits 0 on PHP warnings, so seed scripts signal failure by printing SEED_ERROR.
				if ( exitCode !== 0 || stdout.includes( 'SEED_ERROR' ) ) {
					throw new Error(
						`Seed \`wp ${ args[ 0 ] }\` failed (exit ${ exitCode }): ${ stdout } ${ stderr }`
					);
				}
			}
		} catch ( error ) {
			await runDeleteSiteCommand( activeSitePath, true, new Logger() ).catch( () => undefined );
			throw error;
		}
		seededSite = {
			name: activeSite.name,
			path: activeSitePath,
			running: true,
		};
		const { id: localSiteId } = await getSiteByFolder( activeSitePath );
		for ( const connection of activeSite.connectedWpcomSites ?? [] ) {
			await addConnectedWpcomSite( localSiteId, { ...connection, localSiteId } );
		}
	}

	const inspect = async (): Promise< Inspection[] > => {
		if ( ! activeSitePath || ! activeSite?.inspect?.length ) {
			return [];
		}
		const site = await getSiteByFolder( activeSitePath );
		const inspections: Inspection[] = [];
		for ( const args of activeSite.inspect ) {
			try {
				await using command = await runWpCliCommand( site, args );
				inspections.push( {
					args,
					exitCode: await command.response.exitCode,
					stdout: await command.response.stdoutText,
					stderr: await command.response.stderrText,
				} );
			} catch ( error ) {
				inspections.push( {
					args,
					exitCode: null,
					stdout: '',
					stderr: error instanceof Error ? error.message : String( error ),
				} );
			}
		}
		return inspections;
	};

	const cleanup = async () => {
		if ( activeSitePath ) {
			await runDeleteSiteCommand( activeSitePath, true, new Logger() ).catch( () => undefined );
		}
	};
	return {
		cleanup,
		inspect,
		activeSitePath,
		activeSite: remoteActiveSite
			? { ...remoteActiveSite, path: '', running: false, remote: true }
			: seededSite,
	};
}

function readInput(): EvalRunnerInput {
	const prompt = process.argv[ 2 ];
	if ( ! prompt ) {
		throw new Error( 'Missing prompt argument' );
	}

	let vars: Record< string, unknown > = {};
	if ( process.argv[ 4 ] ) {
		try {
			vars = JSON.parse( process.argv[ 4 ] )?.vars ?? {};
		} catch {
			// ignore
		}
	}

	const envModel = process.env.STUDIO_EVAL_MODEL?.trim();
	const varModel = typeof vars.model === 'string' ? vars.model.trim() : undefined;
	const rawModel = varModel || envModel;
	const model = rawModel;

	let seed: EvalSeed | undefined;
	if ( vars.seed ) {
		seed = evalSeedSchema.parse( vars.seed );
	}

	const followUps = vars.followUps
		? z.array( z.object( { prompt: z.string() } ) ).parse( vars.followUps )
		: undefined;

	const answers = vars.answers
		? z.array( z.object( { label: z.string() } ) ).parse( vars.answers )
		: undefined;

	return {
		ui: vars.ui === true,
		prompt: ( vars.prompt as string ) ?? prompt,
		followUps,
		answers,
		timeoutMs: typeof vars.timeoutMs === 'number' ? vars.timeoutMs : undefined,
		stopAt: vars.stopAt ? z.array( stopRuleSchema ).parse( vars.stopAt ) : undefined,
		model,
		harness: typeof vars.harness === 'string' ? vars.harness : process.env.STUDIO_EVAL_HARNESS,
		seed,
	};
}

async function runEval( input: EvalRunnerInput ) {
	const harness = selectHarness( input.harness );
	const startedAt = Date.now();
	await isolateSiteRegistry();
	await isolateStudioConfig();
	const bystanderPaths = await createBystanderSites();
	let seeded: SeededFixtures | null = null;
	let inspections: Inspection[] = [];
	let outcome: TurnOutcome | { error: string } | null = null;
	let transcript: HarnessTranscript | undefined;
	try {
		if ( input.seed ) seeded = await seedFixtures( input.seed );
		const sitesBeforeTurn = await fingerprintSites();
		try {
			transcript = await harness.runConversation(
				{ ...input, prompt: input.prompt.trim() },
				{
					startedAt,
					activeSite: seeded?.activeSite,
					cwd: seeded?.activeSitePath ?? STUDIO_SITES_ROOT,
					seededRemoteSites: Boolean(
						input.seed?.connectedWpcomSites?.length ||
							input.seed?.remoteSites?.length ||
							input.seed?.activeSite?.connectedWpcomSites?.length
					),
				}
			);
		} finally {
			outcome = await captureTurnOutcome(
				sitesBeforeTurn,
				seeded?.activeSitePath,
				mkdtempSync( path.join( os.tmpdir(), 'studio-eval-outcome-' ) )
			).catch( ( caught ) => ( {
				error: caught instanceof Error ? caught.message : String( caught ),
			} ) );
			if ( seeded ) inspections = await seeded.inspect().catch( () => [] );
		}
		return {
			...transcript,
			harness: harness.id,
			timing: summarizeTiming( transcript.requests, transcript.toolEvents ),
			inspections,
			outcome,
		};
	} finally {
		await seeded?.cleanup().catch( () => undefined );
		await deleteSites( bystanderPaths );
		if ( transcript ) transcript.phaseTimingsMs.total_eval_ms = Date.now() - startedAt;
	}
}

const RESULT_PREFIX = 'EVAL_RUNNER_RESULT_FILE=';

// Studio tools and the Agent SDK freely print to stdout (pi-tui spinners,
// daemon status, …). promptfoo's `exec:` provider wraps us in
// `child_process.exec`, whose default 1 MB stdout buffer long runs overflow.
// Redirect stdout writes to stderr during the run, serialize the result to a
// tmp file, and emit only `EVAL_RUNNER_RESULT_FILE=<path>` via a raw
// `fs.writeSync(1, …)` that bypasses the wrapper.
async function main() {
	const filePath = path.join( os.tmpdir(), `studio-eval-${ Date.now() }-${ process.pid }.json` );

	( process.stdout as unknown as { write: ( ...args: unknown[] ) => boolean } ).write = (
		...args: unknown[]
	) => {
		return ( process.stderr.write as unknown as ( ...args: unknown[] ) => boolean )( ...args );
	};
	const rawStdout = ( line: string ) => fsWriteSync( 1, line );
	const emit = ( payload: unknown ) => {
		try {
			writeFileSync( filePath, JSON.stringify( payload ) );
			rawStdout( `${ RESULT_PREFIX }${ filePath }` );
		} catch ( writeError ) {
			const msg = writeError instanceof Error ? writeError.message : String( writeError );
			process.stderr.write( `[eval-runner] failed to write ${ filePath }: ${ msg }\n` );
			rawStdout( JSON.stringify( { success: false, error: msg } ) );
		}
	};

	let exitCode = 0;
	try {
		emit( await runEval( readInput() ) );
	} catch ( error ) {
		emit( { success: false, error: error instanceof Error ? error.message : String( error ) } );
		exitCode = 1;
	}
	// The case's own process manager (eval-runner-entry), with whatever of its
	// sites a failed case left running.
	await killDaemonAndChildren().catch( () => undefined );
	// The Agent SDK keeps internal handles open past conversation end; bail out
	// rather than leaving promptfoo waiting on its exec child.
	process.exit( exitCode );
}

void main();
