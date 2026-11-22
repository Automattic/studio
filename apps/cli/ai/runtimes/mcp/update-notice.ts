import {
	getAvailableCliUpdate,
	getCliInstallKind,
	type CliInstallKind,
	type CliUpdate,
} from 'cli/lib/update-notifier';

export function createMcpUpdateNotice(
	version: string,
	installKind: CliInstallKind = getCliInstallKind()
) {
	let checkedAt = -Infinity;
	let check: Promise< CliUpdate | null >;
	let deliveredVersion: string | undefined;
	const getNotice = async () => {
		if ( Date.now() - checkedAt >= 24 * 60 * 60 * 1000 ) {
			checkedAt = Date.now();
			check = getAvailableCliUpdate( version, installKind ).catch( () => null );
		}
		const update = await check;
		return update
			? {
					version: update.latestVersion,
					text: `WordPress Studio CLI update available: ${ version } → ${ update.latestVersion }. Tell the user an update is available. They can run \`${ update.updateCommand }\` in a terminal, then reconnect the Studio MCP server to use the new version.`,
			  }
			: null;
	};
	return {
		instructions: async () => ( await getNotice() )?.text ?? '',
		forToolResult: async () => {
			const notice = await getNotice();
			if ( ! notice || deliveredVersion === notice.version ) {
				return '';
			}
			deliveredVersion = notice.version;
			return notice.text;
		},
	};
}
