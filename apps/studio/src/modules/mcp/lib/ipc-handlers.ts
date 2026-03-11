import { getMcpServerConfigJson } from '@studio/common/lib/mcp-config';

export async function getMcpServerConfig(): Promise< string > {
	return getMcpServerConfigJson();
}
