import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { addSshHost, listSshHosts } from '../ssh-config';
import { useFakeServer } from './fake-ssh';

describe.skipIf( process.platform === 'win32' )( 'SSH config hosts', () => {
	const server = useFakeServer( '' );
	const ssh = ( file: string ) => path.join( server.dir, '.ssh', file );
	const writeSsh = ( file: string, text: string ) => {
		mkdirSync( path.dirname( ssh( file ) ), { recursive: true } );
		writeFileSync( ssh( file ), text );
	};

	it( 'lists the hosts of the config and the files it includes, without patterns', async () => {
		writeSsh(
			'config',
			'Include config.d/*/config\n# Host commented\nHost acme staging *.internal !bad\n\tUser deploy\nHost=quoted "spaced"\nHost *\n'
		);
		writeSsh( 'config.d/work/config', 'Host work\n' );
		await expect( listSshHosts() ).resolves.toEqual( [
			{ name: 'work', description: 'deploy@work.test' },
			{ name: 'acme', description: 'deploy@acme.test' },
			{ name: 'staging', description: 'deploy@staging.test' },
			{ name: 'quoted', description: 'deploy@quoted.test' },
			{ name: 'spaced', description: 'deploy@spaced.test' },
		] );
	} );

	it( 'adds a host to its own file, which the config includes first', async () => {
		writeSsh( 'config', 'Host *\n\tUser root\n' );
		writeSsh( 'id_ed25519', '' );
		await expect(
			addSshHost( {
				name: 'acme',
				server: 'deploy@acme.com',
				port: '2222',
				key: '~/.ssh/id_ed25519',
			} )
		).resolves.toMatchObject( { name: 'acme' } );
		expect( readFileSync( ssh( 'studio_config' ), 'utf8' ) ).toBe(
			'Host acme\n\tHostName acme.com\n\tUser deploy\n\tPort 2222\n\tIdentityFile ~/.ssh/id_ed25519\n\tIdentitiesOnly yes\n'
		);
		expect( readFileSync( ssh( 'config' ), 'utf8' ) ).toBe(
			'Include ~/.ssh/studio_config\n\nHost *\n\tUser root\n'
		);
		expect( readFileSync( path.join( server.dir, 'args' ), 'utf8' ) ).toContain( 'acme\ntrue' );

		await addSshHost( { name: 'shop', server: 'shop.com' } );
		expect( readFileSync( ssh( 'studio_config' ), 'utf8' ) ).toContain(
			'IdentitiesOnly yes\n\nHost shop\n\tHostName shop.com\n'
		);
		expect( readFileSync( ssh( 'config' ), 'utf8' ).match( /Include/g ) ).toHaveLength( 1 );
		expect( statSync( ssh( 'studio_config' ) ).mode & 0o777 ).toBe( 0o600 );
	} );

	it( 'refuses a name the config has, and leaves no host behind when ssh fails', async () => {
		writeSsh( 'config', 'Host acme\n' );
		await expect( addSshHost( { name: 'acme', server: 'acme.com' } ) ).rejects.toThrow(
			'already has a host named acme'
		);
		vi.stubEnv( 'FAKE_SSH_FAIL', 'shop: Permission denied (publickey).' );
		await expect( addSshHost( { name: 'shop', server: 'shop.com' } ) ).rejects.toMatchObject( {
			code: 'ssh_auth',
		} );
		expect( readFileSync( ssh( 'studio_config' ), 'utf8' ) ).toBe( '' );
	} );
} );
