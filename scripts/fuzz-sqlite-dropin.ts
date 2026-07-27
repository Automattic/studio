#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteIntegrationProvider } from '../packages/common/lib/sqlite-integration.ts';

type CaseResult = {
	id: string;
	operation: string;
	passed: boolean;
	expected: Record< string, unknown >;
	observed: Record< string, unknown >;
	durationMs: number;
	error?: string;
};

const root = resolve( dirname( fileURLToPath( import.meta.url ) ), '..' );
const seed = process.env.HOMEBOY_FUZZ_SEED || '3692';
const runId = process.env.HOMEBOY_FUZZ_RUN_ID || seed;
const resultsFile = process.env.HOMEBOY_FUZZ_RESULTS_FILE;
const artifactsDir = resultsFile
	? resolve( process.env.HOMEBOY_FUZZ_ARTIFACTS_DIR || '' )
	: resolve( root, 'artifacts', 'db-dropin-fuzz', runId );
const scratchRoot = mkdtempSync( join( tmpdir(), 'studio-db-dropin-fuzz-' ) );
const sourcePath = join( scratchRoot, 'source' );
const stockMarker = 'This file is auto-generated and copied from the sqlite plugin.';
const stockDropin = `<?php\n// ${ stockMarker }\ndefine( 'SQLITE_DB_DROPIN_VERSION', 'test' );\n'{SQLITE_IMPLEMENTATION_FOLDER_PATH}';\n`;

if ( resultsFile && ! process.env.HOMEBOY_FUZZ_ARTIFACTS_DIR ) {
	throw new Error( 'HOMEBOY_FUZZ_ARTIFACTS_DIR is required with HOMEBOY_FUZZ_RESULTS_FILE.' );
}

mkdirSync( sourcePath, { recursive: true } );
writeFileSync( join( sourcePath, 'db.copy' ), stockDropin );
writeFileSync( join( sourcePath, 'load.php' ), '<?php\n/** Version: test */\n' );

class FuzzSqliteProvider extends SqliteIntegrationProvider {
	getSqliteDirname(): string {
		return 'sqlite-database-integration';
	}

	protected getSqlitePluginSourcePath(): string {
		return sourcePath;
	}
}

const provider = new FuzzSqliteProvider();
const results: CaseResult[] = [];

function writeJson( path: string, value: unknown ): void {
	mkdirSync( dirname( path ), { recursive: true } );
	writeFileSync( path, `${ JSON.stringify( value, null, 2 ) }\n` );
}

function hash( value: string ): string {
	return `sha256:${ createHash( 'sha256' ).update( value ).digest( 'hex' ) }`;
}

function seededNoise( index: number ): string {
	return createHash( 'sha256' ).update( `${ seed }:${ index }` ).digest( 'hex' ).slice( 0, 16 );
}

function sitePathFor( id: string ): string {
	const sitePath = join( scratchRoot, 'cases', id );
	mkdirSync( join( sitePath, 'wp-content' ), { recursive: true } );
	return sitePath;
}

async function runCase(
	id: string,
	operation: string,
	expected: Record< string, unknown >,
	run: ( sitePath: string ) => Promise< Record< string, unknown > >
): Promise< void > {
	const sitePath = sitePathFor( id );
	const started = performance.now();
	try {
		const observed = await run( sitePath );
		results.push( {
			id,
			operation,
			passed: JSON.stringify( observed ) === JSON.stringify( expected ),
			expected,
			observed,
			durationMs: Math.max( 1, Math.ceil( performance.now() - started ) ),
		} );
	} catch ( error ) {
		results.push( {
			id,
			operation,
			passed: false,
			expected,
			observed: { completed: false },
			durationMs: Math.max( 1, Math.ceil( performance.now() - started ) ),
			error: error instanceof Error ? `${ error.name }: ${ error.message }` : String( error ),
		} );
	}
}

function materializeSqliteArtifacts(
	sitePath: string,
	artifacts: { config: boolean; dropin: boolean; database: boolean; plugin: boolean }
): void {
	if ( artifacts.config ) {
		writeFileSync( join( sitePath, 'wp-config.php' ), '<?php // external database\n' );
	}
	if ( artifacts.dropin ) {
		writeFileSync( join( sitePath, 'wp-content', 'db.php' ), '<?php // foreign drop-in\n' );
	}
	if ( artifacts.database ) {
		mkdirSync( join( sitePath, 'wp-content', 'database' ), { recursive: true } );
		writeFileSync( join( sitePath, 'wp-content', 'database', '.ht.sqlite' ), '' );
	}
	if ( artifacts.plugin ) {
		mkdirSync( join( sitePath, 'wp-content', 'mu-plugins', 'sqlite-database-integration' ), {
			recursive: true,
		} );
	}
}

async function runClassificationCases(): Promise< void > {
	for ( const config of [ false, true ] ) {
		for ( let mask = 0; mask < 8; mask++ ) {
			const artifacts = {
				config,
				dropin: Boolean( mask & 1 ),
				database: Boolean( mask & 2 ),
				plugin: Boolean( mask & 4 ),
			};
			const id = `classify-config-${ Number( config ) }-artifacts-${ mask }`;
			await runCase(
				id,
				'classify-destination',
				{ needsSqliteSetup: ! config || mask > 0 },
				async ( sitePath ) => {
					materializeSqliteArtifacts( sitePath, artifacts );
					return { needsSqliteSetup: await provider.needsSqliteSetup( sitePath ) };
				}
			);
		}
	}
}

async function runContentCases(): Promise< void > {
	const contentCases = [
		{ id: 'absent', content: null, replace: true },
		{ id: 'empty', content: '', replace: true },
		{ id: 'foreign', content: '<?php class QM_DB {}\n', replace: true },
		{
			id: 'custom-define',
			content: "<?php define( 'SQLITE_DB_DROPIN_VERSION', 'custom' );\n",
			replace: false,
		},
		{
			id: 'stock-with-define',
			content: `<?php // ${ stockMarker }\ndefine( 'SQLITE_DB_DROPIN_VERSION', 'old' );\n`,
			replace: true,
		},
		{
			id: 'comment-only-token',
			content: '<?php // SQLITE_DB_DROPIN_VERSION is intentionally not defined\n',
			replace: true,
		},
		{
			id: 'string-only-token',
			content: "<?php $name = 'SQLITE_DB_DROPIN_VERSION';\n",
			replace: true,
		},
		{
			id: 'prefixed-identifier-token',
			content: '<?php $MY_SQLITE_DB_DROPIN_VERSION = true;\n',
			replace: true,
		},
		{ id: 'lowercase-token', content: '<?php // sqlite_db_dropin_version\n', replace: true },
		{ id: 'nul-bytes', content: '<?php\u0000foreign\u0000dropin\n', replace: true },
	];

	for ( let index = 0; index < 48; index++ ) {
		const noise = seededNoise( index );
		const mode = index % 3;
		contentCases.push( {
			id: `generated-token-spoof-${ index }`,
			content:
				mode === 0
					? `<?php /* ${ noise } SQLITE_DB_DROPIN_VERSION ${ noise } */\n`
					: mode === 1
					? `<?php $value = "${ noise } SQLITE_DB_DROPIN_VERSION ${ noise }";\n`
					: `<?php $${ noise }_SQLITE_DB_DROPIN_VERSION = false;\n`,
			replace: true,
		} );
	}

	for ( const contentCase of contentCases ) {
		await runCase(
			`content-${ contentCase.id }`,
			'classify-dropin',
			{ replace: contentCase.replace },
			async ( sitePath ) => {
				if ( contentCase.content !== null ) {
					writeFileSync( join( sitePath, 'wp-content', 'db.php' ), contentCase.content );
				}
				return { replace: await provider.shouldReplaceDbDropin( sitePath ) };
			}
		);
	}
}

async function runInstallCases(): Promise< void > {
	const installCases = [
		{ id: 'absent', content: null, preserved: false },
		{ id: 'foreign', content: '<?php class QM_DB {}\n', preserved: false },
		{ id: 'stock', content: `<?php // ${ stockMarker }\n`, preserved: false },
		{
			id: 'custom-define',
			content: "<?php define( 'SQLITE_DB_DROPIN_VERSION', 'custom' );\n",
			preserved: true,
		},
		{
			id: 'comment-token',
			content: '<?php // SQLITE_DB_DROPIN_VERSION is not defined\n',
			preserved: false,
		},
		{
			id: 'string-token',
			content: "<?php $value = 'SQLITE_DB_DROPIN_VERSION';\n",
			preserved: false,
		},
	];

	for ( const installCase of installCases ) {
		await runCase(
			`install-${ installCase.id }`,
			'install-integration',
			{ completed: true, preserved: installCase.preserved, pluginInstalled: true },
			async ( sitePath ) => {
				const dbPath = join( sitePath, 'wp-content', 'db.php' );
				if ( installCase.content !== null ) {
					writeFileSync( dbPath, installCase.content );
				}
				await provider.installSqliteIntegration( sitePath );
				const installedContent = readFileSync( dbPath, 'utf8' );
				return {
					completed: true,
					preserved: installedContent === installCase.content,
					pluginInstalled: existsSync(
						join( sitePath, 'wp-content', 'mu-plugins', 'sqlite-database-integration', 'load.php' )
					),
				};
			}
		);
	}

	await runCase(
		'install-database-file-blocker',
		'install-integration',
		{ completed: true, databaseDirectory: true },
		async ( sitePath ) => {
			writeFileSync( join( sitePath, 'wp-content', 'database' ), 'blocker' );
			await provider.installSqliteIntegration( sitePath );
			return {
				completed: true,
				databaseDirectory: lstatSync( join( sitePath, 'wp-content', 'database' ) ).isDirectory(),
			};
		}
	);

	await runCase(
		'install-db-php-directory-blocker',
		'install-integration',
		{ completed: true, dbPhpFile: true },
		async ( sitePath ) => {
			mkdirSync( join( sitePath, 'wp-content', 'db.php' ) );
			await provider.installSqliteIntegration( sitePath );
			return {
				completed: true,
				dbPhpFile: lstatSync( join( sitePath, 'wp-content', 'db.php' ) ).isFile(),
			};
		}
	);

	await runCase(
		'install-db-php-external-symlink',
		'install-integration',
		{ completed: true, externalUnchanged: true, dbPhpSymlink: false },
		async ( sitePath ) => {
			const externalPath = join( scratchRoot, 'external-db.php' );
			const dbPath = join( sitePath, 'wp-content', 'db.php' );
			writeFileSync( externalPath, '<?php // external sentinel\n' );
			symlinkSync( externalPath, dbPath );
			await provider.installSqliteIntegration( sitePath );
			return {
				completed: true,
				externalUnchanged: readFileSync( externalPath, 'utf8' ) === '<?php // external sentinel\n',
				dbPhpSymlink: lstatSync( dbPath ).isSymbolicLink(),
			};
		}
	);

	await runCase(
		'keep-updated-intentional-mysql',
		'keep-updated',
		{ sqliteArtifacts: false },
		async ( sitePath ) => {
			writeFileSync( join( sitePath, 'wp-config.php' ), '<?php // external database\n' );
			await provider.keepSqliteIntegrationUpdated( sitePath );
			return {
				sqliteArtifacts:
					existsSync( join( sitePath, 'wp-content', 'db.php' ) ) ||
					existsSync( join( sitePath, 'wp-content', 'database', '.ht.sqlite' ) ) ||
					existsSync( join( sitePath, 'wp-content', 'mu-plugins', 'sqlite-database-integration' ) ),
			};
		}
	);
}

function artifact( id: string, kind: string, path: string ) {
	return {
		schema: 'homeboy/fuzz-artifact/v1',
		id,
		kind,
		artifact: {
			schema: 'homeboy/artifact-contract/v1',
			kind,
			type: 'file',
			path,
			role: kind,
		},
	};
}

function findingCode( result: CaseResult ): string {
	if ( result.id.includes( 'external-symlink' ) ) {
		return 'external-symlink-write';
	}
	if ( result.id.includes( 'database-file-blocker' ) ) {
		return 'database-path-blocker';
	}
	if ( result.id.includes( 'db-php-directory-blocker' ) ) {
		return 'dropin-path-blocker';
	}
	return 'non-defining-token-preserved';
}

const findingDetails: Record< string, { title: string; severity: string } > = {
	'external-symlink-write': {
		title: 'SQLite installation writes through an external db.php symlink',
		severity: 'high',
	},
	'database-path-blocker': {
		title: 'SQLite installation cannot recover from a file blocking the database directory',
		severity: 'medium',
	},
	'dropin-path-blocker': {
		title: 'SQLite installation cannot recover from a directory blocking db.php',
		severity: 'medium',
	},
	'non-defining-token-preserved': {
		title: 'Non-defining SQLITE_DB_DROPIN_VERSION text preserves a foreign drop-in',
		severity: 'medium',
	},
};

try {
	await runClassificationCases();
	await runContentCases();
	await runInstallCases();

	const operations = [
		'classify-destination',
		'classify-dropin',
		'install-integration',
		'keep-updated',
	];
	const failed = results.filter( ( result ) => ! result.passed );
	const caseLog = results.map( ( result ) => ( {
		schema: 'homeboy/fuzz-case-log/v1',
		version: 1,
		case_id: result.id,
		target_id: 'sqlite-integration-provider',
		operation_id: result.operation,
		operation_family: result.operation.startsWith( 'classify' ) ? 'read' : 'update',
		seed,
		input_hash: hash( `${ seed }:${ result.id }` ),
		status: result.passed ? 'passed' : 'failed',
		duration_ms: result.durationMs,
		...( result.passed
			? {}
			: {
					failure_reason:
						result.error || 'Observed filesystem state differed from the declared contract.',
			  } ),
	} ) );
	const groupedFailures = Map.groupBy( failed, findingCode );
	const findings = Array.from( groupedFailures, ( [ code, cases ] ) => {
		const representative = cases[ 0 ];
		return {
			schema: 'homeboy/fuzz-finding/v1',
			id: `db-dropin-${ code }`,
			title: findingDetails[ code ].title,
			severity: findingDetails[ code ].severity,
			status: 'open',
			target_id: 'sqlite-integration-provider',
			operation_id: representative.operation,
			case_id: representative.id,
			workload_id: 'db-dropin-state-machine',
			seed_id: `seed-${ seed }`,
			fingerprint: hash( code ),
			artifact_ids: [ 'case-log', 'replay-data' ],
			source_refs: [ 'packages/common/lib/sqlite-integration.ts' ],
			metadata: {
				case_ids: cases.map( ( result ) => result.id ),
				operations: Array.from( new Set( cases.map( ( result ) => result.operation ) ) ),
				expected: representative.expected,
				observed: representative.observed,
				error: representative.error,
			},
		};
	} );
	const artifacts = [
		artifact( 'case-log', 'case_log', 'case-log.jsonl' ),
		artifact( 'replay-data', 'replay_data', 'replay.json' ),
		artifact( 'coverage-summary', 'coverage_summary', 'coverage-summary.json' ),
		artifact( 'result-envelope', 'result_envelope', 'campaign.json' ),
	];
	const campaign = {
		schema: 'homeboy/fuzz-campaign/v1',
		version: 1,
		id: `studio-db-dropin-${ runId }`,
		title: 'Studio SQLite db.php state-machine fuzz campaign',
		safety_class: 'isolated_mutation',
		surfaces: [
			{
				schema: 'homeboy/fuzz-surface/v1',
				id: 'db-dropin-filesystem',
				kind: 'filesystem-state-machine',
				safety_class: 'isolated_mutation',
				operations: operations.map( ( operation ) => ( {
					id: operation,
					kind: operation,
					family: operation.startsWith( 'classify' ) ? 'read' : 'update',
					target_id: 'sqlite-integration-provider',
				} ) ),
			},
		],
		targets: [
			{
				schema: 'homeboy/fuzz-target/v1',
				id: 'sqlite-integration-provider',
				kind: 'typescript-class',
				operations: operations.map( ( operation ) => ( {
					id: operation,
					kind: operation,
					family: operation.startsWith( 'classify' ) ? 'read' : 'update',
					target_id: 'sqlite-integration-provider',
				} ) ),
				source_refs: [ 'packages/common/lib/sqlite-integration.ts' ],
			},
		],
		workloads: [
			{
				schema: 'homeboy/fuzz-workload/v1',
				id: 'db-dropin-state-machine',
				safety_class: 'isolated_mutation',
				operations,
				seed_ids: [ `seed-${ seed }` ],
				case_budget: results.length,
			},
		],
		cases: results.map( ( result ) => ( {
			schema: 'homeboy/fuzz-case/v1',
			id: result.id,
			target_id: 'sqlite-integration-provider',
			operation_id: result.operation,
			workload_id: 'db-dropin-state-machine',
			seed_id: `seed-${ seed }`,
			replay_id: result.id,
			expected: result.expected,
			observed: { ...result.observed, error: result.error },
		} ) ),
		seeds: [
			{
				schema: 'homeboy/fuzz-seed/v1',
				id: `seed-${ seed }`,
				kind: 'deterministic',
				value: seed,
			},
		],
		coverage_summary: {
			schema: 'homeboy/fuzz-coverage-summary/v1',
			declared_targets: 1,
			executable_targets: 1,
			proven_targets: 1,
			declared_operations: operations.length,
			executable_operations: operations.length,
			proven_operations: new Set( results.map( ( result ) => result.operation ) ).size,
			artifact_ids: [ 'coverage-summary', 'case-log' ],
			metadata: {
				case_count: results.length,
				dimensions: [
					'destination-artifact-combinations',
					'dropin-content-spoofing',
					'custom-dropin-preservation',
					'filesystem-blocker-recovery',
					'symlink-containment',
					'intentional-mysql-non-mutation',
				],
			},
		},
		findings,
		artifacts,
		provenance: {
			schema: 'homeboy/fuzz-provenance/v1',
			producer: 'studio',
			producer_version: 'db-dropin-state-machine/v1',
			invocation: 'scripts/fuzz-sqlite-dropin.ts',
			run_id: runId,
			source_ref: 'packages/common/lib/sqlite-integration.ts',
		},
		replay: {
			schema: 'homeboy/fuzz-replay/v1',
			id: 'studio-db-dropin-replay',
			command: 'node',
			args: [ '--experimental-strip-types', 'scripts/fuzz-sqlite-dropin.ts' ],
			seed,
			artifact_id: 'replay-data',
		},
	};

	mkdirSync( artifactsDir, { recursive: true } );
	writeFileSync(
		join( artifactsDir, 'case-log.jsonl' ),
		`${ caseLog.map( ( entry ) => JSON.stringify( entry ) ).join( '\n' ) }\n`
	);
	writeJson( join( artifactsDir, 'replay.json' ), {
		seed,
		command: 'node --experimental-strip-types scripts/fuzz-sqlite-dropin.ts',
		case_ids: results.map( ( result ) => result.id ),
	} );
	writeJson( join( artifactsDir, 'coverage-summary.json' ), campaign.coverage_summary );
	writeJson( join( artifactsDir, 'campaign.json' ), campaign );
	if ( resultsFile ) {
		writeJson( resolve( resultsFile ), campaign );
	}

	console.log(
		`Wrote Studio db.php fuzz artifacts (${ results.length } cases, ${
			findings.length
		} findings) to ${ relative( root, artifactsDir ) }.`
	);
} finally {
	rmSync( scratchRoot, { recursive: true, force: true } );
}
