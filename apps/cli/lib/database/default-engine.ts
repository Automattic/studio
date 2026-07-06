import { type DatabaseEngine } from '@studio/common/lib/database-engine';
import { resolveDefaultDatabaseEngine as resolveSharedDefaultDatabaseEngine } from '@studio/common/lib/default-database-engine';
import { getDatabaseProvider } from './providers';

export async function resolveDefaultDatabaseEngine(
	explicitEngine?: DatabaseEngine
): Promise< DatabaseEngine > {
	return getDatabaseProvider( await resolveSharedDefaultDatabaseEngine( explicitEngine ) ).engine;
}
