import { getErrorMessage } from '@studio/common/lib/error-formatting';
import { __ } from '@wordpress/i18n';
import { useEffect, useRef } from 'react';
import { useConnector } from '@/data/core';
import { usePathValidator } from '@/data/queries/use-create-site-helpers';
import { useSites } from '@/data/queries/use-sites';
import type { FormData } from './form-data';

const TYPED_PATH_CHECK_DELAY_MS = 300;

// Called from the form (not `PathField`) so it runs even when Advanced is
// collapsed — otherwise `data.path` would stay empty on first load and the
// Advanced toggle would falsely show "1 error found".
export function usePathAutoGenerate(
	data: FormData,
	onChange: ( update: Partial< FormData > ) => void,
	isSubmitting: boolean,
	requiresEmptyPath?: boolean
) {
	const connector = useConnector();
	const { data: sites } = useSites();
	const { generateProposedPath, selectPath } = usePathValidator( sites, requiresEmptyPath );

	const onChangeRef = useRef( onChange );
	useEffect( () => {
		onChangeRef.current = onChange;
	}, [ onChange ] );

	const pendingNameRef = useRef< string | null >( null );
	useEffect( () => {
		if ( isSubmitting ) return;
		if ( data.hasCustomPath ) {
			pendingNameRef.current = null;
			onChangeRef.current( { isPathPending: false } );
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

	// Without a native picker the folder is typed, so it's checked as it's typed.
	const typedPath =
		data.hasCustomPath && ! connector.capabilities.nativeFolderPicker ? data.path.trim() : '';
	useEffect( () => {
		if ( isSubmitting || ! typedPath ) return;
		onChangeRef.current( { isPathPending: true } );
		let cancelled = false;
		const timer = setTimeout( async () => {
			try {
				const result = await selectPath( typedPath );
				if ( cancelled ) return;
				onChangeRef.current( {
					pathError: result?.error ?? '',
					isWordPress: !! result?.isWordPress,
					isPathPending: false,
				} );
			} catch ( error ) {
				if ( cancelled ) return;
				onChangeRef.current( { pathError: getErrorMessage( error ), isPathPending: false } );
			}
		}, TYPED_PATH_CHECK_DELAY_MS );
		return () => {
			cancelled = true;
			clearTimeout( timer );
		};
	}, [ typedPath, selectPath, isSubmitting ] );
}
