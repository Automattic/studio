import { describe, expect, it } from 'vitest';
import { formatBlueprintRunnerError } from 'cli/lib/native-php/blueprints';
import { PhpCommandError } from 'cli/lib/native-php/php-process';

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
