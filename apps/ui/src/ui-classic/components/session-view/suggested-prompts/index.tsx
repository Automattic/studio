import { __ } from '@wordpress/i18n';
import { Button, Dialog } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useMemo, useRef, useState } from 'react';
import { getSuggestedPrompts } from './prompts';
import styles from './style.module.css';

interface SuggestedPromptsProps {
	siteName: string;
	// Drops the prompt into the composer (focused) — the user sends it.
	onPick: ( prompt: string ) => void;
	// Checked at click time; confirmation is only asked when the draft
	// diverged from the last suggestion we inserted (user edits count,
	// switching between untouched suggestions does not).
	getDraft: () => { text: string; hasAttachments: boolean };
}

// Plain-text starter prompts floating under the empty-state logo. One action:
// click to load the prompt into the composer, ready to tweak or send. A fresh
// sample rotates in per mount (memo keeps it stable across re-renders).
export function SuggestedPrompts( { siteName, onPick, getDraft }: SuggestedPromptsProps ) {
	const prompts = useMemo( () => getSuggestedPrompts( siteName ), [ siteName ] );
	const [ pendingPrompt, setPendingPrompt ] = useState< string | null >( null );
	// Text of the last suggestion we inserted. While the draft still equals it
	// (and no attachments were added), another suggestion may replace it freely.
	const baselineRef = useRef< string | null >( null );

	const apply = ( prompt: string ) => {
		baselineRef.current = prompt;
		onPick( prompt );
	};

	const pick = ( prompt: string ) => {
		const draft = getDraft();
		const isUntouched =
			! draft.hasAttachments &&
			( draft.text.trim().length === 0 || draft.text === baselineRef.current );
		if ( isUntouched ) {
			apply( prompt );
		} else {
			setPendingPrompt( prompt );
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
					{ prompts.map( ( item ) => (
						<li key={ item.id }>
							<button
								type="button"
								className={ styles.prompt }
								onClick={ () => pick( item.prompt ) }
							>
								{ item.label }
							</button>
						</li>
					) ) }
				</ul>
			</div>
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
									apply( pendingPrompt );
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
