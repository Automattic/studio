import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const studioRoot = path.resolve( import.meta.dirname, '..' );

export function buildSpotlightNative( arch: string, outputPath: string ) {
	if ( process.platform !== 'darwin' ) {
		throw new Error( 'Building the Spotlight bridge requires macOS and Xcode Command Line Tools.' );
	}
	if ( arch !== 'arm64' && arch !== 'x64' ) {
		throw new Error( `Unsupported Spotlight bridge architecture: ${ arch }` );
	}
	const require = createRequire( import.meta.url );
	const { include_dir: headers } = require( 'node-api-headers' ) as { include_dir: string };
	mkdirSync( path.dirname( outputPath ), { recursive: true } );
	execFileSync(
		'xcrun',
		[
			'clang++',
			'-std=c++17',
			'-fobjc-arc',
			'-fblocks',
			'-bundle',
			'-undefined',
			'dynamic_lookup',
			'-arch',
			arch === 'x64' ? 'x86_64' : arch,
			'-mmacosx-version-min=12.0',
			'-DNAPI_VERSION=8',
			'-DNODE_GYP_MODULE_NAME=studio_spotlight',
			'-I',
			headers,
			'-framework',
			'Foundation',
			'-framework',
			'CoreSpotlight',
			path.join( studioRoot, 'native/spotlight.mm' ),
			'-o',
			outputPath,
		],
		{ stdio: 'inherit' }
	);
}
