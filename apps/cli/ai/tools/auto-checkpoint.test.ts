import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withAutoCheckpoint, AUTO_CHECKPOINT_DEBOUNCE_MS } from './auto-checkpoint';
import type { AnyStudioAgentTool } from './define-tool';

const createCheckpoint = vi.hoisted( () => vi.fn() );
const isCheckpointSupported = vi.hoisted( () => vi.fn() );
const readCheckpointIndex = vi.hoisted( () => vi.fn() );
const resolveSite = vi.hoisted( () => vi.fn() );

vi.mock( 'cli/lib/checkpoints/create', () => ( { createCheckpoint, isCheckpointSupported } ) );
vi.mock( 'cli/lib/checkpoints/manifest', () => ( { readCheckpointIndex } ) );
vi.mock( './utils', () => ( {
	resolveSite,
	textResult: ( text: string ) => ( { content: [ { type: 'text', text } ] } ),
} ) );

const SITE = { id: 'site-1', path: '/tmp/site', name: 'site' };
const MANIFEST = {
	id: 'cp-auto',
	siteId: 'site-1',
	label: undefined,
	trigger: 'auto-pre-tool',
	toolName: 'wp_cli',
	createdAt: 123,
};

function makeTool( name: string ): AnyStudioAgentTool {
	return {
		name,
		description: '',
		label: name,
		parameters: {},
		rawHandler: vi.fn( async () => ( { content: [ { type: 'text' as const, text: 'ok' } ] } ) ),
		execute: vi.fn( async () => ( { content: [ { type: 'text' as const, text: 'ok' } ] } ) ),
	};
}

beforeEach( () => {
	vi.clearAllMocks();
	resolveSite.mockResolvedValue( SITE );
	isCheckpointSupported.mockReturnValue( true );
	readCheckpointIndex.mockResolvedValue( { version: 1, checkpoints: [] } );
	createCheckpoint.mockResolvedValue( MANIFEST );
} );

describe( 'withAutoCheckpoint', () => {
	it( 'leaves non-destructive tools untouched', () => {
		const tool = makeTool( 'site_info' );
		expect( withAutoCheckpoint( tool ) ).toBe( tool );
	} );

	it( 'creates a checkpoint before wp_cli runs (rawHandler path)', async () => {
		const tool = makeTool( 'wp_cli' );
		const wrapped = withAutoCheckpoint( tool );
		const result = await wrapped.rawHandler( {
			nameOrPath: 'site',
			command: 'wp option update x y',
		} as never );

		expect( createCheckpoint ).toHaveBeenCalledWith(
			SITE,
			expect.objectContaining( { trigger: 'auto-pre-tool', toolName: 'wp_cli' } )
		);
		expect( tool.rawHandler ).toHaveBeenCalled();
		// The checkpoint chip is attached to the tool result.
		expect(
			( result as { studioArtifacts?: Array< { type: string } > } ).studioArtifacts?.[ 0 ]?.type
		).toBe( 'checkpoint' );
	} );

	it( 'attaches the artifact through the execute path details', async () => {
		const tool = makeTool( 'wp_cli' );
		const wrapped = withAutoCheckpoint( tool );
		const result = await wrapped.execute( 'call-1', { nameOrPath: 'site' } as never );

		const details = result.details as { studioArtifacts?: Array< { type: string } > };
		expect( details.studioArtifacts?.[ 0 ]?.type ).toBe( 'checkpoint' );
	} );

	it( 'debounces when a recent checkpoint exists', async () => {
		readCheckpointIndex.mockResolvedValue( {
			version: 1,
			checkpoints: [
				{
					id: 'cp-recent',
					createdAt: Date.now() - AUTO_CHECKPOINT_DEBOUNCE_MS / 2,
					trigger: 'manual',
				},
			],
		} );
		const tool = makeTool( 'wp_cli' );
		const wrapped = withAutoCheckpoint( tool );
		const result = await wrapped.rawHandler( { nameOrPath: 'site' } as never );

		expect( createCheckpoint ).not.toHaveBeenCalled();
		// No chip when no checkpoint was actually captured.
		expect( ( result as { studioArtifacts?: unknown[] } ).studioArtifacts ).toBeUndefined();
	} );

	it( 'lets the tool proceed when checkpointing fails', async () => {
		createCheckpoint.mockRejectedValue( new Error( 'disk full' ) );
		const tool = makeTool( 'wp_cli' );
		const wrapped = withAutoCheckpoint( tool );
		const result = await wrapped.rawHandler( { nameOrPath: 'site' } as never );

		expect( tool.rawHandler ).toHaveBeenCalled();
		expect( ( result as { content: Array< { text: string } > } ).content[ 0 ].text ).toBe( 'ok' );
	} );

	it( 'extracts the data_liberation site target from engine args', async () => {
		const tool = makeTool( 'data_liberation' );
		const wrapped = withAutoCheckpoint( tool );
		await wrapped.rawHandler( {
			tool: 'liberate_reconstruct_pages',
			args: { target: { kind: 'studio', sitePath: '/tmp/site' } },
		} as never );

		expect( resolveSite ).toHaveBeenCalledWith( '/tmp/site' );
		expect( createCheckpoint ).toHaveBeenCalled();
	} );

	it( 'skips checkpointing for unsupported (reprint) sites', async () => {
		isCheckpointSupported.mockReturnValue( false );
		const tool = makeTool( 'wp_cli' );
		const wrapped = withAutoCheckpoint( tool );
		await wrapped.rawHandler( { nameOrPath: 'site' } as never );

		expect( createCheckpoint ).not.toHaveBeenCalled();
		expect( tool.rawHandler ).toHaveBeenCalled();
	} );

	it( 'coalesces concurrent tool calls into a single checkpoint and chip', async () => {
		// Simulate a slow capture so the second call arrives while the first
		// is still in flight (the agent often issues several wp_cli calls in
		// one turn — this must not produce one checkpoint per call).
		let releaseCapture!: ( manifest: typeof MANIFEST ) => void;
		createCheckpoint.mockImplementation(
			() => new Promise( ( resolve ) => ( releaseCapture = resolve ) )
		);
		const tool = makeTool( 'wp_cli' );
		const wrapped = withAutoCheckpoint( tool );

		const first = wrapped.rawHandler( { nameOrPath: 'site', command: 'wp option get x' } as never );
		const second = wrapped.rawHandler( { nameOrPath: 'site', command: 'wp post list' } as never );
		// Let both calls reach the in-flight gate before the capture resolves.
		await new Promise( ( resolve ) => setImmediate( resolve ) );
		releaseCapture( MANIFEST );

		const [ firstResult, secondResult ] = ( await Promise.all( [ first, second ] ) ) as Array< {
			studioArtifacts?: Array< { type: string } >;
		} >;

		expect( createCheckpoint ).toHaveBeenCalledTimes( 1 );
		// Exactly one of the two results carries the chip.
		const chips = [ firstResult, secondResult ].filter(
			( result ) => result.studioArtifacts?.[ 0 ]?.type === 'checkpoint'
		);
		expect( chips ).toHaveLength( 1 );
	} );
} );
