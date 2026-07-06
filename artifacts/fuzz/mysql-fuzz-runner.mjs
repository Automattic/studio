import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
const artifactsDir = process.env.HOMEBOY_FUZZ_ARTIFACTS_DIR || path.join( root, 'artifacts/fuzz/run' );
const resultsFile = process.env.HOMEBOY_FUZZ_RESULTS_FILE || path.join( artifactsDir, 'results.json' );
const requestFile = process.env.HOMEBOY_FUZZ_EXECUTION_REQUEST_FILE;
const runId = process.env.HOMEBOY_FUZZ_RUN_ID || `studio-mysql-fuzz-${ Date.now() }`;
const runtimeRoot = process.env.STUDIO_FUZZ_RUNTIME_ROOT || path.join( '/tmp', runId );
const devConfigDir = path.join( runtimeRoot, 'config' );
const sitesRoot = path.join( runtimeRoot, 'sites' );
const caseLogPath = path.join( artifactsDir, 'case-log.jsonl' );
const replayPath = path.join( artifactsDir, 'replay.json' );
const resultsArtifactPath = path.relative( artifactsDir, resultsFile );
const cliPath = path.join( root, 'apps/cli/dist/cli/main.mjs' );

const request = requestFile
	? JSON.parse( await fs.readFile( requestFile, 'utf8' ) )
	: { id: runId, sampling: { operation_strata: [] } };
const selectedOperations = new Set(
	request.sampling?.operation_strata
		?.find( ( stratum ) => stratum.kind === 'operation' )
		?.values || []
);
const cases = [];
const findings = [];

await fs.mkdir( artifactsDir, { recursive: true } );
await fs.rm( runtimeRoot, { recursive: true, force: true } );
await fs.mkdir( sitesRoot, { recursive: true } );
await fs.writeFile( caseLogPath, '' );

const baseEnv = {
	...process.env,
	CI: '1',
	DEV_CONFIG_DIR: devConfigDir,
	STUDIO_PROCESS_MANAGER_HOME: devConfigDir,
	STUDIO_HOME: devConfigDir,
	TMPDIR: path.join( runtimeRoot, 'tmp' ),
};
await fs.mkdir( baseEnv.TMPDIR, { recursive: true } );

async function run( command, args, options = {} ) {
	const started = Date.now();
	return await new Promise( ( resolve ) => {
		const child = spawn( command, args, {
			cwd: options.cwd || root,
			env: { ...baseEnv, ...( options.env || {} ) },
			stdio: [ 'ignore', 'pipe', 'pipe' ],
		} );
		let stdout = '';
		let stderr = '';
		child.stdout.on( 'data', ( chunk ) => ( stdout += chunk ) );
		child.stderr.on( 'data', ( chunk ) => ( stderr += chunk ) );
		child.on( 'close', ( code, signal ) =>
			resolve( { code, signal, stdout, stderr, duration_ms: Date.now() - started } )
		);
	} );
}

async function logCase( entry ) {
	await fs.appendFile( caseLogPath, `${ JSON.stringify( entry ) }\n` );
}

async function runCase( id, targetId, operationId, fn, options = {} ) {
	if ( selectedOperations.size && ! selectedOperations.has( operationId ) ) {
		return;
	}
	const started = new Date().toISOString();
	try {
		const observed = await fn();
		const passed = options.expectFailure ? observed.code !== 0 : observed.code === 0;
		const status = passed ? 'passed' : 'failed';
		const caseEntry = {
			schema: 'homeboy/fuzz-case/v1',
			id,
			target_id: targetId,
			operation_id: operationId,
			workload_id: process.env.HOMEBOY_FUZZ_WORKLOAD_ID || 'component-script-1',
			observed: {
				status,
				exit_code: observed.code,
				duration_ms: observed.duration_ms,
				stdout_tail: observed.stdout.slice( -4000 ),
				stderr_tail: observed.stderr.slice( -4000 ),
			},
			metadata: { started, expect_failure: Boolean( options.expectFailure ) },
		};
		cases.push( caseEntry );
		await logCase( caseEntry );
		if ( ! passed ) {
			findings.push( {
				schema: 'homeboy/fuzz-finding/v1',
				id: `${ id }-failure`,
				status: 'open',
				severity: 'high',
				title: `Studio MySQL fuzz case failed: ${ operationId }`,
				target_id: targetId,
				operation_id: operationId,
				case_id: id,
				metadata: caseEntry.observed,
			} );
		}
	} catch ( error ) {
		const caseEntry = {
			schema: 'homeboy/fuzz-case/v1',
			id,
			target_id: targetId,
			operation_id: operationId,
			observed: { status: 'error', error: error?.stack || String( error ) },
			metadata: { started },
		};
		cases.push( caseEntry );
		await logCase( caseEntry );
		findings.push( {
			schema: 'homeboy/fuzz-finding/v1',
			id: `${ id }-error`,
			status: 'open',
			severity: 'critical',
			title: `Studio MySQL fuzz case errored: ${ operationId }`,
			target_id: targetId,
			operation_id: operationId,
			case_id: id,
			metadata: caseEntry.observed,
		} );
	}
}

const cli = ( ...args ) => run( process.execPath, [ cliPath, ...args ] );
const sitePath = ( name ) => path.join( sitesRoot, name );

await runCase( 'build-cli', 'studio.mysql.binary.delivery', 'binary.metadata.platform.resolve', () =>
	run( 'npm', [ 'run', 'cli:build', '--silent' ] )
);

await runCase( 'create-mysql-native', 'studio.cli.site.create.mysql', 'create.mysql.native', () =>
	cli( 'site', 'create', '--path', sitePath( 'mysql-native' ), '--name', 'mysql-native', '--runtime', 'native', '--database-engine', 'mysql', '--no-start', '--skip-browser', '--skip-log-details' )
);

await runCase( 'create-mysql-playground-rejected', 'studio.cli.site.create.mysql', 'create.mysql.playground.rejected', () =>
	cli( 'site', 'create', '--path', sitePath( 'mysql-playground' ), '--name', 'mysql-playground', '--runtime', 'sandbox', '--database-engine', 'mysql', '--no-start', '--skip-browser', '--skip-log-details' ),
	{ expectFailure: true }
);

await runCase( 'create-sqlite-default', 'studio.cli.site.create.mysql', 'create.sqlite.default.unchanged', () =>
	cli( 'site', 'create', '--path', sitePath( 'sqlite-default' ), '--name', 'sqlite-default', '--runtime', 'native', '--skip-browser', '--skip-log-details' )
);

await runCase( 'convert-sqlite-empty', 'studio.cli.site.convert.mysql', 'convert.sqlite.mysql.empty', () =>
	cli( 'site', 'convert', '--path', sitePath( 'sqlite-default' ), '--to', 'mysql' )
);

await runCase( 'mysql-start', 'studio.runtime.mysql.lifecycle', 'mysql.start.stop.restart', () =>
	cli( 'site', 'start', '--path', sitePath( 'mysql-native' ), '--skip-browser', '--skip-log-details' )
);

await runCase( 'wpcli-db-query', 'studio.runtime.mysql.wpcli', 'wpcli.db.query', () =>
	cli( 'wp', '--path', sitePath( 'mysql-native' ), 'db', 'query', 'SELECT 1' )
);

await runCase( 'mysql-stop', 'studio.runtime.mysql.lifecycle', 'mysql.start.stop.restart', () =>
	cli( 'site', 'stop', '--path', sitePath( 'mysql-native' ) )
);

await fs.writeFile(
	replayPath,
	JSON.stringify(
		{
			schema: 'homeboy/fuzz-replay/v1',
			run_id: runId,
			request_file: requestFile,
			dev_config_dir: devConfigDir,
			sites_root: sitesRoot,
		},
		null,
		2
	)
);

const targetIds = new Set( cases.map( ( item ) => item.target_id ) );
const operationIds = new Set( cases.map( ( item ) => item.operation_id ) );
const campaign = {
	schema: 'homeboy/fuzz-campaign/v1',
	version: 1,
	id: runId,
	title: 'Studio MySQL destructive fuzz campaign',
	safety_class: 'isolated_mutation',
	cases,
	findings,
	coverage_summary: {
		schema: 'homeboy/fuzz-coverage-summary/v1',
		declared_targets: targetIds.size,
		executable_targets: targetIds.size,
		proven_targets: targetIds.size,
		declared_operations: operationIds.size,
		executable_operations: operationIds.size,
		proven_operations: operationIds.size,
		skipped_targets: [],
		skipped_operations: [],
		surface_summaries: [],
		kind_summaries: [],
		artifact_ids: [ 'case-log', 'replay-data', 'result-envelope' ],
	},
	artifacts: [
		{
			schema: 'homeboy/fuzz-artifact/v1',
			id: 'case-log',
			kind: 'case_log',
			artifact: {
				schema: 'homeboy/artifact-contract/v1',
				kind: 'case_log',
				type: 'file',
				path: 'case-log.jsonl',
				role: 'case_log',
			},
		},
		{
			schema: 'homeboy/fuzz-artifact/v1',
			id: 'replay-data',
			kind: 'replay_data',
			artifact: {
				schema: 'homeboy/artifact-contract/v1',
				kind: 'replay_data',
				type: 'file',
				path: 'replay.json',
				role: 'replay_data',
			},
		},
		{
			schema: 'homeboy/fuzz-artifact/v1',
			id: 'result-envelope',
			kind: 'result_envelope',
			artifact: {
				schema: 'homeboy/artifact-contract/v1',
				kind: 'result_envelope',
				type: 'file',
				path: resultsArtifactPath,
				role: 'result_envelope',
			},
		},
	],
	metadata: {
		status: findings.length ? 'failed' : 'passed',
		success: findings.length === 0,
		case_counts: {
			passed: cases.filter( ( item ) => item.observed.status === 'passed' ).length,
			failed: cases.filter( ( item ) => item.observed.status === 'failed' ).length,
			errored: cases.filter( ( item ) => item.observed.status === 'error' ).length,
		},
		artifact_refs: [
			{ kind: 'case_log', path: 'case-log.jsonl' },
			{ kind: 'replay_data', path: 'replay.json' },
			{ kind: 'result_envelope', path: resultsArtifactPath },
		],
	},
};

await fs.writeFile( resultsFile, JSON.stringify( campaign, null, 2 ) );
process.exit( findings.length ? 1 : 0 );
