import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useState } from 'react';
import { useIpcListener } from '../hooks/use-ipc-listener';
import { useSiteDetails } from '../hooks/use-site-details';
import { cx } from '../lib/cx';
import { getIpcApi } from '../lib/get-ipc-api';
import Button from './button';
import { ModalContent, SiteModal } from './site-modal';

interface AddSiteProps {
	className?: string;
}
export default function AddSite( { className }: AddSiteProps ) {
	const { __ } = useI18n();
	const { createSite, data: sites } = useSiteDetails();
	const [ error, setError ] = useState( '' );
	const [ showModal, setShowModal ] = useState( false );
	const [ isAddingSite, setIsAddingSite ] = useState( false );
	const [ siteName, setSiteName ] = useState< string | null >( null );
	const [ sitePath, setSitePath ] = useState( '' );
	const [ proposedSitePath, setProposedSitePath ] = useState( '' );
	const [ doesPathContainWordPress, setDoesPathContainWordPress ] = useState( false );

	const defaultSiteName = __( 'My Site' );

	const openModal = useCallback( async () => {
		const { path, name, isWordPress } =
			await getIpcApi().generateProposedSitePath( defaultSiteName );
		setSiteName( name );
		setProposedSitePath( path );
		setSitePath( '' );
		setError( '' );
		setDoesPathContainWordPress( isWordPress );

		setShowModal( true );
	}, [ defaultSiteName ] );

	const closeModal = useCallback( () => {
		setShowModal( false );
	}, [] );

	const siteWithPathAlreadyExists = useCallback(
		( path: string ) => {
			return sites.some( ( site ) => site.path === path );
		},
		[ sites ]
	);

	const handlePathSelectorClick = useCallback( async () => {
		const response = await getIpcApi().showOpenFolderDialog( __( 'Choose folder for site' ) );
		if ( response?.path ) {
			const { path, name, isEmpty, isWordPress } = response;
			setDoesPathContainWordPress( false );
			setError( '' );
			setSitePath( path );
			if ( siteWithPathAlreadyExists( path ) ) {
				return;
			}
			if ( ! isEmpty && ! isWordPress ) {
				setError( __( 'This path does not contain a WordPress site.' ) );
				return;
			}
			setDoesPathContainWordPress( ! isEmpty && isWordPress );
			if ( ! siteName ) {
				setSiteName( name ?? null );
			}
		}
	}, [ __, siteWithPathAlreadyExists, siteName ] );

	const handleAddSiteClick = useCallback( async () => {
		setIsAddingSite( true );
		try {
			const path = sitePath ? sitePath : proposedSitePath;
			await createSite( path, siteName ?? '' );
			setShowModal( false );
		} catch ( e ) {
			setError( ( e as Error )?.message );
		}
		setIsAddingSite( false );
	}, [ createSite, proposedSitePath, siteName, sitePath ] );

	const handleSiteNameChange = useCallback(
		async ( name: string ) => {
			setSiteName( name );
			if ( sitePath ) {
				return;
			}
			setError( '' );
			const {
				path: proposedPath,
				isEmpty,
				isWordPress,
			} = await getIpcApi().generateProposedSitePath( name );
			setProposedSitePath( proposedPath );

			if ( siteWithPathAlreadyExists( proposedPath ) ) {
				return;
			}
			if ( ! isEmpty && ! isWordPress ) {
				setError( __( 'This path does not contain a WordPress site.' ) );
				return;
			}
			setDoesPathContainWordPress( ! isEmpty && isWordPress );
		},
		[ __, sitePath, siteWithPathAlreadyExists ]
	);

	useIpcListener( 'add-site', () => {
		openModal();
	} );

	const buttonClassName = cx(
		'!ring-1 !ring-inset ring-white text-white hover:bg-gray-100 hover:text-black',
		className
	);

	const displayedPath = sitePath ? sitePath : proposedSitePath;

	const displayedError = siteWithPathAlreadyExists( displayedPath )
		? __( 'Another site already exists at this path.' )
		: error;

	return (
		<>
			<SiteModal
				isOpen={ showModal }
				onRequestClose={ closeModal }
				title={ __( 'Add a Site' ) }
				primaryButtonLabel={ __( 'Add Site' ) }
				onPrimaryAction={ handleAddSiteClick }
				isPrimaryButtonDisabled={ !! displayedError || ! siteName }
				isCancelDisabled={ isAddingSite }
			>
				<ModalContent
					siteName={ siteName || '' }
					setSiteName={ handleSiteNameChange }
					sitePath={ displayedPath }
					onSelectPath={ handlePathSelectorClick }
					error={ displayedError }
					doesPathContainWordPress={ doesPathContainWordPress }
				/>
			</SiteModal>
			<Button className={ buttonClassName } onClick={ openModal }>
				{ __( 'Add site' ) }
			</Button>
		</>
	);
}
