import { execSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath( import.meta.url );
const __dirname = dirname( __filename );
const projectRoot = dirname( __dirname );

const POT_FILE = join( projectRoot, 'out', 'pots', 'bundle-strings.pot' );
const IMPORT_PAGE = 'https://translate.wordpress.com/projects/studio/import-originals/';

function executeCommand( command, description ) {
	try {
		console.log( `🔄 ${ description }` );
		execSync( command, { stdio: 'inherit', cwd: projectRoot } );
		return true;
	} catch ( error ) {
		console.error( `❌ Error: ${ description } failed` );
		console.error( error.message );
		return false;
	}
}

console.log( '✨ Starting pot files generation...\n' );

const commands = [
	{
		command: 'rm -rf ./out/pots',
		description: 'Removing existing pot files',
	},
	{
		command:
			'wp-babel-makepot "{src,cli/commands,cli/lib,common}/**/*.{js,jsx,ts,tsx}" --ignore "**/*.d.ts" --base "." --dir "./out/pots" --output "./out/pots/bundle-strings.pot"',
		description: 'Generating pot file with wp-babel-makepot',
	},
	{
		command: `open -R "${ POT_FILE }"`,
		description: `Revealing pot file in Finder: ${ POT_FILE }`,
	},
	{
		command: `open "${ IMPORT_PAGE }"`,
		description: `Opening the translation import page ${ IMPORT_PAGE } in the browser`,
	},
];

for ( const { command, description } of commands ) {
	if ( ! executeCommand( command, description ) ) {
		process.exit( 1 );
	}
}

console.log( '\n✅ Success! Now drag and drop the "bundle-strings.pot" file into GlotPress.' );
