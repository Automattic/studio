import {
	findOwnFreeFormOptionLabel,
	getFreeFormOptionDescription,
	getFreeFormOptionLabel,
	STOPPED_WITHOUT_ANSWER,
} from '@studio/common/ai/tools';
import { __, sprintf } from '@wordpress/i18n';
import { SearchIcon } from 'lucide-react';
import { useState, type Ref } from 'react';
import { useLocalMediaDataUrl } from '@/data/queries/use-local-media';
import { QuestionOptionViewer } from '@/features/chats/session-view/conversation/agent-question/option-viewer';
import { joinedAttributes, type Joined } from '@/features/chats/session-view/conversation/joined';
import {
	Button,
	IconButton,
	Questionnaire,
	QuestionnaireAnswer,
	QuestionnaireChoice,
	QuestionnaireChoices,
	QuestionnaireDescription,
	QuestionnaireProgress,
	QuestionnaireTitle,
} from '@/lib/ui';
import styles from './style.module.css';
import type { AgentQuestionRenderItem } from '@/features/chats/session-view/conversation/transcript-items';

export function getAnswerLetter(
	options: AgentQuestionRenderItem[ 'options' ],
	pickedLabel: string
): string | undefined {
	const index = options.findIndex( ( option ) => option.label === pickedLabel );
	return index < 0 ? undefined : String.fromCharCode( 65 + index );
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
	ref,
	tabIndex,
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
	ref?: Ref< HTMLFieldSetElement >;
	tabIndex?: number;
} & Joined ) {
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
	const letter = ( index: number ) => ( answering ? String.fromCharCode( 65 + index ) : undefined );

	return (
		<div
			className={ styles.questionCard }
			data-state={ isFolding ? 'folding' : undefined }
			{ ...joinedAttributes( joined ) }
		>
			{ progress ? (
				<QuestionnaireProgress className={ styles.questionProgress }>
					{ progress }
				</QuestionnaireProgress>
			) : null }
			<Questionnaire
				ref={ ref }
				tabIndex={ tabIndex }
				multiple={ multiSelect }
				shortcuts={ answering }
				className={ styles.questionnaire }
			>
				<QuestionnaireTitle>{ question }</QuestionnaireTitle>
				{ answered ? (
					<QuestionnaireAnswer
						className={ styles.pickedAnswer }
						letter={ multiSelect ? undefined : getAnswerLetter( options, pickedLabel ) }
					>
						{ pickedLabel }
					</QuestionnaireAnswer>
				) : (
					<>
						{ multiSelect ? (
							<QuestionnaireDescription>
								{ __( 'Select all that apply.' ) }
							</QuestionnaireDescription>
						) : null }
						<QuestionnaireChoices layout={ hasImages ? 'grid' : 'list' }>
							{ options.map( ( option, index ) => {
								const isOwnFreeForm = option.label === ownFreeFormLabel;
								return (
									<QuestionnaireChoice
										key={ index }
										className={ styles.choice }
										label={ option.label }
										description={
											isOwnFreeForm ? getFreeFormOptionDescription() : option.description
										}
										shortcut={ letter( index ) }
										checked={
											isOwnFreeForm ? freeFormActive : pickedLabels.includes( option.label )
										}
										disabled={ ! isInteractive }
										muted={ isOwnFreeForm }
										wide={ hasImages && ! option.image }
										media={ option.image ? <QuestionOptionImage path={ option.image } /> : null }
										action={
											option.image ? (
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
											) : null
										}
										onSelect={ () => choose( option.label ) }
									/>
								);
							} ) }
							{ showFreeForm ? (
								<QuestionnaireChoice
									label={ freeFormLabel }
									description={ getFreeFormOptionDescription() }
									shortcut={ letter( options.length ) }
									checked={ freeFormActive }
									disabled={ ! isInteractive }
									muted
									wide={ hasImages }
									onSelect={ onChooseFreeForm }
								/>
							) : null }
						</QuestionnaireChoices>
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
			</Questionnaire>
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
