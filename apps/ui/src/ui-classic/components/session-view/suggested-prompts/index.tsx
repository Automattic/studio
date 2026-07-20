import { __ } from '@wordpress/i18n';
import { Button, Dialog } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useMemo, useState } from 'react';
import { getSuggestedPrompts } from './prompts';
import styles from './style.module.css';

interface SuggestedPromptsProps {
	siteName: string;
	// Drops the prompt into the composer (focused) — the user sends it.
	onPick: ( prompt: string ) => void;
	// Checked at click time; a truthy draft asks for confirmation before
	// onPick overwrites it.
	hasExistingDraft: () => boolean;
}

// Plain-text starter prompts floating under the empty-state logo. One action:
// click to load the prompt into the composer, ready to tweak or send. A fresh
// sample rotates in per mount (memo keeps it stable across re-renders).
export function SuggestedPrompts( { siteName, onPick, hasExistingDraft }: SuggestedPromptsProps ) {
	const prompts = useMemo( () => getSuggestedPrompts( siteName ), [ siteName ] );
	const [ pendingPrompt, setPendingPrompt ] = useState< string | null >( null );

	const pick = ( prompt: string ) => {
		if ( hasExistingDraft() ) {
			setPendingPrompt( prompt );
			return;
		}
		onPick( prompt );
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
							{ __(
								'Using this suggestion will replace the message and attachments you’ve already added.'
							) }
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
									onPick( pendingPrompt );
								}
								setPendingPrompt( null );
							} }
						>
							{ __( 'Use suggestion' ) }
						</Button>
					</Dialog.Footer>
				</Dialog.Popup>
			</Dialog.Root>
		</div>
	);
}
