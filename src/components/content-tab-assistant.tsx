interface ContentTabAssistantProps {
	selectedSite: SiteDetails;
}

const AssistantIcon = () => (
	<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
		<g clipPath="url(#clip0_2870_30744)">
			<path
				d="M13.7035 6.58213L10.8309 5.59124C9.69491 5.20089 8.79911 4.30509 8.40876 3.16908L7.41787 0.296515C7.28275 -0.0988382 6.71725 -0.0988382 6.58213 0.296515L5.59124 3.16908C5.20089 4.30509 4.30509 5.20089 3.16908 5.59124L0.296515 6.58213C-0.0988382 6.71725 -0.0988382 7.28275 0.296515 7.41787L3.16908 8.40876C4.30509 8.79911 5.20089 9.69491 5.59124 10.8309L6.58213 13.7035C6.71725 14.0988 7.28275 14.0988 7.41787 13.7035L8.40876 10.8309C8.79911 9.69491 9.69491 8.79911 10.8309 8.40876L13.7035 7.41787C14.0988 7.28275 14.0988 6.71725 13.7035 6.58213ZM10.3505 7.21269L8.91421 7.70813C8.3437 7.90331 7.8983 8.35371 7.70313 8.91921L7.20768 10.3555C7.13762 10.5557 6.85737 10.5557 6.79231 10.3555L6.29687 8.91921C6.1017 8.3487 5.6513 7.90331 5.08579 7.70813L3.64951 7.21269C3.44933 7.14263 3.44933 6.86238 3.64951 6.79232L5.08579 6.29687C5.6563 6.1017 6.1017 5.6513 6.29687 5.08579L6.79231 3.64951C6.86238 3.44933 7.14263 3.44933 7.20768 3.64951L7.70313 5.08579C7.8983 5.6563 8.3487 6.1017 8.91421 6.29687L10.3505 6.79232C10.5507 6.86238 10.5507 7.14263 10.3505 7.21269Z"
				fill="black"
			/>
		</g>
		<defs>
			<clipPath id="clip0_2870_30744">
				<rect width="14" height="14" fill="white" />
			</clipPath>
		</defs>
	</svg>
);

export function ContentTabAssistant( { selectedSite }: ContentTabAssistantProps ) {
	console.log( selectedSite );

	return (
		<div className="h-full flex flex-col">
			<div className="flex-1 p-4 bg-gray-100 rounded-lg mb-4 overflow-auto">
				<div className="text-gray-500">Chat transcript</div>
			</div>
			<div className="p-4 bg-gray-100 rounded-lg mb-4">
				<div className="text-gray-500">Suggested prompts</div>
			</div>
			<div className="flex gap-2">
				<div className="relative flex-1">
					<input
						type="text"
						placeholder="Ask Studio WordPress Assistant"
						className="w-full p-2 rounded-lg border-black border ltr:pl-8 rtl:pr-8"
					/>
					<div className="absolute top-1/2 transform -translate-y-1/2 ltr:left-3 rtl:left-auto rtl:right-3 pointer-events-none">
						<AssistantIcon />
					</div>
				</div>
				<button className="btn btn-primary">Send</button>
			</div>
		</div>
	);
}
