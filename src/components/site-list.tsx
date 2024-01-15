import { useSiteDetails } from '../hooks/use-site-details';

export function SiteList() {
	const { data, startServer, stopServer } = useSiteDetails();

	if ( ! data?.length ) {
		return <div>No sites found.</div>;
	}

	return (
		<table>
			<thead>
				<tr>
					<th>Name</th>
					<th>Path</th>
					<th>Status</th>
				</tr>
			</thead>
			<tbody>
				{ data.map( ( site ) => (
					<tr key={ site.id }>
						<td>{ site.name }</td>
						<td>{ site.path }</td>
						<td>
							{ site.running ? (
								<button onClick={ () => stopServer( site.id ) }>Stop</button>
							) : (
								<button onClick={ () => startServer( site.id ) }>Start</button>
							) }
						</td>
					</tr>
				) ) }
			</tbody>
		</table>
	);
}
