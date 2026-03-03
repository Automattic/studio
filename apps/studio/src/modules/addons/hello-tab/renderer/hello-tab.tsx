/**
 * Hello Tab — example content tab component.
 * Receives selectedSite from Studio's tab rendering infrastructure.
 */
export function HelloTab( { selectedSite }: { selectedSite: SiteDetails } ) {
	return (
		<div className="p-8 flex flex-col gap-4">
			<h2 className="text-xl font-semibold">Hello from the addon system!</h2>
			<p className="text-sm text-gray-600">
				This tab was added by the <strong>studio-hello-tab</strong> addon using the{ ' ' }
				<code className="bg-gray-100 px-1 rounded">contentTabs</code> slot.
			</p>
			<div className="mt-2 p-4 bg-gray-50 rounded-md border border-gray-200 text-sm font-mono">
				<div>
					<span className="text-gray-400">id: </span>
					{ selectedSite.id }
				</div>
				<div>
					<span className="text-gray-400">name: </span>
					{ selectedSite.name }
				</div>
				<div>
					<span className="text-gray-400">path: </span>
					{ selectedSite.path }
				</div>
				<div>
					<span className="text-gray-400">php: </span>
					{ selectedSite.phpVersion }
				</div>
				<div>
					<span className="text-gray-400">running: </span>
					{ selectedSite.running ? 'yes' : 'no' }
				</div>
				{ selectedSite.running && (
					<div>
						<span className="text-gray-400">url: </span>
						{ selectedSite.url }
					</div>
				) }
			</div>
		</div>
	);
}
