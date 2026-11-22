import { getErrorMessage } from '@studio/common/lib/error-formatting';
import { __ } from '@wordpress/i18n';
import { useEffect, useRef } from 'react';
import { usePathValidator } from '@/data/queries/use-create-site-helpers';
import { useSites } from '@/data/queries/use-sites';
import { getFolderNameError, splitFolderPath } from './folder-path';
import type { FormData } from './form-data';

export function usePathAutoGenerate(
	data: FormData,
	onChange: ( update: Partial< FormData > ) => void,
	isSubmitting: boolean,
	requiresEmptyPath?: boolean,
	requiresExistingPath?: boolean
) {
	const { data: sites } = useSites();
	const { generateProposedPath, selectPath } = usePathValidator(
		sites,
		requiresEmptyPath,
		requiresExistingPath
	);

	const onChangeRef = useRef( onChange );
	useEffect( () => {
		onChangeRef.current = onChange;
	}, [ onChange ] );

	const pendingNameRef = useRef< string | null >( null );
	useEffect( () => {
		if ( isSubmitting ) return;
		if ( data.hasCustomPath ) {
			pendingNameRef.current = null;
			return;
		}
		const trimmed = data.name.trim();
		if ( ! trimmed ) {
			pendingNameRef.current = null;
			onChangeRef.current( { path: '', pathError: '', isPathPending: false } );
			return;
		}
		pendingNameRef.current = trimmed;
		onChangeRef.current( { isPathPending: true } );
		let cancelled = false;
		void ( async () => {
			try {
				const result = await generateProposedPath( trimmed );
				if ( cancelled || pendingNameRef.current !== trimmed ) return;
				onChangeRef.current( {
					path: result.path,
					pathError: result.error ?? '',
					isWordPress: result.isWordPress,
					isPathPending: false,
				} );
			} catch {
				if ( cancelled || pendingNameRef.current !== trimmed ) return;
				onChangeRef.current( {
					path: '',
					pathError: __( 'Unable to suggest a folder for this site name.' ),
					isPathPending: false,
				} );
			}
		} )();
		return () => {
			cancelled = true;
		};
	}, [ data.name, data.hasCustomPath, generateProposedPath, isSubmitting ] );

	// Recheck chosen folders when the source's requirements change.
	const customPath = data.hasCustomPath ? data.path : '';
	const awaitingSiteName = data.matchSiteName && ! data.name.trim();
	useEffect( () => {
		if ( isSubmitting ) return;
		if ( awaitingSiteName ) {
			onChangeRef.current( { pathError: '', isPathPending: false } );
			return;
		}
		if ( ! customPath.trim() ) {
			if ( data.hasCustomPath ) onChangeRef.current( { isPathPending: false } );
			return;
		}
		const nameError = getFolderNameError( splitFolderPath( customPath ).name );
		if ( nameError ) {
			onChangeRef.current( { pathError: nameError, isPathPending: false } );
			return;
		}
		onChangeRef.current( { isPathPending: true } );
		let cancelled = false;
		const timer = setTimeout( async () => {
			try {
				const result = await selectPath( customPath, true );
				if ( cancelled ) return;
				if ( ! result ) {
					onChangeRef.current( { isPathPending: false } );
					return;
				}
				onChangeRef.current( {
					pathError: result?.error ?? '',
					isWordPress: !! result?.isWordPress,
					isPathPending: false,
					...( result.isWordPress && ! requiresEmptyPath ? { matchSiteName: false } : {} ),
				} );
			} catch ( error ) {
				if ( cancelled ) return;
				onChangeRef.current( { pathError: getErrorMessage( error ), isPathPending: false } );
			}
		}, 300 );
		return () => {
			cancelled = true;
			clearTimeout( timer );
		};
	}, [
		customPath,
		data.hasCustomPath,
		selectPath,
		isSubmitting,
		requiresEmptyPath,
		awaitingSiteName,
	] );
}
