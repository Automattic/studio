#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const [ command, directory, id, value, ...flags ] = process.argv.slice( 2 );
const help =
	'Usage: image-bridge.mjs list <directory> | complete <directory> <id> <png> | fail <directory> <id> <message> [--filtered]';
try {
	if ( ! directory || ! path.isAbsolute( directory ) ) throw new Error( help );
	const requests = path.join( directory, 'requests' );
	const responses = path.join( directory, 'responses' );
	const read = ( file ) => JSON.parse( fs.readFileSync( file, 'utf8' ) );
	const open = ( request ) =>
		request.v === 1 &&
		/^[a-f0-9]{32}$/.test( request.id ) &&
		typeof request.expiresAt === 'number' &&
		request.expiresAt > Date.now() / 1000 &&
		! fs.existsSync( path.join( responses, `${ request.id }.json` ) );
	if ( command === 'list' ) {
		const pending = fs.existsSync( requests )
			? fs
					.readdirSync( requests )
					.filter( ( file ) => /^[a-f0-9]{32}\.json$/.test( file ) )
					.map( ( file ) => read( path.join( requests, file ) ) )
					.filter( open )
			: [];
		process.stdout.write( JSON.stringify( pending, null, 2 ) + '\n' );
	} else if ( [ 'complete', 'fail' ].includes( command ) ) {
		if ( ! id || ! /^[a-f0-9]{32}$/.test( id ) || ! value ) throw new Error( help );
		const request = read( path.join( requests, `${ id }.json` ) );
		if ( request.id !== id || ! open( request ) )
			throw new Error( 'Commission is expired, closed, or mismatched.' );
		let answer = { v: 1, id, ok: command === 'complete' };
		if ( command === 'complete' ) {
			const bytes = fs.readFileSync( value );
			if (
				bytes.length > 32 * 1024 * 1024 ||
				bytes.subarray( 0, 8 ).toString( 'hex' ) !== '89504e470d0a1a0a'
			) {
				throw new Error( 'Expected a generated PNG under 32 MiB.' );
			}
			answer.sha256 = createHash( 'sha256' ).update( bytes ).digest( 'hex' );
			const image = path.join( responses, `${ id }.png` );
			const staging = path.join( responses, `.${ id }-${ randomUUID() }.png.tmp` );
			try {
				fs.writeFileSync( staging, bytes, { flag: 'wx' } );
				try {
					fs.linkSync( staging, image );
				} catch ( error ) {
					if ( error.code !== 'EEXIST' ) throw error;
					const stat = fs.lstatSync( image );
					if (
						! stat.isFile() ||
						stat.size !== bytes.length ||
						! fs.readFileSync( image ).equals( bytes )
					)
						throw new Error( 'Existing commission pixels do not match this delivery.' );
				}
			} finally {
				if ( fs.existsSync( staging ) ) fs.unlinkSync( staging );
			}
		} else {
			answer.error = value;
			answer.filtered = flags.includes( '--filtered' );
		}
		const temp = path.join( responses, `.${ id }-${ randomUUID() }.tmp` );
		fs.writeFileSync( temp, JSON.stringify( answer ) );
		try {
			fs.linkSync( temp, path.join( responses, `${ id }.json` ) );
		} finally {
			fs.unlinkSync( temp );
		}
		process.stdout.write( JSON.stringify( { id, delivered: command === 'complete' } ) + '\n' );
	} else throw new Error( help );
} catch ( error ) {
	process.stderr.write( error.message + '\n' );
	process.exitCode = 1;
}
