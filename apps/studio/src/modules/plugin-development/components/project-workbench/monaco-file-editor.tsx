import { __, sprintf } from '@wordpress/i18n';
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type MouseEvent as ReactMouseEvent,
} from 'react';
import { cx } from 'src/lib/cx';
import workbenchStyles from '../development-workbench.module.css';
import {
	CODE_EDITOR_FONT_FAMILY,
	EMPTY_AI_PATCH_HUNKS,
	EMPTY_VALIDATION_FINDINGS,
	getAiPatchLineMap,
	getValidationLineMap,
	offsetForLineColumn,
	renderFallbackEditorHtml,
	renderMonacoEditorHtml,
	type AiPatchLineMapSide,
	type ValidationHoverState,
} from './monaco-highlighting';
import type { DiffHunk, EditorRevealRequest } from './types';
import type { DevelopmentProjectValidationFinding } from '@studio/common/types/publishing';

export function MonacoFileEditor( {
	disabled,
	isLoading,
	onChange,
	onSave,
	path,
	revealRequest,
	aiPatchSide = 'after',
	aiPatchHunks = EMPTY_AI_PATCH_HUNKS,
	validationFindings = EMPTY_VALIDATION_FINDINGS,
	value,
}: {
	disabled: boolean;
	isLoading: boolean;
	onChange: ( value: string ) => void;
	onSave: () => void;
	path: string | null;
	revealRequest: EditorRevealRequest | null;
	aiPatchSide?: AiPatchLineMapSide;
	aiPatchHunks?: DiffHunk[];
	validationFindings?: DevelopmentProjectValidationFinding[];
	value: string;
} ) {
	const textareaRef = useRef< HTMLTextAreaElement | null >( null );
	const highlightedRef = useRef< HTMLPreElement | null >( null );
	const lineNumbersRef = useRef< HTMLDivElement | null >( null );
	const contentRef = useRef< HTMLDivElement | null >( null );
	const [ highlightedHtml, setHighlightedHtml ] = useState( () =>
		renderFallbackEditorHtml(
			value,
			path,
			getValidationLineMap( validationFindings ),
			getAiPatchLineMap( aiPatchHunks, aiPatchSide )
		)
	);
	const validationLineMap = useMemo(
		() => getValidationLineMap( validationFindings ),
		[ validationFindings ]
	);
	const aiPatchLineMap = useMemo(
		() => getAiPatchLineMap( aiPatchHunks, aiPatchSide ),
		[ aiPatchHunks, aiPatchSide ]
	);
	const lineNumbers = useMemo(
		() =>
			Array.from(
				{ length: Math.max( 1, value.split( '\n' ).length ) },
				( _, index ) => index + 1
			),
		[ value ]
	);
	const [ validationHover, setValidationHover ] = useState< ValidationHoverState | null >( null );
	const isReadOnly = disabled || isLoading;
	const syncScroll = useCallback( () => {
		const textarea = textareaRef.current;
		if ( ! textarea ) {
			return;
		}
		if ( highlightedRef.current ) {
			highlightedRef.current.scrollTop = textarea.scrollTop;
			highlightedRef.current.scrollLeft = textarea.scrollLeft;
		}
		if ( lineNumbersRef.current ) {
			lineNumbersRef.current.scrollTop = textarea.scrollTop;
		}
		setValidationHover( null );
	}, [] );
	const handleValidationHover = useCallback(
		( event: ReactMouseEvent< HTMLElement > ) => {
			const textarea = textareaRef.current;
			const content = contentRef.current;
			if ( ! textarea || ! content ) {
				setValidationHover( null );
				return;
			}

			const lineHeight = 20;
			const paddingTop = 12;
			const textareaRect = textarea.getBoundingClientRect();
			const relativeY = event.clientY - textareaRect.top + textarea.scrollTop - paddingTop;
			const line = Math.floor( relativeY / lineHeight ) + 1;
			const metadata = validationLineMap.get( line );
			if ( ! metadata ) {
				setValidationHover( null );
				return;
			}

			const contentRect = content.getBoundingClientRect();
			const tooltipWidth = Math.min( 360, Math.max( 240, contentRect.width - 24 ) );
			const x = Math.min(
				Math.max( 12, event.clientX - contentRect.left + 14 ),
				Math.max( 12, contentRect.width - tooltipWidth - 12 )
			);
			const y = Math.min(
				Math.max( 12, event.clientY - contentRect.top + 14 ),
				Math.max( 12, contentRect.height - 104 )
			);

			setValidationHover( {
				...metadata,
				line,
				x,
				y,
			} );
		},
		[ validationLineMap ]
	);

	useEffect( () => {
		let isCancelled = false;
		setHighlightedHtml(
			renderFallbackEditorHtml( value, path, validationLineMap, aiPatchLineMap )
		);

		void renderMonacoEditorHtml( value, path, validationLineMap, aiPatchLineMap )
			.then( ( html ) => {
				if ( ! isCancelled ) {
					setHighlightedHtml( html );
				}
			} )
			.catch( () => {
				if ( ! isCancelled ) {
					setHighlightedHtml(
						renderFallbackEditorHtml( value, path, validationLineMap, aiPatchLineMap )
					);
				}
			} );

		return () => {
			isCancelled = true;
		};
	}, [ aiPatchLineMap, path, validationLineMap, value ] );

	useEffect( () => {
		const textarea = textareaRef.current;
		if ( ! textarea || ! revealRequest || revealRequest.path !== path || isLoading ) {
			return;
		}

		const offset = offsetForLineColumn( value, revealRequest.line, revealRequest.column );
		textarea.focus();
		textarea.setSelectionRange( offset, offset );
		const lineHeight = 20;
		textarea.scrollTop = Math.max( 0, ( revealRequest.line - 3 ) * lineHeight );
		syncScroll();
	}, [ isLoading, path, revealRequest, syncScroll, value ] );

	return (
		<div className={ workbenchStyles.monacoEditorShell }>
			<div ref={ lineNumbersRef } className={ workbenchStyles.codeEditorLineNumbers }>
				{ lineNumbers.map( ( lineNumber ) => {
					const metadata = validationLineMap.get( lineNumber );
					const aiPatchMetadata = aiPatchLineMap.get( lineNumber );
					return (
						<span
							key={ lineNumber }
							className={ cx(
								metadata && workbenchStyles.codeEditorLineNumberWithFinding,
								metadata?.severity === 'error' && workbenchStyles.codeEditorLineNumberError,
								metadata?.severity === 'warning' && workbenchStyles.codeEditorLineNumberWarning,
								metadata?.severity === 'info' && workbenchStyles.codeEditorLineNumberInfo,
								aiPatchMetadata && workbenchStyles.codeEditorLineNumberWithPatch,
								aiPatchMetadata?.type === 'add' && workbenchStyles.codeEditorLineNumberPatchAdd,
								aiPatchMetadata?.type === 'delete' &&
									workbenchStyles.codeEditorLineNumberPatchDelete
							) }
							title={ metadata?.message }
						>
							{ lineNumber }
						</span>
					);
				} ) }
			</div>
			<div
				ref={ contentRef }
				className={ workbenchStyles.codeEditorContent }
				onMouseMove={ handleValidationHover }
				onMouseLeave={ () => setValidationHover( null ) }
			>
				<pre
					ref={ highlightedRef }
					aria-hidden="true"
					className={ workbenchStyles.codeEditorHighlight }
					style={ { fontFamily: CODE_EDITOR_FONT_FAMILY } }
					dangerouslySetInnerHTML={ { __html: highlightedHtml } }
				/>
				<textarea
					ref={ textareaRef }
					aria-label={ path || __( 'Plugin file editor' ) }
					className={ workbenchStyles.codeEditorTextarea }
					disabled={ isReadOnly }
					spellCheck={ false }
					style={ { fontFamily: CODE_EDITOR_FONT_FAMILY } }
					value={ value }
					onChange={ ( event ) => onChange( event.currentTarget.value ) }
					onKeyDown={ ( event ) => {
						if ( ( event.metaKey || event.ctrlKey ) && event.key.toLowerCase() === 's' ) {
							event.preventDefault();
							onSave();
						}
					} }
					onScroll={ syncScroll }
				/>
				{ validationHover && (
					<div
						className={ cx(
							workbenchStyles.codeEditorHover,
							validationHover.severity === 'error' && workbenchStyles.codeEditorHoverError,
							validationHover.severity === 'warning' && workbenchStyles.codeEditorHoverWarning,
							validationHover.severity === 'info' && workbenchStyles.codeEditorHoverInfo
						) }
						style={ {
							left: validationHover.x,
							top: validationHover.y,
						} }
					>
						<strong>
							{ sprintf(
								// translators: %d is a source-code line number.
								__( 'Line %d' ),
								validationHover.line
							) }
						</strong>
						{ validationHover.message.split( '\n' ).map( ( message, index ) => (
							<span key={ `${ index }:${ message }` }>{ message }</span>
						) ) }
					</div>
				) }
				{ isLoading && (
					<div className={ workbenchStyles.monacoEditorOverlay }>{ __( 'Loading file…' ) }</div>
				) }
			</div>
		</div>
	);
}
