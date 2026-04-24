import { MINIMUM_WORDPRESS_VERSION } from '@studio/common/constants';
import {
	BlueprintPreferredVersions,
	BlueprintValidationWarning,
} from '@studio/common/lib/blueprint-validation';
import { SupportedPHPVersion, SupportedPHPVersionsList } from '@studio/common/types/php-versions';
import { SyncSite } from '@studio/common/types/sync';
import { Navigator, useNavigator } from '@wordpress/components';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CreateSiteFormValues } from 'src/hooks/use-add-site';
import { useGetWordPressVersions } from 'src/stores/wordpress-versions-api';
import { Blueprint } from 'src/stores/wpcom-api';
import BlueprintDetails from './components/blueprint-details';
import { AddSiteBlueprintSelector } from './components/blueprints';
import CreateSite from './components/create-site';
import ImportBackup from './components/import-backup';
import AddSiteOptionsClassic, { type ClassicAddSiteFlowType } from './components/options-classic';
import { PullRemoteSite } from './components/pull-remote-site-classic';
import StepperClassic from './components/stepper-classic';
import { useFindAvailableSiteName } from './hooks/use-find-available-site-name';
import { applyBlueprintFormValues } from './lib/apply-blueprint-form-values';

type BlueprintsData = ReturnType<
	typeof import('src/stores/wpcom-api').useGetBlueprints
>[ 'data' ];

export interface NavigationContentClassicProps {
	startOver: () => void;
	blueprintsData: BlueprintsData;
	isLoadingBlueprints: boolean;
	blueprintsErrorMessage?: string;
	defaultValues: {
		siteName: string;
		sitePath: string;
		phpVersion: SupportedPHPVersion;
		wpVersion: string;
	};
	onSelectPath: ( currentPath: string ) => Promise< {
		path: string;
		name?: string;
		isEmpty: boolean;
		isWordPress: boolean;
		error?: string;
	} | null >;
	onSiteNameChange: ( name: string ) => Promise< {
		path: string;
		isEmpty: boolean;
		isWordPress: boolean;
		error?: string;
	} >;
	existingDomainNames: string[];
	onFormSubmit: ( values: CreateSiteFormValues ) => void;
	onValidityChange: ( isValid: boolean ) => void;
	canSubmit: boolean;
	fileForImport: File | null;
	setFileForImport: ( file: File | null ) => void;
	setSelectedBlueprint: ( blueprint?: Blueprint ) => void;
	selectedBlueprint?: Blueprint;
	blueprintPreferredVersions?: BlueprintPreferredVersions;
	setBlueprintPreferredVersions: ( versions: BlueprintPreferredVersions | undefined ) => void;
	blueprintSuggestedDomain?: string;
	setBlueprintSuggestedDomain: ( domain: string | undefined ) => void;
	blueprintSuggestedHttps?: boolean;
	setBlueprintSuggestedHttps: ( https: boolean | undefined ) => void;
	blueprintCredentials?: { adminUsername?: string; adminPassword?: string };
	blueprintSuggestedSiteName?: string;
	setBlueprintSuggestedSiteName: ( name: string | undefined ) => void;
	blueprintRequiresCustomDomain: boolean;
	setBlueprintRequiresCustomDomain: ( requires: boolean ) => void;
	selectedRemoteSite?: SyncSite;
	setSelectedRemoteSite: ( site?: SyncSite ) => void;
	isDeeplinkFlow: boolean;
	setIsDeeplinkFlow: ( isDeeplink: boolean ) => void;
}

export default function NavigationContentClassic( props: NavigationContentClassicProps ) {
	const { goTo, location } = useNavigator();
	const {
		startOver,
		blueprintsData,
		isLoadingBlueprints,
		blueprintsErrorMessage,
		defaultValues,
		onSelectPath,
		onSiteNameChange,
		existingDomainNames,
		onFormSubmit,
		onValidityChange,
		canSubmit,
		fileForImport,
		setFileForImport,
		selectedBlueprint,
		setSelectedBlueprint,
		blueprintPreferredVersions,
		setBlueprintPreferredVersions,
		blueprintSuggestedDomain,
		setBlueprintSuggestedDomain,
		blueprintSuggestedHttps,
		setBlueprintSuggestedHttps,
		blueprintCredentials,
		blueprintSuggestedSiteName,
		setBlueprintSuggestedSiteName,
		blueprintRequiresCustomDomain,
		setBlueprintRequiresCustomDomain,
		selectedRemoteSite,
		setSelectedRemoteSite,
		isDeeplinkFlow,
		setIsDeeplinkFlow,
	} = props;

	useEffect( () => {
		if ( isDeeplinkFlow && selectedBlueprint ) {
			goTo( '/blueprint/deeplink' );
			setIsDeeplinkFlow( false );
		}
	}, [ isDeeplinkFlow, goTo, setIsDeeplinkFlow, selectedBlueprint ] );

	const handleOptionSelect = useCallback(
		( option: ClassicAddSiteFlowType ) => {
			if ( option === 'blueprint' ) {
				goTo( '/blueprint/select' );
			} else if ( option === 'create' ) {
				goTo( '/create' );
			} else if ( option === 'backup' ) {
				goTo( '/backup' );
			} else if ( option === 'pullRemote' ) {
				goTo( '/pullRemote' );
			}
		},
		[ goTo ]
	);

	const handleBlueprintContinue = useCallback( () => {
		if ( selectedBlueprint ) {
			goTo( '/blueprint/select/details' );
		}
	}, [ selectedBlueprint, goTo ] );

	const handleBlueprintDetailsContinue = useCallback( () => {
		if ( selectedBlueprint ) {
			goTo( '/blueprint/select/create' );
		}
	}, [ selectedBlueprint, goTo ] );

	const handleBackupFileSelect = useCallback(
		( file?: File ) => {
			setFileForImport( file || null );
		},
		[ setFileForImport ]
	);

	const handleBackupContinue = useCallback( () => {
		if ( fileForImport ) {
			goTo( '/backup/create' );
		}
	}, [ fileForImport, goTo ] );

	const findAvailableSiteName = useFindAvailableSiteName();
	const [ remoteSiteName, setRemoteSiteName ] = useState( '' );

	const handlePullRemoteContinue = useCallback( async () => {
		if ( selectedRemoteSite ) {
			const availableName = await findAvailableSiteName( selectedRemoteSite.name );
			setRemoteSiteName( availableName );
			goTo( '/pullRemote/create' );
		}
	}, [ findAvailableSiteName, goTo, selectedRemoteSite ] );

	const blueprints = useMemo(
		() => blueprintsData?.blueprints.slice().reverse() || [],
		[ blueprintsData ]
	);

	const handleBlueprintDeeplinkContinue = useCallback( () => {
		goTo( '/blueprint/deeplink/create' );
	}, [ goTo ] );

	const handleBack = useCallback( () => {
		const goToFirstStep = () => {
			startOver();
			goTo( '/' );
		};
		if ( location.path === '/blueprint/select/create' ) {
			goTo( '/blueprint/select/details' );
		} else if ( location.path === '/blueprint/select/details' ) {
			goTo( '/blueprint/select' );
		} else if ( location.path === '/blueprint/deeplink/create' ) {
			goTo( '/blueprint/deeplink' );
		} else if ( location.path === '/backup/create' ) {
			goTo( '/backup' );
		} else if ( location.path === '/pullRemote/create' ) {
			setRemoteSiteName( '' );
			goTo( '/pullRemote' );
		} else if (
			location.path === '/backup' ||
			location.path === '/blueprint/select' ||
			location.path === '/blueprint/deeplink' ||
			location.path === '/create' ||
			location.path === '/pullRemote'
		) {
			if ( location.path === '/backup' ) {
				setFileForImport( null );
			}
			if ( location.path === '/blueprint/select' || location.path === '/blueprint/deeplink' ) {
				setSelectedBlueprint();
				setBlueprintPreferredVersions?.( undefined );
				setBlueprintSuggestedSiteName?.( undefined );
			}
			if ( location.path === '/pullRemote' ) {
				setSelectedRemoteSite( undefined );
				setRemoteSiteName( '' );
			}
			goToFirstStep();
		} else {
			goToFirstStep();
		}
	}, [
		location.path,
		goTo,
		startOver,
		setFileForImport,
		setSelectedBlueprint,
		setBlueprintPreferredVersions,
		setSelectedRemoteSite,
		setBlueprintSuggestedSiteName,
	] );

	const handleBlueprintFormValues = useCallback(
		( blueprint?: Blueprint ) => {
			setSelectedBlueprint( blueprint );

			if ( ! blueprint?.blueprint ) {
				setBlueprintPreferredVersions?.( undefined );
				setBlueprintSuggestedDomain?.( undefined );
				setBlueprintSuggestedHttps?.( undefined );
				setBlueprintSuggestedSiteName?.( undefined );
				setBlueprintRequiresCustomDomain( false );
				return;
			}

			applyBlueprintFormValues( blueprint.blueprint, {
				setBlueprintPreferredVersions,
				setBlueprintSuggestedDomain,
				setBlueprintSuggestedHttps,
				setBlueprintSuggestedSiteName,
				setBlueprintRequiresCustomDomain,
			} );
		},
		[
			setSelectedBlueprint,
			setBlueprintPreferredVersions,
			setBlueprintSuggestedDomain,
			setBlueprintSuggestedHttps,
			setBlueprintSuggestedSiteName,
			setBlueprintRequiresCustomDomain,
		]
	);

	const handleBlueprintChange = useCallback(
		( blueprintId: string ) => {
			const blueprint = blueprintsData?.blueprints.find(
				( b: Blueprint ) => b.slug === blueprintId
			);
			handleBlueprintFormValues( blueprint );
		},
		[ blueprintsData?.blueprints, handleBlueprintFormValues ]
	);

	const handleFileBlueprintSelect = useCallback(
		( blueprint: Blueprint, _warnings?: BlueprintValidationWarning[] ) => {
			handleBlueprintFormValues( blueprint );
			goTo( '/blueprint/select/details' );
		},
		[ handleBlueprintFormValues, goTo ]
	);

	// Build default values with blueprint preferred versions applied
	const { data: wpVersions = [] } = useGetWordPressVersions( {
		minimumVersion: MINIMUM_WORDPRESS_VERSION,
	} );
	const defaultValuesWithBlueprint = useMemo( () => {
		const values = { ...defaultValues };
		if (
			blueprintPreferredVersions?.php &&
			SupportedPHPVersionsList.includes( blueprintPreferredVersions.php )
		) {
			values.phpVersion = blueprintPreferredVersions.php;
		}
		if (
			blueprintPreferredVersions?.wp &&
			wpVersions.some( ( v ) => v.value === blueprintPreferredVersions.wp )
		) {
			values.wpVersion = blueprintPreferredVersions.wp;
		}
		if ( blueprintSuggestedSiteName ) {
			values.siteName = blueprintSuggestedSiteName;
		}
		return values;
	}, [ defaultValues, blueprintPreferredVersions, blueprintSuggestedSiteName, wpVersions ] );

	const formRef = useRef< HTMLFormElement >( null );

	const createSiteProps = {
		onSelectPath,
		onSiteNameChange,
		existingDomainNames,
		onSubmit: onFormSubmit,
		onValidityChange,
		formRef,
		blueprintCredentials: blueprintCredentials ?? undefined,
	};

	return (
		<>
			<Navigator.Screen className="flex-1" path="/">
				<AddSiteOptionsClassic onOptionSelect={ handleOptionSelect } />
			</Navigator.Screen>
			<Navigator.Screen className="flex-1" path="/blueprint/select">
				<AddSiteBlueprintSelector
					blueprints={ blueprints }
					errorMessage={ blueprintsErrorMessage }
					isLoading={ isLoadingBlueprints }
					selectedBlueprint={ selectedBlueprint?.slug || null }
					onBlueprintChange={ handleBlueprintChange }
					onFileBlueprintSelect={ handleFileBlueprintSelect }
				/>
			</Navigator.Screen>
			<Navigator.Screen className="flex-1" path="/blueprint/select/details">
				<BlueprintDetails
					selectedBlueprint={ selectedBlueprint }
					source={ selectedBlueprint?.slug?.startsWith( 'file:' ) ? 'file' : 'featured' }
				/>
			</Navigator.Screen>
			<Navigator.Screen className="flex-1" path="/blueprint/select/create">
				<CreateSite
					{ ...createSiteProps }
					defaultValues={ defaultValuesWithBlueprint }
					blueprintPreferredVersions={ blueprintPreferredVersions }
					blueprintSuggestedDomain={ blueprintSuggestedDomain }
					blueprintSuggestedHttps={ blueprintSuggestedHttps }
					blueprintRequiresCustomDomain={ blueprintRequiresCustomDomain }
				/>
			</Navigator.Screen>
			<Navigator.Screen className="flex-1" path="/create">
				<CreateSite { ...createSiteProps } defaultValues={ defaultValues } />
			</Navigator.Screen>
			<Navigator.Screen className="flex-1" path="/blueprint/deeplink">
				<BlueprintDetails selectedBlueprint={ selectedBlueprint } source="deeplink" />
			</Navigator.Screen>
			<Navigator.Screen className="flex-1" path="/blueprint/deeplink/create">
				<CreateSite
					{ ...createSiteProps }
					defaultValues={ defaultValuesWithBlueprint }
					blueprintPreferredVersions={ blueprintPreferredVersions }
					blueprintSuggestedDomain={ blueprintSuggestedDomain }
					blueprintSuggestedHttps={ blueprintSuggestedHttps }
					blueprintRequiresCustomDomain={ blueprintRequiresCustomDomain }
				/>
			</Navigator.Screen>
			<Navigator.Screen className="flex-1" path="/backup">
				<ImportBackup onFileSelect={ handleBackupFileSelect } selectedFile={ fileForImport } />
			</Navigator.Screen>
			<Navigator.Screen className="flex-1" path="/backup/create">
				<CreateSite { ...createSiteProps } defaultValues={ defaultValues } />
			</Navigator.Screen>
			<Navigator.Screen className="flex-1 flex justify-center" path="/pullRemote">
				<PullRemoteSite
					selectedRemoteSite={ selectedRemoteSite }
					setSelectedRemoteSite={ setSelectedRemoteSite }
				/>
			</Navigator.Screen>
			<Navigator.Screen className="flex-1" path="/pullRemote/create">
				<CreateSite
					{ ...createSiteProps }
					defaultValues={ { ...defaultValues, siteName: remoteSiteName } }
				/>
			</Navigator.Screen>
			<StepperClassic
				currentPath={ location.path }
				onBack={ handleBack }
				onBlueprintContinue={ handleBlueprintContinue }
				onBlueprintDetailsContinue={ handleBlueprintDetailsContinue }
				onBlueprintDeeplinkContinue={ handleBlueprintDeeplinkContinue }
				onBackupContinue={ handleBackupContinue }
				onPullRemoteContinue={ handlePullRemoteContinue }
				onCreateSubmit={ () => {
					formRef.current?.requestSubmit();
				} }
				canSubmitBlueprint={ !! selectedBlueprint }
				canSubmitBlueprintDetails={ !! selectedBlueprint }
				canSubmitBlueprintDeeplink={ !! selectedBlueprint }
				canSubmitBackup={ !! fileForImport }
				canSubmitPullRemote={ !! selectedRemoteSite }
				canSubmitCreate={ canSubmit }
			/>
		</>
	);
}
