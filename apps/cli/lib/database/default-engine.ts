import { DATABASE_ENGINE_SQLITE, type DatabaseEngine } from '@studio/common/lib/database-engine';
import { readDefaultDatabaseEnginePreference } from '@studio/common/lib/default-database-engine';
import { getDatabaseProvider } from './providers';

export async function resolveDefaultDatabaseEngine(
	explicitEngine?: DatabaseEngine
): Promise< DatabaseEngine > {
	if ( explicitEngine ) {
		return getDatabaseProvider( explicitEngine ).engine;
	}

	const preference = await readDefaultDatabaseEnginePreference();
	if ( preference ) {
		return getDatabaseProvider( preference ).engine;
	}

	return getDatabaseProvider( DATABASE_ENGINE_SQLITE ).engine;
}
