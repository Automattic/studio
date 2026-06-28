import { useEffect, useMemo, useState } from 'react';
import { useGetStudioExtensionsQuery } from 'src/stores/installed-apps-api';
import {
	loadStudioRendererExtension,
	registeredStudioRendererExtensions,
} from '../renderer-registry';
import type { StudioExtensionListItem, StudioRendererExtension } from '../types';

const EMPTY_EXTENSIONS: StudioExtensionListItem[] = [];
const EMPTY_RENDERER_EXTENSIONS: StudioRendererExtension[] = [];

function isActiveExtension( extension: StudioExtensionListItem ): boolean {
	return extension.installed && extension.enabled && extension.isSupported;
}

export function useActiveStudioExtensions() {
	const { data: extensions = EMPTY_EXTENSIONS, isLoading } = useGetStudioExtensionsQuery();
	const activeIds = useMemo(
		() => new Set( extensions.filter( isActiveExtension ).map( ( extension ) => extension.id ) ),
		[ extensions ]
	);
	const externalExtensions = useMemo(
		() =>
			extensions.filter(
				( extension ) =>
					isActiveExtension( extension ) && extension.renderer && extension.installedPath
			),
		[ extensions ]
	);
	const [ loadedExtensions, setLoadedExtensions ] =
		useState< StudioRendererExtension[] >( EMPTY_RENDERER_EXTENSIONS );
	const [ isLoadingRendererExtensions, setIsLoadingRendererExtensions ] = useState( false );
	const activeRegisteredExtensions = useMemo(
		() =>
			registeredStudioRendererExtensions.filter( ( extension ) =>
				activeIds.has( extension.manifest.id )
			),
		[ activeIds ]
	);
	const activeExtensions = useMemo(
		() => [ ...activeRegisteredExtensions, ...loadedExtensions ],
		[ activeRegisteredExtensions, loadedExtensions ]
	);

	useEffect( () => {
		let isCurrent = true;

		if ( externalExtensions.length === 0 ) {
			setLoadedExtensions( EMPTY_RENDERER_EXTENSIONS );
			setIsLoadingRendererExtensions( false );
			return () => {
				isCurrent = false;
			};
		}

		setIsLoadingRendererExtensions( true );
		void Promise.all(
			externalExtensions.map( async ( extension ) => {
				try {
					return await loadStudioRendererExtension( extension );
				} catch ( error ) {
					console.error( `Failed to load Studio extension renderer: ${ extension.id }`, error );
					return undefined;
				}
			} )
		).then( ( loadedRendererExtensions ) => {
			if ( ! isCurrent ) {
				return;
			}
			setLoadedExtensions(
				loadedRendererExtensions.filter( ( extension ): extension is StudioRendererExtension =>
					Boolean( extension )
				)
			);
			setIsLoadingRendererExtensions( false );
		} );

		return () => {
			isCurrent = false;
		};
	}, [ externalExtensions ] );

	return {
		isLoading: isLoading || isLoadingRendererExtensions,
		extensions: activeExtensions,
	};
}
