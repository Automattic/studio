import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	buildLinuxTrustInstallCommand,
	getLinuxFirefoxProfileDbDirs,
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
		// Real tmp dir — helper uses fs.existsSync, not a mock.
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

	describe( 'getLinuxFirefoxProfileDbDirs', () => {
		let tmpHome: string;

		beforeEach( () => {
			tmpHome = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-firefox-test-' ) );
		} );

		afterEach( () => {
			fs.rmSync( tmpHome, { recursive: true, force: true } );
		} );

		it( 'returns an empty list when no Firefox profile root exists', () => {
			expect( getLinuxFirefoxProfileDbDirs( tmpHome ) ).toEqual( [] );
		} );

		it( 'lists profile dirs that already have cert9.db across apt, snap, and flatpak roots', () => {
			const apt = path.join( tmpHome, '.mozilla', 'firefox', 'abc.default-release' );
			const snap = path.join(
				tmpHome,
				'snap',
				'firefox',
				'common',
				'.mozilla',
				'firefox',
				'xyz.default'
			);
			const flatpak = path.join(
				tmpHome,
				'.var',
				'app',
				'org.mozilla.firefox',
				'.mozilla',
				'firefox',
				'qqq.default-esr'
			);
			for ( const dir of [ apt, snap, flatpak ] ) {
				fs.mkdirSync( dir, { recursive: true } );
				fs.writeFileSync( path.join( dir, 'cert9.db' ), '' );
			}

			expect( getLinuxFirefoxProfileDbDirs( tmpHome ).sort() ).toEqual(
				[ apt, snap, flatpak ].sort()
			);
		} );

		it( 'skips profile dirs that lack cert9.db (Firefox installed but never opened)', () => {
			const fresh = path.join( tmpHome, '.mozilla', 'firefox', 'abc.default-release' );
			fs.mkdirSync( fresh, { recursive: true } );

			expect( getLinuxFirefoxProfileDbDirs( tmpHome ) ).toEqual( [] );
		} );

		it( 'skips non-default profile dirs', () => {
			const custom = path.join( tmpHome, '.mozilla', 'firefox', 'abc.custom-profile' );
			fs.mkdirSync( custom, { recursive: true } );
			fs.writeFileSync( path.join( custom, 'cert9.db' ), '' );

			expect( getLinuxFirefoxProfileDbDirs( tmpHome ) ).toEqual( [] );
		} );
	} );
} );
