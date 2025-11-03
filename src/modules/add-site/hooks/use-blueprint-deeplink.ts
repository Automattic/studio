import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useEffect, useState } from 'react';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { Blueprint } from 'src/stores/wpcom-api';

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

	const handleAddSiteBlueprint = useCallback(
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
	useIpcListener( 'add-site-blueprint', handleAddSiteBlueprint );

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

					// Create a file blueprint object similar to handleFileSelect
					const fileName = pendingBlueprintPath.split( /[/\\]/ ).pop() || 'blueprint.json';
					const blueprintMeta = blueprintJson.meta as
						| { title?: string; description?: string }
						| undefined;
					const fileBlueprint: Blueprint = {
						slug: `file:${ fileName }`,
						title: blueprintMeta?.title || fileName.replace( '.json', '' ),
						excerpt: blueprintMeta?.description || __( 'Blueprint loaded from URL' ),
						image: '',
						playground_url: '',
						blueprint: blueprintJson,
					};

					setSelectedBlueprint( fileBlueprint );

					// Apply preferred versions if any
					if ( blueprintJson.preferredVersions ) {
						const preferredVersions = blueprintJson.preferredVersions as {
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
		setSelectedBlueprint,
		setPhpVersion,
		setWpVersion,
		setBlueprintPreferredVersions,
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
