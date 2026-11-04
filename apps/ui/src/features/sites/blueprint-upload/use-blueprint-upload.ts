import { __ } from '@wordpress/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useConnector } from '@/data/core';
import { loadBlueprintFile, MissingBlueprintError } from './load-blueprint-file';
import type { SelectedBlueprint } from '@/features/sites/blueprint-selection';

export function useBlueprintUpload( {
	enabled,
	onSelect,
	onValidityChange,
	onBackup,
}: {
	enabled: boolean;
	onSelect: ( blueprint: SelectedBlueprint ) => void;
	onValidityChange: ( valid: boolean ) => void;
	onBackup?: ( file: File ) => void;
} ) {
	const connector = useConnector();
	const [ error, setError ] = useState( '' );
	const [ isLoading, setIsLoading ] = useState( false );
	const requestRef = useRef( 0 );

	const cancel = useCallback( () => {
		requestRef.current += 1;
		setError( '' );
		setIsLoading( false );
		onValidityChange( true );
	}, [ onValidityChange ] );

	useEffect( () => {
		if ( ! enabled ) cancel();
	}, [ enabled, cancel ] );
	useEffect(
		() => () => {
			requestRef.current += 1;
		},
		[]
	);

	const handleFile = useCallback(
		async ( file: File, detectBackup = false ) => {
			if ( ! enabled ) return;
			const request = ++requestRef.current;
			setError( '' );
			setIsLoading( true );
			onValidityChange( false );
			const timeout = setTimeout( () => {
				if ( request !== requestRef.current ) return;
				requestRef.current += 1;
				setError(
					__( 'This file took too long to load. Please try again or choose another file.' )
				);
				setIsLoading( false );
				onValidityChange( true );
			}, 60_000 );
			try {
				const blueprint = await loadBlueprintFile( file, connector );
				if ( request !== requestRef.current ) {
					if ( blueprint.tempDir ) {
						await connector.cleanupBlueprintTempDir( blueprint.tempDir ).catch( () => undefined );
					}
					return;
				}
				onSelect( blueprint );
				onValidityChange( true );
			} catch ( loadError ) {
				if ( request === requestRef.current ) {
					if ( detectBackup && onBackup && loadError instanceof MissingBlueprintError ) {
						onBackup( file );
						onValidityChange( true );
						return;
					}
					setError(
						loadError instanceof Error
							? loadError.message
							: __( 'Failed to load Blueprint file. Please try again.' )
					);
					onValidityChange( true );
				}
			} finally {
				clearTimeout( timeout );
				if ( request === requestRef.current ) setIsLoading( false );
			}
		},
		[ connector, enabled, onSelect, onValidityChange, onBackup ]
	);

	return { handleFile, error, isLoading, dismissError: cancel, cancel };
}
