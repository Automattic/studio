interface EmptyStateProps {
	title: string;
	copy: string;
}

export function EmptyState( { title, copy }: EmptyStateProps ) {
	return (
		<div className="empty">
			<p className="empty-title">{ title }</p>
			<p>{ copy }</p>
		</div>
	);
}
