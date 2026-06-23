import { useEffect, useState } from 'react';
import { useFindAvailableSiteName } from '@/data/queries/use-create-site-helpers';

/**
 * Resolves a seeded site name (from a blueprint, a backup filename, a
 * connected site, …) to a variant that doesn't collide with an existing
 * site ("Name", "Name 2", …). Returns `null` while resolving — callers
 * hold the form's initial values until then since they're applied only
 * once. Falls back to the raw name if the collision check fails, so the
 * form still seeds; the create form's path validation surfaces any real
 * conflict before submit.
 */
export function useSeededSiteName( baseName: string | null ): string | null {
	const findAvailableSiteName = useFindAvailableSiteName();
	const [ seededName, setSeededName ] = useState< string | null >( null );

	useEffect( () => {
		if ( ! baseName ) {
			setSeededName( null );
			return;
		}
		let cancelled = false;
		findAvailableSiteName( baseName )
			.then( ( { name } ) => {
				if ( ! cancelled ) {
					setSeededName( name );
				}
			} )
			.catch( () => {
				if ( ! cancelled ) {
					setSeededName( baseName );
				}
			} );
		return () => {
			cancelled = true;
		};
	}, [ baseName, findAvailableSiteName ] );

	return seededName;
}
