import { createContext, ReactNode, useCallback, useContext, useState } from 'react';
import { BlueprintValidationWarning } from 'common/lib/blueprint-validation';
import { useAddSite } from 'src/hooks/use-add-site';
import { useImportExport } from 'src/hooks/use-import-export';
import { useBlueprintDeeplink } from 'src/modules/add-site/hooks/use-blueprint-deeplink';
import { Blueprint } from 'src/stores/wpcom-api';

interface AddSiteContextType {
	blueprintPreferredVersions?: { php?: string; wp?: string };
	setBlueprintPreferredVersions: ( versions: { php?: string; wp?: string } | undefined ) => void;
	blueprintDeeplinkWarnings?: BlueprintValidationWarning[];
	setBlueprintDeeplinkWarnings: ( warnings: BlueprintValidationWarning[] | undefined ) => void;
	isDeeplinkFlow: boolean;
	setIsDeeplinkFlow: ( isDeeplink: boolean ) => void;
	selectedBlueprint?: Blueprint;
	pendingDeeplinkModal: boolean;
	clearDeeplinkState: () => void;
	addSiteProps: ReturnType< typeof useAddSite >;
	isAnySiteProcessing: boolean;
}

const AddSiteContext = createContext< AddSiteContextType | null >( null );

interface AddSiteProviderProps {
	children: ReactNode;
}

export function AddSiteProvider( { children }: AddSiteProviderProps ) {
	const addSiteProps = useAddSite();
	const {
		setSelectedBlueprint,
		setPhpVersion,
		setWpVersion,
		setFileForImport,
		sites,
		selectedBlueprint,
	} = addSiteProps;
	const { importState } = useImportExport();

	const [ blueprintPreferredVersions, setBlueprintPreferredVersions ] = useState<
		{ php?: string; wp?: string } | undefined
	>();
	const [ blueprintDeeplinkWarnings, setBlueprintDeeplinkWarnings ] = useState<
		BlueprintValidationWarning[] | undefined
	>();
	const [ isDeeplinkFlow, setIsDeeplinkFlow ] = useState( false );
	const [ pendingDeeplinkModal, setPendingDeeplinkModal ] = useState( false );

	const isAnySiteProcessing = sites.some(
		( site ) => site.isAddingSite || importState[ site.id ]?.isNewSite
	);

	const clearDeeplinkState = useCallback( () => {
		setIsDeeplinkFlow( false );
		setSelectedBlueprint( undefined );
		setBlueprintPreferredVersions( undefined );
		setBlueprintDeeplinkWarnings( undefined );
		setPendingDeeplinkModal( false );
		setFileForImport( null );
	}, [ setSelectedBlueprint, setFileForImport ] );

	useBlueprintDeeplink( {
		isAnySiteProcessing,
		openModal: () => setPendingDeeplinkModal( true ),
		setSelectedBlueprint,
		setPhpVersion,
		setWpVersion,
		setBlueprintPreferredVersions,
		setBlueprintDeeplinkWarnings,
		navigateToBlueprintDeeplink: () => setIsDeeplinkFlow( true ),
	} );

	return (
		<AddSiteContext.Provider
			value={ {
				blueprintPreferredVersions,
				setBlueprintPreferredVersions,
				blueprintDeeplinkWarnings,
				setBlueprintDeeplinkWarnings,
				isDeeplinkFlow,
				setIsDeeplinkFlow,
				selectedBlueprint,
				pendingDeeplinkModal,
				clearDeeplinkState,
				addSiteProps,
				isAnySiteProcessing,
			} }
		>
			{ children }
		</AddSiteContext.Provider>
	);
}

export function useAddSiteContext() {
	const context = useContext( AddSiteContext );

	if ( ! context ) {
		throw new Error( 'useAddSiteContext must be used within an AddSiteProvider' );
	}

	return context;
}
