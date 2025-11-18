import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useEffect, useState } from 'react';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { Blueprint } from 'src/stores/wpcom-api';

type BlueprintMetadata = {
	title?: string;
	description?: string;
};

interface UseBlueprintDeeplinkOptions {
	showModal: boolean;
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
		showModal,
		isAnySiteProcessing,
		openModal,
		setSelectedBlueprint,
		setPhpVersion,
		setWpVersion,
		setBlueprintPreferredVersions,
	} = options;

	const [ pendingBlueprintPath, setPendingBlueprintPath ] = useState< string | null >( null );
	const [ initialNavigatorPath, setInitialNavigatorPath ] = useState< string >( '/' );
	const [ blueprintError, setBlueprintError ] = useState< string | null >( null );

	const resetDeeplinkState = useCallback( () => {
		setInitialNavigatorPath( '/' );
		setPendingBlueprintPath( null );
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
			setPendingBlueprintPath( blueprintPath );
			setInitialNavigatorPath( '/blueprint' );
			openModal();
		},
		[ isAnySiteProcessing, openModal ]
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

	// Load and set blueprint when modal opens with a pending blueprint
	useEffect( () => {
		if ( showModal && pendingBlueprintPath ) {
			const loadBlueprintFromPath = async () => {
				try {
					const blueprintJson = await getIpcApi().readBlueprintFile( pendingBlueprintPath );

					const validation = await getIpcApi().validateBlueprint( blueprintJson );

					if ( ! validation.valid ) {
						const errorMessage = validation.error || __( 'Invalid Blueprint format' );
						throw new Error( errorMessage );
					}

					const fileName = pendingBlueprintPath.split( /[/\\]/ ).pop() || 'blueprint.json';
					const fileBlueprint = createBlueprintFromData(
						blueprintJson,
						`file:${ fileName }`,
						fileName.replace( '.json', '' ),
						__( 'Blueprint loaded from URL' )
					);

					setSelectedBlueprint( fileBlueprint );
					applyPreferredVersions( blueprintJson );
					setPendingBlueprintPath( null );
				} catch ( error ) {
					const errorMessage =
						error instanceof Error
							? error.message
							: __( 'Failed to load blueprint. Please check the blueprint file and try again.' );
					setBlueprintError( errorMessage );
					setPendingBlueprintPath( null );
				}
			};

			void loadBlueprintFromPath();
		}
	}, [
		showModal,
		pendingBlueprintPath,
		createBlueprintFromData,
		setSelectedBlueprint,
		applyPreferredVersions,
		setBlueprintError,
		__,
	] );

	return {
		initialNavigatorPath,
		blueprintError,
		setBlueprintError,
		resetDeeplinkState,
	};
}
