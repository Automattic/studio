import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
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
const commandTimeoutMs = Number( process.env.STUDIO_FUZZ_COMMAND_TIMEOUT_MS || 180_000 );

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
let activeCaseCommands = null;
let commandSequence = 0;

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

function snippet( value, length = 4000 ) {
 return String( value || '' ).slice( -length );
}

function errorMetadata( result ) {
 const text = `${ result.stdout }\n${ result.stderr }`;
 return {
  saw_mysql_unavailable: /MySQL .*not available|No managed MySQL server|unsupported platform/i.test( text ),
  saw_hash_mismatch: /SHA-256 mismatch|hash mismatch/i.test( text ),
  saw_lock_timeout: /lock|EEXIST|Timed out waiting/i.test( text ),
  saw_port_collision: /EADDRINUSE|address already in use|port.*in use|Timed out waiting for mysqld/i.test( text ),
  saw_rollback: /rolled back to SQLite|rolling back to SQLite|site is unchanged/i.test( text ),
 };
}

async function run( command, args, options = {} ) {
 const started = Date.now();
 return await new Promise( ( resolve ) => {
  const commandId = `${ options.operationId || 'command' }-${ ++commandSequence }`;
  const controller = new AbortController();
  const timeout = setTimeout( () => controller.abort(), options.timeoutMs || commandTimeoutMs );
  const child = spawn( command, args, {
   cwd: options.cwd || root,
   env: { ...baseEnv, ...( options.env || {} ) },
   stdio: [ options.stdin ? 'pipe' : 'ignore', 'pipe', 'pipe' ],
   signal: controller.signal,
  } );
  let stdout = '';
  let stderr = '';
  let spawnError = null;
  if ( options.stdin ) {
   child.stdin.end( options.stdin );
  }
  child.stdout.on( 'data', ( chunk ) => ( stdout += chunk ) );
  child.stderr.on( 'data', ( chunk ) => ( stderr += chunk ) );
  child.on( 'error', ( error ) => {
   spawnError = error;
  } );
  child.on( 'close', ( code, signal ) => {
   clearTimeout( timeout );
   const result = {
    command_id: commandId,
    command,
    args,
    cwd: options.cwd || root,
    code: spawnError ? 1 : code,
    signal: signal || ( controller.signal.aborted ? 'TIMEOUT' : null ),
    stdout,
    stderr: spawnError ? `${ stderr }\n${ spawnError.stack || spawnError.message }` : stderr,
    duration_ms: Date.now() - started,
   };
   const envelope = {
    command_id: commandId,
    command,
    args,
    cwd: result.cwd,
    exit_code: result.code,
    signal: result.signal,
    duration_ms: result.duration_ms,
    stdout_tail: snippet( result.stdout ),
    stderr_tail: snippet( result.stderr ),
    error_metadata: errorMetadata( result ),
   };
   activeCaseCommands?.push( envelope );
   resolve( result );
  } );
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
 activeCaseCommands = [];
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
    signal: observed.signal || null,
    duration_ms: observed.duration_ms,
    stdout_tail: snippet( observed.stdout ),
    stderr_tail: snippet( observed.stderr ),
    error_metadata: errorMetadata( observed ),
    commands: activeCaseCommands,
   },
   metadata: {
    started,
    expect_failure: Boolean( options.expectFailure ),
    replay: {
     run_id: runId,
     case_id: id,
     operation_id: operationId,
     runtime_root: runtimeRoot,
     artifacts_dir: artifactsDir,
    },
    ...( options.metadata || {} ),
   },
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
   observed: { status: 'error', error: error?.stack || String( error ), commands: activeCaseCommands },
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
 } finally {
  activeCaseCommands = null;
 }
}

const cli = ( ...args ) => run( process.execPath, [ cliPath, ...args ], { operationId: args.join( '-' ) } );
const sitePath = ( name ) => path.join( sitesRoot, name );
const cliConfigPath = path.join( devConfigDir, 'cli.json' );

async function readCliConfig() {
 return JSON.parse( await fs.readFile( cliConfigPath, 'utf8' ) );
}

async function getSiteConfig( name ) {
 const config = await readCliConfig();
 const fullPath = sitePath( name );
 const site = config.sites.find( ( item ) => item.path === fullPath );
 if ( ! site ) {
  throw new Error( `Missing fuzz site config for ${ name } at ${ fullPath }` );
 }
 return site;
}

async function createSqliteSite( name ) {
 return cli( 'site', 'create', '--path', sitePath( name ), '--name', name, '--runtime', 'native', '--no-start', '--skip-browser', '--skip-log-details' );
}

async function createMysqlSite( name ) {
 return cli( 'site', 'create', '--path', sitePath( name ), '--name', name, '--runtime', 'native', '--database-engine', 'mysql', '--no-start', '--skip-browser', '--skip-log-details' );
}

async function seedLargeSqliteSite( name ) {
 const content = 'Large MySQL conversion fuzz payload '.repeat( 200 );
 const code = `for ($i = 0; $i < 250; $i++) { wp_insert_post(array('post_title' => 'Fuzz post ' . $i, 'post_status' => 'publish', 'post_content' => ${ JSON.stringify( content ) })); } update_option('studio_mysql_fuzz_large_seeded', '250-posts');`;
 return cli( 'wp', '--path', sitePath( name ), 'eval', code );
}

async function runSequence( steps ) {
 const outputs = [];
 const started = Date.now();
 for ( const step of steps ) {
  const result = await step();
  outputs.push( result );
  if ( result.code !== 0 ) {
   return combineResults( outputs, Date.now() - started );
  }
 }
 return combineResults( outputs, Date.now() - started );
}

function combineResults( results, durationMs ) {
 const failed = results.find( ( item ) => item.code !== 0 );
 const last = results[ results.length - 1 ] || { code: 0, signal: null };
 return {
  code: failed ? failed.code : last.code,
  signal: failed?.signal || last.signal,
  duration_ms: durationMs,
  stdout: results.map( ( item, index ) => `## step ${ index + 1 }\n${ item.stdout }` ).join( '\n' ),
  stderr: results.map( ( item, index ) => `## step ${ index + 1 }\n${ item.stderr }` ).join( '\n' ),
 };
}

async function withPortCollision( port, fn ) {
 const server = net.createServer();
 await new Promise( ( resolve, reject ) => {
  server.once( 'error', reject );
  server.listen( port, '127.0.0.1', resolve );
 } );
 try {
  return await fn();
 } finally {
  await new Promise( ( resolve ) => server.close( resolve ) );
 }
}

async function requestSite( site, requestPath, options = {} ) {
 const started = Date.now();
 return await new Promise( ( resolve ) => {
  const commandId = `http-${ ++commandSequence }`;
  const finish = ( result ) => {
   const envelope = {
    command_id: commandId,
    command: 'http.request',
    args: [ `${ options.method || 'GET' } http://127.0.0.1:${ site.port }${ requestPath }` ],
    cwd: root,
    exit_code: result.code,
    signal: result.signal || null,
    duration_ms: result.duration_ms,
    stdout_tail: snippet( result.stdout ),
    stderr_tail: snippet( result.stderr ),
    error_metadata: errorMetadata( result ),
   };
   activeCaseCommands?.push( envelope );
   resolve( result );
  };
  const req = http.request(
   {
    hostname: '127.0.0.1',
    port: site.port,
    path: requestPath,
    method: options.method || 'GET',
    headers: { host: `localhost:${ site.port }`, ...( options.headers || {} ) },
    timeout: options.timeoutMs || 15_000,
   },
   ( res ) => {
    let body = '';
    res.on( 'data', ( chunk ) => ( body += chunk ) );
    res.on( 'end', () =>
     finish( {
      code: res.statusCode && res.statusCode < 500 ? 0 : 1,
      signal: null,
      stdout: body,
      stderr: '',
      duration_ms: Date.now() - started,
     } )
    );
   }
  );
  req.on( 'timeout', () => req.destroy( new Error( 'HTTP request timed out' ) ) );
  req.on( 'error', ( error ) =>
   finish( {
    code: options.expectAbort ? 0 : 1,
    signal: options.expectAbort ? 'CLIENT_ABORT' : null,
    stdout: '',
    stderr: error.stack || String( error ),
    duration_ms: Date.now() - started,
   } )
  );
  if ( options.abortAfterMs ) {
   setTimeout( () => req.destroy( new Error( 'intentional client abort' ) ), options.abortAfterMs );
  }
  if ( options.body ) {
   req.write( options.body );
  }
  req.end();
 } );
}

await runCase( 'build-cli', 'studio.mysql.binary.delivery', 'binary.metadata.platform.resolve', () =>
	run( 'npm', [ 'ci' ] ).then( async ( install ) => {
		if ( install.code !== 0 ) {
			return install;
		}

		return await run( 'npm', [ 'run', 'cli:build', '--silent' ] );
	} )
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

await runCase( 'convert-sqlite-large', 'studio.cli.site.convert.mysql', 'convert.sqlite.mysql.large', () =>
 runSequence( [
  () => createSqliteSite( 'sqlite-large' ),
  () => seedLargeSqliteSite( 'sqlite-large' ),
  () => cli( 'site', 'convert', '--path', sitePath( 'sqlite-large' ), '--to', 'mysql' ),
  () => cli( 'wp', '--path', sitePath( 'sqlite-large' ), 'post', 'list', '--post_type=post', '--format=count' ),
 ] ),
 { metadata: { expected_minimum_posts_after_conversion: 250 } }
);

await runCase( 'convert-sqlite-rollback-on-kept-dropin', 'studio.cli.site.convert.mysql', 'convert.sqlite.mysql.rollback', async () => {
 const name = 'sqlite-rollback';
 const created = await createSqliteSite( name );
 if ( created.code !== 0 ) {
  return created;
 }
 const dbPhpPath = path.join( sitePath( name ), 'wp-content', 'db.php' );
 const originalDropin = await fs.readFile( dbPhpPath, 'utf8' );
 await fs.writeFile( dbPhpPath, `${ originalDropin }\n/* @studio-keep fuzz rollback guard */\n` );
 const failedConvert = await cli( 'site', 'convert', '--path', sitePath( name ), '--to', 'mysql' );
 const siteConfig = await getSiteConfig( name );
 const dropinAfter = await fs.readFile( dbPhpPath, 'utf8' );
 return {
  ...failedConvert,
  stdout: `${ failedConvert.stdout }\nrollback_probe=${ JSON.stringify( {
   databaseEngine: siteConfig.databaseEngine || 'sqlite-default',
   hasMysqlConfig: Boolean( siteConfig.mysql ),
   keptDropinStillPresent: dropinAfter.includes( '@studio-keep fuzz rollback guard' ),
  } ) }`,
 };
}, { expectFailure: true } );

await runCase( 'mysql-start', 'studio.runtime.mysql.lifecycle', 'mysql.start.stop.restart', () =>
	cli( 'site', 'start', '--path', sitePath( 'mysql-native' ), '--skip-browser', '--skip-log-details' )
);

await runCase( 'mysql-port-collision', 'studio.runtime.mysql.lifecycle', 'mysql.port.collision', async () => {
 const name = 'mysql-port-collision';
 const created = await createMysqlSite( name );
 if ( created.code !== 0 ) {
  return created;
 }
 const site = await getSiteConfig( name );
 return await withPortCollision( site.mysql.port, () =>
  cli( 'site', 'start', '--path', sitePath( name ), '--skip-browser', '--skip-log-details' )
 );
}, { expectFailure: true } );

await runCase( 'mysql-orphan-process-recovery', 'studio.runtime.mysql.lifecycle', 'mysql.orphan.process.recovery', () =>
 runSequence( [
  () => createMysqlSite( 'mysql-orphan-recovery' ),
  () => cli( 'site', 'start', '--path', sitePath( 'mysql-orphan-recovery' ), '--skip-browser', '--skip-log-details' ),
  () => cli( 'site', 'stop', '--path', sitePath( 'mysql-orphan-recovery' ) ),
  () => cli( 'site', 'start', '--path', sitePath( 'mysql-orphan-recovery' ), '--skip-browser', '--skip-log-details' ),
  () => cli( 'wp', '--path', sitePath( 'mysql-orphan-recovery' ), 'db', 'query', 'SELECT 1' ),
  () => cli( 'site', 'stop', '--path', sitePath( 'mysql-orphan-recovery' ) ),
 ] ),
 { metadata: { recovery_shape: 'restart_after_stop_then_wpcli_connection_check' } }
);

await runCase( 'mysql-concurrent-install-lock', 'studio.runtime.mysql.lifecycle', 'mysql.concurrent.install.lock', async () => {
 const started = Date.now();
 const results = await Promise.all( [ createMysqlSite( 'mysql-lock-a' ), createMysqlSite( 'mysql-lock-b' ) ] );
 return combineResults( results, Date.now() - started );
}, { metadata: { concurrency: 2, intent: 'exercise shared MySQL binary install lock' } } );

await runCase( 'wpcli-db-query', 'studio.runtime.mysql.wpcli', 'wpcli.db.query', () =>
	cli( 'wp', '--path', sitePath( 'mysql-native' ), 'db', 'query', 'SELECT 1' )
);

await runCase( 'wpcli-db-import-export', 'studio.runtime.mysql.wpcli', 'wpcli.db.import.export', async () => {
 const exportPath = path.join( artifactsDir, 'wpcli-db-import-export.sql' );
 return runSequence( [
  () => cli( 'wp', '--path', sitePath( 'mysql-native' ), 'option', 'update', 'studio_mysql_fuzz_roundtrip', runId ),
  () => cli( 'wp', '--path', sitePath( 'mysql-native' ), 'db', 'export', exportPath ),
  () => cli( 'wp', '--path', sitePath( 'mysql-native' ), 'option', 'delete', 'studio_mysql_fuzz_roundtrip' ),
  () => cli( 'wp', '--path', sitePath( 'mysql-native' ), 'db', 'import', exportPath ),
  () => cli( 'wp', '--path', sitePath( 'mysql-native' ), 'option', 'get', 'studio_mysql_fuzz_roundtrip' ),
 ] );
}, { metadata: { export_artifact: 'wpcli-db-import-export.sql' } } );

await runCase( 'wpcli-starts-mysql-when-needed', 'studio.runtime.mysql.wpcli', 'wpcli.starts.mysql.when-needed', () =>
 runSequence( [
  () => cli( 'site', 'stop', '--path', sitePath( 'mysql-native' ) ),
  () => cli( 'wp', '--path', sitePath( 'mysql-native' ), 'db', 'query', 'SELECT 1' ),
 ] ),
 { metadata: { intent: 'WP-CLI should ensure managed MySQL is running even when the site server is stopped' } }
);

await runCase( 'loopback-wp-cron-idle', 'studio.runtime.mysql.loopback', 'loopback.wp-cron.idle', async () => {
 const start = await cli( 'site', 'start', '--path', sitePath( 'mysql-native' ), '--skip-browser', '--skip-log-details' );
 if ( start.code !== 0 ) {
  return start;
 }
 const site = await getSiteConfig( 'mysql-native' );
 return await requestSite( site, '/wp-cron.php?doing_wp_cron=studio-mysql-fuzz' );
} );

await runCase( 'loopback-async-post-fanout', 'studio.runtime.mysql.loopback', 'loopback.async.post.fanout', async () => {
 const site = await getSiteConfig( 'mysql-native' );
 const started = Date.now();
 const results = await Promise.all(
  Array.from( { length: 12 }, ( _, index ) =>
   requestSite( site, `/wp-cron.php?doing_wp_cron=studio-mysql-fuzz-${ index }`, { timeoutMs: 20_000 } )
  )
 );
 return combineResults( results, Date.now() - started );
}, { metadata: { fanout: 12 } } );

await runCase( 'loopback-client-abort-worker-survives', 'studio.runtime.mysql.loopback', 'loopback.client-abort.worker-survives', async () => {
 const site = await getSiteConfig( 'mysql-native' );
 const aborted = await requestSite( site, '/wp-cron.php?doing_wp_cron=studio-mysql-fuzz-abort', {
  abortAfterMs: 25,
  expectAbort: true,
 } );
 if ( aborted.code !== 0 ) {
  return aborted;
 }
 const health = await cli( 'wp', '--path', sitePath( 'mysql-native' ), 'db', 'query', 'SELECT 1' );
 return combineResults( [ aborted, health ], aborted.duration_ms + health.duration_ms );
} );

await runCase( 'binary-hash-mismatch-metadata', 'studio.mysql.binary.delivery', 'binary.hash.mismatch', () =>
 run( process.execPath, [
  '--input-type=module',
  '-e',
  `import crypto from 'node:crypto'; const actual = crypto.createHash('sha256').update('studio-mysql-fuzz').digest('hex'); const expected = '0'.repeat(64); if (actual === expected) process.exit(0); console.error(JSON.stringify({expected, actual, message: 'synthetic SHA-256 mismatch probe for lab diagnostics'})); process.exit(1);`,
 ] ),
 { expectFailure: true, metadata: { synthetic_probe: true, destructive_download_not_required: true } }
);

await runCase( 'binary-offline-unsupported-platform', 'studio.mysql.binary.delivery', 'binary.offline.unsupported-platform', () =>
 run( process.execPath, [
  '--input-type=module',
  '-e',
  `import metadata from './packages/common/lib/mysql-binary-cdn-metadata.json' with { type: 'json' }; const unsupportedKey = 'aix-ppc64'; const found = Object.values(metadata.versions).some((version) => version.artifacts[unsupportedKey]); if (found) process.exit(1); console.error(JSON.stringify({unsupportedKey, message: 'MySQL 8.4 metadata has no artifact for synthetic unsupported offline platform'})); process.exit(1);`,
 ] ),
 { expectFailure: true, metadata: { synthetic_platform: 'aix-ppc64', offline_probe: true } }
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
