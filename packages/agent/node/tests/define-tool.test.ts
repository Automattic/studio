import { validateToolArguments } from '@earendil-works/pi-ai';
import { expect, it } from 'vitest';
import { bindTool } from '@studio/agent/node/tools/define-tool';
import { takeScreenshotTool } from '@studio/agent/node/tools/take-screenshot';
import type { StudioAgentHost } from '@studio/agent/node/host';

// eval12-13: three screenshot calls sent their URLs as the JSON text of a list.
it.each( [
	[
		'["http://localhost:8881/", "http://localhost:8881/about/"]',
		[ 'http://localhost:8881/', 'http://localhost:8881/about/' ],
	],
	[ 'http://localhost:8881/', 'http://localhost:8881/' ],
	[ '[not json', '[not json' ],
] )( 'takes the url %s as %j', ( url, taken ) => {
	const tool = bindTool( takeScreenshotTool, {} as StudioAgentHost );
	const args = ( tool.prepareArguments ?? ( ( sent ) => sent ) )( { url } );
	expect(
		validateToolArguments( tool, {
			type: 'toolCall',
			id: '1',
			name: tool.name,
			arguments: args as never,
		} )
	).toMatchObject( { url: taken } );
} );
