import { __ } from '@wordpress/i18n';
import { useEffect, useId, useRef, type ReactNode, type Ref } from 'react';
import {
	ChevronLeftIcon,
	ChevronRightIcon,
	EyeOffIcon,
	EyeIcon,
	LinkIcon,
	LoginIcon,
	GlobeHemisphereIcon,
} from '@/lib/icons';
import { Button, Popover, RadioGroup, RadioGroupItem } from '@/lib/ui';
import styles from './style.module.css';

export type Access = 'link' | 'public' | 'coming-soon' | 'private';

export function AccessControl( {
	value,
	onClick,
	disabled,
	ref,
	label: customLabel,
}: {
	value: Access;
	onClick: () => void;
	disabled: boolean;
	ref?: Ref< HTMLButtonElement >;
	label?: string;
} ) {
	const label =
		customLabel ?? ( value === 'public' ? __( 'Everyone' ) : __( 'Anyone with the link' ) );
	return (
		<div>
			<Button
				ref={ ref }
				variant="ghost"
				disabled={ disabled }
				aria-label={ __( 'Who can view' ) }
				aria-description={ label }
				className={ styles.accessTrigger }
				onClick={ onClick }
			>
				<EyeIcon data-icon="inline-start" />
				<span className={ styles.accessTriggerLabel }>{ __( 'Who can view' ) }</span>
				<span className={ styles.accessTriggerValue }>{ label }</span>
				<ChevronRightIcon data-icon="inline-end" />
			</Button>
		</div>
	);
}

export function AccessView( {
	value,
	onChange,
	disabled,
	publicDescription,
	publishDisabled,
	onBack,
	onDone,
	hosted = false,
	includePrivate = false,
	saving = false,
	doneLabel,
	doneVariant,
	error,
}: {
	value: Access | undefined;
	onChange: ( value: Access ) => void;
	disabled: boolean;
	publicDescription: string;
	publishDisabled: boolean;
	onBack: () => void;
	onDone: () => void;
	hosted?: boolean;
	includePrivate?: boolean;
	saving?: boolean;
	doneLabel?: string;
	doneVariant?: 'accent' | 'outline';
	error?: ReactNode;
} ) {
	const id = useId();
	const group = useRef< HTMLDivElement >( null );
	useEffect( () => {
		const frame = requestAnimationFrame( () => {
			group.current?.querySelector< HTMLElement >( '[role="radio"][aria-checked="true"]' )?.focus();
		} );
		return () => cancelAnimationFrame( frame );
	}, [] );
	const choices = [
		...( hosted
			? [
					{
						value: 'coming-soon' as const,
						label: __( 'Coming soon' ),
						description: __( 'Show a Coming Soon page to visitors.' ),
						icon: <EyeOffIcon />,
					},
			  ]
			: [
					{
						value: 'link' as const,
						label: __( 'Visible to anyone with the link' ),
						description: __( 'Publish a temporary preview of your site.' ),
						icon: <LinkIcon />,
					},
			  ] ),
		{
			value: 'public' as const,
			label: __( 'Visible to anyone' ),
			description: publicDescription,
			icon: <GlobeHemisphereIcon />,
		},
		...( includePrivate
			? [
					{
						value: 'private' as const,
						label: __( 'Private' ),
						description: __( 'Only you and people you invite can view.' ),
						icon: <LoginIcon />,
					},
			  ]
			: [] ),
	];
	return (
		<div
			onKeyDown={ ( event ) => {
				if ( event.key === 'Escape' ) {
					event.preventDefault();
					event.stopPropagation();
					if ( ! saving ) onBack();
				}
			} }
		>
			<div className={ styles.destinationRow }>
				<Popover.Title className={ styles.destinationLabel }>
					{ __( 'Who can view your WordPress?' ) }
				</Popover.Title>
			</div>
			{ ! hosted ? (
				<Popover.Description className={ styles.shareDescription }>
					{ __( 'Publish on WordPress.com to make your site public and choose a custom domain.' ) }
				</Popover.Description>
			) : null }
			<RadioGroup
				ref={ group }
				value={ value }
				onValueChange={ onChange }
				aria-label={ __( 'Who has access' ) }
				disabled={ disabled }
				className={ styles.accessChoices }
			>
				{ choices.map( ( choice ) => (
					<label key={ choice.value } className={ styles.accessChoice }>
						<span className={ styles.accessChoiceIcon } aria-hidden="true">
							{ choice.icon }
						</span>
						<span className={ styles.accessChoiceText }>
							<span id={ `${ id }-${ choice.value }-label` }>{ choice.label }</span>
							<span
								id={ `${ id }-${ choice.value }-description` }
								className={ styles.accessDescription }
							>
								{ choice.description }
							</span>
						</span>
						<RadioGroupItem
							value={ choice.value }
							aria-labelledby={ `${ id }-${ choice.value }-label` }
							aria-describedby={ `${ id }-${ choice.value }-description` }
							className={ styles.accessRadio }
						/>
					</label>
				) ) }
			</RadioGroup>
			{ error }
			<div className={ styles.shareFooter }>
				<Button variant="outline" onClick={ onBack } disabled={ saving }>
					<ChevronLeftIcon data-icon="inline-start" />
					{ __( 'Back' ) }
				</Button>
				<Button
					variant={ doneVariant ?? ( value === 'public' ? 'accent' : 'outline' ) }
					disabled={ disabled || ( ( hosted || value === 'public' ) && publishDisabled ) }
					loading={ saving }
					onClick={ onDone }
				>
					{ doneLabel ?? ( value === 'public' ? __( 'Publish' ) : __( 'Done' ) ) }
				</Button>
			</div>
		</div>
	);
}
