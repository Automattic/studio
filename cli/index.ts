import { Command, Option } from 'commander';
import { registerCommand as registerPreviewCreateCommand } from 'cli/commands/preview/create';
import { registerCommand as registerPreviewDeleteCommand } from 'cli/commands/preview/delete';
import { registerCommand as registerPreviewListCommand } from 'cli/commands/preview/list';
import { registerCommand as registerPreviewUpdateCommand } from 'cli/commands/preview/update';
import { version } from 'cli/package.json';

const program = new Command();

program
	.name( 'studio' )
	.description( 'Studio by WordPress.com CLI' )
	.version( version )
	.addOption(
		new Option( '--output-format [format]', 'Specify a non-standard output format' )
			.argParser( ( value: string ) => {
				if ( value !== 'json' ) {
					throw new Error( 'The only custom output format supported is "json"' );
				}
				return value;
			} )
			.hideHelp()
	);

const previewCommand = program.command( 'preview' ).description( 'Manage preview sites' );

registerPreviewCreateCommand( program );
registerPreviewListCommand( previewCommand );
registerPreviewDeleteCommand( previewCommand );
registerPreviewUpdateCommand( previewCommand );

program.parse( process.argv );
