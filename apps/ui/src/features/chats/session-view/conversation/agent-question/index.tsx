import { useReducedMotion } from '@wordpress/compose';
import { __, sprintf } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useEffect, useRef, useState } from 'react';
import {
	AgentQuestion,
	getAnswerLetter,
	QuestionAnswer,
} from '@/features/chats/session-view/conversation/agent-question/agent-question';
import { scrollElementIntoViewIfNeeded } from '@/features/chats/session-view/conversation/agent-question/scroll-into-view';
import { joinedAttributes, type Joined } from '@/features/chats/session-view/conversation/joined';
import styles from './style.module.css';
import type { AgentQuestionRenderItem } from '@/features/chats/session-view/conversation/transcript-items';

const QUESTION_COLLAPSE_DELAY_MS = 650;

function getQuestionPickedLabel(
	question: AgentQuestionRenderItem,
	pendingAnswers: Record< string, string >
): string | undefined {
	return pendingAnswers[ question.question ] ?? question.pickedLabel;
}

function findFirstUnansweredQuestionIndex(
	questions: AgentQuestionRenderItem[],
	pendingQuestions: Set< string >,
	pendingAnswers: Record< string, string >
): number {
	for ( let index = 0; index < questions.length; index += 1 ) {
		const question = questions[ index ];
		const pickedLabel = getQuestionPickedLabel( question, pendingAnswers );
		if ( pendingQuestions.has( question.question ) && ! pickedLabel ) {
			return index;
		}
	}
	return -1;
}

function QuestionSummary( {
	index,
	total,
	question,
	options,
	pickedLabel,
	canEdit,
	onClick,
	...joined
}: {
	index: number;
	total: number;
	question: string;
	options: AgentQuestionRenderItem[ 'options' ];
	pickedLabel: string;
	canEdit: boolean;
	onClick: () => void;
} & Joined ) {
	const content = (
		<>
			<span className={ styles.questionText }>{ question }</span>
			<QuestionAnswer letter={ getAnswerLetter( options, pickedLabel ) } label={ pickedLabel } />
		</>
	);

	if ( ! canEdit ) {
		return (
			<div className={ styles.questionCard } { ...joinedAttributes( joined ) }>
				{ content }
			</div>
		);
	}

	return (
		<button
			type="button"
			className={ clsx( styles.questionCard, styles.questionSummary ) }
			{ ...joinedAttributes( joined ) }
			onClick={ onClick }
			aria-label={ sprintf(
				__( 'Edit question %1$d of %2$d: %3$s. Selected answer: %4$s' ),
				index + 1,
				total,
				question,
				pickedLabel
			) }
		>
			{ content }
		</button>
	);
}

export function AgentQuestionBatch( {
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
	const [ expandedIndex, setExpandedIndex ] = useState< number | null >( null );
	const [ settlingIndex, setSettlingIndex ] = useState< number | null >( null );
	const prefersReducedMotion = useReducedMotion();
	const activeQuestionRef = useRef< HTMLDivElement | null >( null );
	const shouldFocusActiveQuestionRef = useRef( false );
	const total = questions.length;
	const firstUnansweredIndex = findFirstUnansweredQuestionIndex(
		questions,
		pendingQuestions,
		pendingAnswers
	);
	const activeIndex = settlingIndex ?? expandedIndex ?? firstUnansweredIndex;
	const visibleQuestionCount = activeIndex === -1 ? total : Math.min( activeIndex + 1, total );

	useEffect( () => {
		setExpandedIndex( ( index ) =>
			index === null || index < total ? index : Math.max( total - 1, 0 )
		);
		setSettlingIndex( ( index ) =>
			index === null || index < total ? index : Math.max( total - 1, 0 )
		);
	}, [ total ] );

	useEffect( () => {
		if ( settlingIndex === null ) {
			return;
		}
		if ( prefersReducedMotion ) {
			setSettlingIndex( null );
			return;
		}
		const timeoutId = window.setTimeout(
			() => setSettlingIndex( null ),
			QUESTION_COLLAPSE_DELAY_MS
		);
		return () => window.clearTimeout( timeoutId );
	}, [ prefersReducedMotion, settlingIndex ] );

	useEffect( () => {
		if ( activeIndex === -1 || settlingIndex !== null ) {
			if ( activeIndex === -1 && settlingIndex === null ) {
				shouldFocusActiveQuestionRef.current = false;
			}
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
	}, [ activeIndex, prefersReducedMotion, settlingIndex ] );

	if ( total === 0 ) {
		return null;
	}

	if ( total === 1 ) {
		const question = questions[ 0 ];
		// The scroll-into-view effect needs a target here too, or a lone question
		// stays half-hidden behind the composer when the agent asks it.
		return (
			<div
				ref={ activeIndex === 0 ? activeQuestionRef : undefined }
				{ ...joinedAttributes( { joinedAbove, joinedBelow } ) }
			>
				<AgentQuestion
					question={ question.question }
					options={ question.options }
					multiSelect={ question.multiSelect }
					isInteractive={ pendingQuestions.has( question.question ) }
					pickedLabel={ getQuestionPickedLabel( question, pendingAnswers ) }
					freeFormActive={ freeFormQuestion === question.question }
					onAnswer={ ( label ) => onAnswer( question.question, label ) }
					onChooseFreeForm={ () => onChooseFreeForm( question.question ) }
					joinedAbove={ joinedAbove }
					joinedBelow={ joinedBelow }
				/>
			</div>
		);
	}

	const handleAnswer = ( question: AgentQuestionRenderItem, index: number, label: string ) => {
		shouldFocusActiveQuestionRef.current = true;
		setExpandedIndex( null );
		setSettlingIndex( index );
		onAnswer( question.question, label );
	};

	return (
		<div className={ styles.questionBatch } { ...joinedAttributes( { joinedAbove, joinedBelow } ) }>
			{ questions.slice( 0, visibleQuestionCount ).map( ( question, index ) => {
				const pickedLabel = getQuestionPickedLabel( question, pendingAnswers );
				const isActive = index === activeIndex;
				const joined = {
					joinedAbove: joinedAbove || index > 0,
					joinedBelow: joinedBelow || index < visibleQuestionCount - 1,
				};
				if ( ! isActive && pickedLabel ) {
					return (
						<QuestionSummary
							key={ question.key }
							index={ index }
							total={ total }
							question={ question.question }
							options={ question.options }
							pickedLabel={ pickedLabel }
							canEdit={ pendingQuestions.has( question.question ) }
							onClick={ () => setExpandedIndex( index ) }
							{ ...joined }
						/>
					);
				}
				return (
					<div
						key={ question.key }
						ref={ isActive ? activeQuestionRef : undefined }
						className={ styles.questionBatchStep }
						data-state={ settlingIndex === index ? 'answered' : 'asking' }
						tabIndex={ isActive ? -1 : undefined }
						aria-label={
							isActive ? sprintf( __( 'Current question: %s' ), question.question ) : undefined
						}
					>
						<AgentQuestion
							progress={ sprintf( __( 'Asking question %1$d of %2$d' ), index + 1, total ) }
							question={ question.question }
							options={ question.options }
							multiSelect={ question.multiSelect }
							isInteractive={ pendingQuestions.has( question.question ) && settlingIndex !== index }
							pickedLabel={ pickedLabel }
							isCollapsing={ settlingIndex === index }
							freeFormActive={ freeFormQuestion === question.question }
							onAnswer={ ( label ) => handleAnswer( question, index, label ) }
							onChooseFreeForm={ () => onChooseFreeForm( question.question ) }
							{ ...joined }
						/>
					</div>
				);
			} ) }
		</div>
	);
}
