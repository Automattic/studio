import { DEFAULT_MODEL } from '@studio/common/ai/models';
import { describe, expect, it, vi } from 'vitest';
import { designGenerationPromptsForTesting, startConcurrentDesignGeneration } from './generation';
import type { AiSessionSummary, Connector } from '@/data/core';

function session( id: string ): AiSessionSummary {
	return { id } as AiSessionSummary;
}

describe( 'startConcurrentDesignGeneration', () => {
	it( 'launches three isolated workers and one visible coordinator', async () => {
		const sessions = [
			session( 'coordinator' ),
			session( 'worker-1' ),
			session( 'worker-2' ),
			session( 'worker-3' ),
		];
		const createSession = vi.fn().mockImplementation( async () => sessions.shift() );
		const updateSessionMetadata = vi.fn().mockImplementation( async ( id, patch ) => ( {
			id,
			...patch,
		} ) );
		const continueSession = vi
			.fn()
			.mockImplementation( async ( id ) => ( { runId: `run-${ id }` } ) );
		const connector = {
			createSession,
			setSessionModel: vi.fn().mockResolvedValue( undefined ),
			initializeDesignProject: vi.fn().mockResolvedValue( {} ),
			updateSessionMetadata,
			continueSession,
			interruptAgentRun: vi.fn().mockResolvedValue( undefined ),
			deleteSession: vi.fn().mockResolvedValue( undefined ),
		} as unknown as Connector;
		const attachments = { images: [], files: [] };

		const result = await startConcurrentDesignGeneration( {
			connector,
			siteId: 'site-1',
			brief: 'A site about animation',
			model: DEFAULT_MODEL,
			attachments,
		} );

		expect( result.session.id ).toBe( 'coordinator' );
		expect( result.sessionIds ).toEqual( [ 'coordinator', 'worker-1', 'worker-2', 'worker-3' ] );
		expect( continueSession ).toHaveBeenCalledTimes( 4 );
		for ( const [ index, workerId ] of [ 'worker-1', 'worker-2', 'worker-3' ].entries() ) {
			expect( continueSession ).toHaveBeenCalledWith(
				workerId,
				expect.stringContaining( `worker-${ index + 1 }-r1` ),
				attachments
			);
		}
		expect( continueSession ).toHaveBeenLastCalledWith(
			'coordinator',
			expect.stringContaining( 'design_project_wait' ),
			{ displayMessage: 'A site about animation' }
		);
		expect( updateSessionMetadata.mock.calls ).toEqual( [
			[ 'coordinator', { archived: true } ],
			[ 'worker-1', { archived: true } ],
			[ 'worker-2', { archived: true } ],
			[ 'worker-3', { archived: true } ],
			[ 'coordinator', { archived: false } ],
		] );
	} );

	it( 'gives every worker a distinct exploration and a locked manifest boundary', () => {
		const prompts = [ 0, 1, 2 ].map( ( index ) =>
			designGenerationPromptsForTesting.getWorkerPrompt( 'Brief', index )
		);

		expect( new Set( prompts ).size ).toBe( 3 );
		for ( const prompt of prompts ) {
			expect( prompt ).toContain( 'call design_artifact_finalize exactly once' );
			expect( prompt ).toContain( 'Do not write project.json yourself' );
		}
	} );
} );
