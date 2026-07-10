import { useEffect, useState } from 'react';
import { useFindAvailableSitePath } from '@/data/queries/use-create-site-helpers';

export function useSeededSiteName( baseName: string | null ): string | null {
	const findAvailableSitePath = useFindAvailableSitePath();
	const [ seededName, setSeededName ] = useState< string | null >( null );

	useEffect( () => {
		if ( ! baseName ) {
			setSeededName( null );
			return;
		}

		let cancelled = false;
		setSeededName( null );
		findAvailableSitePath( baseName )
			.then( ( { name } ) => {
				if ( ! cancelled ) setSeededName( name );
			} )
			.catch( () => {
				if ( ! cancelled ) setSeededName( baseName );
			} );

		return () => {
			cancelled = true;
		};
	}, [ baseName, findAvailableSitePath ] );

	return seededName;
}
