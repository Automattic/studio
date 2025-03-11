#!/usr/bin/env node

import path from 'path';
import { Command } from 'commander';
import lockfile from 'lockfile';
import { version } from '../package.json';
import { StudioGo } from './go';

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
		lockfile.lockSync( path.join( folder, '.studio-lock' ), {
			stale: 1000 * 60 * 5,
		} );

		const studioGo = new StudioGo( folder, options.outputFormat );
		await studioGo.run();
	} );

program.parse( process.argv );
