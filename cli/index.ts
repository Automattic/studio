import { Command } from 'commander';
import { PreviewCreateCommand } from 'cli/commands/preview/create';
import { version } from '../package.json';

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

PreviewCreateCommand.register( program );

program.parse( process.argv );
