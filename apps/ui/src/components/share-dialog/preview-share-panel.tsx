import { DAY_MS, DEMO_SITE_EXPIRATION_DAYS } from '@studio/common/constants';
import { __, sprintf } from '@wordpress/i18n';
import { copy, moreHorizontal, rotateRight } from '@wordpress/icons';
import { Button, Icon, IconButton, Spinner } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useId, useState, type ReactNode } from 'react';
import * as Menu from '@/components/menu';
import { MenuSelect } from '@/components/publish-panel/parts';
import { useConnector } from '@/data/core';
import { markPreviewSeen } from '@/data/preview-ready';
import { useSiteThumbnail } from '@/data/queries/use-site-thumbnail';
import { useDeleteSnapshot, useRenameSnapshot } from '@/data/queries/use-snapshots';
import { useUserLocale } from '@/data/queries/use-user-locale';
import { getSnapshotHostname, getSnapshotUrl } from '@/lib/snapshot-url';
import styles from './style.module.css';
import type { SiteDetails, Snapshot } from '@/data/core';

export function previewExpiry( snapshot: Snapshot, locale?: string ) {
	return sprintf(
		/* translators: %s: the date a preview site expires */
		__( 'Expires %s' ),
		new Date( snapshot.date + DEMO_SITE_EXPIRATION_DAYS * DAY_MS ).toLocaleDateString( locale, {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
		} )
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
			<label htmlFor={ id } className={ styles.label }>
				{ __( 'Preview name' ) }
			</label>
			<input
				id={ id }
				className={ styles.input }
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
			<div className={ styles.confirmActions }>
				<Button variant="minimal" tone="neutral" size="compact" onClick={ onDone }>
					{ __( 'Cancel' ) }
				</Button>
				<Button
					type="submit"
					variant="solid"
					tone="neutral"
					size="compact"
					loading={ rename.isPending }
				>
					{ __( 'Save' ) }
				</Button>
			</div>
		</form>
	);
}

export function PreviewSharePanel( {
	site,
	previews,
	busy,
	publishing,
	failed,
	canCreate,
	notice,
	footer,
	onPublish,
}: {
	site: SiteDetails;
	previews: Snapshot[];
	busy: boolean;
	publishing: boolean;
	failed: boolean;
	canCreate: boolean;
	notice?: string;
	footer?: ReactNode;
	onPublish: ( hostname?: string ) => void;
} ) {
	const connector = useConnector();
	const locale = useUserLocale();
	const linkId = useId();
	const [ selectedId, setSelectedId ] = useState< number >();
	const [ editing, setEditing ] = useState< 'rename' | 'delete' | null >( null );
	const [ copied, setCopied ] = useState< string | null >( null );
	const [ imageFailed, setImageFailed ] = useState( false );
	const remove = useDeleteSnapshot();
	const thumbnail = useSiteThumbnail( site.id );
	const snapshot = previews.find( ( item ) => item.atomicSiteId === selectedId ) ?? previews[ 0 ];
	const url = snapshot ? getSnapshotUrl( snapshot ) : '';
	const locked = busy || remove.isPending;
	const copyLink = async () => {
		await connector.copyText( url );
		markPreviewSeen( site.id );
		setCopied( url );
		setTimeout( () => setCopied( null ), 1500 );
	};

	if ( ! snapshot ) {
		return (
			<div className={ styles.panel }>
				<Button
					variant="solid"
					tone="neutral"
					className={ clsx( styles.large, publishing && styles.busy ) }
					disabled={ locked || ( ! canCreate && ! publishing ) }
					onClick={ () => onPublish() }
				>
					{ publishing ? <Spinner /> : null }
					{ publishing
						? __( 'Publishing preview…' )
						: failed
						? __( 'Try again' )
						: __( 'Create preview' ) }
				</Button>
				{ notice ? <p className={ styles.notice }>{ notice }</p> : null }
				{ footer }
			</div>
		);
	}

	return (
		<div className={ styles.panel }>
			{ previews.length > 1 ? (
				<MenuSelect
					value={ snapshot.atomicSiteId }
					label={ __( 'Select preview' ) }
					disabled={ locked }
					className={ styles.previewSelect }
					items={ previews.map( ( item ) => ( {
						value: item.atomicSiteId,
						label: item.name || __( 'Preview site' ),
					} ) ) }
					onChange={ ( value ) => {
						setSelectedId( value );
						setEditing( null );
					} }
				/>
			) : null }
			<figure className={ styles.frame }>
				{ thumbnail.data && ! imageFailed ? (
					<img
						src={ thumbnail.data }
						/* translators: %s: site name */
						alt={ sprintf( __( 'Local site preview of %s' ), site.name ) }
						onError={ () => setImageFailed( true ) }
					/>
				) : (
					<p>
						{ thumbnail.isPending
							? __( 'Loading preview image…' )
							: __( 'Preview image unavailable' ) }
					</p>
				) }
				{ editing === 'delete' ? null : (
					<button
						type="button"
						className={ styles.update }
						disabled={ locked }
						onClick={ () => onPublish( getSnapshotHostname( snapshot ) ) }
					>
						{ publishing ? <Spinner /> : <Icon icon={ rotateRight } size={ 20 } /> }
						{ publishing ? __( 'Updating' ) : failed ? __( 'Try again' ) : __( 'Update preview' ) }
					</button>
				) }
			</figure>
			{ editing === 'delete' ? (
				<div className={ styles.confirm }>
					<p>{ __( 'Delete this preview? Its shared link will stop working.' ) }</p>
					<div className={ styles.confirmActions }>
						<Button
							variant="minimal"
							tone="neutral"
							size="compact"
							disabled={ remove.isPending }
							onClick={ () => setEditing( null ) }
						>
							{ __( 'Cancel' ) }
						</Button>
						<Button
							variant="solid"
							tone="neutral"
							size="compact"
							className={ styles.destructive }
							loading={ remove.isPending }
							onClick={ () =>
								remove.mutate(
									{ hostname: getSnapshotHostname( snapshot ) },
									{ onSuccess: () => setEditing( null ) }
								)
							}
						>
							{ __( 'Delete preview' ) }
						</Button>
					</div>
				</div>
			) : (
				<Button
					variant="solid"
					tone="neutral"
					className="studio-control"
					disabled={ remove.isPending }
					onClick={ () => void copyLink() }
				>
					<Icon icon={ copy } size={ 20 } />
					{ copied === url ? __( 'Copied' ) : __( 'Copy link' ) }
				</Button>
			) }
			{ editing === 'rename' ? (
				<RenamePreview
					key={ snapshot.atomicSiteId }
					snapshot={ snapshot }
					onDone={ () => setEditing( null ) }
				/>
			) : (
				<div className={ styles.expiry }>
					<p>{ previewExpiry( snapshot, locale ) }</p>
					<Menu.Root modal={ false }>
						<Menu.Trigger
							render={
								<IconButton
									variant="minimal"
									tone="neutral"
									size="compact"
									icon={ moreHorizontal }
									label={ __( 'Preview actions' ) }
									disabled={ locked }
								/>
							}
						/>
						<Menu.Popup side="bottom" align="end">
							<Menu.Item disabled={ ! canCreate } onClick={ () => onPublish() }>
								{ __( 'New preview' ) }
							</Menu.Item>
							<Menu.Item onClick={ () => setEditing( 'rename' ) }>{ __( 'Rename…' ) }</Menu.Item>
							<Menu.Separator />
							<Menu.Item destructive onClick={ () => setEditing( 'delete' ) }>
								{ __( 'Delete preview' ) }
							</Menu.Item>
						</Menu.Popup>
					</Menu.Root>
				</div>
			) }
			{ notice ? <p className={ styles.notice }>{ notice }</p> : null }
			{ footer }
			<div className={ styles.field }>
				<label htmlFor={ linkId } className={ styles.label }>
					{ __( 'Preview link' ) }
				</label>
				<input
					id={ linkId }
					className={ styles.input }
					readOnly
					value={ url }
					onFocus={ ( event ) => event.currentTarget.select() }
				/>
			</div>
		</div>
	);
}
