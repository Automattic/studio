import {
	findOwnFreeFormOptionLabel,
	getFreeFormOptionDescription,
	getFreeFormOptionLabel,
	STOPPED_WITHOUT_ANSWER,
} from '@studio/common/ai/tools';
import { __, sprintf } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { CheckIcon, SearchIcon } from 'lucide-react';
import { useEffect, useEffectEvent, useId, useState } from 'react';
import { useLocalMediaDataUrl } from '@/data/queries/use-local-media';
import { QuestionOptionViewer } from '@/features/chats/session-view/conversation/agent-question/option-viewer';
import { joinedAttributes, type Joined } from '@/features/chats/session-view/conversation/joined';
import { isTextEntry } from '@/lib/keyboard';
import { Button, IconButton } from '@/lib/ui';
import styles from './style.module.css';
import type { AgentQuestionRenderItem } from '@/features/chats/session-view/conversation/transcript-items';

export function getAnswerLetter(
	options: AgentQuestionRenderItem[ 'options' ],
	pickedLabel: string
): string | undefined {
	const index = options.findIndex( ( option ) => option.label === pickedLabel );
	return index < 0 ? undefined : String.fromCharCode( 65 + index );
}

export function QuestionAnswer( { letter, label }: { letter?: string; label: string } ) {
	return (
		<span className={ styles.questionAnswer }>
			{ letter ? (
				<span className={ styles.questionLetter } aria-hidden="true">
					{ letter }
				</span>
			) : null }
			<span className={ styles.questionAnswerLabel }>{ label }</span>
			<CheckIcon aria-hidden="true" />
		</span>
	);
}

export function AgentQuestion( {
	question,
	options,
	multiSelect = false,
	isInteractive,
	pickedLabel,
	isCollapsing = false,
	freeFormActive = false,
	progress,
	onAnswer,
	onChooseFreeForm,
	...joined
}: {
	question: string;
	options: Array< { label: string; description: string; image?: string } >;
	multiSelect?: boolean;
	isInteractive: boolean;
	pickedLabel: string | undefined;
	isCollapsing?: boolean;
	freeFormActive?: boolean;
	progress?: string;
	onAnswer: ( label: string ) => void;
	onChooseFreeForm: () => void;
} & Joined ) {
	const optionsId = useId();
	const isFolding = isCollapsing && Boolean( pickedLabel );
	// The stop marker is written by the app, not the user.
	const answered =
		!! pickedLabel && pickedLabel !== STOPPED_WITHOUT_ANSWER && ! isInteractive && ! isFolding;
	const answering = isInteractive && ! isFolding;
	const freeFormLabel = getFreeFormOptionLabel();
	// An off-contract model writes its own escape hatch. Drive the composer from
	// that one rather than appending a second, so either way the user types the
	// answer instead of sending the label back as one.
	const ownFreeFormLabel = answering ? findOwnFreeFormOptionLabel( options ) : undefined;
	const showFreeForm = answering && ! ownFreeFormLabel;
	const viewable = options.filter( ( option ) => option.image );
	const hasImages = viewable.length > 0;
	const [ draft, setDraft ] = useState< { pickedLabel?: string; labels: string[] } | null >( null );
	const [ viewing, setViewing ] = useState< number | null >( null );
	const answeredLabels = multiSelect ? pickedLabel?.split( ', ' ) ?? [] : [ pickedLabel ];
	const pickedLabels = draft && draft.pickedLabel === pickedLabel ? draft.labels : answeredLabels;
	const toggle = ( label: string ) =>
		setDraft( {
			pickedLabel,
			labels: options
				.map( ( option ) => option.label )
				.filter( ( other ) => ( other === label ) !== pickedLabels.includes( other ) ),
		} );
	const choose = ( label: string ) => {
		if ( label === ownFreeFormLabel ) {
			onChooseFreeForm();
		} else if ( multiSelect ) {
			toggle( label );
		} else {
			onAnswer( label );
		}
	};
	// The letter keys pick the options they're lettered with.
	const onKeyDown = useEffectEvent( ( event: KeyboardEvent ) => {
		if (
			! /^[a-z]$/i.test( event.key ) ||
			event.defaultPrevented ||
			event.repeat ||
			event.metaKey ||
			event.ctrlKey ||
			event.altKey ||
			isTextEntry( event.target ) ||
			( event.target instanceof Element &&
				event.target.closest( '[role="dialog"], [role="menu"]' ) )
		) {
			return;
		}
		const index = event.key.toUpperCase().charCodeAt( 0 ) - 65;
		if ( options[ index ] ) {
			choose( options[ index ].label );
		} else if ( showFreeForm && index === options.length ) {
			onChooseFreeForm();
		} else {
			return;
		}
		event.preventDefault();
	} );
	useEffect( () => {
		if ( ! answering ) {
			return;
		}
		document.addEventListener( 'keydown', onKeyDown );
		return () => document.removeEventListener( 'keydown', onKeyDown );
	}, [ answering ] );

	const choice = (
		index: number,
		label: string,
		description: string | undefined,
		picked: boolean,
		{ image, freeForm = false }: { image?: string; freeForm?: boolean } = {}
	) => {
		const descriptionId = description ? `${ optionsId }-option-${ index }-description` : undefined;
		return (
			<button
				type="button"
				className={ clsx( styles.questionChoice, freeForm && styles.questionChoiceFreeForm ) }
				disabled={ ! isInteractive }
				onClick={ freeForm ? onChooseFreeForm : () => choose( label ) }
				aria-label={ label }
				aria-describedby={ descriptionId }
				aria-pressed={ picked }
				data-has-image={ image ? 'true' : undefined }
			>
				{ image ? <QuestionOptionImage path={ image } /> : null }
				{ answering ? (
					<span className={ styles.questionLetter } aria-hidden="true">
						{ String.fromCharCode( 65 + index ) }
					</span>
				) : null }
				<span className={ styles.questionChoiceLabel }>
					<span>{ label }</span>
					{ description ? (
						<span id={ descriptionId } className={ styles.questionChoiceDescription }>
							{ description }
						</span>
					) : null }
				</span>
				{ picked ? <CheckIcon aria-hidden="true" /> : null }
			</button>
		);
	};

	return (
		<div
			className={ styles.questionCard }
			data-state={ isFolding ? 'folding' : undefined }
			{ ...joinedAttributes( joined ) }
		>
			{ progress ? <span className={ styles.questionProgress }>{ progress }</span> : null }
			<p className={ styles.questionText }>{ question }</p>
			{ answered ? (
				<QuestionAnswer
					letter={ multiSelect ? undefined : getAnswerLetter( options, pickedLabel ) }
					label={ pickedLabel }
				/>
			) : (
				<>
					{ multiSelect ? (
						<span className={ styles.questionHint }>{ __( 'Select all that apply.' ) }</span>
					) : null }
					<ol className={ styles.questionChoices } data-layout={ hasImages ? 'grid' : undefined }>
						{ options.map( ( option, index ) => {
							const isOwnFreeForm = option.label === ownFreeFormLabel;
							const picked = isOwnFreeForm ? freeFormActive : pickedLabels.includes( option.label );
							return (
								<li
									key={ index }
									className={ styles.questionChoiceItem }
									data-picked={ picked ? 'true' : undefined }
									data-wide={ hasImages && ! option.image ? 'true' : undefined }
								>
									{ choice(
										index,
										option.label,
										isOwnFreeForm ? getFreeFormOptionDescription() : option.description,
										picked,
										{ image: option.image, freeForm: isOwnFreeForm }
									) }
									{ option.image ? (
										<IconButton
											className={ styles.questionOptionZoom }
											size="icon-2xs"
											icon={ <SearchIcon /> }
											label={ sprintf(
												// translators: %s: name of a design option.
												__( 'View %s larger' ),
												option.label
											) }
											onClick={ () => setViewing( viewable.indexOf( option ) ) }
										/>
									) : null }
								</li>
							);
						} ) }
						{ showFreeForm ? (
							<li
								className={ styles.questionChoiceItem }
								data-picked={ freeFormActive ? 'true' : undefined }
								data-wide={ hasImages ? 'true' : undefined }
							>
								{ choice(
									options.length,
									freeFormLabel,
									getFreeFormOptionDescription(),
									freeFormActive,
									{ freeForm: true }
								) }
							</li>
						) : null }
					</ol>
					{ hasImages ? (
						<QuestionOptionViewer
							options={ viewable }
							index={ viewing }
							onIndexChange={ setViewing }
							onChoose={ isInteractive && ! multiSelect ? onAnswer : undefined }
						/>
					) : null }
					{ multiSelect && isInteractive ? (
						<div>
							<Button
								variant="outline"
								disabled={ pickedLabels.length === 0 }
								onClick={ () => onAnswer( pickedLabels.join( ', ' ) ) }
							>
								{ __( 'Submit choices' ) }
							</Button>
						</div>
					) : null }
				</>
			) }
		</div>
	);
}

function QuestionOptionImage( { path }: { path: string | undefined } ) {
	const localFileQuery = useLocalMediaDataUrl( path ?? null );

	if ( ! path || localFileQuery.isError ) {
		return (
			<span className={ styles.questionOptionImageUnavailable } aria-hidden="true">
				{ path ? __( 'Preview unavailable' ) : null }
			</span>
		);
	}
	if ( ! localFileQuery.data ) {
		return <span className={ styles.questionOptionImageLoading } aria-hidden="true" />;
	}
	return <img className={ styles.questionOptionImage } src={ localFileQuery.data } alt="" />;
}
