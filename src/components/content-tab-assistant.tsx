import { AssistantIcon } from './assistant-icon';

export function ContentTabAssistant() {
	return (
		<div className="h-full flex flex-col">
			<div className="flex-1 p-4 bg-gray-100 rounded-lg mb-4 overflow-auto">
				<div className="text-gray-500">Chat transcript</div>
			</div>
			<div className="p-2 bg-gray-100 rounded-lg mb-4">
				<div className="text-gray-500">Suggested prompts</div>
			</div>
			<div className="flex gap-2">
				<div className="relative flex-1">
					<input
						type="text"
						placeholder="Ask Studio WordPress Assistant"
						className="w-full p-2 rounded-lg border-black border pl-10"
					/>
					<div className="absolute top-1/2 transform -translate-y-1/2 left-3 pointer-events-none">
						<AssistantIcon />
					</div>
				</div>
				<button className="btn btn-primary">Send</button>
			</div>
		</div>
	);
}
