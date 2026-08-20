import { ACCEPTED_ADD_SITE_FILE_TYPES } from '@studio/common/constants';
import { isSupportedBackupFilename } from '@studio/common/lib/backup-files';
import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { chevronLeft } from '@wordpress/icons';
import { Button, Icon } from '@wordpress/ui';
import { useCallback, useRef, useState } from 'react';
import { OnboardingFooter } from '@/components/onboarding-footer';
import {
	BuildNewSiteIllustration,
	ConnectSiteIllustration,
	DropBackupIllustration,
	illustrationHostClass,
} from '@/components/onboarding-illustrations';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { useSites } from '@/data/queries/use-sites';
import { useOffline } from '@/hooks/use-offline';
import { setPendingBackup } from '@/lib/pending-backup';
import { onboardingLayoutRoute } from '../layout-onboarding';
import sharedStyles from '../layout-onboarding/style.module.css';
import styles from './style.module.css';

const cardClass = `${ styles.card } ${ illustrationHostClass }`;

function ImportBackupCard() {
	const navigate = useNavigate();
	const inputRef = useRef< HTMLInputElement >( null );
	const [ isDragging, setIsDragging ] = useState( false );
	const [ error, setError ] = useState( '' );

	const handleFile = useCallback(
		( file?: File ) => {
			if ( ! file ) return;
			// A .sql dump is a database without the files that go with it, so it can
			// only be imported over an existing site — not used to create one.
			if ( ! isSupportedBackupFilename( file.name, ACCEPTED_ADD_SITE_FILE_TYPES ) ) {
				setError(
					__(
						'This file type is not supported. Please use a .zip, .gz, .gzip, .tar, .tar.gz, .wpress, or .xml file.'
					)
				);
				return;
			}

			setError( '' );
			setPendingBackup( file );
			void navigate( { to: '/onboarding/import' } );
		},
		[ navigate ]
	);

	return (
		<>
			<input
				ref={ inputRef }
				type="file"
				accept={ ACCEPTED_ADD_SITE_FILE_TYPES.join( ',' ) }
				className={ styles.hiddenInput }
				onChange={ ( event ) => {
					handleFile( event.target.files?.[ 0 ] );
					event.target.value = '';
				} }
			/>
			<button
				type="button"
				className={ isDragging ? `${ cardClass } ${ styles.cardDragging }` : cardClass }
				onClick={ () => inputRef.current?.click() }
				onDragOver={ ( event ) => {
					event.preventDefault();
					setIsDragging( true );
					setError( '' );
				} }
				onDragLeave={ ( event ) => {
					event.preventDefault();
					if ( event.currentTarget.contains( event.relatedTarget as Node | null ) ) return;
					setIsDragging( false );
				} }
				onDrop={ ( event ) => {
					event.preventDefault();
					setIsDragging( false );
					handleFile( event.dataTransfer.files[ 0 ] );
				} }
			>
				<DropBackupIllustration />
				<div className={ styles.cardText }>
					<span className={ styles.cardTitle }>{ __( 'Import from a backup' ) }</span>
					<p className={ styles.cardBody }>{ __( 'Drop a file or click to browse.' ) }</p>
					{ error && (
						<span role="alert" className={ styles.cardError }>
							{ error }
						</span>
					) }
				</div>
			</button>
		</>
	);
}

export function OnboardingHomePage() {
	const navigate = useNavigate();
	const { data: sites } = useSites();
	const isOffline = useOffline();
	const { chatEnabled } = useAgenticFeatures();

	return (
		<div className={ styles.page }>
			<h1 className={ sharedStyles.title }>{ __( 'Add a site' ) }</h1>
			<p className={ sharedStyles.subtitle }>
				{ __( 'Start fresh or bring an existing site into your Studio.' ) }
			</p>
			<div className={ styles.cards }>
				<Link to="/onboarding/create" className={ cardClass }>
					<BuildNewSiteIllustration />
					<div className={ styles.cardText }>
						<h3 className={ styles.cardTitle }>{ __( 'Create a site' ) }</h3>
						<p className={ styles.cardBody }>
							{ chatEnabled
								? __( 'Describe it with AI, start from a Blueprint, or build it from scratch.' )
								: __(
										'Start from scratch or use a Blueprint. Perfect for theme and plugin development.'
								  ) }
						</p>
					</div>
				</Link>
				<Link
					to="/onboarding/connect"
					className={ `${ cardClass } ${ isOffline ? styles.cardDisabled : '' }` }
					aria-disabled={ isOffline || undefined }
					onClick={ ( event ) => isOffline && event.preventDefault() }
				>
					<ConnectSiteIllustration />
					<div className={ styles.cardText }>
						<h3 className={ styles.cardTitle }>{ __( 'Connect a site' ) }</h3>
						<p className={ styles.cardBody }>
							{ __( 'Pull a WordPress.com or Pressable site into a new local Studio site.' ) }
						</p>
						{ isOffline && <span className={ styles.cardHint }>{ __( 'Available online' ) }</span> }
					</div>
				</Link>
				<ImportBackupCard />
			</div>
			{ ( sites?.length ?? 0 ) > 0 && (
				<OnboardingFooter>
					<Button
						type="button"
						variant="minimal"
						tone="neutral"
						onClick={ () => void navigate( { to: '/' } ) }
					>
						<Icon icon={ chevronLeft } size={ 16 } />
						<span>{ __( 'Back' ) }</span>
					</Button>
				</OnboardingFooter>
			) }
		</div>
	);
}

export const onboardingHomeRoute = createRoute( {
	getParentRoute: () => onboardingLayoutRoute,
	path: '/onboarding',
	component: OnboardingHomePage,
} );
