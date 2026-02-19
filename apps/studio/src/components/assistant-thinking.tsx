import { __ } from '@wordpress/i18n';

export function MessageThinking() {
	return (
		<div
			aria-label={ __( 'Thinking…' ) }
			className="flex justify-center items-center gap-1 p-0.5 min-h-5"
		>
			<div
				className="animate-pulse h-1.5 w-1.5 bg-a8c-blue-50 rounded-full"
				style={ { animationDelay: '0.2s' } }
			/>
			<div className="animate-pulse h-1.5 w-1.5 bg-a8c-blue-50 rounded-full" />
			<div
				className="animate-pulse h-1.5 w-1.5 bg-a8c-blue-50 rounded-full"
				style={ { animationDelay: '0.4s' } }
			/>
		</div>
	);
}
