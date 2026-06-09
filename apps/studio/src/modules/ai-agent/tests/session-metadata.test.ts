import { loadAiSession } from '@studio/common/ai/sessions/store';
import { readSharedSession, updateSharedSession } from '@studio/common/lib/shared-config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateAiSessionMetadata } from '../session-metadata';
import type { LoadedAiSession } from '@studio/common/ai/sessions/types';

vi.mock( 'src/lib/ai-sessions', () => ( {
	getAiSessionsRootDirectory: () => '/tmp/studio-sessions',
} ) );

vi.mock( '@studio/common/ai/sessions/store', () => ( {
	loadAiSession: vi.fn(),
} ) );

vi.mock( '@studio/common/lib/shared-config', () => ( {
	readSharedSession: vi.fn(),
	updateSharedSession: vi.fn(),
} ) );

const loadAiSessionMock = vi.mocked( loadAiSession );
const readSharedSessionMock = vi.mocked( readSharedSession );
const updateSharedSessionMock = vi.mocked( updateSharedSession );

describe( 'generateAiSessionMetadata', () => {
	beforeEach( () => {
		loadAiSessionMock.mockReset();
		readSharedSessionMock.mockReset().mockResolvedValue( undefined );
		updateSharedSessionMock.mockReset().mockResolvedValue( undefined );
	} );

	it( 'generates a title from the first prompt after a successful turn', async () => {
		loadAiSessionMock.mockResolvedValue(
			createLoadedSession( {
				firstPrompt: 'Can you build a landing page for a coffee shop?',
				eventCount: 4,
				prompts: [ 'Can you build a landing page for a coffee shop?' ],
			} )
		);

		await generateAiSessionMetadata( 'session-1' );

		expect( updateSharedSessionMock ).toHaveBeenCalledWith(
			'session-1',
			expect.objectContaining( {
				generatedTitle: 'build a landing page for a coffee shop',
				titleGeneratedAt: expect.any( String ),
			} )
		);
	} );

	it( 'does not overwrite user-authored chat details', async () => {
		readSharedSessionMock.mockResolvedValue( {
			userTitle: 'My title',
			userDescription: 'My description',
		} );
		loadAiSessionMock.mockResolvedValue(
			createLoadedSession( {
				firstPrompt: 'Update the homepage',
				assistantReplyPreview: 'Changed the hero and footer.',
				eventCount: 12,
				prompts: [ 'Update the homepage', 'Tweak the hero', 'Adjust the footer' ],
			} )
		);

		await generateAiSessionMetadata( 'session-1' );

		expect( updateSharedSessionMock ).not.toHaveBeenCalled();
	} );

	it( 'generates and later refreshes a description after enough chat activity', async () => {
		readSharedSessionMock.mockResolvedValue( { descriptionGeneratedEventCount: 1 } );
		loadAiSessionMock.mockResolvedValue(
			createLoadedSession( {
				firstPrompt: 'Fix checkout',
				assistantReplyPreview: 'Updated the checkout flow and added validation.',
				eventCount: 12,
				prompts: [ 'Fix checkout', 'Add validation', 'Polish errors' ],
			} )
		);

		await generateAiSessionMetadata( 'session-1' );

		expect( updateSharedSessionMock ).toHaveBeenCalledWith(
			'session-1',
			expect.objectContaining( {
				generatedDescription: expect.stringContaining( 'Latest: Updated the checkout flow' ),
				descriptionGeneratedAt: expect.any( String ),
				descriptionGeneratedEventCount: 12,
			} )
		);
	} );
} );

function createLoadedSession( {
	firstPrompt,
	assistantReplyPreview,
	eventCount,
	prompts,
}: {
	firstPrompt: string;
	assistantReplyPreview?: string;
	eventCount: number;
	prompts: string[];
} ): LoadedAiSession {
	return {
		summary: {
			id: 'session-1',
			filePath: '/tmp/session.jsonl',
			createdAt: '2026-05-01T00:00:00.000Z',
			updatedAt: '2026-05-01T00:00:00.000Z',
			firstPrompt,
			assistantReplyPreview,
			activeEnvironment: 'local' as const,
			eventCount,
		},
		entries: prompts.map( ( prompt, index ) => ( {
			type: 'custom' as const,
			id: `entry-${ index }`,
			parentId: null,
			timestamp: '2026-05-01T00:00:00.000Z',
			customType: 'studio.user_prompt' as const,
			data: { text: prompt, source: 'prompt' as const },
		} ) ),
	};
}
