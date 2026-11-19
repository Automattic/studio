import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, expect, it, vi } from 'vitest';
import { writeZip } from 'cli/tests/zip-fixture';
import { copyLanguagePackToSite } from '../language-packs';

const root = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-language-packs-' ) );
const packsPath = path.join( root, 'languages' );
const sitePath = path.join( root, 'site' );

vi.mock( 'cli/lib/dependency-management/paths', () => ( {
	getLanguagePacksPath: () => packsPath,
} ) );

afterAll( () => fs.rmSync( root, { recursive: true, force: true } ) );

it( "unpacks a bundled locale's core, plugin and theme translations into the site", async () => {
	await writeZip( path.join( packsPath, 'de_DE.zip' ), {
		'de_DE.l10n.php': '<?php',
		'plugins/akismet-de_DE.l10n.php': '<?php',
		'themes/twentytwentyfive-de_DE.l10n.php': '<?php',
	} );

	expect( await copyLanguagePackToSite( sitePath, 'de_DE' ) ).toBe( true );
	expect(
		fs.readdirSync( path.join( sitePath, 'wp-content', 'languages' ), { recursive: true } ).sort()
	).toEqual( [
		'de_DE.l10n.php',
		'plugins',
		path.join( 'plugins', 'akismet-de_DE.l10n.php' ),
		'themes',
		path.join( 'themes', 'twentytwentyfive-de_DE.l10n.php' ),
	] );
	expect( await copyLanguagePackToSite( sitePath, 'fr_FR' ) ).toBe( false );
} );
