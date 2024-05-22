export function ContentTabAssistant() {
	return (
		<div className="h-full flex flex-col">
			<div className="flex gap-2">
				<input type="text" placeholder="Hello" className="flex-1 p-2 rounded-lg" />
				<button className="btn btn-primary">Send</button>
			</div>
		</div>
	);
}
