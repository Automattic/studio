import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createStudioTools } from 'cli/ai/tools';

export async function startMcpStdioServer(): Promise< void > {
	const studioMcp = createStudioTools();
	const transport = new StdioServerTransport();

	const shutdown = async () => {
		await studioMcp.instance.close();
		process.exit( 0 );
	};
	process.on( 'SIGINT', shutdown );
	process.on( 'SIGTERM', shutdown );

	await studioMcp.instance.connect( transport );
}
