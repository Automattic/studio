import { Button, Popover } from '@studio/ds';
import { __ } from '@wordpress/i18n';
import { ChevronLeftIcon } from 'lucide-react';
import styles from './site-delivery-step.module.css';
import type { ReactNode, Ref } from 'react';

export function SiteDeliveryStep( {
	title,
	titleClassName,
	onBack,
	disabled,
	backButton,
	section,
	children,
}: {
	title: string;
	titleClassName?: string;
	onBack?: () => void;
	disabled?: boolean;
	backButton: Ref< HTMLButtonElement >;
	section: Ref< HTMLElement >;
	children: ReactNode;
} ) {
	return (
		<section className={ styles.step } ref={ section }>
			{ onBack && (
				<header className={ styles.header }>
					<Button
						ref={ backButton }
						aria-label={ __( 'Back' ) }
						variant="outline"
						size="icon-sm"
						disabled={ disabled }
						onClick={ onBack }
					>
						<ChevronLeftIcon />
					</Button>
					<Popover.Title className={ titleClassName }>{ title }</Popover.Title>
				</header>
			) }
			<div className={ styles.body }>{ children }</div>
		</section>
	);
}
