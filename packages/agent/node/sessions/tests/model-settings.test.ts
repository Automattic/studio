import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { resolveResumeSessionContext } from '../context';
import { setSessionModelSettings } from '../model-settings';
import { createAiSession, loadAiSession } from '../store';

let root: string;
beforeEach( async () => {
	root = await mkdtemp( path.join( os.tmpdir(), 'studio-model-settings-' ) );
} );
afterEach( () => rm( root, { recursive: true, force: true } ) );
it( 'restores provider, model and effort together and resets legacy model selections', async () => {
	const { id } = await createAiSession( root );
	await setSessionModelSettings( root, id, 'balanced', 'high', 'wpcom' );
	expect( resolveResumeSessionContext( await loadAiSession( root, id ) ) ).toMatchObject( {
		provider: 'wpcom',
		model: 'balanced',
		effort: 'high',
	} );
	await setSessionModelSettings( root, id, 'balanced', 'low' );
	expect( resolveResumeSessionContext( await loadAiSession( root, id ) ) ).toMatchObject( {
		provider: 'wpcom',
		model: 'balanced',
		effort: 'low',
	} );
	await setSessionModelSettings( root, id, 'fast' );
	expect( resolveResumeSessionContext( await loadAiSession( root, id ) ) ).toMatchObject( {
		provider: 'wpcom',
		model: 'fast',
		effort: 'default',
	} );
} );
it( 'rejects unsupported selections before writing', async () => {
	const { id } = await createAiSession( root );
	const before = ( await loadAiSession( root, id ) ).entries;
	await expect( setSessionModelSettings( root, id, 'fast', 'high' ) ).rejects.toThrow(
		'Unsupported effort'
	);
	await expect( setSessionModelSettings( root, id, 'unknown' ) ).rejects.toThrow(
		'Unknown AI model'
	);
	await expect(
		setSessionModelSettings( root, id, 'balanced', 'high', 'anthropic-api-key' )
	).rejects.toThrow( 'not served' );
	expect( ( await loadAiSession( root, id ) ).entries ).toEqual( before );
} );
