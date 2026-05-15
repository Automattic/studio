import { __ } from '@wordpress/i18n';
import {
	chevronLeft,
	chevronRight,
	closeSmall,
	external,
	Icon,
	lockSmall,
	rotateRight,
} from '@wordpress/icons';
import Button from 'src/components/button';
import { getIpcApi } from 'src/lib/get-ipc-api';

type DollyPreviewHeaderControlsProps = {
	isOpen: boolean;
	displayUrl: string;
	previewUrl?: string;
	canGoBack?: boolean;
	canGoForward?: boolean;
	onOpen: () => void;
	onClose: () => void;
	onGoBack: () => void;
	onGoForward: () => void;
	onRefresh: () => void;
};

export function DollyPreviewHeaderControls( {
	isOpen,
	displayUrl,
	previewUrl,
	canGoBack,
	canGoForward,
	onOpen,
	onClose,
	onGoBack,
	onGoForward,
	onRefresh,
}: DollyPreviewHeaderControlsProps ) {
	if ( ! isOpen ) {
		return (
			<button
				type="button"
				className="flex w-full min-w-0 max-w-[27rem] items-center gap-2 rounded-full border border-a8c-gray-5 bg-a8c-gray-0 px-3 py-2 text-left transition hover:border-a8c-gray-20 hover:bg-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-frame-theme"
				onClick={ onOpen }
				aria-label={ __( 'Show preview' ) }
			>
				<Icon icon={ lockSmall } size={ 16 } className="shrink-0 fill-frame-text-secondary" />
				<span className="truncate text-xs leading-4 text-frame-text-secondary">{ displayUrl }</span>
			</button>
		);
	}

	return (
		<div className="flex w-full min-w-0 items-center justify-end gap-2">
			<Button
				variant="icon"
				tooltipText={ __( 'Go back' ) }
				disabled={ ! canGoBack }
				onClick={ onGoBack }
				aria-label={ __( 'Go back' ) }
			>
				<Icon icon={ chevronLeft } size={ 20 } />
			</Button>
			<Button
				variant="icon"
				tooltipText={ __( 'Go forward' ) }
				disabled={ ! canGoForward }
				onClick={ onGoForward }
				aria-label={ __( 'Go forward' ) }
			>
				<Icon icon={ chevronRight } size={ 20 } />
			</Button>
			<Button
				variant="icon"
				tooltipText={ __( 'Reload preview' ) }
				disabled={ ! previewUrl }
				onClick={ onRefresh }
				aria-label={ __( 'Reload preview' ) }
			>
				<Icon icon={ rotateRight } size={ 18 } />
			</Button>
			<div className="flex min-w-0 max-w-[27rem] flex-1 items-center gap-2 rounded-full border border-a8c-gray-5 bg-a8c-gray-0 px-3 py-2">
				<Icon icon={ lockSmall } size={ 16 } className="shrink-0 fill-frame-text-secondary" />
				<div className="truncate text-xs leading-4 text-frame-text-secondary">{ displayUrl }</div>
			</div>
			<Button
				variant="icon"
				tooltipText={ __( 'Open in browser' ) }
				disabled={ ! previewUrl }
				onClick={ () => getIpcApi().openURL( displayUrl ) }
				aria-label={ __( 'Open in browser' ) }
			>
				<Icon icon={ external } size={ 18 } />
			</Button>
			<Button
				variant="icon"
				tooltipText={ __( 'Close preview' ) }
				onClick={ onClose }
				aria-label={ __( 'Close preview' ) }
			>
				<Icon icon={ closeSmall } size={ 20 } />
			</Button>
		</div>
	);
}
