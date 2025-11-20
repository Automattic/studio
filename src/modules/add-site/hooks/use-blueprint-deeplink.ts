import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useState } from 'react';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { Blueprint } from 'src/stores/wpcom-api';

type BlueprintMetadata = {
	title?: string;
	description?: string;
};

interface UseBlueprintDeeplinkOptions {
	isAnySiteProcessing: boolean;
	openModal: () => void;
	setSelectedBlueprint: ( blueprint?: Blueprint ) => void;
	setPhpVersion: ( version: string ) => void;
	setWpVersion: ( version: string ) => void;
	setBlueprintPreferredVersions: ( versions: { php?: string; wp?: string } | undefined ) => void;
}

interface UseBlueprintDeeplinkReturn {
	initialNavigatorPath: string;
	blueprintError: string | null;
	setBlueprintError: ( error: string | null ) => void;
	resetDeeplinkState: () => void;
}

export function useBlueprintDeeplink(
	options: UseBlueprintDeeplinkOptions
): UseBlueprintDeeplinkReturn {
	const { __ } = useI18n();
	const {
		isAnySiteProcessing,
		openModal,
		setSelectedBlueprint,
		setPhpVersion,
		setWpVersion,
		setBlueprintPreferredVersions,
	} = options;

	const [ initialNavigatorPath, setInitialNavigatorPath ] = useState< string >( '/' );
	const [ blueprintError, setBlueprintError ] = useState< string | null >( null );

	const resetDeeplinkState = useCallback( () => {
		setInitialNavigatorPath( '/' );
		setBlueprintError( null );
	}, [] );

	const createBlueprintFromData = useCallback(
		(
			blueprintData: { meta?: BlueprintMetadata; [ key: string ]: unknown },
			slug: string,
			defaultTitle: string,
			defaultExcerpt: string
		): Blueprint => {
			const blueprintMeta = blueprintData.meta as BlueprintMetadata | undefined;
			return {
				slug,
				title: blueprintMeta?.title || defaultTitle,
				excerpt: blueprintMeta?.description || defaultExcerpt,
				image: '',
				playground_url: '',
				blueprint: blueprintData,
			};
		},
		[]
	);

	const applyPreferredVersions = useCallback(
		( blueprintData: { preferredVersions?: { php?: string; wp?: string } } ) => {
			if ( blueprintData.preferredVersions ) {
				const preferredVersions = blueprintData.preferredVersions as {
					php?: string;
					wp?: string;
				};
				setBlueprintPreferredVersions( preferredVersions );
				if ( preferredVersions.php && preferredVersions.php !== 'latest' ) {
					setPhpVersion( preferredVersions.php );
				}
				if ( preferredVersions.wp && preferredVersions.wp !== 'latest' ) {
					setWpVersion( preferredVersions.wp );
				}
			}
		},
		[ setBlueprintPreferredVersions, setPhpVersion, setWpVersion ]
	);

	const handleBlueprintFromUrl = useCallback(
		async ( _event: unknown, { blueprintPath }: { blueprintPath: string } ) => {
			if ( isAnySiteProcessing ) {
				return;
			}
			try {
				const blueprintJson = await getIpcApi().readBlueprintFile( blueprintPath );

				const fileName = blueprintPath.split( /[/\\]/ ).pop() || 'blueprint.json';
				const fileBlueprint = createBlueprintFromData(
					blueprintJson,
					`file:${ fileName }`,
					fileName.replace( '.json', '' ),
					__( 'Blueprint loaded from URL' )
				);

				setSelectedBlueprint( fileBlueprint );
				applyPreferredVersions( blueprintJson );
				setInitialNavigatorPath( '/blueprint/create' );
				openModal();
			} catch ( error ) {
				console.error( 'Failed to load blueprint from URL:', error );
			}
		},
		[
			isAnySiteProcessing,
			__,
			createBlueprintFromData,
			setSelectedBlueprint,
			applyPreferredVersions,
			openModal,
		]
	);
	useIpcListener( 'add-site-blueprint-from-url', handleBlueprintFromUrl );

	const handleBlueprintFromBase64 = useCallback(
		( _event: unknown, { blueprintJson }: { blueprintJson: string } ) => {
			if ( isAnySiteProcessing ) {
				return;
			}
			try {
				const blueprintData = JSON.parse( blueprintJson );
				const blueprint = createBlueprintFromData(
					blueprintData,
					`deeplink-${ Date.now() }`,
					__( 'Custom Blueprint' ),
					__( 'Blueprint from base64' )
				);

				setSelectedBlueprint( blueprint );
				applyPreferredVersions( blueprintData );
				setInitialNavigatorPath( '/blueprint/create' );
				openModal();
			} catch ( error ) {
				console.error( 'Failed to parse blueprint from IPC event:', error );
			}
		},
		[
			isAnySiteProcessing,
			__,
			createBlueprintFromData,
			setSelectedBlueprint,
			applyPreferredVersions,
			openModal,
		]
	);
	useIpcListener( 'add-site-blueprint-from-base64', handleBlueprintFromBase64 );

	return {
		initialNavigatorPath,
		blueprintError,
		setBlueprintError,
		resetDeeplinkState,
	};
}
