import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { uploadWpCli, withSsh } from '../shell';
import { useFakeServer } from './fake-ssh';

describe.skipIf( process.platform === 'win32' )( 'SSH connections', () => {
	const server = useFakeServer( '' );
	const site = () => {
		const folder = path.join( server.dir, 'www' );
		mkdirSync( folder, { recursive: true } );
		return { destination: 'deploy@acme.test', path: folder, php: 'php' };
	};
	const calls = () =>
		readFileSync( path.join( server.dir, 'args.log' ), 'utf8' )
			.trim()
			.split( '\n' )
			.map( ( call ) => /ControlMaster=\w+|-O exit/.exec( call )?.[ 0 ] ?? 'own' );

	it( 'shares one connection between commands, and gives a transfer its own', async () => {
		await withSsh( site(), async ( ssh ) => {
			await ssh.run( 'true' );
			await ssh.transfer( 'true' );
		} );
		expect( calls() ).toEqual( [ 'ControlMaster=yes', 'ControlMaster=no', 'own', '-O exit' ] );
	} );

	it( 'puts Studio’s WP-CLI on the server once, by its hash, in place of older ones', async () => {
		const folder = path.join( server.dir, '.studio-sync' );
		mkdirSync( folder );
		writeFileSync( path.join( folder, 'wp-cli-0123456789ab.phar' ), 'old' );
		const name = await withSsh( site(), ( ssh ) => uploadWpCli( ssh, site() ) );
		await withSsh( site(), ( ssh ) => uploadWpCli( ssh, site() ) );
		expect( name ).toMatch( /^wp-cli-[0-9a-f]{12}\.phar$/ );
		expect( readdirSync( folder ) ).toEqual( [ name ] );
		expect( readFileSync( path.join( folder, name ), 'utf8' ) ).toBe( 'phar' );
		expect( calls().filter( ( call ) => call === 'own' ) ).toHaveLength( 1 );
	} );

	it( 'says so when the server has no PHP', async () => {
		rmSync( path.join( server.dir, 'php' ) );
		vi.stubEnv( 'PATH', `${ server.dir }${ path.delimiter }/usr/bin${ path.delimiter }/bin` );
		await expect( withSsh( site(), ( ssh ) => uploadWpCli( ssh, site() ) ) ).rejects.toMatchObject(
			{ code: 'ssh_php' }
		);
	} );
} );
