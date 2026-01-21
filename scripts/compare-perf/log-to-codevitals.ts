#!/usr/bin/env node
/* eslint-disable no-console */
import fs from 'fs';
import path from 'path';

const [ token, branch, hash, baseHash, timestamp ] = process.argv.slice( 2 );

const resultsFiles = [
	{
		file: 'site-startup.summary.json',
		metricsPrefix: '',
	},
	{
		file: 'site-editor.summary.json',
		metricsPrefix: 'site-editor-',
	},
];

const performanceResults = resultsFiles.map( ( { file } ) =>
	JSON.parse(
		fs.readFileSync( path.join( process.env.ARTIFACTS_PATH ?? 'artifacts', file ), 'utf8' )
	)
);

const payload = {
	branch,
	hash,
	baseHash,
	timestamp,
	metrics: resultsFiles.reduce( ( result, { metricsPrefix }, index ) => {
		return {
			...result,
			...Object.fromEntries(
				Object.entries( performanceResults[ index ][ hash ] ?? {} ).map( ( [ key, value ] ) => [
					metricsPrefix + key,
					value,
				] )
			),
		};
	}, {} ),
	baseMetrics: resultsFiles.reduce( ( result, { metricsPrefix }, index ) => {
		return {
			...result,
			...Object.fromEntries(
				Object.entries( performanceResults[ index ][ baseHash ] ?? {} ).map( ( [ key, value ] ) => [
					metricsPrefix + key,
					value,
				] )
			),
		};
	}, {} ),
};

( async () => {
	try {
		const response = await fetch( `https://codevitals.run/api/log?token=${ token }`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify( payload ),
		} );

		const responseText = await response.text();
		console.log( `statusCode: ${ response.status }` );
		if ( responseText ) {
			console.log( responseText );
		}

		if ( ! response.ok ) {
			process.exit( 1 );
		}
	} catch ( error ) {
		console.error( error );
		process.exit( 1 );
	}
} )();
