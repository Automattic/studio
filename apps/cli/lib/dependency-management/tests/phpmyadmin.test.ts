import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, expect, it, vi } from 'vitest';
import { writeZip } from 'cli/tests/zip-fixture';
import { getPhpMyAdminPath, installBundledPhpMyAdmin } from '../phpmyadmin';

const root = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-phpmyadmin-' ) );
const versionsPath = path.join( root, 'phpmyadmin-versions' );
const zipPath = path.join( root, 'phpmyadmin.zip' );

vi.mock( '../paths', () => ( {
	readBundledManifest: () => ( { wordpressVersion: '7.1.3', phpMyAdminHash: 'current' } ),
	getBundledPhpMyAdminZipPath: () => zipPath,
	getPhpMyAdminVersionsPath: () => versionsPath,
} ) );

afterAll( () => fs.rmSync( root, { recursive: true, force: true } ) );

function addVersion( name: string, ageInDays: number ) {
	const versionPath = path.join( versionsPath, name );
	fs.mkdirSync( versionPath, { recursive: true } );
	fs.writeFileSync( path.join( versionPath, 'index.php' ), '<?php' );
	const date = new Date( Date.now() - ageInDays * 24 * 60 * 60 * 1000 );
	fs.utimesSync( versionPath, date, date );
}

it( 'unpacks the bundled phpMyAdmin under its hash and removes versions unused for 30 days', async () => {
	await writeZip( zipPath, {
		'phpmyadmin/index.php': '<?php',
		'phpmyadmin/js/app.js': '',
	} );
	addVersion( 'used-last-week', 7 );
	addVersion( 'unused', 45 );

	await Promise.all( [ installBundledPhpMyAdmin(), installBundledPhpMyAdmin() ] );

	expect( getPhpMyAdminPath() ).toBe( path.join( versionsPath, 'current' ) );
	expect( fs.existsSync( path.join( versionsPath, 'current', 'js', 'app.js' ) ) ).toBe( true );
	expect( fs.readdirSync( versionsPath ).sort() ).toEqual( [ 'current', 'used-last-week' ] );
} );
