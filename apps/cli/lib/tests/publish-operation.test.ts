import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { publishOperation } from '../publish-operation';
import type { PublishServices, Visibility, LocalAccessOptions } from '../publish-operation';
const folders: string[] = [];
afterEach( () => {
	for ( const directory of folders.splice( 0 ) )
		fs.rmSync( directory, { recursive: true, force: true } );
} );
function fixture() {
	const directory = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-publish-test-' ) );
	folders.push( directory );
	let visibility: Visibility = {
		id: 908,
		url: 'https://example.wpcomstaging.com',
		private: false,
		comingSoon: true,
		blogPublic: 0,
		launchStatus: 'unlaunched',
	};
	let local = '1';
	let localAccess: LocalAccessOptions = { wpcom_coming_soon: null, wpcom_public_coming_soon: null };
	const calls: string[] = [];
	const services: PublishServices = {
		resolve: async () => ( { id: 908, url: visibility.url } ),
		snapshot: async () => ( { ...visibility } ),
		verifyAccess: async () => 'access.png',
		makePrivate: async () => {
			calls.push( 'private' );
			visibility = { ...visibility, private: true, comingSoon: false, blogPublic: -1 };
		},
		manifest: async () => ( {
			pages: [ { slug: 'home', title: 'Home', hash: 'abc' } ],
			media: [ { file: 'ducks.webp' } ],
		} ),
		localVisibility: async () => local,
		localAccessOptions: async () => ( { ...localAccess } ),
		setLocalAccessOptions: async ( value ) => {
			localAccess = { ...value };
		},
		withLocalExportLock: async ( action ) => action(),
		setLocalVisibility: async ( value ) => {
			local = value;
			calls.push( 'local:' + value );
		},
		push: async ( _remote, hooks ) => {
			calls.push( 'push' );
			hooks.onPhase( 'creatingBackup' );
			try {
				await hooks.beforeExport();
				calls.push( 'export:' + local );
				expect( hooks.excludePatterns ).toContain( '/wp-content/mu-plugins/0-preview-offline.php' );
			} finally {
				await hooks.afterExport();
			}
			hooks.onPhase( 'uploading', 0 );
			calls.push( 'upload:' + local );
			hooks.onPhase( 'applyingChanges', 100 );
		},
		verify: async ( _remote, _manifest, expected ) => {
			calls.push( 'verify:' + expected.blogPublic );
			return {
				pages: 1,
				media: 1,
				visibility: expected.private ? 'private' : 'coming-soon',
				screenshot: 'access.png',
			};
		},
	};
	const options = {
		sitePath: '/tmp/source-site',
		remoteSite: 'https://example.wpcomstaging.com',
		visibility: 'preserve' as const,
		directory,
		mode: 'publish' as const,
	};
	return {
		directory,
		services,
		options,
		calls,
		get local() {
			return local;
		},
		get localAccess() {
			return localAccess;
		},
		set visibility( value: Visibility ) {
			visibility = value;
		},
	};
}
describe( 'publication operation', () => {
	it( 'honors cancellation during the access check before reporting a plan', async () => {
		const f = fixture();
		const controller = new AbortController();
		f.services.verifyAccess = async () => {
			controller.abort();
			return 'access.png';
		};
		await expect(
			publishOperation( { ...f.options, mode: 'plan' }, f.services, () => {}, controller.signal )
		).rejects.toThrow( 'cancelled' );
	} );
	it.each( [ 'plan', 'publish' ] as const )(
		'blocks %s when metadata and anonymous access disagree',
		async ( mode ) => {
			const f = fixture();
			f.services.verifyAccess = async () => {
				throw new Error( 'Coming Soon is not protecting the published site.' );
			};
			await expect( publishOperation( { ...f.options, mode }, f.services ) ).rejects.toThrow(
				'Coming Soon'
			);
			expect( f.calls ).toEqual( [] );
			expect( f.local ).toBe( '1' );
			expect( f.localAccess ).toEqual( {
				wpcom_coming_soon: null,
				wpcom_public_coming_soon: null,
			} );
		}
	);
	it( 'rechecks blog_public after staging Coming Soon options', async () => {
		const f = fixture();
		const set = f.services.setLocalAccessOptions;
		f.services.setLocalAccessOptions = async ( value ) => {
			await set( value );
			if ( value.wpcom_public_coming_soon === 1 ) await f.services.setLocalVisibility( '1' );
		};
		await expect( publishOperation( f.options, f.services ) ).rejects.toThrow( 'transfer blocked' );
		expect( f.calls ).not.toContain( 'export:1' );
		expect( f.calls ).not.toContain( 'upload:1' );
	} );
	it( 'keeps public noindex distinct from Coming Soon during export', async () => {
		const f = fixture();
		f.visibility = {
			id: 908,
			url: f.options.remoteSite,
			private: false,
			comingSoon: false,
			blogPublic: 0,
			launchStatus: 'launched',
		};
		const push = f.services.push;
		f.services.push = async ( remote, hooks ) =>
			push( remote, {
				...hooks,
				beforeExport: async () => {
					await hooks.beforeExport();
					expect( f.localAccess ).toEqual( { wpcom_coming_soon: 0, wpcom_public_coming_soon: 0 } );
				},
			} );
		await publishOperation( f.options, f.services );
	} );
	it( 'uses the source-site export lock for interrupted cleanup', async () => {
		const f = fixture();
		await publishOperation( { ...f.options, mode: 'plan' }, f.services );
		const file = path.join( f.directory, 'receipt.json' );
		const receipt = JSON.parse( fs.readFileSync( file, 'utf8' ) );
		fs.writeFileSync(
			file,
			JSON.stringify( {
				...receipt,
				exportStaged: true,
				originalLocalVisibility: '1',
				originalLocalAccessOptions: { wpcom_coming_soon: null, wpcom_public_coming_soon: null },
			} )
		);
		let locked = false;
		const setOptions = f.services.setLocalAccessOptions;
		f.services.withLocalExportLock = async ( action ) => {
			locked = true;
			try {
				await action();
			} finally {
				locked = false;
			}
		};
		f.services.setLocalAccessOptions = async ( value ) => {
			expect( locked ).toBe( true );
			await setOptions( value );
		};
		await publishOperation( { ...f.options, mode: 'verify' }, f.services );
	} );
	it( 'blocks export when Coming Soon staging is rejected', async () => {
		const f = fixture();
		f.services.setLocalAccessOptions = async () => {};
		await expect( publishOperation( f.options, f.services ) ).rejects.toThrow( 'transfer blocked' );
		expect( f.calls ).not.toContain( 'export:0' );
		expect( f.calls ).not.toContain( 'upload:1' );
		expect( f.local ).toBe( '1' );
	} );
	it( 'stages Coming Soon independently from noindex and restores absent local flags', async () => {
		const f = fixture();
		const push = f.services.push;
		f.services.push = async ( remote, hooks ) =>
			push( remote, {
				...hooks,
				beforeExport: async () => {
					await hooks.beforeExport();
					expect( f.localAccess ).toEqual( { wpcom_coming_soon: 0, wpcom_public_coming_soon: 1 } );
				},
				afterExport: async () => {
					await hooks.afterExport();
					expect( f.localAccess ).toEqual( {
						wpcom_coming_soon: null,
						wpcom_public_coming_soon: null,
					} );
				},
			} );
		await publishOperation( f.options, f.services );
	} );
	it( 'resolves, stages only during export, restores before upload and verifies before success', async () => {
		const f = fixture();
		const events: string[] = [];
		const result = await publishOperation( f.options, f.services, ( event ) =>
			events.push( event.phase )
		);
		expect( f.calls ).toEqual( [
			'push',
			'local:0',
			'export:0',
			'local:1',
			'upload:1',
			'verify:0',
		] );
		expect( result.phase ).toBe( 'published' );
		expect( result.cleanupComplete ).toBe( true );
		expect( events.indexOf( 'verifying' ) ).toBeLessThan( events.indexOf( 'published' ) );
	} );
	it( 'plans without local changes, transfer or verification', async () => {
		const f = fixture();
		expect( ( await publishOperation( { ...f.options, mode: 'plan' }, f.services ) ).phase ).toBe(
			'planned'
		);
		expect( f.calls ).toEqual( [] );
	} );
	it( 'makes and verifies a private destination before exporting private content', async () => {
		const f = fixture();
		await publishOperation( { ...f.options, visibility: 'private' }, f.services );
		expect( f.calls ).toEqual( [
			'private',
			'push',
			'local:-1',
			'export:-1',
			'local:1',
			'upload:1',
			'verify:-1',
		] );
	} );
	it( 'fails closed if the requested private setting cannot be confirmed', async () => {
		const f = fixture();
		f.services.makePrivate = async () => {};
		await expect(
			publishOperation( { ...f.options, visibility: 'private' }, f.services )
		).rejects.toThrow( 'Private access' );
		expect( f.calls ).not.toContain( 'push' );
	} );
	it( 'restores local visibility when export fails', async () => {
		const f = fixture();
		f.services.push = async ( _remote, hooks ) => {
			try {
				await hooks.beforeExport();
				throw new Error( 'export failed' );
			} finally {
				await hooks.afterExport();
			}
		};
		await expect( publishOperation( f.options, f.services ) ).rejects.toThrow( 'export failed' );
		expect( f.local ).toBe( '1' );
	} );
	it( 'does not replay an uncertain transfer, including through replanning', async () => {
		const f = fixture();
		f.services.push = async ( _remote, hooks ) => {
			hooks.onPhase( 'uploading', 20 );
			throw new Error( 'network disconnected' );
		};
		await expect( publishOperation( f.options, f.services ) ).rejects.toThrow(
			'network disconnected'
		);
		const before = fs.readFileSync( path.join( f.directory, 'receipt.json' ), 'utf8' );
		for ( const mode of [ 'publish', 'plan' ] as const )
			await expect( publishOperation( { ...f.options, mode }, f.services ) ).rejects.toThrow(
				'do not replay'
			);
		expect( fs.readFileSync( path.join( f.directory, 'receipt.json' ), 'utf8' ) ).toBe( before );
	} );
	it( 'verifies an existing transfer without pushing again', async () => {
		const f = fixture();
		await publishOperation( f.options, f.services );
		f.calls.splice( 0 );
		expect( ( await publishOperation( { ...f.options, mode: 'verify' }, f.services ) ).phase ).toBe(
			'verified'
		);
		expect( f.calls ).toEqual( [ 'verify:0' ] );
	} );
	it( 'rejects a changed destination before transfer', async () => {
		const f = fixture();
		await publishOperation( { ...f.options, mode: 'plan' }, f.services );
		f.visibility = {
			id: 908,
			url: 'https://example.wpcomstaging.com',
			private: false,
			comingSoon: false,
			blogPublic: 1,
			launchStatus: 'launched',
		};
		await expect( publishOperation( f.options, f.services ) ).rejects.toThrow(
			'changed since preflight'
		);
		expect( f.calls ).toEqual( [] );
	} );
	it( 'does not claim success when content or visibility verification fails', async () => {
		const f = fixture();
		f.services.verify = async () => {
			throw new Error( 'missing photo' );
		};
		await expect( publishOperation( f.options, f.services ) ).rejects.toThrow( 'missing photo' );
		expect(
			JSON.parse( fs.readFileSync( path.join( f.directory, 'receipt.json' ), 'utf8' ) ).phase
		).toBe( 'needs-verification' );
	} );
	it( 'preserves a concurrent local change and records failed cleanup', async () => {
		const f = fixture();
		f.services.push = async ( _remote, hooks ) => {
			await hooks.beforeExport();
			await f.services.setLocalVisibility( '-1' );
			await hooks.afterExport();
		};
		await expect( publishOperation( f.options, f.services ) ).rejects.toThrow( 'concurrently' );
		expect( f.local ).toBe( '-1' );
		expect(
			JSON.parse( fs.readFileSync( path.join( f.directory, 'receipt.json' ), 'utf8' ) )
				.cleanupComplete
		).toBe( false );
	} );
	it( 'ignores cancellation after upload starts and completes verification', async () => {
		const f = fixture();
		const controller = new AbortController(),
			push = f.services.push;
		f.services.push = async ( remote, hooks ) =>
			push( remote, {
				...hooks,
				onPhase: ( phase, progress ) => {
					hooks.onPhase( phase, progress );
					if ( phase === 'uploading' ) controller.abort();
				},
			} );
		expect(
			( await publishOperation( f.options, f.services, () => {}, controller.signal ) ).phase
		).toBe( 'published' );
	} );
	it( 'rejects cancellation before transferring', async () => {
		const f = fixture();
		const controller = new AbortController();
		controller.abort();
		await expect(
			publishOperation( f.options, f.services, () => {}, controller.signal )
		).rejects.toThrow( 'cancelled' );
		expect( f.calls ).toEqual( [] );
	} );
	it( 'honors cancellation during preflight before changing remote privacy', async () => {
		const f = fixture();
		const controller = new AbortController();
		const snapshot = f.services.snapshot;
		f.services.snapshot = async ( remote ) => {
			controller.abort();
			return snapshot( remote );
		};
		await expect(
			publishOperation(
				{ ...f.options, visibility: 'private' },
				f.services,
				() => {},
				controller.signal
			)
		).rejects.toThrow( 'cancelled' );
		expect( f.calls ).not.toContain( 'private' );
	} );
	it.each( [ 'source', 'operation', 'visibility' ] )( 'binds receipts to %s', async ( changed ) => {
		const f = fixture();
		const options = { ...f.options, operationId: 'original' };
		await publishOperation( { ...options, mode: 'plan' }, f.services );
		await expect(
			publishOperation(
				{
					...options,
					...( changed === 'source' ? { sitePath: '/tmp/other-site' } : {} ),
					...( changed === 'operation' ? { operationId: 'other' } : {} ),
					...( changed === 'visibility' ? { visibility: 'private' as const } : {} ),
				},
				f.services
			)
		).rejects.toThrow( 'another source, operation, or visibility' );
		expect( f.calls ).not.toContain( 'push' );
	} );
	it.each( [ 'plan', 'publish' ] as const )(
		'keeps interrupted cleanup evidence during %s',
		async ( mode ) => {
			const f = fixture();
			await publishOperation( { ...f.options, mode: 'plan' }, f.services );
			const file = path.join( f.directory, 'receipt.json' );
			const receipt = {
				...JSON.parse( fs.readFileSync( file, 'utf8' ) ),
				exportStaged: true,
				originalLocalVisibility: '1',
			};
			fs.writeFileSync( file, JSON.stringify( receipt ) );
			await expect( publishOperation( { ...f.options, mode }, f.services ) ).rejects.toThrow(
				'verify-only cleanup'
			);
			expect( JSON.parse( fs.readFileSync( file, 'utf8' ) ) ).toEqual( receipt );
			expect( f.calls ).not.toContain( 'push' );
		}
	);
	it( 'reads replay protection after acquiring the lock', async () => {
		const f = fixture();
		await publishOperation( { ...f.options, mode: 'plan' }, f.services );
		const open = fs.openSync;
		const spy = vi
			.spyOn( fs, 'openSync' )
			.mockImplementation( ( ...args: Parameters< typeof fs.openSync > ) => {
				if ( String( args[ 0 ] ).endsWith( 'owner.lock' ) ) {
					const file = path.join( f.directory, 'receipt.json' );
					const receipt = JSON.parse( fs.readFileSync( file, 'utf8' ) );
					fs.writeFileSync( file, JSON.stringify( { ...receipt, transferStarted: true } ) );
				}
				return open( ...args );
			} );
		try {
			await expect( publishOperation( f.options, f.services ) ).rejects.toThrow( 'do not replay' );
		} finally {
			spy.mockRestore();
		}
		expect( f.calls ).not.toContain( 'push' );
	} );
	it.each( [ '123e3', '123foo', '908\n', 'https://example.com/path' ] )(
		'rejects a nonexact destination %s',
		async ( remoteSite ) => {
			const f = fixture();
			await expect( publishOperation( { ...f.options, remoteSite }, f.services ) ).rejects.toThrow(
				'exact'
			);
		}
	);
} );
