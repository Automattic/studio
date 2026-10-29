// A stdio MCP server for mcp-tools.test.ts. `write` refuses until it is sent
// user_confirmed, the way WordPress.com asks for the user's approval. Reading
// `grow` adds a tool and says the server's tools changed. Each listing is counted in
// `read`'s answer.
// eslint-disable-next-line import-x/no-unresolved -- subpath resolved via package's wildcard export, which the lint resolver doesn't follow
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
// eslint-disable-next-line import-x/no-unresolved -- subpath resolved via package's wildcard export, which the lint resolver doesn't follow
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server(
	{ name: 'fixture', version: '1' },
	{ capabilities: { tools: { listChanged: true } } }
);
const text = ( value, isError = false ) => ( {
	content: [ { type: 'text', text: value } ],
	isError,
} );
const id = { type: 'string' };
let listed = 0;
let grown = false;

server.setRequestHandler( ListToolsRequestSchema, async () => ( {
	tools: [
		...( ( listed++, grown ) ? [ { name: 'grown', inputSchema: { type: 'object' } } ] : [] ),
		{
			name: 'read',
			description: 'Reads a post.',
			inputSchema: { type: 'object', properties: { id }, required: [ 'id' ] },
		},
		{
			name: 'write',
			description: 'Writes a post.',
			inputSchema: {
				type: 'object',
				properties: { id, user_confirmed: { type: 'boolean' } },
				required: [ 'id', 'user_confirmed' ],
			},
		},
	],
} ) );

server.setRequestHandler( CallToolRequestSchema, async ( { params } ) => {
	const args = params.arguments ?? {};
	if ( params.name === 'read' && args.id === 'grow' ) {
		grown = true;
		await server.sendToolListChanged();
	}
	if ( params.name === 'read' ) {
		return text( `read ${ args.id }, listed ${ listed }` );
	}
	if ( args.id === 'missing' ) {
		return text( 'No post missing.', true );
	}
	return args.user_confirmed === true
		? text( `wrote ${ args.id }` )
		: text(
				'Approval required. Nothing was changed.\n\nWhat to tell the user: Run Write for site 1?\n\nRequested action: Retitle the post.',
				true
		  );
} );

await server.connect( new StdioServerTransport() );
