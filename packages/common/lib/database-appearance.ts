import { readAppConfig, updateAppConfig } from './app-config';

export type DatabaseAppearance = 'studio' | 'phpmyadmin';

export const DATABASE_APPEARANCES = [ 'studio', 'phpmyadmin' ] as const;
export const DEFAULT_DATABASE_APPEARANCE: DatabaseAppearance = 'studio';

export function parseDatabaseAppearance( value: unknown ): DatabaseAppearance {
	return value === 'phpmyadmin' ? value : DEFAULT_DATABASE_APPEARANCE;
}

export async function getDatabaseAppearance(): Promise< DatabaseAppearance > {
	return parseDatabaseAppearance( ( await readAppConfig() ).databaseAppearance );
}

export async function saveDatabaseAppearance( appearance: DatabaseAppearance ): Promise< void > {
	if ( appearance !== 'studio' && appearance !== 'phpmyadmin' ) {
		throw new Error( `Unsupported database appearance: ${ appearance }` );
	}

	await updateAppConfig( ( config ) => {
		config.databaseAppearance = appearance;
	} );
}
