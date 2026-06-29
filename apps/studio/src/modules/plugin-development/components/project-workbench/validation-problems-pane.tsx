import { decodeHtmlEntities } from '@studio/common/lib/html-entities';
import { __ } from '@wordpress/i18n';
import { check } from '@wordpress/icons';
import Button from 'src/components/button';
import { cx } from 'src/lib/cx';
import workbenchStyles from '../development-workbench.module.css';
import { formatValidationSummary } from './utils';
import type {
	DevelopmentProjectValidationFinding,
	DevelopmentProjectValidationResult,
} from '@studio/common/types/publishing';

type ValidationProblemsPaneProps = {
	validationResult: DevelopmentProjectValidationResult | null;
	isBlocked: boolean;
	isValidatingProject: boolean;
	onRunValidation: () => void;
	onOpenFinding: ( finding: DevelopmentProjectValidationFinding ) => void;
};

export function ValidationProblemsPane( {
	validationResult,
	isBlocked,
	isValidatingProject,
	onRunValidation,
	onOpenFinding,
}: ValidationProblemsPaneProps ) {
	if ( ! validationResult ) {
		return null;
	}

	return (
		<section
			className={ workbenchStyles.editorProblemsPane }
			aria-label={ __( 'Validation results' ) }
		>
			<div className={ workbenchStyles.editorProblemsHeader }>
				<div>
					<strong>{ __( 'Validation' ) }</strong>
					<span>{ formatValidationSummary( validationResult.summary ) }</span>
				</div>
				<Button
					variant="secondary"
					icon={ check }
					iconSize={ 16 }
					disabled={ isBlocked || isValidatingProject }
					onClick={ onRunValidation }
				>
					{ isValidatingProject ? __( 'Running…' ) : __( 'Re-run' ) }
				</Button>
			</div>
			{ validationResult.findings.length === 0 ? (
				<div className={ workbenchStyles.editorProblemsEmpty }>
					{ __( 'No validation findings.' ) }
				</div>
			) : (
				<div className={ workbenchStyles.editorProblemsList }>
					{ validationResult.findings.map( ( finding, index ) => {
						const message = decodeHtmlEntities( finding.message );
						return (
							<button
								key={ `${ finding.source }:${ finding.code ?? index }:${ finding.file ?? '' }:${
									finding.line ?? ''
								}` }
								type="button"
								className={ cx(
									workbenchStyles.editorProblemItem,
									finding.severity === 'error' && workbenchStyles.editorProblemItemError,
									finding.severity === 'warning' && workbenchStyles.editorProblemItemWarning,
									finding.severity === 'info' && workbenchStyles.editorProblemItemInfo
								) }
								onClick={ () => onOpenFinding( finding ) }
								disabled={ ! finding.file }
								title={ message }
							>
								<span className={ workbenchStyles.editorProblemSeverity }>
									{ finding.severity }
								</span>
								<span className={ workbenchStyles.editorProblemLocation }>
									{ finding.file ? `${ finding.file }:${ finding.line || 1 }` : finding.source }
								</span>
								<span className={ workbenchStyles.editorProblemCode }>
									{ finding.code || finding.source }
								</span>
								<span className={ workbenchStyles.editorProblemMessage }>{ message }</span>
							</button>
						);
					} ) }
				</div>
			) }
		</section>
	);
}
