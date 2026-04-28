import { describe, expect, it } from 'vitest';
import {
	buildLinuxTrustInstallCommand,
	LINUX_SYSTEM_CA_BUNDLE,
	LINUX_TRUST_STORE_PATH,
} from '@studio/common/lib/linux-trust-store';

describe( 'linux-trust-store', () => {
	describe( 'constants', () => {
		it( 'targets the Debian/Ubuntu system trust bundle', () => {
			expect( LINUX_SYSTEM_CA_BUNDLE ).toBe( '/etc/ssl/certs/ca-certificates.crt' );
		} );

		it( 'installs into the locally-administered trust store directory', () => {
			expect( LINUX_TRUST_STORE_PATH ).toBe( '/usr/local/share/ca-certificates/studio-ca.crt' );
		} );
	} );

	describe( 'buildLinuxTrustInstallCommand', () => {
		it( 'composes an install + update-ca-certificates command targeting the system trust store', () => {
			const command = buildLinuxTrustInstallCommand( '/home/u/.studio/certificates/studio-ca.crt' );

			expect( command ).toBe(
				`install -m 0644 "/home/u/.studio/certificates/studio-ca.crt" "${ LINUX_TRUST_STORE_PATH }" && update-ca-certificates`
			);
		} );

		it( 'quotes the source path so home directories with spaces are handled', () => {
			const command = buildLinuxTrustInstallCommand(
				'/home/Some User/.studio/certificates/studio-ca.crt'
			);

			expect( command ).toContain( '"/home/Some User/.studio/certificates/studio-ca.crt"' );
		} );
	} );
} );
