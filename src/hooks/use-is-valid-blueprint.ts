import { useEffect, useState, useMemo } from 'react';
import { getIpcApi } from 'src/lib/get-ipc-api';
import type { Blueprint } from 'src/stores/wpcom-api';

export function useIsValidBlueprint( className?: string, content?: string ) {
	const blueprintJson = useMemo< Blueprint[ 'blueprint' ] | null >( () => {
		if ( ! className?.includes( 'language-json' ) || ! content ) {
			return null;
		}
		try {
			const parsed = JSON.parse( content );
			return parsed;
		} catch {
			return null;
		}
	}, [ className, content ] );

	const [ isBlueprintValid, setIsBlueprintValid ] = useState( false );

	useEffect( () => {
		const validate = async () => {
			if ( ! blueprintJson ) {
				return;
			}

			try {
				const validation = await getIpcApi().validateBlueprint( blueprintJson );
				setIsBlueprintValid( Boolean( validation.valid ) );
			} catch {
				console.error( 'Failed to validate Blueprint' );
			}
		};

		void validate();
	}, [ blueprintJson ] );

	return isBlueprintValid;
}
