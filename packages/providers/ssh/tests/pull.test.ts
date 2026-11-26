import { execFileSync } from 'node:child_process';
import { createWriteStream, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { sshSites } from '../sites';
import { useFakeServer } from './fake-ssh';

const FAKE_WP = `#!/bin/sh
case "$1 $2" in
	'db tables') echo acme_options,acme_posts ;;
	'db export') echo dump > "$3"; echo "$4" > "$HOME/export-tables" ;;
esac
`;

describe.skipIf( process.platform === 'win32' )( 'pulling over SSH', () => {
	const server = useFakeServer( FAKE_WP );

	async function pull( optionsToSync: ( 'all' | 'plugins' )[] ) {
		const root = path.join( server.dir, 'www' );
		const content = path.join( root, 'app' );
		for ( const file of [
			'plugins/akismet/akismet.php',
			'plugins/.htaccess',
			'uploads/a.jpg',
			'cache/page.html',
			'object-cache.php',
		] ) {
			mkdirSync( path.dirname( path.join( content, file ) ), { recursive: true } );
			writeFileSync( path.join( content, file ), file );
		}
		// A plugin the host manages, linked from a folder of its own.
		mkdirSync( path.join( server.dir, 'managed/jetpack' ), { recursive: true } );
		writeFileSync( path.join( server.dir, 'managed/jetpack/jetpack.php' ), 'jetpack' );
		symlinkSync(
			path.join( server.dir, 'managed/jetpack' ),
			path.join( content, 'plugins/jetpack' )
		);
		const archive = path.join( server.dir, 'pull.tar' );
		const percents: number[] = [];
		await sshSites.pullArchive!(
			undefined,
			{
				id: `deploy@acme.test:${ root }`,
				name: 'Acme',
				url: 'https://acme.test',
				contentDir: content,
			},
			{ optionsToSync },
			Writable.toWeb( createWriteStream( archive ) ),
			( percent ) => percents.push( percent )
		);
		return {
			entries: execFileSync( 'tar', [ '-tf', archive ], { encoding: 'utf8' } )
				.split( '\n' )
				.filter( ( entry ) => entry && ! entry.endsWith( '/' ) )
				.sort(),
			percents,
		};
	}

	it( 'sends the database and content in Studio’s layout, with linked plugins and without caches or drop-ins', async () => {
		const { entries, percents } = await pull( [ 'all' ] );
		expect( entries ).toEqual( [
			'sql/database.sql',
			'wp-content/plugins/.htaccess',
			'wp-content/plugins/akismet/akismet.php',
			'wp-content/plugins/jetpack/jetpack.php',
			'wp-content/uploads/a.jpg',
		] );
		expect( percents.at( -1 ) ).toBeGreaterThan( 0 );
		expect(
			readdirSync( path.join( server.dir, '.studio-sync' ) ).filter( ( name ) =>
				name.startsWith( 'pull-' )
			)
		).toEqual( [] );
	} );

	it( 'sends only what was picked', async () => {
		const { entries } = await pull( [ 'plugins' ] );
		expect( entries ).toEqual( [
			'wp-content/plugins/.htaccess',
			'wp-content/plugins/akismet/akismet.php',
			'wp-content/plugins/jetpack/jetpack.php',
		] );
	} );
} );
