import fs from 'node:fs';
import {
	buildLinuxTrustInstallCommand,
	importCAIntoUserNssDbsLinux,
	isCAImportedInUserNssDbsLinux,
	isCATrustedOnLinux,
} from '@studio/common/lib/linux-trust-store';
import sudo from '@vscode/sudo-prompt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isRootCATrusted, trustRootCA } from 'cli/lib/certificate-manager';

const { execFileMock } = vi.hoisted( () => ( { execFileMock: vi.fn() } ) );
vi.mock( 'node:child_process', () => ( {
	execFile: execFileMock,
	default: { execFile: execFileMock },
} ) );

vi.mock( '@studio/common/lib/linux-trust-store', () => ( {
	LINUX_TRUST_STORE_PATH: '/usr/local/share/ca-certificates/studio-ca.crt',
	LINUX_NSS_NICKNAME: 'WordPress Studio CA',
	isCATrustedOnLinux: vi.fn(),
	isCAImportedInUserNssDbsLinux: vi.fn(),
	buildLinuxTrustInstallCommand: vi.fn(),
	importCAIntoUserNssDbsLinux: vi.fn(),
} ) );

vi.mock( '@vscode/sudo-prompt', () => ( {
	default: {
		exec: vi.fn(),
	},
} ) );

const mockedIsCATrustedOnLinux = vi.mocked( isCATrustedOnLinux );
const mockedIsCAImportedInUserNssDbsLinux = vi.mocked( isCAImportedInUserNssDbsLinux );
const mockedBuildLinuxTrustInstallCommand = vi.mocked( buildLinuxTrustInstallCommand );
const mockedImportCAIntoUserNssDbsLinux = vi.mocked( importCAIntoUserNssDbsLinux );
const mockedSudoExec = vi.mocked( sudo.exec );

type SudoExecCallback = ( error?: Error, stdout?: string, stderr?: string ) => void;

const stubSudoExec = ( error?: Error ) => {
	mockedSudoExec.mockImplementation( ( ( ..._args: unknown[] ) => {
		const cb = _args[ _args.length - 1 ] as SudoExecCallback;
		cb( error );
	} ) as unknown as typeof sudo.exec );
};

const setPlatform = ( platform: NodeJS.Platform ) => {
	Object.defineProperty( process, 'platform', { value: platform, configurable: true } );
};

describe( 'certificate-manager (Linux)', () => {
	const originalPlatform = process.platform;
	let existsSpy: ReturnType< typeof vi.spyOn >;
	beforeEach( () => {
		mockedIsCATrustedOnLinux.mockReset();
		mockedIsCAImportedInUserNssDbsLinux.mockReset();
		mockedBuildLinuxTrustInstallCommand.mockReset();
		mockedImportCAIntoUserNssDbsLinux.mockReset();
		mockedSudoExec.mockReset();
		mockedBuildLinuxTrustInstallCommand.mockReturnValue(
			'install -m 0644 "/home/user/.studio/certificates/studio-ca.crt" "/usr/local/share/ca-certificates/studio-ca.crt" && update-ca-certificates'
		);
		mockedImportCAIntoUserNssDbsLinux.mockResolvedValue( undefined );
		// Default: NSS DBs are populated. Override per-test for the
		// install-browser-after-trust scenario.
		mockedIsCAImportedInUserNssDbsLinux.mockResolvedValue( true );
		existsSpy = vi.spyOn( fs, 'existsSync' ).mockReturnValue( true );
	} );

	afterEach( () => {
		existsSpy.mockRestore();
		setPlatform( originalPlatform );
	} );

	describe( 'isRootCATrusted', () => {
		it( 'returns true on Linux only when both system bundle AND NSS DBs are populated', async () => {
			setPlatform( 'linux' );
			mockedIsCATrustedOnLinux.mockResolvedValue( true );
			mockedIsCAImportedInUserNssDbsLinux.mockResolvedValue( true );

			await expect( isRootCATrusted() ).resolves.toBe( true );

			expect( mockedIsCATrustedOnLinux ).toHaveBeenCalledWith(
				expect.stringContaining( 'studio-ca.crt' )
			);
			expect( mockedIsCAImportedInUserNssDbsLinux ).toHaveBeenCalled();
		} );

		it( 'returns false on Linux when the system bundle is missing the CA', async () => {
			setPlatform( 'linux' );
			mockedIsCATrustedOnLinux.mockResolvedValue( false );
			mockedIsCAImportedInUserNssDbsLinux.mockResolvedValue( true );

			await expect( isRootCATrusted() ).resolves.toBe( false );
		} );

		it( 'returns false on Linux when an NSS DB is missing the CA (install-browser-after-trust)', async () => {
			// Repro: Snap-Chromium installed *after* the initial trust — system
			// bundle is happy, but the new browser's NSS DB is empty.
			setPlatform( 'linux' );
			mockedIsCATrustedOnLinux.mockResolvedValue( true );
			mockedIsCAImportedInUserNssDbsLinux.mockResolvedValue( false );

			await expect( isRootCATrusted() ).resolves.toBe( false );
		} );

		it( 'returns false when the CA file does not exist on disk (no platform branch entered)', async () => {
			setPlatform( 'linux' );
			existsSpy.mockReturnValue( false );

			await expect( isRootCATrusted() ).resolves.toBe( false );
			expect( mockedIsCATrustedOnLinux ).not.toHaveBeenCalled();
			expect( mockedIsCAImportedInUserNssDbsLinux ).not.toHaveBeenCalled();
		} );

		describe( 'macOS', () => {
			// Resolve or reject the promisified execFile via its trailing callback.
			const stubExecFile = ( error?: Error ) => {
				execFileMock.mockImplementation( ( ( ..._args: unknown[] ) => {
					const cb = _args[ _args.length - 1 ] as ( e: Error | null, r: object ) => void;
					cb( error ?? null, { stdout: '', stderr: '' } );
				} ) as never );
			};

			beforeEach( () => {
				setPlatform( 'darwin' );
				execFileMock.mockReset();
			} );

			it( 'evaluates against the system trust store, not the CA as its own anchor', async () => {
				stubExecFile();

				await expect( isRootCATrusted() ).resolves.toBe( true );

				const [ , args ] = execFileMock.mock.calls[ 0 ];
				expect( args ).not.toContain( '-r' );
				expect( args ).toEqual( [
					'verify-cert',
					'-c',
					expect.stringContaining( 'studio-ca.crt' ),
					'-p',
					'ssl',
					'-l',
				] );
			} );

			it( 'returns false when the CA is not trusted by the system', async () => {
				stubExecFile( new Error( 'CSSMERR_TP_NOT_TRUSTED' ) );

				await expect( isRootCATrusted() ).resolves.toBe( false );
			} );
		} );
	} );

	describe( 'trustRootCA', () => {
		beforeEach( () => {
			setPlatform( 'linux' );
		} );

		it( 'invokes sudo.exec with the install command on Linux when not yet trusted', async () => {
			mockedIsCATrustedOnLinux.mockResolvedValue( false );
			mockedIsCAImportedInUserNssDbsLinux.mockResolvedValue( false );
			stubSudoExec();

			await expect( trustRootCA() ).resolves.toBeUndefined();

			expect( mockedBuildLinuxTrustInstallCommand ).toHaveBeenCalledWith(
				expect.stringContaining( 'studio-ca.crt' )
			);
			expect( mockedSudoExec ).toHaveBeenCalledTimes( 1 );
			const [ command, options ] = mockedSudoExec.mock.calls[ 0 ];
			expect( command ).toContain( 'update-ca-certificates' );
			expect( command ).toContain( '/usr/local/share/ca-certificates/studio-ca.crt' );
			expect( options ).toEqual( { name: 'WordPress Studio' } );
		} );

		it( 'imports the CA into per-user NSS DBs after the system install succeeds', async () => {
			mockedIsCATrustedOnLinux.mockResolvedValue( false );
			mockedIsCAImportedInUserNssDbsLinux.mockResolvedValue( false );
			stubSudoExec();

			await trustRootCA();

			expect( mockedImportCAIntoUserNssDbsLinux ).toHaveBeenCalledWith(
				expect.stringContaining( 'studio-ca.crt' )
			);
			// NSS import must run *after* the sudo install.
			const sudoOrder = mockedSudoExec.mock.invocationCallOrder[ 0 ];
			const nssOrder = mockedImportCAIntoUserNssDbsLinux.mock.invocationCallOrder[ 0 ];
			expect( nssOrder ).toBeGreaterThan( sudoOrder );
		} );

		it( 'does not import into NSS DBs when the system install fails', async () => {
			mockedIsCATrustedOnLinux.mockResolvedValue( false );
			mockedIsCAImportedInUserNssDbsLinux.mockResolvedValue( false );
			stubSudoExec( new Error( 'pkexec dismissed' ) );

			await expect( trustRootCA() ).rejects.toThrow();

			expect( mockedImportCAIntoUserNssDbsLinux ).not.toHaveBeenCalled();
		} );

		it( 'rejects when sudo.exec reports an error', async () => {
			mockedIsCATrustedOnLinux.mockResolvedValue( false );
			mockedIsCAImportedInUserNssDbsLinux.mockResolvedValue( false );
			stubSudoExec( new Error( 'user dismissed pkexec prompt' ) );

			await expect( trustRootCA() ).rejects.toThrow( 'user dismissed pkexec prompt' );
		} );

		it( 'short-circuits when the CA is fully trusted (system bundle + every NSS DB)', async () => {
			mockedIsCATrustedOnLinux.mockResolvedValue( true );
			mockedIsCAImportedInUserNssDbsLinux.mockResolvedValue( true );

			await expect( trustRootCA() ).resolves.toBeUndefined();
			expect( mockedSudoExec ).not.toHaveBeenCalled();
			expect( mockedImportCAIntoUserNssDbsLinux ).not.toHaveBeenCalled();
		} );

		it( 'skips sudo but still imports into NSS when system bundle is already trusted (install-browser-after-trust)', async () => {
			// Repro: user clicks **Trust Certificate** after installing
			// Snap-Chromium. System bundle is already populated, so polkit
			// shouldn't reprompt — but NSS DBs need to be re-synced because the
			// new browser's sandboxed DB started empty.
			mockedIsCATrustedOnLinux.mockResolvedValue( true );
			mockedIsCAImportedInUserNssDbsLinux.mockResolvedValue( false );

			await expect( trustRootCA() ).resolves.toBeUndefined();

			expect( mockedSudoExec ).not.toHaveBeenCalled();
			expect( mockedImportCAIntoUserNssDbsLinux ).toHaveBeenCalledWith(
				expect.stringContaining( 'studio-ca.crt' )
			);
		} );
	} );
} );
