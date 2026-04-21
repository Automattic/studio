import {
	type ApprovedPermission,
	lockCliConfig,
	readCliConfig,
	saveCliConfig,
	unlockCliConfig,
} from './core';

export async function readApprovedPermissions(): Promise< ApprovedPermission[] > {
	const config = await readCliConfig();
	return config.approvedPermissions ?? [];
}

export async function addApprovedPermission( entry: ApprovedPermission ): Promise< void > {
	try {
		await lockCliConfig();
		const config = await readCliConfig();
		const existing = config.approvedPermissions ?? [];
		const alreadyPresent = existing.some(
			( item ) => item.toolName === entry.toolName && item.approvalPath === entry.approvalPath
		);
		if ( alreadyPresent ) {
			return;
		}
		config.approvedPermissions = [ ...existing, entry ];
		await saveCliConfig( config );
	} finally {
		await unlockCliConfig();
	}
}
