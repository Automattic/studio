import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useId } from 'react';
import { Button } from '@/lib/ui/button';
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
	illustration,
	footer,
	className,
	...props
}: Omit< ComponentProps< typeof Popover.Popup >, 'children' | 'aria-describedby' > & {
	title: string;
	description: string;
	descriptionId?: string;
	illustration?: ReactNode;
	footer?: ReactNode;
} ) {
	const generatedId = useId();
	const descriptionId = providedDescriptionId ?? generatedId;
	return (
		<Popover.Popup
			className={ clsx( styles.card, className ) }
			{ ...props }
			aria-describedby={ descriptionId }
		>
			{ illustration ? (
				<div className={ styles.illustration } aria-hidden="true" inert>
					{ illustration }
				</div>
			) : null }
			<div className={ styles.copy }>
				<Popover.Title>{ title }</Popover.Title>
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
					<Button variant="ghost" size="sm" onClick={ onSkip }>
						{ __( 'Skip' ) }
					</Button>
				) : null }
				<Button ref={ nextButtonRef } variant="accent" size="sm" onClick={ onNext }>
					{ nextLabel }
				</Button>
			</div>
		</div>
	);
}
