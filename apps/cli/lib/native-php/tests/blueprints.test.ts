import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	formatBlueprintRunnerError,
	normalizeBlueprintForRunner,
	removeOwnedSqliteSymlink,
} from 'cli/lib/native-php/blueprints';
import { PhpCommandError } from 'cli/lib/native-php/php-process';

const tempDirs: string[] = [];

afterEach( () => {
	for ( const tempDir of tempDirs.splice( 0 ) ) {
		fs.rmSync( tempDir, { recursive: true, force: true } );
	}
} );

describe( 'normalizeBlueprintForRunner', () => {
	it( 'drops preferredVersions', () => {
		const contents = { preferredVersions: { php: '8.3', wp: 'latest' }, steps: [] };

		normalizeBlueprintForRunner( contents );

		expect( contents ).not.toHaveProperty( 'preferredVersions' );
	} );

	// `intl` is the one gallery Blueprints such as Stylish Press set.
	it( 'drops features the runner does not know', () => {
		const contents = { features: { intl: true, networking: true }, steps: [] };

		normalizeBlueprintForRunner( contents );

		expect( contents.features ).toEqual( { networking: true } );
	} );

	it( 'removes features entirely when nothing supported is left', () => {
		const contents: Record< string, unknown > = { features: { intl: true }, steps: [] };

		normalizeBlueprintForRunner( contents );

		expect( contents ).not.toHaveProperty( 'features' );
	} );

	it( 'leaves a Blueprint without features or preferredVersions untouched', () => {
		const contents = { steps: [ { step: 'installPlugin' } ] };

		normalizeBlueprintForRunner( contents );

		expect( contents ).toEqual( { steps: [ { step: 'installPlugin' } ] } );
	} );

	it( 'tolerates a features value that is not an object', () => {
		const contents: Record< string, unknown > = { features: null, steps: [] };

		expect( () => normalizeBlueprintForRunner( contents ) ).not.toThrow();
	} );
} );

describe( 'removeOwnedSqliteSymlink', () => {
	it( 'removes its symlink after the target has been deleted', async () => {
		const tempDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-blueprint-sqlite-' ) );
		tempDirs.push( tempDir );
		const target = path.join( tempDir, 'mu-plugin' );
		const symlink = path.join( tempDir, 'plugin' );
		fs.mkdirSync( target );
		fs.symlinkSync( target, symlink, 'junction' );
		const symlinkIno = fs.lstatSync( symlink ).ino;
		fs.rmSync( target, { recursive: true } );

		await removeOwnedSqliteSymlink( symlink, symlinkIno );

		expect( fs.existsSync( symlink ) ).toBe( false );
		expect( () => fs.lstatSync( symlink ) ).toThrow();
	} );

	it( 'preserves a replacement entry', async () => {
		const tempDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-blueprint-sqlite-' ) );
		tempDirs.push( tempDir );
		const target = path.join( tempDir, 'mu-plugin' );
		const symlink = path.join( tempDir, 'plugin' );
		fs.mkdirSync( target );
		fs.symlinkSync( target, symlink, 'junction' );
		const symlinkIno = fs.lstatSync( symlink ).ino;
		fs.rmSync( symlink );
		fs.mkdirSync( symlink );

		await removeOwnedSqliteSymlink( symlink, symlinkIno );

		expect( fs.statSync( symlink ).isDirectory() ).toBe( true );
	} );
} );

function phpError( { stdout = '', stderr = '' }: { stdout?: string; stderr?: string } ) {
	return new PhpCommandError( 'PHP command failed (code: 1)', 1, stdout, stderr );
}

describe( 'formatBlueprintRunnerError', () => {
	it( "reports the runner's schema validation errors", () => {
		const message = formatBlueprintRunnerError(
			phpError( {
				stdout: [
					'{"type":"progress","progress":0,"caption":"Loading Blueprint data"}',
					'{"type":"error","message":"Invalid Blueprint v1 provided. See the validation errors below:"}',
					'{"type":"error","message":"Blueprint root[\\"features\\"][\\"intl\\"]:"}',
					'{"type":"error","message":"Property \\"intl\\" isn\'t allowed here. Allowed properties are: networking."}',
				].join( '\n' ),
			} )
		);

		expect( message ).toContain( 'Invalid Blueprint v1 provided.' );
		expect( message ).toContain( 'Property "intl" isn\'t allowed here.' );
		expect( message ).not.toContain( 'Loading Blueprint data' );
	} );

	// Step failures carry a `details.trace` that is useless in a toast and dwarfs the message.
	it( 'keeps the exception message and drops its stack trace', () => {
		const message = formatBlueprintRunnerError(
			phpError( {
				stdout: JSON.stringify( {
					type: 'error',
					message: 'Failed to resolve branch file path: dist/main',
					details: {
						exception: 'WordPress\\Git\\GitException',
						trace: '#0 phar:///blueprints.phar/class-gitremote.php(297)',
					},
				} ),
			} )
		);

		expect( message ).toContain( 'Failed to resolve branch file path: dist/main' );
		expect( message ).not.toContain( 'class-gitremote.php' );
	} );

	it( 'falls back to stderr when the runner reported no error lines', () => {
		const message = formatBlueprintRunnerError(
			phpError( { stderr: 'PHP Fatal error: Allowed memory size exhausted' } )
		);

		expect( message ).toContain( 'Allowed memory size exhausted' );
	} );

	it( 'falls back to the exit code when the process said nothing', () => {
		expect( formatBlueprintRunnerError( phpError( {} ) ) ).toBe( 'PHP command failed (code: 1)' );
	} );

	it( 'ignores non-JSON noise on stdout', () => {
		const message = formatBlueprintRunnerError(
			phpError( { stdout: 'Warning: something\n{"type":"error","message":"the real problem"}' } )
		);

		expect( message ).toBe( 'the real problem' );
	} );
} );
