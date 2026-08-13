/**
 * Moves `aiProvider` and `anthropicApiKey` from the CLI-owned `cli.json` into
 * the shared `shared.json`, where both Desktop and CLI now read them from.
 *
 * Earlier builds wrote both fields to cli.json. `settings-store.ts` still falls
 * back to reading them there, so nothing breaks before this runs; the migration
 * makes shared.json the single source and drops the stale copies. Values already
 * in shared.json win — they were written by a newer build, so the cli.json ones
 * are stale and only get removed.
 */

import {
	lockCliConfigFile,
	readCliConfigFileRaw,
	unlockCliConfigFile,
	writeCliConfigFileRaw,
} from '@studio/common/lib/cli-config-file';
import {
	lockSharedConfig,
	readSharedConfig,
	saveSharedConfig,
	unlockSharedConfig,
} from '@studio/common/lib/shared-config';
import type { Migration } from '@studio/common/lib/migration';

interface LegacyAiFields {
	aiProvider?: string;
	anthropicApiKey?: string;
}

async function readLegacyCliFields(): Promise< LegacyAiFields > {
	try {
		const { aiProvider, anthropicApiKey } = await readCliConfigFileRaw();
		return {
			aiProvider: typeof aiProvider === 'string' ? aiProvider : undefined,
			anthropicApiKey: typeof anthropicApiKey === 'string' ? anthropicApiKey : undefined,
		};
	} catch {
		return {};
	}
}

function hasLegacyFields( fields: LegacyAiFields ): boolean {
	return fields.aiProvider !== undefined || fields.anthropicApiKey !== undefined;
}

async function copyToSharedConfig( legacy: LegacyAiFields ): Promise< void > {
	try {
		await lockSharedConfig();
		const shared = await readSharedConfig();
		const update: LegacyAiFields = {};
		if ( legacy.aiProvider !== undefined && shared.aiProvider === undefined ) {
			update.aiProvider = legacy.aiProvider;
		}
		if ( legacy.anthropicApiKey !== undefined && shared.anthropicApiKey === undefined ) {
			update.anthropicApiKey = legacy.anthropicApiKey;
		}
		if ( Object.keys( update ).length === 0 ) {
			return;
		}
		await saveSharedConfig( { ...shared, ...update } );
	} finally {
		await unlockSharedConfig();
	}
}

async function removeFromCliConfig(): Promise< void > {
	try {
		await lockCliConfigFile();
		const config = await readCliConfigFileRaw();
		if ( ! hasLegacyFields( config as LegacyAiFields ) ) {
			return;
		}
		delete config.aiProvider;
		delete config.anthropicApiKey;
		await writeCliConfigFileRaw( config );
	} finally {
		await unlockCliConfigFile();
	}
}

export const moveAiSettingsToShared: Migration = {
	async needsToRun() {
		return hasLegacyFields( await readLegacyCliFields() );
	},

	async run() {
		const legacy = await readLegacyCliFields();
		if ( ! hasLegacyFields( legacy ) ) {
			return;
		}
		await copyToSharedConfig( legacy );
		await removeFromCliConfig();
	},
};
