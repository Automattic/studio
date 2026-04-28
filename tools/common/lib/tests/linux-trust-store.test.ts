import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	buildLinuxTrustInstallCommand,
	getLinuxNssDbCandidates,
	LINUX_NSS_NICKNAME,
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

		it( 'uses a stable nickname for the imported NSS entry', () => {
			expect( LINUX_NSS_NICKNAME ).toBe( 'WordPress Studio CA' );
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

	describe( 'getLinuxNssDbCandidates', () => {
		// Use a real tmp dir so the existsSync check inside the helper sees what we set up.
		let tmpHome: string;

		beforeEach( () => {
			tmpHome = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-nss-test-' ) );
		} );

		afterEach( () => {
			fs.rmSync( tmpHome, { recursive: true, force: true } );
		} );

		it( 'always includes ~/.pki/nssdb (apt Chromium-family DB)', () => {
			const candidates = getLinuxNssDbCandidates( tmpHome );

			expect( candidates ).toContain( path.join( tmpHome, '.pki', 'nssdb' ) );
		} );

		it( 'omits the snap-chromium NSS path when snap-chromium is not installed', () => {
			const candidates = getLinuxNssDbCandidates( tmpHome );

			expect( candidates ).not.toContain(
				path.join( tmpHome, 'snap', 'chromium', 'current', '.pki', 'nssdb' )
			);
		} );

		it( 'includes the snap-chromium NSS path when ~/snap/chromium exists', () => {
			fs.mkdirSync( path.join( tmpHome, 'snap', 'chromium' ), { recursive: true } );

			const candidates = getLinuxNssDbCandidates( tmpHome );

			expect( candidates ).toContain(
				path.join( tmpHome, 'snap', 'chromium', 'current', '.pki', 'nssdb' )
			);
		} );
	} );
} );
