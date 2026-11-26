import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { sshSites } from '../sites';
import { useFakeServer } from './fake-ssh';

const FAKE_WP = `#!/bin/sh
case "$2" in *"get_bloginfo( 'name' )"*) ;; *) exit 1 ;; esac
echo 'Notice: a plugin talks first'
printf '{"home":"https://acme.test","name":"Acme","contentDir":"%s/wp-content","multisite":false}\\n' "$PWD"
`;

describe.skipIf( process.platform === 'win32' )( 'connecting an SSH site', () => {
	const server = useFakeServer( FAKE_WP );
	const site = () => {
		const folder = path.join( server.dir, 'it’s a site' );
		mkdirSync( folder, { recursive: true } );
		return folder;
	};

	it( 'reads the site in the folder, trusting a new host only now', async () => {
		const folder = site();
		await expect(
			sshSites.resolve!( undefined, {
				input: { host: 'deploy@acme.test', path: `${ folder }/`, php: '' },
			} )
		).resolves.toEqual( {
			id: `deploy@acme.test:${ folder }`,
			name: 'Acme',
			url: 'https://acme.test',
			contentDir: `${ folder }/wp-content`,
		} );
		expect( readFileSync( path.join( server.dir, 'args' ), 'utf8' ) ).toContain(
			'StrictHostKeyChecking=accept-new'
		);
	} );

	it( 'runs WP-CLI on the WordPress that the site’s wp-load.php links to', async () => {
		const folder = site();
		mkdirSync( path.join( folder, '__wp__' ) );
		writeFileSync( path.join( folder, '__wp__/wp-load.php' ), '' );
		symlinkSync( '__wp__/wp-load.php', path.join( folder, 'wp-load.php' ) );
		await sshSites.resolve!( undefined, { input: { host: 'deploy@acme.test', path: folder } } );
		expect( readFileSync( path.join( server.dir, 'php.log' ), 'utf8' ) ).toContain(
			`--path=${ folder }/__wp__ `
		);
	} );

	it( 'reaches a site by its id, with its port', async () => {
		const folder = site();
		await expect(
			sshSites.resolve!( undefined, { id: `ssh://deploy@acme.test:2222${ folder }` } )
		).resolves.toMatchObject( { id: `ssh://deploy@acme.test:2222${ folder }` } );
	} );

	it( 'says what to fix when the server refuses the key', async () => {
		vi.stubEnv( 'FAKE_SSH_FAIL', 'deploy@acme.test: Permission denied (publickey).' );
		await expect(
			sshSites.resolve!( undefined, { input: { host: 'deploy@acme.test', path: site() } } )
		).rejects.toMatchObject( { code: 'ssh_auth' } );
	} );
} );
