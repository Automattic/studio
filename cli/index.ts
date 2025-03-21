import { Command } from 'commander';
import { PreviewCreateCommand } from 'cli/commands/preview/create';
import { version } from '../package.json';

const program = new Command();

program.name( 'studio' ).description( 'WordPress.com Studio CLI' ).version( version );

program
	.command( 'go [folder]' )
	.description(
		'Start a new WordPress environment in the specified folder (defaults to current directory)'
	)
	.option(
		'--output-format [format]',
		'Specify a non-standard output format',
		( value: string ) => {
			if ( value !== 'json' ) {
				throw new Error( 'The only custom output format supported is "json"' );
			}
			return value;
		}
	)
	.action( async ( folder: string = process.cwd(), options: { outputFormat?: 'json' } ) => {
		const previewCreate = new PreviewCreateCommand( folder, options.outputFormat );
		await previewCreate.run();
	} );

program.parse( process.argv );
