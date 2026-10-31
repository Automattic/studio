import { getSnapshotExpiry } from '@studio/common/lib/snapshots';
import { __, sprintf } from '@wordpress/i18n';
import { EllipsisIcon, RefreshCwIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { useConnector } from '@/data/core';
import { useCopyText } from '@/data/host/use-copy-text';
import { markPreviewSeen } from '@/data/preview-ready';
import { useRenameSnapshot } from '@/data/queries/use-snapshots';
import { useUserLocale } from '@/data/queries/use-user-locale';
import { getSnapshotHostname, getSnapshotOpenUrl, getSnapshotUrl } from '@/data/snapshot-url';
import { SiteCard, getWebsiteThumbnailUrl } from '@/features/site-card';
import { DuplicateIcon, ExternalLinkIcon, RenameIcon, TrashIcon } from '@/lib/icons';
import {
	Button,
	IconButton,
	Field,
	FieldLabel,
	Input,
	Menu,
	Spinner,
	VisuallyHidden,
} from '@/lib/ui';
import styles from './style.module.css';
import type { PreviewManagementAction } from './preview-management-dialog';
import type { SiteDetails, Snapshot } from '@/data/core';

function PreviewLinkActions( {
	snapshot,
	siteId,
	locked,
	onUpdate,
}: {
	snapshot: Snapshot;
	siteId: string;
	locked: boolean;
	onUpdate: () => void;
} ) {
	const connector = useConnector();
	const url = getSnapshotUrl( snapshot );
	const { copy } = useCopyText( url );
	return (
		<>
			<Menu.Item disabled={ locked } onClick={ onUpdate }>
				<RefreshCwIcon />
				{ __( 'Update' ) }
			</Menu.Item>
			<Menu.Item
				onClick={ () => {
					copy();
					markPreviewSeen( siteId );
				} }
			>
				<DuplicateIcon />
				{ __( 'Copy link' ) }
			</Menu.Item>
			<Menu.Item onClick={ () => void connector.openExternalUrl( getSnapshotOpenUrl( snapshot ) ) }>
				<ExternalLinkIcon />
				{ __( 'Visit preview' ) }
			</Menu.Item>
		</>
	);
}

export function previewExpiry(
	snapshot: Snapshot,
	locale?: string,
	format: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }
) {
	return sprintf(
		/* translators: %s: the date a preview site expires */
		__( 'Expires %s' ),
		new Date( getSnapshotExpiry( snapshot ) ).toLocaleDateString( locale, format )
	);
}

// Renames a preview in place, the way its delete is confirmed.
export function RenamePreview( { snapshot, onDone }: { snapshot: Snapshot; onDone: () => void } ) {
	const id = useId();
	const rename = useRenameSnapshot();
	const [ name, setName ] = useState( snapshot.name ?? '' );
	const save = () => {
		if ( ! name.trim() || name.trim() === snapshot.name ) {
			onDone();
			return;
		}
		rename.mutate(
			{ hostname: getSnapshotHostname( snapshot ), name: name.trim() },
			{ onSuccess: onDone }
		);
	};
	return (
		<form
			className={ styles.inlineForm }
			onSubmit={ ( event ) => {
				event.preventDefault();
				save();
			} }
		>
			<Field>
				<FieldLabel htmlFor={ id }>{ __( 'Preview name' ) }</FieldLabel>
				<Input
					id={ id }
					value={ name }
					autoFocus
					disabled={ rename.isPending }
					onChange={ ( event ) => setName( event.target.value ) }
					onKeyDown={ ( event ) => {
						if ( event.key === 'Escape' ) {
							event.stopPropagation();
							onDone();
						}
					} }
				/>
			</Field>
			{ rename.error ? (
				<p className={ styles.error } role="alert">
					{ rename.error.message }
				</p>
			) : null }
			<div className={ styles.confirmActions }>
				<Button variant="ghost" onClick={ onDone }>
					{ __( 'Cancel' ) }
				</Button>
				<Button type="submit" loading={ rename.isPending }>
					{ __( 'Save' ) }
				</Button>
			</div>
		</form>
	);
}

export function PreviewSharePanel( {
	site,
	primaryAction,
	previews,
	busy,
	creating,
	offline,
	error,
	onRetry,
	retryCreates,
	createdUrl,
	restriction,
	canCreate,
	notice,
	onPublish,
	onManagePreview,
}: {
	site: SiteDetails;
	primaryAction: RefObject< HTMLButtonElement | null >;
	previews: Snapshot[];
	busy: boolean;
	creating: boolean;
	offline: boolean;
	error?: string;
	onRetry?: () => void;
	retryCreates: boolean;
	createdUrl?: string;
	restriction?: string;
	canCreate: boolean;
	notice?: string;
	onPublish: ( hostname?: string ) => void;
	onManagePreview: ( action: PreviewManagementAction ) => void;
} ) {
	const locale = useUserLocale();
	const connector = useConnector();
	const selectionId = useId();
	const [ selectedId, setSelectedId ] = useState< number >();
	const previewMenuTrigger = useRef< HTMLButtonElement >( null );
	const transferringFocus = useRef( false );
	const appliedCreatedUrl = useRef< string >( undefined );
	useEffect( () => {
		if ( ! createdUrl || appliedCreatedUrl.current === createdUrl ) return;
		const created = previews.find( ( preview ) => getSnapshotUrl( preview ) === createdUrl );
		if ( created ) {
			appliedCreatedUrl.current = createdUrl;
			setSelectedId( created.atomicSiteId );
		}
	}, [ createdUrl, previews ] );
	const snapshot = previews.find( ( item ) => item.atomicSiteId === selectedId ) ?? previews[ 0 ];
	const locked = busy || offline || creating;
	const managementLocked = offline || ( busy && ! creating );

	const managementItems = ( item: Snapshot ) => (
		<>
			<Menu.Item
				disabled={ managementLocked }
				onClick={ () => {
					transferringFocus.current = true;
					onManagePreview( {
						kind: 'rename',
						snapshot: item,
						trigger: previewMenuTrigger.current,
					} );
				} }
			>
				<RenameIcon />
				{ __( 'Rename' ) }
			</Menu.Item>
			<Menu.Separator />
			<Menu.Item
				disabled={ managementLocked }
				destructive
				onClick={ () => {
					transferringFocus.current = true;
					onManagePreview( {
						kind: 'delete',
						snapshot: item,
						trigger: previewMenuTrigger.current,
					} );
				} }
			>
				<TrashIcon />
				{ __( 'Delete preview' ) }
			</Menu.Item>
		</>
	);

	const feedback = (
		<>
			{ restriction ? (
				<p className={ styles.notice } role="status">
					{ restriction }
				</p>
			) : null }
			{ notice ? <p className={ styles.notice }>{ notice }</p> : null }
			{ error ? (
				<div className={ styles.error } role="alert">
					<p>{ error }</p>
					{ onRetry && snapshot ? (
						<Button
							variant="outline"
							disabled={ locked || ( retryCreates && ! canCreate ) }
							onClick={ onRetry }
						>
							{ __( 'Try again' ) }
						</Button>
					) : null }
				</div>
			) : null }
		</>
	);

	return (
		<div className={ styles.panel }>
			{ snapshot ? (
				<div className={ styles.previewListWrap }>
					<ul className={ styles.previewList } aria-label={ __( 'Previews' ) }>
						{ previews.map( ( item, index ) => {
							const title =
								item.name ||
								sprintf( __( 'Preview %d' ), item.sequence ?? previews.length - index );
							const selected = item.atomicSiteId === snapshot.atomicSiteId;
							return (
								<li
									key={ item.atomicSiteId }
									className={ styles.previewRow }
									aria-label={ sprintf( __( 'Select %s' ), title ) }
									data-selected={ selected || undefined }
									onClick={ () => setSelectedId( item.atomicSiteId ) }
								>
									<VisuallyHidden>
										<input
											type="radio"
											name={ selectionId }
											aria-label={ sprintf( __( 'Select %s' ), title ) }
											checked={ selected }
											onChange={ () => setSelectedId( item.atomicSiteId ) }
										/>
									</VisuallyHidden>
									<SiteCard
										thumbnailUrl={ getWebsiteThumbnailUrl( getSnapshotUrl( item ) ) }
										title={
											<a
												className={ styles.previewLink }
												href={ getSnapshotUrl( item ) }
												title={ title }
												onClick={ ( event ) => {
													event.preventDefault();
													void connector.openExternalUrl( getSnapshotOpenUrl( item ) );
												} }
											>
												<span className={ styles.previewLinkText }>{ title }</span>
												<ExternalLinkIcon className={ styles.previewExternalIcon } />
											</a>
										}
										description={ previewExpiry( item, locale, {
											month: 'short',
											day: 'numeric',
										} ) }
										actions={
											<div onClick={ ( event ) => event.stopPropagation() }>
												<Menu.Root modal={ false }>
													<Menu.Trigger
														render={
															<IconButton
																size="icon-sm"
																icon={ <EllipsisIcon /> }
																label={ __( 'Preview actions' ) }
																variant="muted-ghost"
																onClick={ ( event ) => {
																	previewMenuTrigger.current = event.currentTarget;
																	transferringFocus.current = false;
																} }
															/>
														}
													/>
													<Menu.Popup
														side="right"
														align="start"
														finalFocus={ () =>
															transferringFocus.current ? false : previewMenuTrigger.current
														}
													>
														<PreviewLinkActions
															snapshot={ item }
															siteId={ site.id }
															locked={ locked }
															onUpdate={ () => {
																setSelectedId( item.atomicSiteId );
																onPublish( getSnapshotHostname( item ) );
															} }
														/>
														{ managementItems( item ) }
													</Menu.Popup>
												</Menu.Root>
											</div>
										}
									/>
								</li>
							);
						} ) }
					</ul>
				</div>
			) : null }

			{ feedback }

			<Button
				className={ styles.createAction }
				variant="accent"
				ref={ primaryAction }
				size="lg"
				aria-busy={ creating || undefined }
				disabled={ locked || ! canCreate }
				onClick={ ! snapshot && error && onRetry ? onRetry : () => onPublish() }
			>
				{ creating ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null }
				{ creating
					? __( 'Creating preview…' )
					: ! snapshot && error && onRetry
					? __( 'Try again' )
					: snapshot
					? __( 'Create another preview' )
					: __( 'Create preview' ) }
			</Button>
		</div>
	);
}
