export function FailureNotice( { message, onRetry }: { message: string; onRetry?: () => void } ) {
	return (
		<section aria-live="polite">
			<div className="alert" role="alert">
				<p>{ message }</p>
				{ onRetry && (
					<button type="button" data-kind="secondary" onClick={ onRetry }>
						Try again
					</button>
				) }
			</div>
		</section>
	);
}
