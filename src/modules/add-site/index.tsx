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
import AddSiteLegacy from './components/add-site-legacy';
import AddSiteBlueprintSelector from './components/blueprints';
import AddSiteOptions from './components/options';
import StepperWrapper from './components/stepper';

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
			<Navigator.Screen className="flex-1" path="/">
				<AddSiteOptions onOptionSelect={ handleOptionSelect } />
			</Navigator.Screen>
			<Navigator.Screen className="flex-1" path="/blueprint">
				<AddSiteBlueprintSelector
					onSelectBlueprint={ handleBlueprintSelect }
					blueprints={ blueprintsData?.blueprints || [] }
					isLoading={ isLoadingBlueprints }
				/>
			</Navigator.Screen>
			<StepperWrapper />
		</>
	);
}

export default function AddSite( { className }: AddSiteProps ) {
	const { __ } = useI18n();
	const { enableBlueprints } = useFeatureFlags();
	const [ showModal, setShowModal ] = useState( false );
	const {
		data: blueprintsData,
		isLoading: isLoadingBlueprints,
		refetch,
		isUninitialized,
	} = useGetBlueprints();

	const { importState } = useImportExport();
	const { sites } = useAddSite();

	const isAnySiteProcessing = sites.some(
		( site ) => site.isAddingSite || importState[ site.id ]?.isNewSite
	);

	const openModal = useCallback( () => {
		if ( ! isUninitialized ) {
			void refetch();
		}
		setShowModal( true );
	}, [ refetch, isUninitialized ] );

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
				<Navigator className="w-full h-full" initialPath="/">
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
