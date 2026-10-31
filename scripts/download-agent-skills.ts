import { spawnSync } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import { extractZip } from '../packages/common/lib/extract-zip.ts';
import { fetch, sharedDispatcher } from './lib/with-retry.ts';

const WP_FILES_PATH = path.join( import.meta.dirname, '..', 'wp-files' );
const AI_SKILLS_PATH = path.join( WP_FILES_PATH, 'skills' );
const LOCAL_AI_SKILLS_PATH = path.join( import.meta.dirname, '..', 'skills' );

const REPO_ZIP_URL = 'https://github.com/WordPress/agent-skills/archive/refs/heads/trunk.zip';
const REPO_GIT_URL = 'https://github.com/WordPress/agent-skills.git';

const REMOTE_SKILL_IDS = [
	'wp-plugin-development',
	'wp-block-development',
	'wp-block-themes',
	'wp-rest-api',
	'wp-wpcli-and-ops',
];

async function downloadRemoteSkills(): Promise< void > {
	console.log( '[ai-skills] Downloading remote WordPress skills...' );

	const zipPath = path.join( os.tmpdir(), 'agent-skills.zip' );
	const extractPath = path.join( os.tmpdir(), 'agent-skills-extracted' );

	await fs.remove( extractPath );
	await fs.ensureDir( extractPath );
	try {
		const response = await fetch( REPO_ZIP_URL, { dispatcher: sharedDispatcher } );
		if ( ! response.ok ) {
			throw new Error( `Failed to download agent-skills: ${ response.status }` );
		}
		await fs.writeFile( zipPath, Buffer.from( await response.arrayBuffer() ) );
		await extractZip( zipPath, extractPath );
	} catch ( error ) {
		// Some sandboxes allow git reads of GitHub but not archive downloads.
		console.warn(
			`[ai-skills] ${
				error instanceof Error ? error.message : error
			}; cloning the repository instead`
		);
		await fs.emptyDir( extractPath );
		const clone = spawnSync(
			'git',
			[
				'clone',
				'--quiet',
				'--depth',
				'1',
				REPO_GIT_URL,
				path.join( extractPath, 'agent-skills-trunk' ),
			],
			{ stdio: 'inherit' }
		);
		if ( clone.status !== 0 ) {
			throw error;
		}
	}

	// Find the extracted root directory (e.g., agent-skills-trunk/)
	const extractedDirs = await fs.readdir( extractPath );
	const repoDir = extractedDirs.find( ( dir ) => dir.startsWith( 'agent-skills-' ) );
	if ( ! repoDir ) {
		throw new Error( 'Could not find extracted agent-skills directory' );
	}

	const skillsSourceDir = path.join( extractPath, repoDir, 'skills' );

	// Copy each skill to the destination
	for ( const skillId of REMOTE_SKILL_IDS ) {
		const source = path.join( skillsSourceDir, skillId );
		const destination = path.join( AI_SKILLS_PATH, skillId );

		if ( ! ( await fs.pathExists( source ) ) ) {
			console.warn( `[ai-skills] Remote skill not found: ${ skillId }` );
			continue;
		}

		await fs.remove( destination );
		await fs.copy( source, destination );
		console.log( `[ai-skills] Downloaded ${ skillId }` );
	}

	// Clean up temporary files
	await fs.remove( zipPath );
	await fs.remove( extractPath );
}

async function copyLocalContent(): Promise< void > {
	console.log( '[ai-skills] Copying local content...' );

	const entries = await fs.readdir( LOCAL_AI_SKILLS_PATH, { withFileTypes: true } );
	for ( const entry of entries ) {
		// Skip non-content files (e.g. .ts)
		if ( entry.isFile() && ! entry.name.endsWith( '.md' ) ) {
			continue;
		}

		const source = path.join( LOCAL_AI_SKILLS_PATH, entry.name );
		const destination = path.join( AI_SKILLS_PATH, entry.name );
		await fs.remove( destination );
		await fs.copy( source, destination );
		console.log( `[ai-skills] Copied ${ entry.name }` );
	}
}

async function downloadAiSkills(): Promise< void > {
	await fs.ensureDir( AI_SKILLS_PATH );
	await copyLocalContent();
	await downloadRemoteSkills();
	console.log( '[ai-skills] Done' );
}

downloadAiSkills().catch( ( err ) => {
	console.error( err );
	process.exit( 1 );
} );
