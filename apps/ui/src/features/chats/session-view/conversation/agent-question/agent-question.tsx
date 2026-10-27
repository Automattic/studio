import {
	findOwnFreeFormOptionLabel,
	getFreeFormOptionDescription,
	SKIPPED_QUESTION,
	STOPPED_WITHOUT_ANSWER,
} from '@studio/common/ai/tools';
import { __, sprintf } from '@wordpress/i18n';
import { SearchIcon } from 'lucide-react';
import { useState, type ReactNode, type Ref } from 'react';
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
	QuestionnaireTitle,
} from '@/lib/ui';
import styles from './style.module.css';
import type { AgentQuestionRenderItem } from '@/features/chats/session-view/conversation/transcript-items';

function getAnswerLetter(
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
	selectedLabels = [],
	onSelectionChange,
	onSkip,
	onBack,
	pager,
	submitLabel,
	freeFormActive = false,
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
	selectedLabels?: string[];
	onSelectionChange?: ( labels: string[] ) => void;
	onSkip?: () => void;
	onBack?: () => void;
	pager?: ReactNode;
	submitLabel?: string;
	freeFormActive?: boolean;
	onAnswer?: () => void;
	onChooseFreeForm: () => void;
	ref?: Ref< HTMLFieldSetElement >;
	tabIndex?: number;
} & Joined ) {
	const answered =
		!! pickedLabel &&
		pickedLabel !== STOPPED_WITHOUT_ANSWER &&
		pickedLabel !== SKIPPED_QUESTION &&
		! isInteractive;
	const inactive = ! isInteractive && ! answered;
	const exactAnswer = options.find( ( option ) => option.label === pickedLabel );
	const selectedOptions = exactAnswer
		? [ exactAnswer ]
		: multiSelect
		? options.filter( ( option ) => pickedLabel?.split( ', ' ).includes( option.label ) )
		: [];
	const answerOptions =
		selectedOptions.map( ( option ) => option.label ).join( ', ' ) === pickedLabel
			? selectedOptions
			: [];
	const ownFreeFormLabel = findOwnFreeFormOptionLabel( options );
	const viewable = options.filter( ( option ) => option.image );
	const hasImages = viewable.length > 0;
	const [ viewing, setViewing ] = useState< number | null >( null );
	const choose = ( label: string ) => {
		if ( label === ownFreeFormLabel ) {
			onSelectionChange?.( [] );
			onChooseFreeForm();
		} else {
			onSelectionChange?.(
				multiSelect
					? options
							.map( ( option ) => option.label )
							.filter( ( other ) => ( other === label ) !== selectedLabels.includes( other ) )
					: [ label ]
			);
		}
	};
	const letter = ( index: number ) => String.fromCharCode( 65 + index );

	return (
		<div
			className={ styles.questionCard }
			data-state={ inactive ? 'inactive' : undefined }
			{ ...joinedAttributes( joined ) }
		>
			<Questionnaire
				ref={ ref }
				tabIndex={ tabIndex }
				multiple={ multiSelect }
				shortcuts={ isInteractive }
				disabled={ inactive }
				className={ styles.questionnaire }
			>
				<QuestionnaireTitle>{ question }</QuestionnaireTitle>
				{ answered ? (
					answerOptions.length ? (
						<QuestionnaireChoices>
							{ answerOptions.map( ( option ) => (
								<QuestionnaireAnswer
									key={ option.label }
									letter={ getAnswerLetter( options, option.label ) }
									description={ option.description }
								>
									{ option.label }
								</QuestionnaireAnswer>
							) ) }
						</QuestionnaireChoices>
					) : (
						<QuestionnaireAnswer>{ pickedLabel }</QuestionnaireAnswer>
					)
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
										label={ option.label }
										description={
											isOwnFreeForm ? getFreeFormOptionDescription() : option.description
										}
										shortcut={ letter( index ) }
										checked={
											isOwnFreeForm
												? freeFormActive && selectedLabels.length === 0
												: selectedLabels.includes( option.label )
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
						</QuestionnaireChoices>
						{ hasImages ? (
							<QuestionOptionViewer
								options={ viewable }
								index={ viewing }
								onIndexChange={ setViewing }
								onChoose={ isInteractive && ! multiSelect ? choose : undefined }
							/>
						) : null }
					</>
				) }
				{ isInteractive ? (
					<div className={ styles.questionFooter }>
						{ pager }
						<div className={ styles.questionActions }>
							{ onBack ? (
								<Button variant="outline" onClick={ onBack }>
									{ __( 'Back' ) }
								</Button>
							) : null }
							<Button variant="outline" onClick={ onSkip }>
								{ __( 'Skip' ) }
							</Button>
							<Button onClick={ onAnswer }>{ submitLabel }</Button>
						</div>
					</div>
				) : null }
			</Questionnaire>
		</div>
	);
}

function QuestionOptionImage( { path }: { path: string } ) {
	const localFileQuery = useLocalMediaDataUrl( path );

	if ( localFileQuery.isError ) {
		return (
			<span className={ styles.questionOptionImageUnavailable } aria-hidden="true">
				{ __( 'Preview unavailable' ) }
			</span>
		);
	}
	if ( ! localFileQuery.data ) {
		return <span className={ styles.questionOptionImageLoading } aria-hidden="true" />;
	}
	return <img className={ styles.questionOptionImage } src={ localFileQuery.data } alt="" />;
}
