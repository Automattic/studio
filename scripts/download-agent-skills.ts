import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import { extractZip } from '../tools/common/lib/extract-zip';

const WP_FILES_PATH = path.join( __dirname, '..', 'wp-files' );
const AGENT_SKILLS_PATH = path.join( WP_FILES_PATH, 'agent-skills' );

const REPO_ZIP_URL = 'https://github.com/WordPress/agent-skills/archive/refs/heads/trunk.zip';

const SKILLS_TO_BUNDLE = [
	'wp-plugin-development',
	'wp-block-development',
	'wp-block-themes',
	'wp-rest-api',
	'wp-wpcli-and-ops',
];

async function downloadAgentSkills(): Promise< void > {
	console.log( '[agent-skills] Downloading WordPress agent skills ...' );

	const zipPath = path.join( os.tmpdir(), 'agent-skills.zip' );
	const extractPath = path.join( os.tmpdir(), 'agent-skills-extracted' );

	// Download the repository archive
	const response = await fetch( REPO_ZIP_URL );
	if ( ! response.ok ) {
		throw new Error( `Failed to download agent-skills: ${ response.status }` );
	}
	const buffer = Buffer.from( await response.arrayBuffer() );
	await fs.writeFile( zipPath, buffer );

	// Extract to a temporary directory
	await fs.remove( extractPath );
	await fs.ensureDir( extractPath );
	await extractZip( zipPath, extractPath );

	// Find the extracted root directory (e.g., agent-skills-trunk/)
	const extractedDirs = await fs.readdir( extractPath );
	const repoDir = extractedDirs.find( ( dir ) => dir.startsWith( 'agent-skills-' ) );
	if ( ! repoDir ) {
		throw new Error( 'Could not find extracted agent-skills directory' );
	}

	const skillsSourceDir = path.join( extractPath, repoDir, 'skills' );

	// Copy each skill to the destination
	await fs.ensureDir( AGENT_SKILLS_PATH );
	for ( const skillName of SKILLS_TO_BUNDLE ) {
		const source = path.join( skillsSourceDir, skillName );
		const destination = path.join( AGENT_SKILLS_PATH, skillName );

		if ( ! ( await fs.pathExists( source ) ) ) {
			console.warn( `[agent-skills] Skill not found in repo: ${ skillName }` );
			continue;
		}

		await fs.remove( destination );
		await fs.copy( source, destination );
		console.log( `[agent-skills] Installed ${ skillName }` );
	}

	// Clean up temporary files
	await fs.remove( zipPath );
	await fs.remove( extractPath );

	console.log( '[agent-skills] Done' );
}

downloadAgentSkills().catch( ( err ) => {
	console.error( err );
	process.exit( 1 );
} );
