import { clsx } from 'clsx';
import { createContext, useContext, useId, type ComponentProps, type ReactNode } from 'react';
import styles from './style.module.css';

const QuestionnaireContext = createContext( { name: '', multiple: false } );

const ARROW_STEPS: Record< string, number > = {
	ArrowDown: 1,
	ArrowRight: 1,
	ArrowUp: -1,
	ArrowLeft: -1,
};

/**
 * One question as a fieldset, answered with native radios, or checkboxes when
 * `multiple`. Arrow keys move between the choices without picking one. With
 * `shortcuts`, a letter key pressed inside the question picks the choice
 * lettered with it.
 */
export function Questionnaire( {
	multiple = false,
	shortcuts = false,
	className,
	onKeyDown,
	...props
}: ComponentProps< 'fieldset' > & { multiple?: boolean; shortcuts?: boolean } ) {
	const name = useId();
	return (
		<QuestionnaireContext.Provider value={ { name, multiple } }>
			<fieldset
				data-slot="questionnaire"
				className={ clsx( styles.questionnaire, className ) }
				onKeyDown={ ( event ) => {
					onKeyDown?.( event );
					const root = event.currentTarget;
					// Portalled popups, like an image viewer, bubble here through React.
					if (
						root.disabled ||
						event.defaultPrevented ||
						! root.contains( event.target as Node )
					) {
						return;
					}
					const inputs = [ ...root.querySelectorAll( 'input' ) ].filter(
						( input ) => input.name === name && ! input.disabled
					);
					const index = inputs.indexOf( event.target as HTMLInputElement );
					const step = ARROW_STEPS[ event.key ];
					if ( index >= 0 && step ) {
						event.preventDefault();
						inputs[ ( index + step + inputs.length ) % inputs.length ].focus();
						return;
					}
					if (
						! shortcuts ||
						event.repeat ||
						event.metaKey ||
						event.ctrlKey ||
						event.altKey ||
						! /^[a-z]$/i.test( event.key )
					) {
						return;
					}
					const key = event.key.toUpperCase();
					const input = inputs.find(
						( candidate ) => candidate.getAttribute( 'aria-keyshortcuts' ) === key
					);
					if ( input ) {
						event.preventDefault();
						input.click();
					}
				} }
				{ ...props }
			/>
		</QuestionnaireContext.Provider>
	);
}

/** The question. A legend, so it names the fieldset. */
export function QuestionnaireTitle( { className, ...props }: ComponentProps< 'legend' > ) {
	return <legend className={ clsx( styles.title, className ) } { ...props } />;
}

export function QuestionnaireDescription( { className, ...props }: ComponentProps< 'span' > ) {
	return <span className={ clsx( styles.description, className ) } { ...props } />;
}

export function QuestionnaireChoices( {
	layout = 'list',
	className,
	...props
}: ComponentProps< 'div' > & { layout?: 'list' | 'grid' } ) {
	return (
		<div
			data-layout={ layout === 'list' ? undefined : layout }
			className={ clsx( styles.choices, className ) }
			{ ...props }
		/>
	);
}

function Letter( { children }: { children: ReactNode } ) {
	return (
		<span className={ styles.letter } aria-hidden="true">
			{ children }
		</span>
	);
}

export function QuestionnaireChoice( {
	label,
	description,
	shortcut,
	checked,
	disabled,
	muted = false,
	wide = false,
	media,
	action,
	className,
	onSelect,
}: {
	label: string;
	description?: ReactNode;
	/** A letter, shown before the label, that picks this choice while the questionnaire takes shortcuts. */
	shortcut?: string;
	checked: boolean;
	disabled?: boolean;
	muted?: boolean;
	/** Spans every column of a grid. */
	wide?: boolean;
	/** An image above the label. */
	media?: ReactNode;
	/** A control beside the choice rather than inside its label, like a zoom button. */
	action?: ReactNode;
	className?: string;
	onSelect: () => void;
} ) {
	const { name, multiple } = useContext( QuestionnaireContext );
	const id = useId();
	return (
		<div
			data-slot="questionnaire-choice"
			data-checked={ checked || undefined }
			data-wide={ wide || undefined }
			className={ clsx( styles.item, className ) }
		>
			<label
				className={ styles.choice }
				data-muted={ muted || undefined }
				data-media={ media ? true : undefined }
			>
				<input
					type={ multiple ? 'checkbox' : 'radio' }
					name={ name }
					className={ styles.input }
					checked={ checked }
					disabled={ disabled }
					aria-labelledby={ `${ id }-label` }
					aria-describedby={ description ? `${ id }-description` : undefined }
					aria-keyshortcuts={ disabled ? undefined : shortcut }
					onChange={ onSelect }
					// A checked radio fires no change event, yet picking it again still answers.
					onClick={ ! multiple && checked ? onSelect : undefined }
				/>
				{ media }
				{ shortcut ? <Letter>{ shortcut }</Letter> : null }
				<span className={ styles.label }>
					<span id={ `${ id }-label` }>{ label }</span>
					{ description ? (
						<span id={ `${ id }-description` } className={ styles.description }>
							{ description }
						</span>
					) : null }
				</span>
			</label>
			{ action }
		</div>
	);
}

/** An answered question's pick, in place of its choices. */
export function QuestionnaireAnswer( {
	letter,
	description,
	children,
	className,
}: {
	letter?: string;
	description?: string;
	children: ReactNode;
	className?: string;
} ) {
	return (
		<span data-slot="questionnaire-answer" className={ clsx( styles.answer, className ) }>
			{ letter ? <Letter>{ letter }</Letter> : null }
			<span className={ clsx( styles.label, styles.answerLabel ) }>
				<span>{ children }</span>
				{ description ? <span className={ styles.description }>{ description }</span> : null }
			</span>
		</span>
	);
}
