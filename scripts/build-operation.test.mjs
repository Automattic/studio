import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
const {
	claimImage,
	getStatus,
	journalSummary,
	launch,
	normalizeSpec,
	publishOperation,
	runOperation,
	validateRemoteSite,
} = await import(
	new URL( '../plugins/wp-studio/scripts/build-operation.mjs', import.meta.url ).href
);

const roots = [];
it( 'defaults to the sibling engine independently of cwd and preserves overrides', () => {
	try {
		vi.stubEnv( 'SITE_BUILD_HOME', undefined );
		vi.spyOn( process, 'cwd' ).mockReturnValue( os.tmpdir() );
		const spec = {
			name: 'Example',
			slug: 'example',
			prompt: 'A site about lamps',
			harness: 'codex',
		};
		expect( normalizeSpec( spec ).engineHome ).toBe(
			path.resolve( import.meta.dirname, '../../site-builder-engine' )
		);
		vi.stubEnv( 'SITE_BUILD_HOME', path.join( os.tmpdir(), 'environment-engine' ) );
		expect( normalizeSpec( spec ).engineHome ).toBe(
			path.join( os.tmpdir(), 'environment-engine' )
		);
		const requested = path.join( os.tmpdir(), 'requested-engine' );
		expect( normalizeSpec( { ...spec, engineHome: requested } ).engineHome ).toBe( requested );
	} finally {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	}
} );
afterEach( () => {
	for ( const root of roots.splice( 0 ) ) fs.rmSync( root, { recursive: true, force: true } );
} );
const json = ( file, value ) => {
	fs.mkdirSync( path.dirname( file ), { recursive: true } );
	fs.writeFileSync( file, JSON.stringify( value ) );
};
function fixture( options = {} ) {
	const root = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-operation-test-' ) );
	roots.push( root );
	const engine = path.join( root, 'engine' );
	fs.mkdirSync( path.join( engine, 'bin' ), { recursive: true } );
	for ( const name of [ 'build.php', 'prepare-studio.php', 'serve.php' ] )
		fs.writeFileSync( path.join( engine, 'bin', name ), 'fixture' );
	const directory = path.join( root, 'operation' );
	const spec = {
		name: 'Example',
		slug: 'example',
		prompt: 'A site about lamps',
		harness: 'codex',
		engineHome: engine,
		images: 'none',
	};
	const calls = [];
	let building = false;
	let stopped = false;
	const start = ( _command, args, context ) => {
		const kind = args.includes( '--protocol' )
			? 'protocol'
			: args.includes( '--transport' )
			? 'transport'
			: args.some( ( a ) => a.endsWith( 'prepare-studio.php' ) )
			? 'prepare'
			: args.some( ( a ) => a.endsWith( 'serve.php' ) )
			? 'serve'
			: args.includes( 'list' )
			? 'studio'
			: args.includes( '--help' )
			? 'studio-help'
			: 'build';
		calls.push( { kind, args, building, env: context.env } );
		const result = ( value, code = 0 ) => ( {
			code,
			stdout: JSON.stringify( value ),
			stderr: code ? 'fixture failure' : '',
		} );
		let done;
		if ( kind === 'protocol' )
			done = Promise.resolve(
				result( {
					capabilities: options.capabilities ?? [
						'events',
						'prompt-file',
						'projects-dir',
						'wordpress',
						'studio-prepare',
						'harness-images',
					],
				} )
			);
		else if ( kind === 'transport' )
			done = Promise.resolve( {
				code: 0,
				stdout: options.transport ?? 'codex-cli subscription',
				stderr: '',
			} );
		else if ( kind === 'studio' ) done = Promise.resolve( result( [] ) );
		else if ( kind === 'studio-help' )
			done = Promise.resolve( {
				code: 0,
				stdout: options.runtimeFlag ? '--runtime native' : 'native PHP create',
				stderr: '',
			} );
		else if ( kind === 'prepare' )
			done = sleep( 2 ).then( () =>
				result(
					{ url: 'http://localhost:9999/', runner: 'studio', prepared: true },
					options.prepareCode ?? 0
				)
			);
		else if ( kind === 'serve' )
			done = Promise.resolve(
				result( {
					url: options.wrongUrl ? 'http://localhost:9998/' : 'http://localhost:9999/',
					runner: 'studio',
				} )
			);
		else {
			building = true;
			const project = path.join( context.env.SITE_BUILD_PROJECTS_DIR, spec.slug );
			json( path.join( project, 'meta.json' ), {} );
			const events = [
				{ type: 'build.started', runId: 'current', data: { steps: [ { id: 'compose' } ] } },
			];
			fs.writeFileSync(
				path.join( project, 'events.jsonl' ),
				events.map( ( e ) => JSON.stringify( e ) ).join( '\n' ) + '\n'
			);
			done = sleep( 20 ).then( () => {
				building = false;
				if ( ! options.noTerminal )
					events.push( {
						type: 'build.completed',
						runId: options.wrongRun ? 'old' : 'current',
						data: { stoppedAfter: options.bounded ? 'compose' : null },
					} );
				fs.writeFileSync(
					path.join( project, 'events.jsonl' ),
					events.map( ( e ) => JSON.stringify( e ) ).join( '\n' ) + '\n'
				);
				if ( options.failedImage )
					json( path.join( project, 'build-stats.json' ), { images: { failed_assets: 1 } } );
				return result( {}, options.buildCode ?? 0 );
			} );
		}
		return {
			done,
			stop: () => {
				stopped = true;
			},
		};
	};
	return {
		directory,
		spec,
		calls,
		start,
		get stopped() {
			return stopped;
		},
	};
}
const checks = async () => ( {
	pages: [ { url: 'http://localhost:9999/' } ],
	visualReview: 'pending',
} );
describe( 'build operation prototype', () => {
	it( 'requires a named harness and rejects bounded or identity-changing flags before work', () => {
		const f = fixture();
		expect( () => normalizeSpec( { ...f.spec, harness: 'unknown' } ) ).toThrow( 'harness' );
		for ( const flag of [
			'--until=compose',
			'--serve',
			'--provider=anthropic',
			'--existing-content-file=x',
			'--slug=elsewhere',
		] )
			expect( () => normalizeSpec( { ...f.spec, engineArguments: [ flag ] } ) ).toThrow( 'owns' );
	} );
	it( 'starts preparation during generation and imports only after both finish', async () => {
		const f = fixture();
		const statuses = [];
		const result = await runOperation( f.spec, f.directory, {
			start: f.start,
			pollMs: 1,
			checkSite: checks,
			onStatus: ( s ) => statuses.push( s.phase ),
		} );
		expect( f.calls.find( ( c ) => c.kind === 'prepare' ).building ).toBe( true );
		expect( f.calls.find( ( c ) => c.kind === 'serve' ).building ).toBe( false );
		expect( result ).toMatchObject( {
			phase: 'ready',
			runId: 'current',
			localUrl: 'http://localhost:9999/',
			result: { kind: 'local-preview' },
		} );
		expect( statuses ).toContain( 'checking' );
		expect( result.remoteUrl ).toBeNull();
	} );
	it( 'refuses a reused operation directory instead of replaying generation', async () => {
		const f = fixture();
		await runOperation( f.spec, f.directory, { start: f.start, pollMs: 1, checkSite: checks } );
		const before = f.calls.length;
		await expect(
			runOperation( f.spec, f.directory, { start: f.start, pollMs: 1, checkSite: checks } )
		).rejects.toThrow();
		expect( f.calls ).toHaveLength( before );
	} );
	it.each( [ { noTerminal: true }, { bounded: true }, { wrongRun: true }, { buildCode: 1 } ] )(
		'rejects incomplete or failed engine result: %j',
		async ( options ) => {
			const f = fixture( options );
			await expect(
				runOperation( f.spec, f.directory, { start: f.start, pollMs: 1, checkSite: checks } )
			).rejects.toThrow();
			expect( getStatus( f.directory ).phase ).toBe( 'failed' );
			expect( f.calls.some( ( c ) => c.kind === 'serve' ) ).toBe( false );
		}
	);
	it( 'stops the active build when preparation fails and preserves its artifacts', async () => {
		const f = fixture( { prepareCode: 1 } );
		await expect(
			runOperation( f.spec, f.directory, { start: f.start, pollMs: 1, checkSite: checks } )
		).rejects.toThrow();
		expect( f.stopped ).toBe( true );
		expect( fs.existsSync( path.join( f.directory, 'projects/example/meta.json' ) ) ).toBe( true );
	} );
	it( 'refuses a different import destination', async () => {
		const f = fixture( { wrongUrl: true } );
		await expect(
			runOperation( f.spec, f.directory, { start: f.start, pollMs: 1, checkSite: checks } )
		).rejects.toThrow( 'retain' );
	} );
	it( 'stops before spending if capabilities or the subscription transport mismatch', async () => {
		for ( const options of [ { capabilities: [ 'events' ] }, { transport: 'openai API' } ] ) {
			const f = fixture( options );
			await expect(
				runOperation( f.spec, f.directory, { start: f.start, pollMs: 1, checkSite: checks } )
			).rejects.toThrow();
			expect( f.calls.some( ( c ) => c.kind === 'build' ) ).toBe( false );
		}
	} );
	it( 'preserves explicit feature and graph flags and pins the provider', async () => {
		const f = fixture();
		await runOperation(
			{ ...f.spec, engineArguments: [ '--blocks-first', '--blog' ] },
			f.directory,
			{ start: f.start, pollMs: 1, checkSite: checks }
		);
		const { args, env } = f.calls.find( ( c ) => c.kind === 'build' );
		expect( args ).toContain( '--blocks-first' );
		expect( args ).toContain( '--blog' );
		expect( args ).not.toContain( '--dsl' );
		expect( args ).toContain( '--provider=openai' );
		expect( env.SITE_BUILD_LLM ).toBe( 'codex-cli' );
	} );
	it( 'does not report image failure or failed checks as ready', async () => {
		const f = fixture( { failedImage: true } );
		await expect(
			runOperation( { ...f.spec, images: 'harness' }, f.directory, {
				start: f.start,
				pollMs: 1,
				checkSite: checks,
			} )
		).rejects.toThrow( 'Image failures' );
		const g = fixture();
		await expect(
			runOperation( g.spec, g.directory, {
				start: g.start,
				pollMs: 1,
				checkSite: async () => {
					throw new Error( 'page failed' );
				},
			} )
		).rejects.toThrow( 'page failed' );
		expect( getStatus( g.directory ).phase ).toBe( 'failed' );
	} );
	it( 'claims each image once and refuses expired or unknown commissions', () => {
		const f = fixture();
		fs.mkdirSync( f.directory );
		json( path.join( f.directory, 'status.json' ), { phase: 'generating', pid: process.pid } );
		const id = 'a'.repeat( 32 );
		json( path.join( f.directory, 'images/requests/' + id + '.json' ), {
			v: 1,
			id,
			prompt: 'A duck',
			expiresAt: Date.now() / 1000 + 60,
		} );
		expect( claimImage( f.directory, id ).prompt ).toBe( 'A duck' );
		expect( getStatus( f.directory ).imageRequests[ 0 ].claimed ).toBe( true );
		expect( () => claimImage( f.directory, id ) ).toThrow();
		expect( () => claimImage( f.directory, '../x' ) ).toThrow( 'unknown' );
	} );
	it( 'requires exact remote identifiers without numeric prefixes or whitespace', () => {
		for ( const value of [
			'123foo',
			'123e3',
			'123\n',
			'https://example.com/\n',
			'https://example.com/path',
		] )
			expect( () => validateRemoteSite( value ) ).toThrow();
		for ( const value of [ '123', 'https://example.com/' ] )
			expect( validateRemoteSite( value ) ).toBe( value );
	} );
	it( 'keeps cancellation during checking terminal', async () => {
		const f = fixture();
		const controller = new AbortController();
		await expect(
			runOperation( f.spec, f.directory, {
				start: f.start,
				pollMs: 1,
				signal: controller.signal,
				checkSite: async () => {
					controller.abort();
					return checks();
				},
			} )
		).rejects.toThrow( 'interrupted' );
		expect( getStatus( f.directory ).phase ).toBe( 'interrupted' );
	} );
	it.each( [ false, true ] )(
		'normalizes only the obsolete native runtime flag (legacy=%s)',
		async ( runtimeFlag ) => {
			const f = fixture( { runtimeFlag } );
			const studioCommand = [
				process.execPath,
				'-e',
				'process.stdout.write(JSON.stringify(process.argv.slice(1)))',
			];
			await runOperation( { ...f.spec, studioCommand }, f.directory, {
				start: f.start,
				pollMs: 1,
				checkSite: checks,
			} );
			const env = f.calls.find( ( c ) => c.kind === 'build' ).env;
			const result = await launch(
				process.execPath,
				[ path.join( f.directory, 'bin/studio' ), 'create', '--runtime', 'native' ],
				{ env }
			).done;
			expect( result.code ).toBe( 0 );
			expect( JSON.parse( result.stdout ) ).toEqual(
				runtimeFlag ? [ 'create', '--runtime', 'native' ] : [ 'create' ]
			);
		}
	);
	it( 'ignores a previous run completion when a new run is active', () => {
		const f = fixture();
		const file = path.join( path.dirname( f.directory ), 'events.jsonl' );
		fs.writeFileSync(
			file,
			[
				{ type: 'build.started', runId: 'old', data: {} },
				{ type: 'build.completed', runId: 'old', data: { stoppedAfter: null } },
				{ type: 'build.started', runId: 'new', data: {} },
			]
				.map( ( e ) => JSON.stringify( e ) )
				.join( '\n' )
		);
		expect( journalSummary( file ) ).toMatchObject( { runId: 'new', completed: false } );
	} );
	it( 'plans publication before generation and publishes after local checks in the same request', async () => {
		const f = fixture(),
			order = [];
		let checked = false;
		const remote = { id: 908, url: 'https://example.wpcomstaging.com' };
		const start = ( command, args, context ) => {
			if ( ! args.includes( 'publish' ) ) return f.start( command, args, context );
			const plan = args.includes( '--check' );
			order.push( plan ? 'plan' : 'publish' );
			if ( ! plan ) expect( checked ).toBe( true );
			const event = {
				type: 'publication.completed',
				phase: plan ? 'planned' : 'published',
				result: {
					phase: plan ? 'planned' : 'published',
					remote,
					verification: { visibility: 'coming-soon' },
				},
			};
			return {
				stop: () => {},
				done: Promise.resolve().then( () => {
					context.onStdoutLine?.( JSON.stringify( event ) );
					return { code: 0, stdout: JSON.stringify( event ), stderr: '' };
				} ),
			};
		};
		const result = await runOperation(
			{ ...f.spec, publish: { remoteSite: remote.url } },
			f.directory,
			{
				start,
				pollMs: 1,
				checkSite: async () => {
					checked = true;
					return checks();
				},
			}
		);
		expect( order ).toEqual( [ 'plan', 'publish' ] );
		expect( result ).toMatchObject( {
			phase: 'published',
			remoteUrl: remote.url,
			result: { kind: 'verified-publication' },
		} );
	} );
	it( 'requires explicit republish intent and gives it a fresh receipt directory', async () => {
		const f = fixture();
		await runOperation( f.spec, f.directory, { start: f.start, pollMs: 1, checkSite: checks } );
		const outputs = [];
		const remote = { id: 908, url: 'https://example.wpcomstaging.com' };
		const start = ( _command, args, context ) => ( {
			stop: () => {},
			done: Promise.resolve().then( () => {
				outputs.push( args.find( ( a ) => a.startsWith( '--output=' ) ) );
				context.onStdoutLine(
					JSON.stringify( {
						type: 'publication.completed',
						phase: 'published',
						result: { phase: 'published', remote, verification: { visibility: 'coming-soon' } },
					} )
				);
				return { code: 0, stdout: '', stderr: '' };
			} ),
		} );
		await publishOperation( f.directory, remote.url, { start } );
		await expect( publishOperation( f.directory, remote.url, { start } ) ).rejects.toThrow(
			'checked'
		);
		await publishOperation( f.directory, remote.url, { start, newAttempt: true } );
		expect( outputs ).toHaveLength( 2 );
		expect( outputs[ 1 ] ).not.toBe( outputs[ 0 ] );
	} );
	it( 'returns a failed spawn as an error result rather than hanging', async () => {
		const result = await launch( '/nonexistent-studio-operation-test', [] ).done;
		expect( result.code ).not.toBe( 0 );
		expect( result.stderr ).toContain( 'ENOENT' );
	} );
	it( 'clears previous success when a later publication fails verification', async () => {
		const f = fixture();
		await runOperation( f.spec, f.directory, { start: f.start, pollMs: 1, checkSite: checks } );
		const file = path.join( f.directory, 'status.json' );
		const state = JSON.parse( fs.readFileSync( file, 'utf8' ) );
		fs.writeFileSync(
			file,
			JSON.stringify( {
				...state,
				phase: 'published',
				publication: { verification: {} },
				result: { kind: 'verified-publication' },
			} )
		);
		const start = ( _command, _args, context ) => ( {
			done: Promise.resolve().then( () => {
				context.onStdoutLine(
					JSON.stringify( {
						type: 'publication.failed',
						result: { transferCompleted: true, error: 'Access check failed.' },
					} )
				);
				return { code: 1 };
			} ),
		} );
		await expect(
			publishOperation( f.directory, 'https://example.wpcomstaging.com', {
				start,
				newAttempt: true,
			} )
		).rejects.toThrow();
		expect( getStatus( f.directory ) ).toMatchObject( {
			phase: 'publication_failed',
			error: 'Access check failed.',
			result: { kind: 'publication-failure', transferCompleted: true, verification: null },
		} );
	} );
} );
