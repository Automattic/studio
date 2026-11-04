import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	appendThinkingLevelChangeEntry,
	createAiSession,
	loadAiSession,
} from '@studio/agent/node/sessions/store';
import { readSessionEffort } from '@studio/agent/protocol/models';

const SITE = { id: 'site-1', name: 'My Site', path: '/tmp/my-site' };

vi.mock( '@studio/common/sites/site-path', () => ( { readSites: async () => [ SITE ] } ) );
vi.mock( '@studio/common/lib/shared-config', async ( importOriginal ) => ( {
	...( await importOriginal< object >() ),
	readSharedSession: async () => undefined,
} ) );

describe( 'appendThinkingLevelChangeEntry', () => {
	let root: string;

	beforeEach( async () => {
		root = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-set-effort-' ) );
	} );

	afterEach( () => fs.rm( root, { recursive: true, force: true } ) );

	it( 'records an effort that both Studio and pi read back', async () => {
		const { id } = await createAiSession( root, { site: SITE } );

		await appendThinkingLevelChangeEntry( root, id, 'medium' );
		await appendThinkingLevelChangeEntry( root, id, 'xhigh' );

		const { summary, entries } = await loadAiSession( root, id );
		expect( readSessionEffort( entries ) ).toBe( 'xhigh' );
		const session = SessionManager.open( summary.filePath );
		expect( session.buildSessionContext().thinkingLevel ).toBe( 'xhigh' );
	} );
} );
