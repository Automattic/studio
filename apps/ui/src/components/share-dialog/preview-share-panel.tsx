import { DAY_MS, DEMO_SITE_EXPIRATION_DAYS } from '@studio/common/constants';
import { __, sprintf } from '@wordpress/i18n';
import { CopyIcon, EllipsisIcon, RefreshCwIcon } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Button, IconButton } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import * as Menu from '@/components/ui/menu';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useConnector } from '@/data/core';
import { markPreviewSeen } from '@/data/preview-ready';
import { useSiteThumbnail } from '@/data/queries/use-site-thumbnail';
import { useDeleteSnapshot, useRenameSnapshot } from '@/data/queries/use-snapshots';
import { useUserLocale } from '@/data/queries/use-user-locale';
import { getSnapshotHostname, getSnapshotUrl } from '@/lib/snapshot-url';
import styles from './style.module.css';
import type { SiteDetails, Snapshot } from '@/data/core';

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

const NEW_PREVIEW = -1;

export function PreviewSharePanel( {
	site,
	previews,
	busy,
	creating,
	updatingHostname,
	failed,
	canCreate,
	notice,
	footer,
	onPublish,
}: {
	site: SiteDetails;
	previews: Snapshot[];
	busy: boolean;
	// A new preview is publishing; `updatingHostname` names an existing one being refreshed.
	creating: boolean;
	updatingHostname?: string;
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
	const showingNew = selectedId === NEW_PREVIEW && creating;
	const snapshot = showingNew
		? undefined
		: previews.find( ( item ) => item.atomicSiteId === selectedId ) ?? previews[ 0 ];
	const picker =
		previews.length > 1 || creating ? (
			<Select
				value={ snapshot?.atomicSiteId ?? NEW_PREVIEW }
				disabled={ busy && ! creating }
				onValueChange={ ( value ) => {
					if ( value === null ) return;
					setSelectedId( value );
					setEditing( null );
				} }
			>
				<SelectTrigger aria-label={ __( 'Select preview' ) } className={ styles.previewSelect }>
					<SelectValue>
						{ snapshot ? snapshot.name || __( 'Preview site' ) : __( 'New preview · Publishing…' ) }
					</SelectValue>
				</SelectTrigger>
				<SelectContent>
					{ creating ? (
						<SelectItem value={ NEW_PREVIEW }>{ __( 'New preview · Publishing…' ) }</SelectItem>
					) : null }
					{ previews.map( ( item ) => (
						<SelectItem key={ item.atomicSiteId } value={ item.atomicSiteId }>
							{ item.name || __( 'Preview site' ) }
						</SelectItem>
					) ) }
				</SelectContent>
			</Select>
		) : null;
	const url = snapshot ? getSnapshotUrl( snapshot ) : '';
	const updating = !! snapshot && updatingHostname === getSnapshotHostname( snapshot );
	const locked = busy || remove.isPending;
	const copyLink = async () => {
		await connector.copyText( url );
		markPreviewSeen( site.id );
		setCopied( url );
		setTimeout( () => setCopied( null ), 2000 );
	};

	if ( ! snapshot ) {
		return (
			<div className={ styles.panel }>
				{ picker }
				<Button
					size="lg"
					disabled={ creating || locked || ! canCreate }
					onClick={ () => onPublish() }
				>
					{ creating ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null }
					{ creating
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
			{ picker }
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
					<Button
						variant="overlay"
						className={ styles.update }
						disabled={ locked }
						onClick={ () => onPublish( getSnapshotHostname( snapshot ) ) }
					>
						{ updating ? (
							<Spinner data-icon="inline-start" aria-hidden="true" />
						) : (
							<RefreshCwIcon data-icon="inline-start" />
						) }
						{ updating ? __( 'Updating' ) : failed ? __( 'Try again' ) : __( 'Update preview' ) }
					</Button>
				) }
			</figure>
			{ editing === 'delete' ? (
				<div className={ styles.confirm }>
					<p>{ __( 'Delete this preview? Its shared link will stop working.' ) }</p>
					<div className={ styles.confirmActions }>
						<Button
							variant="ghost"
							disabled={ remove.isPending }
							onClick={ () => setEditing( null ) }
						>
							{ __( 'Cancel' ) }
						</Button>
						<Button
							variant="destructive"
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
				<Button disabled={ remove.isPending } onClick={ () => void copyLink() }>
					<CopyIcon data-icon="inline-start" />
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
									size="icon-sm"
									icon={ <EllipsisIcon /> }
									label={ __( 'Preview actions' ) }
									disabled={ locked }
								/>
							}
						/>
						<Menu.Popup side="bottom" align="end">
							<Menu.Item
								disabled={ ! canCreate }
								onClick={ () => {
									setSelectedId( NEW_PREVIEW );
									onPublish();
								} }
							>
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
			<Field>
				<FieldLabel htmlFor={ linkId }>{ __( 'Preview link' ) }</FieldLabel>
				<Input
					id={ linkId }
					readOnly
					value={ url }
					onFocus={ ( event ) => event.currentTarget.select() }
				/>
			</Field>
		</div>
	);
}
