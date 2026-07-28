import { ACCEPTED_IMPORT_FILE_TYPES } from '@studio/common/constants';
import { isSupportedBackupFilename } from '@studio/common/lib/backup-files';
import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { chevronLeft, Icon } from '@wordpress/icons';
import { Button } from '@wordpress/ui';
import { useCallback, useRef, useState } from 'react';
import { OnboardingFooter } from '@/components/onboarding-footer';
import {
	BuildNewSiteIllustration,
	ConnectSiteIllustration,
	DropBackupIllustration,
	illustrationHostClass,
} from '@/components/onboarding-illustrations';
import { useSites } from '@/data/queries/use-sites';
import { useGridArrowNavigation } from '@/hooks/use-grid-arrow-navigation';
import { useOffline } from '@/hooks/use-offline';
import { setPendingBackup } from '@/lib/pending-backup';
import { onboardingLayoutRoute } from '../layout-onboarding';
import sharedStyles from '../layout-onboarding/style.module.css';
import styles from './style.module.css';

const cardClass = `${ styles.card } ${ illustrationHostClass }`;

// Connecting requires WordPress.com, so the card is disabled offline —
// matching the desktop renderer's options screen.
function ConnectSiteCard() {
	const isOffline = useOffline();
	return (
		<Link
			to="/onboarding/connect"
			className={ isOffline ? `${ cardClass } ${ styles.cardDisabled }` : cardClass }
			aria-disabled={ isOffline || undefined }
			data-arrow-nav-item
			onClick={ ( event ) => {
				if ( isOffline ) {
					event.preventDefault();
				}
			} }
		>
			<ConnectSiteIllustration />
			<div className={ styles.cardText }>
				<h3 className={ styles.cardTitle }>{ __( 'Connect a site' ) }</h3>
				<p className={ styles.cardBody }>
					{ __( 'Edit a WordPress.com or Pressable site locally, then push or pull changes.' ) }
				</p>
				{ isOffline && <span className={ styles.cardHint }>{ __( 'Available online' ) }</span> }
			</div>
		</Link>
	);
}

/**
 * The import card doubles as a drop target, mirroring the desktop renderer's
 * options screen: dropping (or browsing to) a valid backup archive skips the
 * import route's select step and lands straight on configure, with the file
 * handed over through the pending-backup slot.
 */
function ImportDropCard() {
	const navigate = useNavigate();
	const fileRef = useRef< HTMLInputElement >( null );
	const [ isDragging, setIsDragging ] = useState( false );
	const [ error, setError ] = useState< string | null >( null );

	const handleFile = useCallback(
		( file: File | undefined ) => {
			if ( ! file ) {
				return;
			}
			if ( ! isSupportedBackupFilename( file.name ) ) {
				setError(
					__(
						'This file type is not supported. Please use a .zip, .gz, .gzip, .tar, .tar.gz, .wpress, .sql, or .xml file.'
					)
				);
				return;
			}
			setError( null );
			setPendingBackup( file );
			void navigate( { to: '/onboarding/import' } );
		},
		[ navigate ]
	);

	return (
		<>
			<input
				ref={ fileRef }
				type="file"
				accept={ ACCEPTED_IMPORT_FILE_TYPES.join( ',' ) }
				className={ styles.hiddenInput }
				onChange={ ( event ) => {
					handleFile( event.target.files?.[ 0 ] );
					event.target.value = '';
				} }
			/>
			<button
				type="button"
				className={ isDragging ? `${ cardClass } ${ styles.cardDragging }` : cardClass }
				onClick={ () => fileRef.current?.click() }
				data-arrow-nav-item
				onDragOver={ ( event ) => {
					event.preventDefault();
					setIsDragging( true );
					setError( null );
				} }
				onDragLeave={ ( event ) => {
					event.preventDefault();
					if ( event.currentTarget.contains( event.relatedTarget as Node | null ) ) {
						return;
					}
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
					<h3 className={ styles.cardTitle }>{ __( 'Import from a backup' ) }</h3>
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
	const handleGridKeyDown = useGridArrowNavigation();
	const navigate = useNavigate();
	const { data: sites } = useSites();
	// First-run users (no sites yet) arrived here from the tour — let them
	// step back to its last step. With sites, the layout's close button is
	// the way out instead.
	const hasSites = ( sites?.length ?? 0 ) > 0;
	return (
		<div className={ styles.page }>
			<h1 className={ sharedStyles.title }>{ __( 'Add a site' ) }</h1>
			<p className={ sharedStyles.subtitle }>
				{ __( 'Start fresh or bring an existing site into your Studio.' ) }
			</p>
			<div className={ styles.cards } onKeyDown={ handleGridKeyDown }>
				<Link to="/onboarding/create" className={ cardClass } data-arrow-nav-item>
					<BuildNewSiteIllustration />
					<div className={ styles.cardText }>
						<h3 className={ styles.cardTitle }>{ __( 'Create a new site' ) }</h3>
						<p className={ styles.cardBody }>
							{ __(
								'Start from scratch or use a blueprint. Perfect for theme and plugin development.'
							) }
						</p>
					</div>
				</Link>
				<ConnectSiteCard />
				<ImportDropCard />
			</div>
			{ ! hasSites && (
				<OnboardingFooter>
					<Button
						type="button"
						variant="minimal"
						tone="neutral"
						onClick={ () => void navigate( { to: '/onboarding/tour', search: { step: 'agent' } } ) }
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
