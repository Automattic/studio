import { describe, expect, it } from 'vitest';
import { buildExplorerAgentPrompt, getVisibleExplorerPanelKinds } from './explorer-agent-context';

describe( 'buildExplorerAgentPrompt', () => {
	it( 'keeps prompts unchanged when Explorer is closed', () => {
		expect(
			buildExplorerAgentPrompt( {
				prompt: 'Update the homepage',
				visiblePanelKinds: [],
			} )
		).toBe( 'Update the homepage' );
	} );

	it( 'adds visible Explorer panels as hidden context', () => {
		const prompt = buildExplorerAgentPrompt( {
			prompt: 'Does this navigation make sense?',
			visiblePanelKinds: [ 'wordpress', 'site-map' ],
			browserPath: '/about',
		} );

		expect( prompt ).toContain( 'WordPress screen (/about)' );
		expect( prompt ).toContain( 'Site Map canvas' );
		expect( prompt ).toContain( 'information architecture' );
		expect( prompt ).toContain( 'Does this navigation make sense?' );
	} );

	it( 'does not wrap slash commands', () => {
		expect(
			buildExplorerAgentPrompt( {
				prompt: '/status',
				visiblePanelKinds: [ 'site-map' ],
			} )
		).toBe( '/status' );
	} );

	it( 'derives panel kinds from mixed Explorer tabs', () => {
		expect(
			getVisibleExplorerPanelKinds( {
				visibleTabIds: [ 'preview-tab-1', 'preview-tab-2', 'preview-tab-3', 'preview-tab-4' ],
				tabs: [
					{ id: 'preview-tab-1', path: '/', reloadNonce: 0 },
					{ id: 'preview-tab-2', kind: 'site-map', path: '/', reloadNonce: 0 },
					{ id: 'preview-tab-3', kind: 'theme', path: '/', reloadNonce: 0 },
					{ id: 'preview-tab-4', kind: 'empty', path: '/', reloadNonce: 0 },
				],
			} )
		).toEqual( [ 'wordpress', 'site-map', 'theme' ] );
	} );
} );
