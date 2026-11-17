import { __ } from '@wordpress/i18n';
import { ChevronLeftIcon } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { Button, DialogDismissButton, Popover } from '@/lib/ui';
import styles from './site-delivery-step.module.css';

export function SiteDeliveryStep( {
	title,
	titleClassName,
	onBack,
	onClose,
	disabled,
	children,
}: {
	title: string;
	titleClassName?: string;
	onBack: () => void;
	onClose: () => void;
	disabled?: boolean;
	children: ReactNode;
} ) {
	const back = useRef< HTMLButtonElement >( null );
	useEffect( () => back.current?.focus(), [] );
	return (
		<section className={ styles.step }>
			<header className={ styles.header }>
				<Button
					ref={ back }
					aria-label={ __( 'Back' ) }
					variant="segmented"
					size="icon-sm"
					disabled={ disabled }
					onClick={ onBack }
				>
					<ChevronLeftIcon />
				</Button>
				<Popover.Title className={ titleClassName }>{ title }</Popover.Title>
				<DialogDismissButton disabled={ disabled } onClick={ onClose } />
			</header>
			<div className={ styles.body }>{ children }</div>
		</section>
	);
}
