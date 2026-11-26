import { execFileSync } from 'node:child_process';
import {
	createReadStream,
	existsSync,
	mkdirSync,
	readdirSync,
	lstatSync,
	readFileSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { sshSites } from '../sites';
import { useFakeServer } from './fake-ssh';
import type { PushStatus } from '../../types';

// WP-CLI on a server whose tables are prefixed `acme_`: it logs what it's asked to do.
const FAKE_WP = `#!/bin/sh
log="$HOME/wp.log"
case "$1 $2" in
	'db prefix') echo acme_ ;;
	'db tables') echo acme_options,acme_posts,acme_users ;;
	'db export') echo "export $4" >> "$log"; echo dump > "$3" ;;
	'db import') cat >> "$HOME/imported.sql" ;;
	'cache flush') echo flush >> "$log" ;;
	eval*) case "$2" in
		*'RENAME TABLE'*) echo 'swap tables' ;;
		*search-replace*) echo 'replace URLs' ;;
		*) echo 'drop staging' ;;
	esac >> "$log" ;;
esac
`;

function write( file: string, content: string ) {
	mkdirSync( path.dirname( file ), { recursive: true } );
	writeFileSync( file, content );
}

describe.skipIf( process.platform === 'win32' )( 'pushing over SSH', () => {
	const server = useFakeServer( FAKE_WP );

	it( 'backs up, then replaces plugins whole, merges uploads, leaves caching drop-ins and host-linked plugins, and swaps staged tables in', async () => {
		const local = path.join( server.dir, 'local' );
		write( path.join( local, 'wp-config.php' ), 'local config' );
		write( path.join( local, 'sql/wp_options.sql' ), 'INSERT INTO `wp_options` VALUES (1);\n' );
		write(
			path.join( local, 'sql/wp_bp_xprofile_options.sql' ),
			'CREATE TABLE `wp_bp_xprofile_options` (\n  `id` int\n);\n'
		);
		write(
			path.join( local, 'sql/wp_posts.sql' ),
			"INSERT INTO `wp_posts` VALUES ('INSERT INTO `wp_x`');\n"
		);
		write( path.join( local, 'wp-content/plugins/akismet/new.php' ), 'new' );
		write( path.join( local, 'wp-content/plugins/jetpack/local.php' ), 'local' );
		write( path.join( local, 'wp-content/uploads/a.jpg' ), 'new a' );
		write( path.join( local, 'wp-content/object-cache.php' ), 'local cache' );
		const archive = path.join( server.dir, 'site.tar.gz' );
		execFileSync( 'tar', [ '-czf', archive, '-C', local, '.' ] );

		const root = path.join( server.dir, 'www' );
		const content = path.join( root, 'wp-content' );
		write( path.join( content, 'plugins/akismet/old.php' ), 'old' );
		write( path.join( content, 'plugins/hello.php' ), 'remote only' );
		const managed = path.join( server.dir, 'managed/jetpack' );
		write( path.join( managed, 'host.php' ), 'host' );
		symlinkSync( managed, path.join( content, 'plugins/jetpack' ) );
		write( path.join( content, 'uploads/a.jpg' ), 'old a' );
		write( path.join( content, 'uploads/b.jpg' ), 'remote b' );

		const phases: PushStatus[ 'phase' ][] = [];
		await sshSites.push(
			undefined,
			{ id: `deploy@acme.test:${ root }`, name: 'Acme', contentDir: content },
			{
				kind: 'archive',
				file: createReadStream( archive ),
				name: 'site.tar.gz',
				size: statSync( archive ).size,
			},
			{},
			( { phase } ) => phases.at( -1 ) !== phase && phases.push( phase )
		);

		expect( phases ).toEqual( [
			'uploading',
			'creatingRemoteBackup',
			'applyingChanges',
			'finishing',
		] );
		expect( readdirSync( path.join( content, 'plugins/akismet' ) ) ).toEqual( [ 'new.php' ] );
		expect( existsSync( path.join( content, 'plugins/hello.php' ) ) ).toBe( true );
		expect( lstatSync( path.join( content, 'plugins/jetpack' ) ).isSymbolicLink() ).toBe( true );
		expect( readdirSync( managed ) ).toEqual( [ 'host.php' ] );
		expect( readFileSync( path.join( content, 'uploads/a.jpg' ), 'utf8' ) ).toBe( 'new a' );
		expect( existsSync( path.join( content, 'uploads/b.jpg' ) ) ).toBe( true );
		expect( existsSync( path.join( root, 'wp-config.php' ) ) ).toBe( false );
		expect( existsSync( path.join( content, 'object-cache.php' ) ) ).toBe( false );

		expect( readFileSync( path.join( server.dir, 'imported.sql' ), 'utf8' ) ).toBe(
			'CREATE TABLE `studio_new_bp_xprofile_options` (\n  `id` int\n);\n' +
				'INSERT INTO `studio_new_options` VALUES (1);\n' +
				"INSERT INTO `studio_new_posts` VALUES ('INSERT INTO `wp_x`');\n"
		);
		expect( readFileSync( path.join( server.dir, 'wp.log' ), 'utf8' ).split( '\n' ) ).toEqual( [
			'export --tables=acme_options,acme_posts',
			'drop staging',
			'replace URLs',
			'swap tables',
			'flush',
			'',
		] );

		const run = readdirSync( path.join( server.dir, '.studio-sync' ) ).find( ( name ) =>
			name.startsWith( 'push-' )
		)!;
		expect( readdirSync( path.join( server.dir, '.studio-sync', run ) ).sort() ).toEqual( [
			'backup.sql.gz',
			'old',
		] );
		expect(
			readdirSync( path.join( server.dir, '.studio-sync', run, 'old/plugins/akismet' ) )
		).toEqual( [ 'old.php' ] );
	} );
} );
