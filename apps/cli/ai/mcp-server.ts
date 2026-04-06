import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createStudioTools } from 'cli/ai/tools';
import { type McpTelemetryGroup } from 'cli/lib/types/bump-stats';

type McpServerOptions = {
	telemetryGroup?: McpTelemetryGroup;
};

export async function startMcpStdioServer( options: McpServerOptions = {} ): Promise< void > {
	const studioMcp = createStudioTools( options );
	const transport = new StdioServerTransport();

	const shutdown = async () => {
		await studioMcp.instance.close();
		process.exit( 0 );
	};
	process.on( 'SIGINT', shutdown );
	process.on( 'SIGTERM', shutdown );

	await studioMcp.instance.connect( transport );
}
