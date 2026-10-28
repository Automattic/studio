import { SKIPPED_QUESTION, STOPPED_WITHOUT_ANSWER } from '@studio/common/ai/tools';
import { __, sprintf } from '@wordpress/i18n';
import { memo, useEffect, useRef, useState } from 'react';
import { AgentQuestion } from '@/features/chats/session-view/conversation/agent-question/agent-question';
import { scrollElementIntoViewIfNeeded } from '@/features/chats/session-view/conversation/agent-question/scroll-into-view';
import { joinedAttributes, type Joined } from '@/features/chats/session-view/conversation/joined';
import { useReducedMotion } from '@/lib/hooks';
import styles from './style.module.css';
import type { AgentQuestionRenderItem } from '@/features/chats/session-view/conversation/transcript-items';

export const AgentQuestionBatch = memo( function AgentQuestionBatch( {
	questions,
	pendingQuestions,
	pendingAnswers,
	freeFormQuestion,
	onAnswer,
	onChooseFreeForm,
	joinedAbove,
	joinedBelow,
}: {
	questions: AgentQuestionRenderItem[];
	pendingQuestions: Set< string >;
	pendingAnswers: Record< string, string >;
	freeFormQuestion: string | null;
	onAnswer: ( question: string, label: string ) => void;
	onChooseFreeForm: ( question: string ) => void;
} & Joined ) {
	const [ page, setPage ] = useState< number | null >( null );
	const [ drafts, setDrafts ] = useState< Record< string, string[] > >( {} );
	const prefersReducedMotion = useReducedMotion();
	const activeQuestionRef = useRef< HTMLFieldSetElement | null >( null );
	const shouldFocusActiveQuestionRef = useRef( false );
	const pickedLabel = ( question: AgentQuestionRenderItem ) =>
		pendingAnswers[ question.question ] ?? question.pickedLabel;
	const unanswered = questions
		.map( ( question, index ) =>
			pendingQuestions.has( question.question ) && ! pendingAnswers[ question.question ]
				? index
				: -1
		)
		.filter( ( index ) => index !== -1 );
	const isActive = unanswered.length > 0;
	const activeIndex = isActive ? Math.min( page ?? unanswered[ 0 ], questions.length - 1 ) : -1;

	useEffect( () => {
		if ( activeIndex === -1 ) {
			shouldFocusActiveQuestionRef.current = false;
			return;
		}
		const animationFrameId = window.requestAnimationFrame( () => {
			const element = activeQuestionRef.current;
			if ( element ) {
				scrollElementIntoViewIfNeeded( element, prefersReducedMotion );
				if ( shouldFocusActiveQuestionRef.current ) {
					element.focus( { preventScroll: true } );
					shouldFocusActiveQuestionRef.current = false;
				}
			}
		} );
		return () => window.cancelAnimationFrame( animationFrameId );
	}, [ activeIndex, prefersReducedMotion ] );

	if ( ! isActive ) {
		return (
			<div
				className={ styles.questionBatch }
				{ ...joinedAttributes( { joinedAbove, joinedBelow } ) }
			>
				{ questions.map( ( question, index ) => (
					<AgentQuestion
						key={ question.key }
						question={ question.question }
						options={ question.options }
						multiSelect={ question.multiSelect }
						isInteractive={ false }
						pickedLabel={ pickedLabel( question ) }
						onChooseFreeForm={ () => onChooseFreeForm( question.question ) }
						joinedAbove={ joinedAbove || index > 0 }
						joinedBelow={ joinedBelow || index < questions.length - 1 }
					/>
				) ) }
			</div>
		);
	}

	const question = questions[ activeIndex ];
	const saved = pickedLabel( question );
	const selection =
		drafts[ question.key ] ??
		( ! saved || saved === SKIPPED_QUESTION || saved === STOPPED_WITHOUT_ANSWER
			? []
			: question.multiSelect
			? saved.split( ', ' )
			: [ saved ] );
	const isLastQuestion = activeIndex === questions.length - 1;
	const goToPage = ( index: number ) => {
		shouldFocusActiveQuestionRef.current = true;
		setPage( index );
	};
	const submit = ( answer: string ) => {
		setDrafts( ( previous ) => {
			const next = { ...previous };
			delete next[ question.key ];
			return next;
		} );
		onAnswer( question.question, answer );
		if ( ! isLastQuestion ) goToPage( activeIndex + 1 );
	};

	return (
		<AgentQuestion
			key={ question.key }
			ref={ activeQuestionRef }
			tabIndex={ -1 }
			question={ question.question }
			options={ question.options }
			multiSelect={ question.multiSelect }
			isInteractive
			pickedLabel={ saved }
			selectedLabels={ selection }
			onSelectionChange={ ( labels ) => {
				if ( ! question.multiSelect && labels.length ) {
					submit( labels[ 0 ] );
				} else {
					setDrafts( ( previous ) => ( { ...previous, [ question.key ]: labels } ) );
				}
			} }
			freeFormActive={ freeFormQuestion === question.question }
			onChooseFreeForm={ () => onChooseFreeForm( question.question ) }
			onAnswer={ () => submit( selection.length ? selection.join( ', ' ) : SKIPPED_QUESTION ) }
			onSkip={ () => submit( SKIPPED_QUESTION ) }
			onBack={ activeIndex > 0 ? () => goToPage( activeIndex - 1 ) : undefined }
			submitLabel={ isLastQuestion ? __( 'Done' ) : __( 'Next' ) }
			pager={
				questions.length > 1 ? (
					<div
						className={ styles.questionPager }
						role="img"
						aria-label={ sprintf(
							__( 'Question %1$d of %2$d' ),
							activeIndex + 1,
							questions.length
						) }
					>
						{ questions.map( ( item, index ) => (
							<span
								key={ item.key }
								className={ styles.questionDot }
								data-current={ index === activeIndex || undefined }
								aria-hidden="true"
							/>
						) ) }
					</div>
				) : null
			}
			joinedAbove={ joinedAbove }
			joinedBelow={ joinedBelow }
		/>
	);
} );
