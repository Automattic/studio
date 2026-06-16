import { ACCEPTED_IMPORT_FILE_TYPES } from '@studio/common/constants';
import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { useCallback, useRef, useState } from 'react';
import { useConnector } from '@/data/core';
import { isValidBackupFile } from '@/lib/backup-files';
import { setPendingBackup } from '@/lib/pending-backup';
import { onboardingLayoutRoute } from '../layout-onboarding';
import styles from '../layout-onboarding/style.module.css';

function OnboardingHomePage() {
	const navigate = useNavigate();
	const connector = useConnector();
	const fileRef = useRef< HTMLInputElement >( null );
	const [ isDragging, setIsDragging ] = useState( false );
	const [ error, setError ] = useState< string | null >( null );

	const handleBackupFile = useCallback(
		async ( file: File | undefined ) => {
			if ( ! file ) {
				return;
			}
			if ( ! isValidBackupFile( file ) ) {
				setError( __( 'Unsupported file type.' ) );
				return;
			}
			const path = await connector.getFilePath( file );
			if ( ! path ) {
				setError( __( 'Unable to read the file. Try clicking the card to browse instead.' ) );
				return;
			}
			setError( null );
			setPendingBackup( { file, path } );
			await navigate( { to: '/onboarding/import' } );
		},
		[ connector, navigate ]
	);

	return (
		<div className={ styles.page }>
			<h1 className={ styles.title }>{ __( 'Start a new site' ) }</h1>
			<p className={ styles.subtitle }>
				{ __( 'WordPress can power anything. What are you building?' ) }
			</p>
			<div className={ styles.cards }>
				<Link to="/onboarding/blueprint" className={ styles.card }>
					<h3 className={ styles.cardTitle }>{ __( 'Build a new site' ) }</h3>
					<p className={ styles.cardBody }>
						{ __( 'Start from scratch or choose a Blueprint to provision plugins and settings.' ) }
					</p>
				</Link>
				<input
					ref={ fileRef }
					type="file"
					accept={ ACCEPTED_IMPORT_FILE_TYPES.join( ',' ) }
					className={ styles.hiddenInput }
					onChange={ ( event ) => {
						void handleBackupFile( event.target.files?.[ 0 ] );
						event.target.value = '';
					} }
				/>
				<button
					type="button"
					className={ isDragging ? `${ styles.card } ${ styles.cardDragging }` : styles.card }
					onClick={ () => fileRef.current?.click() }
					onDragOver={ ( event ) => {
						event.preventDefault();
						setIsDragging( true );
						setError( null );
					} }
					onDragLeave={ ( event ) => {
						event.preventDefault();
						setIsDragging( false );
					} }
					onDrop={ ( event ) => {
						event.preventDefault();
						setIsDragging( false );
						void handleBackupFile( event.dataTransfer.files[ 0 ] );
					} }
				>
					<h3 className={ styles.cardTitle }>{ __( 'Import from a backup' ) }</h3>
					<p className={ styles.cardBody }>
						{ __( 'Drop a file or click to browse (.zip, .tar.gz, .sql, .wpress)' ) }
					</p>
					{ error && (
						<span role="alert" className={ styles.cardError }>
							{ error }
						</span>
					) }
				</button>
				<Link to="/onboarding/connect" className={ styles.card }>
					<h3 className={ styles.cardTitle }>{ __( 'Connect a site' ) }</h3>
					<p className={ styles.cardBody }>
						{ __( 'Edit a WordPress.com or Pressable site locally, then push changes back' ) }
					</p>
				</Link>
			</div>
		</div>
	);
}

export const onboardingHomeRoute = createRoute( {
	getParentRoute: () => onboardingLayoutRoute,
	path: '/onboarding',
	component: OnboardingHomePage,
} );
