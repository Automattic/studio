import { __ } from '@wordpress/i18n';
import { Icon, cautionFilled, check, plugins, update } from '@wordpress/icons';
import { cx } from 'src/lib/cx';
import { AddDevelopmentProjectButton } from './add-development-project-button';

export function ProjectEmptyState() {
	return (
		<div className="w-full h-full flex items-center justify-center app-no-drag-region px-8">
			<div className="max-w-[420px] flex flex-col items-center text-center gap-4">
				<div className="w-10 h-10 rounded-sm border border-frame-border bg-frame-surface flex items-center justify-center">
					<Icon icon={ plugins } size={ 24 } className="fill-frame-text-secondary" />
				</div>
				<div>
					<h1 className="text-xl font-medium">{ __( 'Add a plugin project' ) }</h1>
					<p className="mt-2 text-sm text-frame-text-secondary">
						{ __( 'Choose a local WordPress plugin folder to manage it from Studio.' ) }
					</p>
				</div>
				<AddDevelopmentProjectButton variant="primary" />
			</div>
		</div>
	);
}

export function MetadataRow( { label, value }: { label: string; value?: string } ) {
	if ( ! value ) {
		return null;
	}
	return (
		<div className="flex min-w-0 flex-col gap-1">
			<div className="a8c-label text-frame-text-secondary">{ label }</div>
			<div className="text-sm text-frame-text break-words">{ value }</div>
		</div>
	);
}

export function ReadinessItem( {
	label,
	description,
	state,
}: {
	label: string;
	description: string;
	state: 'ready' | 'blocked' | 'next';
} ) {
	const icon = state === 'ready' ? check : state === 'blocked' ? cautionFilled : update;
	return (
		<li className="flex gap-3 py-3 border-t border-frame-border first:border-t-0">
			<div
				className={ cx(
					'w-7 h-7 rounded-sm border flex items-center justify-center shrink-0',
					state === 'ready' && 'border-frame-running text-frame-running bg-frame-surface',
					state === 'blocked' && 'border-frame-error text-frame-error bg-frame-surface',
					state === 'next' && 'border-frame-border text-frame-text-secondary bg-frame-surface'
				) }
			>
				<Icon icon={ icon } size={ 18 } className="fill-current" />
			</div>
			<div className="min-w-0">
				<div className="text-sm font-medium text-frame-text">{ label }</div>
				<div className="text-sm text-frame-text-secondary">{ description }</div>
			</div>
		</li>
	);
}
