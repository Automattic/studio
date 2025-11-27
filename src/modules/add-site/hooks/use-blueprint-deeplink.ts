import { useI18n } from '@wordpress/react-i18n';
import { useCallback } from 'react';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { Blueprint } from 'src/stores/wpcom-api';

type BlueprintMetadata = {
	title?: string;
	description?: string;
};

type BlueprintWarning = { feature: string; reason: string };

interface UseBlueprintDeeplinkOptions {
	isAnySiteProcessing: boolean;
	openModal: () => void;
	setSelectedBlueprint: ( blueprint?: Blueprint ) => void;
	setPhpVersion: ( version: string ) => void;
	setWpVersion: ( version: string ) => void;
	setBlueprintPreferredVersions: ( versions: { php?: string; wp?: string } | undefined ) => void;
	setBlueprintDeeplinkWarnings: ( warnings: BlueprintWarning[] | undefined ) => void;
	navigateToBlueprintDeeplink: () => void;
}

export function useBlueprintDeeplink( options: UseBlueprintDeeplinkOptions ): void {
	const { __ } = useI18n();
	const {
		isAnySiteProcessing,
		openModal,
		setSelectedBlueprint,
		setPhpVersion,
		setWpVersion,
		setBlueprintPreferredVersions,
		setBlueprintDeeplinkWarnings,
		navigateToBlueprintDeeplink,
	} = options;

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
		async (
			_event: unknown,
			{ blueprintPath, warnings }: { blueprintPath: string; warnings?: BlueprintWarning[] }
		) => {
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
				setBlueprintDeeplinkWarnings( warnings );
				openModal();
				navigateToBlueprintDeeplink();
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
			setBlueprintDeeplinkWarnings,
			openModal,
			navigateToBlueprintDeeplink,
		]
	);
	useIpcListener( 'add-site-with-blueprint', handleBlueprintFromUrl );
}
