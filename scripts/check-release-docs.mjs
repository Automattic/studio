import { execFileSync } from 'node:child_process';

const site = 'https://wordpress.studio';
const docsPaths = [ 'docs/user/docs', 'docs/user/screenshots/images' ];
const [ tag, trunk = 'origin/trunk' ] = process.argv.slice( 2 );

function git( ...args ) {
	return execFileSync( 'git', args, { encoding: 'utf8' } ).trim();
}

async function readLive( path ) {
	const url = `${ site }${ path }`;
	const response = await fetch( url, {
		headers: { 'Cache-Control': 'no-cache' },
		signal: AbortSignal.timeout( 15_000 ),
	} );
	if ( ! response.ok ) {
		throw new Error( `${ url } returned HTTP ${ response.status }.` );
	}
	return response.text();
}

async function checkReleaseDocs() {
	if ( ! /^v\d+\.\d+\.\d+$/.test( tag ?? '' ) ) {
		throw new Error( 'Pass a stable release tag, for example v2.2.0.' );
	}

	const [ index, changelog ] = await Promise.all( [
		readLive( '/docs/index.json' ),
		readLive( '/docs/changelog/' ),
	] );
	const { source } = JSON.parse( index );
	if (
		source?.repository !== 'Automattic/studio' ||
		source.ref !== 'trunk' ||
		! /^[a-f0-9]{40}$/.test( source.commit )
	) {
		throw new Error( 'The live docs index does not record a valid Studio trunk commit.' );
	}

	const trunkCommit = git( 'rev-parse', '--verify', '--end-of-options', `${ trunk }^{commit}` );
	try {
		git( 'cat-file', '-e', `${ source.commit }^{commit}` );
	} catch {
		git( 'fetch', '--no-tags', '--depth=1', '--filter=blob:none', 'origin', source.commit );
	}

	// The GitHub compare API caps its file list at 300 entries.
	const changes = git(
		'diff',
		'--name-status',
		'--no-renames',
		source.commit,
		trunkCommit,
		'--',
		...docsPaths
	);
	console.log(
		`Published docs: ${ source.commit.slice( 0, 9 ) }. Trunk: ${ trunkCommit.slice( 0, 9 ) }.`
	);
	if ( changes ) {
		console.log(
			`\nDocs and screenshots that differ from trunk:\n\n\`\`\`text\n${ changes }\n\`\`\`\n`
		);
	}

	const hasRelease = Array.from( changelog.matchAll( /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi ) ).some(
		( [ , heading ] ) =>
			heading
				.replace( /<[^>]+>/g, '' )
				.trim()
				.split( /\s+[–—-]\s+/ )[ 0 ] === tag.slice( 1 )
	);
	console.log(
		`[Live changelog](${ site }/docs/changelog/) ${
			hasRelease ? 'includes' : 'is missing'
		} ${ tag }.`
	);

	if ( changes || ! hasRelease ) {
		throw new Error(
			'Review the release docs, publish them from Automattic/studio-website, then rerun this check.'
		);
	}
	console.log( 'The live docs match trunk.' );
}

try {
	await checkReleaseDocs();
} catch ( error ) {
	console.error( error.message );
	process.exitCode = 1;
}
