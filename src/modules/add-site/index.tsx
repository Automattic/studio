import { Navigator, useNavigator } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useState } from 'react';
import Button from 'src/components/button';
import { FullscreenModal } from 'src/components/fullscreen-modal';
import { useAddSite } from 'src/hooks/use-add-site';
import { useFeatureFlags } from 'src/hooks/use-feature-flags';
import { useImportExport } from 'src/hooks/use-import-export';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { useGetBlueprints } from 'src/stores/wpcom-api';
import AddSiteBlueprintSelector from './components/add-site-blueprints';
import AddSiteLegacy from './components/add-site-legacy';
import AddSiteOptions from './components/add-site-options';

interface AddSiteProps {
	className?: string;
}

type BlueprintsData = ReturnType< typeof useGetBlueprints >[ 'data' ];

interface NavigationContentProps {
	blueprintsData: BlueprintsData;
	isLoadingBlueprints: boolean;
}

function NavigationContent( { blueprintsData, isLoadingBlueprints }: NavigationContentProps ) {
	const { goTo } = useNavigator();

	const handleOptionSelect = useCallback(
		( option: 'create' | 'blueprint' | 'backup' ) => {
			if ( option === 'blueprint' ) {
				goTo( '/blueprint' );
			}
			// TODO: Handle other options
		},
		[ goTo ]
	);

	const handleBlueprintSelect = useCallback( ( blueprintId: string ) => {
		// TODO: Implement blueprint selection logic
		console.log( 'Selected blueprint:', blueprintId );
	}, [] );

	return (
		<>
			<Navigator.Screen path="/">
				<AddSiteOptions onOptionSelect={ handleOptionSelect } />
			</Navigator.Screen>
			<Navigator.Screen path="/blueprint">
				<AddSiteBlueprintSelector
					onSelectBlueprint={ handleBlueprintSelect }
					blueprints={ blueprintsData?.blueprints || [] }
					isLoading={ isLoadingBlueprints }
				/>
			</Navigator.Screen>
		</>
	);
}

export default function AddSite( { className }: AddSiteProps ) {
	const { __ } = useI18n();
	const { enableBlueprints } = useFeatureFlags();
	const [ showModal, setShowModal ] = useState( false );
	const { data: blueprintsData, isLoading: isLoadingBlueprints, refetch } = useGetBlueprints();

	const { importState } = useImportExport();
	const { sites } = useAddSite();

	const isAnySiteProcessing = sites.some(
		( site ) => site.isAddingSite || importState[ site.id ]?.isNewSite
	);

	const openModal = useCallback( () => {
		void refetch();
		setShowModal( true );
	}, [ refetch ] );

	const closeModal = useCallback( () => {
		setShowModal( false );
	}, [] );

	useIpcListener( 'add-site', () => {
		if ( isAnySiteProcessing ) {
			return;
		}
		openModal();
	} );

	if ( ! enableBlueprints ) {
		return (
			<AddSiteLegacy
				className={ className }
				showModal={ showModal }
				setShowModal={ setShowModal }
			/>
		);
	}

	return (
		<>
			<FullscreenModal isOpen={ showModal } onClose={ closeModal }>
				<Navigator className="w-full" initialPath="/">
					<NavigationContent
						blueprintsData={ blueprintsData }
						isLoadingBlueprints={ isLoadingBlueprints }
					/>
				</Navigator>
			</FullscreenModal>
			<Button
				variant="outlined"
				className={ className }
				onClick={ openModal }
				disabled={ isAnySiteProcessing }
			>
				{ __( 'Add site' ) }
			</Button>
		</>
	);
}
