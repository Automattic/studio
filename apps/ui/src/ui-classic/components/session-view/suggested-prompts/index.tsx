import { __ } from '@wordpress/i18n';
import { Button, Dialog, Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useMemo, useRef, useState } from 'react';
import { getSuggestedPrompts } from './prompts';
import styles from './style.module.css';
import type { SuggestedPromptContext } from './prompts';
import type { CSSProperties } from 'react';

interface SuggestedPromptsProps {
	siteName: string;
	context?: SuggestedPromptContext;
	// Drops the prompt into the composer (focused) — the user sends it.
	onPick: ( prompt: string ) => void;
	// Checked at click time; confirmation is only asked when the draft
	// diverged from the last suggestion we inserted (user edits count,
	// switching between untouched suggestions does not).
	getDraft: () => { text: string; hasAttachments: boolean };
}

interface PendingPrompt {
	prompt: string;
	label: string;
	sourceRect: DOMRect;
}

interface PromptTransfer {
	id: number;
	label: string;
	style: CSSProperties;
}

// Plain-text starter prompts floating under the empty-state logo. One action:
// click to load the prompt into the composer, ready to tweak or send. A fresh
// sample rotates in per mount (memo keeps it stable across re-renders).
export function SuggestedPrompts( { siteName, context, onPick, getDraft }: SuggestedPromptsProps ) {
	const prompts = useMemo( () => getSuggestedPrompts( siteName, context ), [ siteName, context ] );
	const tooltipLabels = [
		__( 'Start with this idea' ),
		__( 'Try this one' ),
		__( 'Maybe this one' ),
		__( 'Give this a go' ),
		__( 'How about this' ),
		__( 'Build from here' ),
		__( 'Take this for a spin' ),
	];
	const [ pendingPrompt, setPendingPrompt ] = useState< PendingPrompt | null >( null );
	const [ transfer, setTransfer ] = useState< PromptTransfer | null >( null );
	const transferIdRef = useRef( 0 );
	// Text of the last suggestion we inserted. While the draft still equals it
	// (and no attachments were added), another suggestion may replace it freely.
	const baselineRef = useRef< string | null >( null );

	const apply = ( prompt: string ) => {
		baselineRef.current = prompt;
		onPick( prompt );
	};

	const applyWithTransfer = ( prompt: string, label: string, sourceRect: DOMRect ) => {
		const composer = document.querySelector< HTMLElement >( '[data-session-composer]' );
		const reduceMotion = window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches ?? false;

		if ( composer && ! reduceMotion ) {
			const destinationRect = composer.getBoundingClientRect();
			const sourceCenterX = sourceRect.left + sourceRect.width / 2;
			const sourceCenterY = sourceRect.top + sourceRect.height / 2;
			const destinationX = destinationRect.left + destinationRect.width / 2;
			const destinationY = destinationRect.top + Math.min( destinationRect.height / 2, 40 );

			setTransfer( {
				id: transferIdRef.current++,
				label,
				style: {
					top: sourceRect.top,
					left: sourceRect.left,
					width: sourceRect.width,
					height: sourceRect.height,
					'--prompt-transfer-x': `${ destinationX - sourceCenterX }px`,
					'--prompt-transfer-y': `${ destinationY - sourceCenterY }px`,
				} as CSSProperties,
			} );
		}

		apply( prompt );
	};

	const pick = ( prompt: string, label: string, sourceRect: DOMRect ) => {
		const draft = getDraft();
		const isUntouched =
			! draft.hasAttachments &&
			( draft.text.trim().length === 0 || draft.text === baselineRef.current );
		if ( isUntouched ) {
			applyWithTransfer( prompt, label, sourceRect );
		} else {
			setPendingPrompt( { prompt, label, sourceRect } );
		}
	};

	return (
		<div className={ styles.root }>
			<div className={ styles.group }>
				{ /* Stacked backdrop-blur layers with shrinking radial masks — the
				     progressive-blur technique (see components/progressive-blur) —
				     so the frost ramps up smoothly instead of cutting a hard edge. */ }
				<span className={ clsx( styles.frost, styles.frostSoft ) } aria-hidden="true" />
				<span className={ clsx( styles.frost, styles.frostMedium ) } aria-hidden="true" />
				<span className={ clsx( styles.frost, styles.frostStrong ) } aria-hidden="true" />
				<span className={ clsx( styles.frost, styles.frostIntense ) } aria-hidden="true" />
				<ul className={ styles.list }>
					{ prompts.map( ( item, index ) => (
						<li key={ item.id }>
							<Tooltip.Root>
								<Tooltip.Trigger
									render={
										<Button
											variant="outline"
											tone="neutral"
											size="compact"
											className={ styles.prompt }
											onClick={ ( event ) =>
												pick( item.prompt, item.label, event.currentTarget.getBoundingClientRect() )
											}
										/>
									}
								>
									{ item.label }
								</Tooltip.Trigger>
								<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
									{ item.reason ?? tooltipLabels[ index % tooltipLabels.length ] }
								</Tooltip.Popup>
							</Tooltip.Root>
						</li>
					) ) }
				</ul>
			</div>
			{ transfer && (
				<span
					key={ transfer.id }
					data-testid="prompt-transfer"
					className={ styles.transfer }
					style={ transfer.style }
					aria-hidden="true"
					onAnimationEnd={ () => setTransfer( null ) }
				>
					{ transfer.label }
				</span>
			) }
			<Dialog.Root
				open={ pendingPrompt !== null }
				onOpenChange={ ( next ) => {
					if ( ! next ) {
						setPendingPrompt( null );
					}
				} }
			>
				<Dialog.Popup size="small">
					<Dialog.Header>
						<Dialog.Title>{ __( 'Replace your draft?' ) }</Dialog.Title>
					</Dialog.Header>
					<Dialog.Content>
						<Dialog.Description>
							{ __( 'Your current draft and attachments will be discarded.' ) }
						</Dialog.Description>
					</Dialog.Content>
					<Dialog.Footer>
						<Dialog.Action variant="minimal" tone="neutral">
							{ __( 'Cancel' ) }
						</Dialog.Action>
						<Button
							variant="solid"
							tone="brand"
							onClick={ () => {
								if ( pendingPrompt ) {
									applyWithTransfer(
										pendingPrompt.prompt,
										pendingPrompt.label,
										pendingPrompt.sourceRect
									);
								}
								setPendingPrompt( null );
							} }
						>
							{ __( 'Replace draft' ) }
						</Button>
					</Dialog.Footer>
				</Dialog.Popup>
			</Dialog.Root>
		</div>
	);
}
