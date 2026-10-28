import { DAY_MS, DEMO_SITE_EXPIRATION_DAYS } from '@studio/common/constants';
import { __, sprintf } from '@wordpress/i18n';
import { EllipsisIcon, RefreshCwIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useConnector } from '@/data/core';
import { useCopyText } from '@/data/host/use-copy-text';
import { markPreviewSeen } from '@/data/preview-ready';
import { useRenameSnapshot } from '@/data/queries/use-snapshots';
import { useUserLocale } from '@/data/queries/use-user-locale';
import { getSnapshotHostname, getSnapshotUrl } from '@/data/snapshot-url';
import { DuplicateIcon, ExternalLinkIcon, RenameIcon, TrashIcon } from '@/lib/icons';
import {
	Button,
	IconButton,
	Field,
	FieldLabel,
	Input,
	Menu,
	Spinner,
	Table,
	TableHeader,
	TableBody,
	TableRow,
	TableHead,
	TableCell,
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
			<Menu.Item onClick={ () => void connector.openExternalUrl( url ) }>
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
		new Date( snapshot.date + DEMO_SITE_EXPIRATION_DAYS * DAY_MS ).toLocaleDateString(
			locale,
			format
		)
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
	actionsContainer,
	primaryAction,
	previews,
	busy,
	creating,
	updatingHostname,
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
	actionsContainer: HTMLDivElement | null;
	primaryAction: RefObject< HTMLButtonElement | null >;
	previews: Snapshot[];
	busy: boolean;
	// A new preview is publishing; `updatingHostname` names an existing one being refreshed.
	creating: boolean;
	updatingHostname?: string;
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
	const multiple = previews.length > 1;
	const url = snapshot ? getSnapshotUrl( snapshot ) : '';
	const updating = !! snapshot && updatingHostname === getSnapshotHostname( snapshot );
	const locked = busy || offline || creating;
	const managementLocked = offline || ( busy && ! creating );
	const { copied, copy } = useCopyText( url );

	const managementItems = ( item: Snapshot ) => (
		<>
			<Menu.Item
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
	if ( ! snapshot ) {
		return (
			<div className={ styles.panel }>
				{ feedback }
				<Button
					className={ styles.createAction }
					ref={ primaryAction }
					size="lg"
					aria-busy={ creating || undefined }
					disabled={ locked || ! canCreate }
					onClick={ error && onRetry ? onRetry : () => onPublish() }
				>
					{ creating ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null }
					{ creating
						? __( 'Creating preview…' )
						: error && onRetry
						? __( 'Try again' )
						: __( 'Create preview' ) }
				</Button>
			</div>
		);
	}

	return (
		<div className={ styles.panel }>
			{ multiple ? (
				<div className={ styles.previewTableWrap }>
					<Table className={ styles.previewTable } aria-label={ __( 'Previews' ) }>
						<TableHeader>
							<TableRow>
								<TableHead className={ styles.previewColumn }>{ __( 'Preview' ) }</TableHead>
								<TableHead className={ styles.expiryColumn }>{ __( 'Expires' ) }</TableHead>
								<TableHead className={ styles.actionsColumn }>
									<VisuallyHidden>{ __( 'Actions' ) }</VisuallyHidden>
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{ previews.map( ( item, index ) => {
								const title =
									item.name ||
									sprintf( __( 'Preview %d' ), item.sequence ?? previews.length - index );
								const selected = item.atomicSiteId === snapshot.atomicSiteId;
								return (
									<TableRow
										className={ styles.previewRow }
										key={ item.atomicSiteId }
										data-state={ selected ? 'selected' : undefined }
										onClick={ () => {
											setSelectedId( item.atomicSiteId );
										} }
									>
										<TableCell className={ styles.previewColumn }>
											<div className={ styles.previewTitle }>
												<VisuallyHidden>
													<input
														type="radio"
														name={ selectionId }
														aria-label={ sprintf( __( 'Select %s' ), title ) }
														checked={ selected }
														onChange={ () => setSelectedId( item.atomicSiteId ) }
													/>
												</VisuallyHidden>
												<a
													href={ getSnapshotUrl( item ) }
													title={ title }
													onClick={ ( event ) => {
														event.preventDefault();
														void connector.openExternalUrl( getSnapshotUrl( item ) );
													} }
												>
													<span className={ styles.previewLinkText }>{ title }</span>
													<ExternalLinkIcon className={ styles.previewExternalIcon } />
												</a>
											</div>
										</TableCell>
										<TableCell className={ styles.previewDate }>
											{ new Date(
												item.date + DEMO_SITE_EXPIRATION_DAYS * DAY_MS
											).toLocaleDateString( locale, { month: 'short', day: 'numeric' } ) }
										</TableCell>
										<TableCell
											className={ styles.previewMenuCell }
											onClick={ ( event ) => event.stopPropagation() }
										>
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
															disabled={ managementLocked }
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
										</TableCell>
									</TableRow>
								);
							} ) }
						</TableBody>
					</Table>
				</div>
			) : null }

			{ ! multiple ? (
				<p className={ styles.singleExpiry }>
					<span>
						{ sprintf(
							/* translators: %s: the date a preview was created */
							__( 'Preview created on %s.' ),
							new Date( snapshot.date ).toLocaleDateString( locale, {
								month: 'long',
								day: 'numeric',
							} )
						) }
					</span>
					<span>
						{ sprintf(
							/* translators: %s: the date a preview expires */
							__( 'Expires on %s.' ),
							new Date( snapshot.date + DEMO_SITE_EXPIRATION_DAYS * DAY_MS ).toLocaleDateString(
								locale,
								{ month: 'long', day: 'numeric' }
							)
						) }
					</span>
				</p>
			) : null }

			{ feedback }

			<div className={ styles.previewActions }>
				<Button
					size="lg"
					className={ styles.previewAction }
					variant="outline"
					onClick={ () => {
						if ( multiple ) copy();
						else void connector.openExternalUrl( url );
						markPreviewSeen( site.id );
					} }
				>
					{ multiple ? ( copied ? __( 'Copied' ) : __( 'Copy link' ) ) : __( 'Visit preview' ) }
					{ ! multiple ? <ExternalLinkIcon data-icon="inline-end" aria-hidden="true" /> : null }
				</Button>
				<Button
					size="lg"
					className={ styles.previewAction }
					ref={ primaryAction }
					aria-busy={ creating || updating || undefined }
					disabled={ locked }
					onClick={ () => onPublish( getSnapshotHostname( snapshot ) ) }
				>
					{ creating || updating ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null }
					{ creating ? __( 'Creating…' ) : updating ? __( 'Updating…' ) : __( 'Update' ) }
				</Button>
			</div>

			{ actionsContainer
				? createPortal(
						creating && multiple ? (
							<Button size="sm" variant="outline" disabled aria-busy="true">
								<Spinner data-icon="inline-start" aria-hidden="true" />
								{ __( 'Creating…' ) }
							</Button>
						) : (
							<Menu.Root modal={ false }>
								<Menu.Trigger
									render={
										<IconButton
											icon={ <EllipsisIcon /> }
											label={ __( 'Sharing actions' ) }
											onClick={ ( event ) => {
												previewMenuTrigger.current = event.currentTarget;
												transferringFocus.current = false;
											} }
											size="icon-sm"
											variant="outline"
											disabled={ multiple ? locked : managementLocked }
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
									<Menu.Item
										disabled={ locked || ! canCreate }
										onClick={ () => {
											onPublish();
										} }
									>
										{ __( 'New preview' ) }
									</Menu.Item>
									{ ! multiple ? (
										<>
											<Menu.Separator />
											<Menu.Item
												onClick={ () => {
													copy();
													markPreviewSeen( site.id );
												} }
											>
												<DuplicateIcon />
												{ __( 'Copy link' ) }
											</Menu.Item>
											{ managementItems( snapshot ) }
										</>
									) : null }
								</Menu.Popup>
							</Menu.Root>
						),
						actionsContainer
				  )
				: null }
		</div>
	);
}
