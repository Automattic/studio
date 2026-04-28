import fs from 'node:fs';
import {
	buildLinuxTrustInstallCommand,
	isCATrustedOnLinux,
} from '@studio/common/lib/linux-trust-store';
import sudo from '@vscode/sudo-prompt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isRootCATrusted, trustRootCA } from 'cli/lib/certificate-manager';

vi.mock( '@studio/common/lib/linux-trust-store', () => ( {
	LINUX_TRUST_STORE_PATH: '/usr/local/share/ca-certificates/studio-ca.crt',
	isCATrustedOnLinux: vi.fn(),
	buildLinuxTrustInstallCommand: vi.fn(),
} ) );

vi.mock( '@vscode/sudo-prompt', () => ( {
	default: {
		exec: vi.fn(),
	},
} ) );

const mockedIsCATrustedOnLinux = vi.mocked( isCATrustedOnLinux );
const mockedBuildLinuxTrustInstallCommand = vi.mocked( buildLinuxTrustInstallCommand );
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
		mockedBuildLinuxTrustInstallCommand.mockReset();
		mockedSudoExec.mockReset();
		mockedBuildLinuxTrustInstallCommand.mockReturnValue(
			'install -m 0644 "/home/user/.studio/certificates/studio-ca.crt" "/usr/local/share/ca-certificates/studio-ca.crt" && update-ca-certificates'
		);
		existsSpy = vi.spyOn( fs, 'existsSync' ).mockReturnValue( true );
	} );

	afterEach( () => {
		existsSpy.mockRestore();
		setPlatform( originalPlatform );
	} );

	describe( 'isRootCATrusted', () => {
		it( 'delegates to isCATrustedOnLinux on Linux and returns its result', async () => {
			setPlatform( 'linux' );
			mockedIsCATrustedOnLinux.mockResolvedValue( true );

			const result = await isRootCATrusted();
			expect( result ).toBe( true );

			expect( mockedIsCATrustedOnLinux ).toHaveBeenCalledWith(
				expect.stringContaining( 'studio-ca.crt' )
			);
		} );

		it( 'returns false on Linux when isCATrustedOnLinux returns false', async () => {
			setPlatform( 'linux' );
			mockedIsCATrustedOnLinux.mockResolvedValue( false );

			await expect( isRootCATrusted() ).resolves.toBe( false );
		} );

		it( 'returns false when the CA file does not exist on disk (no platform branch entered)', async () => {
			setPlatform( 'linux' );
			existsSpy.mockReturnValue( false );

			await expect( isRootCATrusted() ).resolves.toBe( false );
			expect( mockedIsCATrustedOnLinux ).not.toHaveBeenCalled();
		} );
	} );

	describe( 'trustRootCA', () => {
		it( 'invokes sudo.exec with the install command on Linux when not yet trusted', async () => {
			setPlatform( 'linux' );
			mockedIsCATrustedOnLinux.mockResolvedValue( false );
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

		it( 'rejects when sudo.exec reports an error', async () => {
			setPlatform( 'linux' );
			mockedIsCATrustedOnLinux.mockResolvedValue( false );
			stubSudoExec( new Error( 'user dismissed pkexec prompt' ) );

			await expect( trustRootCA() ).rejects.toThrow( 'user dismissed pkexec prompt' );
		} );

		it( 'short-circuits when the CA is already trusted', async () => {
			setPlatform( 'linux' );
			mockedIsCATrustedOnLinux.mockResolvedValue( true );

			await expect( trustRootCA() ).resolves.toBeUndefined();
			expect( mockedSudoExec ).not.toHaveBeenCalled();
		} );
	} );
} );
