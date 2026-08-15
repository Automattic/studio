import { readAppConfig, updateAppConfig } from './app-config';

export type DatabaseAppearance = 'studio' | 'phpmyadmin';

const DEFAULT_DATABASE_APPEARANCE: DatabaseAppearance = 'studio';

export async function getDatabaseAppearance(): Promise< DatabaseAppearance > {
	const value = ( await readAppConfig() ).databaseAppearance;
	return value === 'phpmyadmin' ? value : DEFAULT_DATABASE_APPEARANCE;
}

export async function saveDatabaseAppearance( appearance: DatabaseAppearance ): Promise< void > {
	if ( appearance !== 'studio' && appearance !== 'phpmyadmin' ) {
		throw new Error( `Unsupported database appearance: ${ appearance }` );
	}

	await updateAppConfig( ( config ) => {
		config.databaseAppearance = appearance;
	} );
}
