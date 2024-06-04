export function MessageThinking() {
	return (
		<div className="flex justify-center items-center gap-1 p-0.5">
			<div
				className="animate-pulse h-1.5 w-1.5 bg-a8c-blueberry rounded-full"
				style={ { animationDelay: '0.2s' } }
			/>
			<div className="animate-pulse h-1.5 w-1.5 bg-a8c-blueberry rounded-full" />
			<div
				className="animate-pulse h-1.5 w-1.5 bg-a8c-blueberry rounded-full"
				style={ { animationDelay: '0.4s' } }
			/>
		</div>
	);
}
