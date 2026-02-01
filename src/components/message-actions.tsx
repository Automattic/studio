import { DropdownMenu, MenuGroup, MenuItem } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { Icon, copy, reset, share, moreVertical } from '@wordpress/icons';
import { cx } from 'src/lib/cx';

// Custom thumb icons since WordPress icons doesn't have them
const ThumbUpIcon = () => (
	<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
		<path
			d="M7 22H4C3.46957 22 2.96086 21.7893 2.58579 21.4142C2.21071 21.0391 2 20.5304 2 20V13C2 12.4696 2.21071 11.9609 2.58579 11.5858C2.96086 11.2107 3.46957 11 4 11H7M14 9V5C14 4.20435 13.6839 3.44129 13.1213 2.87868C12.5587 2.31607 11.7956 2 11 2L7 11V22H18.28C18.7623 22.0055 19.2304 21.8364 19.5979 21.524C19.9654 21.2116 20.2077 20.7769 20.28 20.3L21.66 11.3C21.7035 11.0134 21.6842 10.7207 21.6033 10.4423C21.5225 10.1638 21.3821 9.90629 21.1919 9.68751C21.0016 9.46873 20.7661 9.29393 20.5016 9.17522C20.2371 9.0565 19.9499 8.99672 19.66 9H14Z"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
);

const ThumbDownIcon = () => (
	<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
		<path
			d="M17 2H19.67C20.236 1.98999 20.7859 2.18813 21.2154 2.55681C21.6449 2.9255 21.9241 3.43905 22 4V11C21.9241 11.5765 21.6381 12.1041 21.1954 12.4796C20.7527 12.8551 20.1845 13.0508 19.6 13H17M10 15V19C10 19.7956 10.3161 20.5587 10.8787 21.1213C11.4413 21.6839 12.2044 22 13 22L17 13V2H5.72C5.23767 1.99454 4.76965 2.16359 4.40209 2.47599C4.03452 2.78839 3.79227 3.22309 3.72 3.7L2.34 12.7C2.29651 12.9866 2.31583 13.2793 2.39666 13.5577C2.47749 13.8362 2.6179 14.0937 2.80814 14.3125C2.99839 14.5313 3.23393 14.7061 3.49843 14.8248C3.76294 14.9435 4.05009 15.0033 4.34 15H10Z"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
);

interface MessageActionsProps {
	content: string;
	onCopy?: () => void;
	onThumbUp?: () => void;
	onThumbDown?: () => void;
	onShare?: () => void;
	onRetry?: () => void;
	className?: string;
}

export function MessageActions( {
	content,
	onCopy,
	onThumbUp,
	onThumbDown,
	onShare,
	onRetry,
	className,
}: MessageActionsProps ) {
	const handleCopy = () => {
		void navigator.clipboard.writeText( content );
		onCopy?.();
	};

	const buttonClass =
		'flex items-center justify-center w-8 h-8 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors';

	return (
		<div className={ cx( 'flex items-center gap-1 mt-2', className ) }>
			{ /* Copy */ }
			<button
				type="button"
				onClick={ handleCopy }
				className={ buttonClass }
				aria-label={ __( 'Copy message' ) }
				title={ __( 'Copy' ) }
			>
				<Icon icon={ copy } size={ 18 } />
			</button>

			{ /* Thumb up */ }
			<button
				type="button"
				onClick={ onThumbUp }
				className={ buttonClass }
				aria-label={ __( 'Good response' ) }
				title={ __( 'Good response' ) }
			>
				<ThumbUpIcon />
			</button>

			{ /* Thumb down */ }
			<button
				type="button"
				onClick={ onThumbDown }
				className={ buttonClass }
				aria-label={ __( 'Bad response' ) }
				title={ __( 'Bad response' ) }
			>
				<ThumbDownIcon />
			</button>

			{ /* Share */ }
			<button
				type="button"
				onClick={ onShare }
				className={ buttonClass }
				aria-label={ __( 'Share' ) }
				title={ __( 'Share' ) }
			>
				<Icon icon={ share } size={ 18 } />
			</button>

			{ /* Try again / Retry */ }
			<button
				type="button"
				onClick={ onRetry }
				className={ buttonClass }
				aria-label={ __( 'Try again' ) }
				title={ __( 'Try again' ) }
			>
				<Icon icon={ reset } size={ 18 } />
			</button>

			{ /* More options */ }
			<DropdownMenu
				icon={ moreVertical }
				label={ __( 'More options' ) }
				className={ cx( buttonClass, '[&>button]:w-8 [&>button]:h-8 [&>button]:min-w-0' ) }
			>
				{ ( { onClose }: { onClose: () => void } ) => (
					<MenuGroup>
						<MenuItem
							onClick={ () => {
								handleCopy();
								onClose();
							} }
						>
							{ __( 'Copy to clipboard' ) }
						</MenuItem>
						<MenuItem
							onClick={ () => {
								onRetry?.();
								onClose();
							} }
						>
							{ __( 'Regenerate response' ) }
						</MenuItem>
						<MenuItem
							onClick={ () => {
								onShare?.();
								onClose();
							} }
						>
							{ __( 'Share conversation' ) }
						</MenuItem>
					</MenuGroup>
				) }
			</DropdownMenu>
		</div>
	);
}
