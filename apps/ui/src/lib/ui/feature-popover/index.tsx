import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { XIcon } from 'lucide-react';
import { useId } from 'react';
import { Button, IconButton } from '@/lib/ui/button';
import * as Popover from '@/lib/ui/popover';
import styles from './style.module.css';
import type { ComponentProps, ReactNode, Ref } from 'react';

export const Root = Popover.Root;
export const Trigger = Popover.Trigger;

export function Target( {
	children,
	highlighted = false,
	className,
	...props
}: ComponentProps< 'span' > & { highlighted?: boolean } ) {
	return (
		<span
			className={ clsx( styles.target, className ) }
			{ ...props }
			data-highlighted={ highlighted || undefined }
		>
			{ children }
		</span>
	);
}

export function Popup( {
	title,
	description,
	descriptionId: providedDescriptionId,
	footer,
	tone = 'default',
	badge,
	onDismiss,
	className,
	...props
}: Omit< ComponentProps< typeof Popover.Popup >, 'children' | 'aria-describedby' > & {
	title: string;
	description: string;
	descriptionId?: string;
	footer?: ReactNode;
	tone?: 'default' | 'accent';
	badge?: string;
	onDismiss?: () => void;
} ) {
	const generatedId = useId();
	const descriptionId = providedDescriptionId ?? generatedId;
	return (
		<Popover.Popup
			className={ clsx( styles.card, tone === 'accent' && styles.accent, className ) }
			{ ...props }
			aria-describedby={ descriptionId }
		>
			{ tone === 'accent' ? <Popover.Arrow className={ styles.arrow } /> : null }
			{ onDismiss ? (
				<IconButton
					className={ styles.dismiss }
					size="icon-sm"
					icon={ <XIcon size={ 16 } /> }
					label={ __( 'Dismiss tip' ) }
					tooltip={ false }
					onClick={ onDismiss }
				/>
			) : null }
			<div className={ styles.copy }>
				<div className={ styles.heading }>
					<Popover.Title>{ title }</Popover.Title>
					{ badge ? <span className={ styles.badge }>{ badge }</span> : null }
				</div>
				<Popover.Description id={ descriptionId }>{ description }</Popover.Description>
			</div>
			{ footer ? <div className={ styles.footer }>{ footer }</div> : null }
		</Popover.Popup>
	);
}

export function Navigation( {
	stepLabel,
	nextLabel = __( 'Next' ),
	onNext,
	onSkip,
	nextButtonRef,
}: {
	stepLabel?: string;
	nextLabel?: string;
	onNext: () => void;
	onSkip?: () => void;
	nextButtonRef?: Ref< HTMLButtonElement >;
} ) {
	return (
		<div className={ styles.navigation }>
			{ stepLabel ? (
				<span className={ styles.progress } role="status">
					{ stepLabel }
				</span>
			) : null }
			<div className={ styles.actions }>
				{ onSkip ? (
					<Button variant="ghost" size="header" onClick={ onSkip }>
						{ __( 'Skip' ) }
					</Button>
				) : null }
				<Button ref={ nextButtonRef } variant="accent" size="header" onClick={ onNext }>
					{ nextLabel }
				</Button>
			</div>
		</div>
	);
}
