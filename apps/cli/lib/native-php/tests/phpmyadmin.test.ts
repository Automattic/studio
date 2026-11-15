import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { siteDetailsSchema } from '@studio/common/lib/cli-events';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { getSiteDetails } from 'cli/lib/site-details';
import { pickPublicSiteFields } from 'cli/lib/site-public-fields';
import { isPhpMyAdminSupported } from '../phpmyadmin';

let sitePath: string;
beforeEach( () => {
	sitePath = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-phpmyadmin-' ) );
} );
afterEach( () => fs.rmSync( sitePath, { recursive: true, force: true } ) );

function write( name: string ) {
	const file = path.join( sitePath, name );
	fs.mkdirSync( path.dirname( file ), { recursive: true } );
	fs.writeFileSync( file, '' );
}

it( 'keeps fresh SQLite sites startable before wp-config.php exists', () => {
	expect( isPhpMyAdminSupported( { path: sitePath } ) ).toBe( true );
} );

it.each( [
	'wp-content/db.php',
	'wp-content/database/.ht.sqlite',
	'wp-content/mu-plugins/sqlite-database-integration/load.php',
] )( 'keeps repairable SQLite sites available with %s', ( artifact ) => {
	write( 'wp-config.php' );
	write( artifact );
	expect( isPhpMyAdminSupported( { path: sitePath } ) ).toBe( true );
} );

it( 'supports Reprint SQLite sites wired through runtime.php', () => {
	write( 'wp-config.php' );
	expect(
		isPhpMyAdminSupported( { path: sitePath, runtimeBlueprintPath: '/runtime/blueprint.json' } )
	).toBe( true );
} );

it( 'reports an external database consistently in lists and events without caching it', () => {
	write( 'wp-config.php' );
	const site = { id: 'review', name: 'Review', path: sitePath, port: 8881, phpVersion: '8.3' };
	expect( isPhpMyAdminSupported( site ) ).toBe( false );
	expect( pickPublicSiteFields( getSiteDetails( site ) ).phpMyAdminSupported ).toBe( false );
	expect( siteDetailsSchema.parse( getSiteDetails( site ) ).phpMyAdminSupported ).toBe( false );
	write( 'wp-content/db.php' );
	expect( getSiteDetails( site ).phpMyAdminSupported ).toBe( true );
} );
