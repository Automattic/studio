import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repo = path.resolve( import.meta.dirname, '../..' );
const variants = {
	trunk: '8f75047079183196e6494228dd35a9c8de269619',
	draft: 'f9bf80467ff950bf336b78dd56655309a4a6fae1',
};
const files = [ 'packages/common/constants.ts', 'apps/cli/lib/wordpress-server-manager.ts' ];
const originals = files.map( ( file ) => fs.readFileSync( path.join( repo, file ) ) );
const output = path.join( repo, 'apps/cli/dist/startup-probe' );
fs.mkdirSync( output, { recursive: true } );

try {
	for ( const [ name, commit ] of Object.entries( variants ) ) {
		for ( const file of files ) {
			fs.writeFileSync(
				path.join( repo, file ),
				execFileSync( 'git', [ 'show', `${ commit }:${ file }` ], { cwd: repo } )
			);
		}
		console.log( `Building ${ name } from ${ commit }` );
		execFileSync(
			process.execPath,
			[
				path.join( repo, 'node_modules/vite/bin/vite.js' ),
				'build',
				'--config',
				'vite.config.dev.ts',
			],
			{ cwd: path.join( repo, 'apps/cli' ), stdio: 'inherit' }
		);
		const target = path.join( output, name );
		fs.rmSync( target, { recursive: true, force: true } );
		fs.renameSync( path.join( repo, 'apps/cli/dist/cli' ), target );
	}
} finally {
	files.forEach( ( file, index ) =>
		fs.writeFileSync( path.join( repo, file ), originals[ index ] )
	);
}

fs.writeFileSync( path.join( output, 'commits.json' ), JSON.stringify( variants, null, 2 ) + '\n' );
