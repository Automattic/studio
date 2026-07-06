import { databaseEngineSchema, type DatabaseEngine } from './database-engine';
import { readSharedConfig } from './shared-config';

export async function readDefaultDatabaseEnginePreference(): Promise< DatabaseEngine | undefined > {
	try {
		const sharedConfig = await readSharedConfig();
		const preference = databaseEngineSchema.safeParse( sharedConfig.defaultDatabaseEngine );
		return preference.success ? preference.data : undefined;
	} catch {
		return undefined;
	}
}
