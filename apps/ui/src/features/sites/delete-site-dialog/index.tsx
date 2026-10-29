import { __, _n, sprintf } from '@wordpress/i18n';
import { XIcon } from 'lucide-react';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useSiteThumbnail } from '@/data/queries/use-site-thumbnail';
import { useDeleteSite } from '@/data/queries/use-sites';
import { SiteCard } from '@/features/site-card';
import { getSiteUrl } from '@/features/sites/get-site-url';
import {
	Button,
	Checkbox,
	AlertDialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Field,
	FieldLabel,
	IconButton,
} from '@/lib/ui';
import styles from './style.module.css';
import type { SiteDetails } from '@/data/core';
import type { ReactNode } from 'react';

interface DeleteSiteDialogProps {
	sites: SiteDetails[];
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
	onDeleted?: ( siteIds: string[] ) => void;
}

function LocalSiteCard( { site, actions }: { site: SiteDetails; actions?: ReactNode } ) {
	const thumbnail = useSiteThumbnail( site.id );
	return (
		<SiteCard
			title={ site.name }
			description={ getSiteUrl( site )
				.replace( /^https?:\/\//, '' )
				.replace( /\/$/, '' ) }
			thumbnailUrl={ thumbnail.data }
			actions={ actions }
		/>
	);
}

export function DeleteSiteDialog( {
	sites,
	open,
	onOpenChange,
	onDeleted,
}: DeleteSiteDialogProps ) {
	const deleteSite = useDeleteSite();
	const [ deleteFiles, setDeleteFiles ] = useState( false );
	const [ pending, setPending ] = useState( false );
	const [ error, setError ] = useState< string >();
	const cancelRef = useRef< HTMLButtonElement >( null );
	const deleteFilesId = useId();
	const [ excludedIds, setExcludedIds ] = useState< string[] >( [] );
	const listRef = useRef< HTMLUListElement >( null );
	const focusIndex = useRef< number | null >( null );
	const includedSites = sites.filter( ( site ) => ! excludedIds.includes( site.id ) );
	const count = includedSites.length;

	useLayoutEffect( () => {
		if ( focusIndex.current === null ) {
			return;
		}
		const buttons = listRef.current?.querySelectorAll< HTMLButtonElement >( 'button' );
		const next = buttons?.[ Math.min( focusIndex.current, buttons.length - 1 ) ];
		( next ?? cancelRef.current )?.focus();
		focusIndex.current = null;
	}, [ excludedIds ] );

	// One at a time, so a failure leaves the rest deleted and is reported.
	const handleConfirm = async () => {
		setPending( true );
		setError( undefined );
		const errors: string[] = [];
		const deletedIds: string[] = [];
		for ( const site of includedSites ) {
			try {
				await deleteSite.mutateAsync( { id: site.id, deleteFiles } );
				deletedIds.push( site.id );
			} catch ( err ) {
				errors.push( ( err as Error )?.message );
			}
		}
		setPending( false );
		if ( errors.length < count ) {
			onDeleted?.( deletedIds );
		}
		if ( ! errors.length ) {
			onOpenChange( false );
			return;
		}
		const reason = errors.find( Boolean ) ?? __( 'Unable to delete the site. Please try again.' );
		setError(
			count === 1
				? reason
				: sprintf(
						/* translators: 1: sites deleted, 2: sites selected, 3: sites that failed, 4: the first error. */
						__( '%1$d of %2$d sites deleted. %3$d failed: %4$s' ),
						count - errors.length,
						count,
						errors.length,
						reason
				  )
		);
	};

	return (
		<AlertDialog
			open={ open }
			onOpenChange={ ( next ) => ! pending && onOpenChange( next ) }
			onOpenChangeComplete={ ( next ) => {
				if ( ! next ) {
					setDeleteFiles( false );
					setExcludedIds( [] );
					setError( undefined );
				}
			} }
		>
			<DialogContent
				layout="confirmation"
				closeButtonDisabled={ pending }
				initialFocus={ cancelRef }
			>
				<DialogHeader>
					<DialogTitle>
						{ count === 1
							? /* translators: %s: site name. */
							  sprintf( __( 'Remove “%s” from WordPress Studio?' ), includedSites[ 0 ].name )
							: sprintf(
									/* translators: %d: number of sites. */
									_n(
										'Remove %d site from WordPress Studio?',
										'Remove %d sites from WordPress Studio?',
										count
									),
									count
							  ) }
					</DialogTitle>
					<DialogDescription tone="default">
						{ count === 1
							? __(
									'Are you sure you want to remove this site and delete its chats and any shared preview sites?'
							  )
							: __(
									'Are you sure you want to remove these sites and delete their chats and any shared preview sites?'
							  ) }
					</DialogDescription>
				</DialogHeader>
				<ul ref={ listRef } className={ styles.sites }>
					{ includedSites.map( ( site, index ) => (
						<li key={ site.id }>
							<LocalSiteCard
								site={ site }
								actions={
									count > 1 ? (
										<IconButton
											icon={ <XIcon /> }
											label={ __( 'Exclude' ) }
											/* translators: %s: site name. */
											aria-label={ sprintf( __( 'Exclude “%s” from removal' ), site.name ) }
											size="icon-sm"
											disabled={ pending }
											onClick={ () => {
												focusIndex.current = index;
												setExcludedIds( ( ids ) => [ ...ids, site.id ] );
											} }
										/>
									) : undefined
								}
							/>
						</li>
					) ) }
				</ul>
				<Field orientation="horizontal">
					<Checkbox
						id={ deleteFilesId }
						checked={ deleteFiles }
						onCheckedChange={ setDeleteFiles }
						disabled={ pending }
					/>
					<FieldLabel htmlFor={ deleteFilesId } tone="muted">
						{ __( 'Also move files and database to Trash' ) }
					</FieldLabel>
				</Field>
				{ error ? (
					<p role="alert" className={ styles.error }>
						{ error }
					</p>
				) : null }
				<DialogFooter>
					<Button
						ref={ cancelRef }
						variant="outline"
						disabled={ pending }
						onClick={ () => onOpenChange( false ) }
					>
						{ __( 'Cancel' ) }
					</Button>
					<Button variant="destructive" loading={ pending } onClick={ () => void handleConfirm() }>
						{ _n( 'Remove site', 'Remove sites', count ) }
					</Button>
				</DialogFooter>
			</DialogContent>
		</AlertDialog>
	);
}
