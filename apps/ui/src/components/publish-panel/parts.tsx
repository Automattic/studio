import { canCancelSyncActivity } from '@studio/common/lib/sync/cancel';
import { useIsMutating } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { chevronDownSmall, chevronLeft } from '@wordpress/icons';
import { Button, Icon, IconButton, Progress, Spinner } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useEffect, useRef, type ReactNode } from 'react';
import * as Menu from '@/components/menu';
import * as Popover from '@/components/popover';
import {
	PULL_FROM_LIVE_MUTATION_KEY,
	PUSH_TO_LIVE_MUTATION_KEY,
} from '@/data/queries/use-sync-site';
import styles from './style.module.css';
import { TransferIcon } from './transfer-icon';
import type { SyncActivity } from '@/data/sync-activity';

export function PanelHeader( { title, onBack }: { title: string; onBack?: () => void } ) {
	const back = useRef< HTMLButtonElement >( null );
	const hasBack = Boolean( onBack );
	useEffect( () => {
		if ( ! hasBack ) {
			return;
		}
		const frame = requestAnimationFrame( () => back.current?.focus() );
		return () => cancelAnimationFrame( frame );
	}, [ hasBack, title ] );
	if ( ! onBack ) {
		return <Popover.Title className={ styles.visuallyHidden }>{ title }</Popover.Title>;
	}
	return (
		<div className={ styles.panelHeader }>
			<IconButton
				ref={ back }
				variant="outline"
				tone="neutral"
				size="compact"
				className={ styles.outline }
				icon={ chevronLeft }
				label={ __( 'Back to Publish' ) }
				onClick={ onBack }
			/>
			<Popover.Title className={ styles.heading }>{ title }</Popover.Title>
		</div>
	);
}

export function PanelBody( {
	children,
	insetTop = false,
	loading = false,
}: {
	children?: ReactNode;
	insetTop?: boolean;
	loading?: boolean;
} ) {
	return (
		<div className={ clsx( styles.body, insetTop && styles.bodyInsetTop ) }>
			{ loading ? (
				<div className={ styles.loading }>
					<Spinner aria-label={ __( 'Loading…' ) } />
				</div>
			) : (
				children
			) }
		</div>
	);
}

export function ErrorMessage( { error, retry }: { error: unknown; retry?: () => void } ) {
	if ( ! error ) {
		return null;
	}
	return (
		<div className={ styles.errorMessage } role="alert">
			<p className={ styles.error }>{ error instanceof Error ? error.message : String( error ) }</p>
			{ retry ? (
				<Button
					variant="outline"
					tone="neutral"
					size="small"
					className={ styles.outline }
					onClick={ retry }
				>
					{ __( 'Try again' ) }
				</Button>
			) : null }
		</div>
	);
}

// A select whose options are a menu, so it reads like the composer's pickers.
export function MenuSelect< Value extends string | number >( {
	id,
	value,
	items,
	label,
	display,
	disabled,
	wide = false,
	onChange,
}: {
	id?: string;
	value: Value;
	items: { value: Value; label: string }[];
	label: string;
	display?: ReactNode;
	disabled?: boolean;
	wide?: boolean;
	onChange: ( value: Value ) => void;
} ) {
	return (
		<Menu.Root modal={ false }>
			<Menu.Trigger
				id={ id }
				disabled={ disabled }
				aria-label={ label }
				className={ clsx( styles.select, wide && styles.selectWide ) }
			>
				<span className={ styles.selectValue }>
					{ display ?? items.find( ( item ) => item.value === value )?.label }
				</span>
				<Icon icon={ chevronDownSmall } size={ 16 } />
			</Menu.Trigger>
			<Menu.Popup
				side="bottom"
				align="start"
				className={ wide ? styles.selectPopupWide : undefined }
			>
				<Menu.RadioGroup value={ value } onValueChange={ ( next ) => onChange( next as Value ) }>
					{ items.map( ( item ) => (
						<Menu.RadioItem key={ item.value } value={ item.value }>
							{ item.label }
						</Menu.RadioItem>
					) ) }
				</Menu.RadioGroup>
			</Menu.Popup>
		</Menu.Root>
	);
}

// Only this window can stop a sync it started; one run by the agent or another
// window is out of its reach.
function useStartedHere( siteId: string, direction: 'push' | 'pull' ) {
	return (
		useIsMutating( {
			mutationKey: direction === 'push' ? PUSH_TO_LIVE_MUTATION_KEY : PULL_FROM_LIVE_MUTATION_KEY,
			predicate: ( mutation ) =>
				( mutation.state.variables as { siteId: string } | undefined )?.siteId === siteId,
		} ) > 0
	);
}

export function TransferProgress( {
	siteId,
	activity,
	scopeLabel,
	cancel,
	cancelling,
}: {
	siteId: string;
	activity: Extract< SyncActivity, { kind: 'pending' } >;
	scopeLabel?: string;
	cancel: () => void;
	cancelling: boolean;
} ) {
	const pushing = activity.direction === 'push';
	const startedHere = useStartedHere( siteId, pushing ? 'push' : 'pull' );
	const cancellable =
		startedHere && activity.remoteSiteId !== undefined && canCancelSyncActivity( activity );
	return (
		<div className={ styles.progress } role="status" aria-live="polite">
			{ scopeLabel && startedHere ? <p className={ styles.text }>{ scopeLabel }</p> : null }
			<div className={ styles.progressTitle }>
				<TransferIcon direction={ pushing ? 'push' : 'pull' } />
				<span className={ styles.heading }>
					{ activity.message || ( pushing ? __( 'Publishing…' ) : __( 'Pulling changes…' ) ) }
				</span>
			</div>
			{ activity.progress !== undefined ? (
				<Progress.Root
					value={ activity.progress }
					aria-label={ pushing ? __( 'Publishing progress' ) : __( 'Pull progress' ) }
				>
					<Progress.Track>
						<Progress.Indicator />
					</Progress.Track>
				</Progress.Root>
			) : null }
			{ cancellable ? (
				<button
					type="button"
					className={ styles.linkButton }
					disabled={ cancelling }
					onClick={ cancel }
				>
					{ cancelling
						? __( 'Cancelling…' )
						: pushing
						? __( 'Cancel publishing' )
						: __( 'Cancel pull' ) }
				</button>
			) : null }
		</div>
	);
}
