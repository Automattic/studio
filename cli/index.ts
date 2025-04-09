import { Command } from 'commander';
import { registerCommand as registerPreviewCreateCommand } from 'cli/commands/preview/create';
import { registerCommand as registerPreviewListCommand } from 'cli/commands/preview/list';
import { version } from 'cli/package.json';

const program = new Command();

program
	.name( 'studio' )
	.description( 'Studio by WordPress.com CLI' )
	.version( version )
	.option(
		'--output-format [format]',
		'Specify a non-standard output format',
		( value: string ) => {
			if ( value !== 'json' ) {
				throw new Error( 'The only custom output format supported is "json"' );
			}
			return value;
		}
	);

registerPreviewCreateCommand( program );
registerPreviewListCommand( program );

program.parse( process.argv );
