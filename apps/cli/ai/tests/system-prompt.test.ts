import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../system-prompt';

describe( 'buildSystemPrompt', () => {
	it( 'omits workflow telemetry instructions by default', () => {
		expect( buildSystemPrompt() ).not.toContain( 'record_workflow_event' );
	} );

	it( 'includes workflow telemetry instructions when enabled', () => {
		expect( buildSystemPrompt( { telemetryEnabled: true } ) ).toContain( 'record_workflow_event' );
	} );
} );
