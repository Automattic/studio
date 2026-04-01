import { Provider as ReduxProvider } from 'react-redux';
import { Sidebar } from 'src/components/new-ui/sidebar';
import SiteMenu from 'src/components/site-menu';
import { ContentTabsProvider } from 'src/hooks/use-content-tabs';
import { ImportExportProvider } from 'src/hooks/use-import-export';
import { siteDetailsContext } from 'src/hooks/use-site-details';
import { store } from 'src/stores';

const MOCK_SITES: SiteDetails[] = [
	{
		id: 'mock-1',
		name: 'My Blog',
		path: '/tmp/mock-1',
		port: 8881,
		phpVersion: '8.2',
		running: true,
		url: 'http://localhost:8881',
	} as SiteDetails,
	{
		id: 'mock-2',
		name: 'Client Project',
		path: '/tmp/mock-2',
		port: 8882,
		phpVersion: '8.2',
		running: false,
	} as SiteDetails,
	{
		id: 'mock-3',
		name: 'WooCommerce Store',
		path: '/tmp/mock-3',
		port: 8883,
		phpVersion: '8.2',
		running: true,
		url: 'http://localhost:8883',
	} as SiteDetails,
	{
		id: 'mock-4',
		name: 'Theme Development',
		path: '/tmp/mock-4',
		port: 8884,
		phpVersion: '8.2',
		running: false,
	} as SiteDetails,
];

const mockSiteDetailsValue = {
	sites: MOCK_SITES,
	selectedSite: MOCK_SITES[ 0 ],
	setSelectedSiteId: () => undefined,
	updateSite: async () => undefined,
	updateSitesSortOrder: async () => undefined,
	createSite: async () => undefined,
	copySite: async () => undefined,
	startServer: async () => undefined,
	stopServer: async () => undefined,
	stopAllRunningSites: async () => undefined,
	startAllStoppedSites: async () => undefined,
	deleteSite: async () => undefined,
	loadingServer: {},
	loadingSites: false,
	isDeleting: false,
	isSiteDeleting: () => false,
	uploadingSites: {},
	setUploadingSites: () => undefined,
	isEditModalOpen: false,
	setIsEditModalOpen: () => undefined,
	editModalInitialTab: '',
	setEditModalInitialTab: () => undefined,
	siteCreationMessages: {},
};

function MockProviders( { children }: { children: React.ReactNode } ) {
	return (
		<ReduxProvider store={ store }>
			<siteDetailsContext.Provider value={ mockSiteDetailsValue }>
				<ContentTabsProvider>
					<ImportExportProvider>{ children }</ImportExportProvider>
				</ContentTabsProvider>
			</siteDetailsContext.Provider>
		</ReduxProvider>
	);
}

function Section( { title, children }: { title: string; children: React.ReactNode } ) {
	return (
		<div className="mb-8">
			<h4 className="a8c-label text-frame-text-secondary mb-3">{ title }</h4>
			{ children }
		</div>
	);
}

export function StudioComponentLibrary() {
	return (
		<MockProviders>
			<div>
				<h3 className="a8c-subtitle-small text-chrome-text mb-6">Studio Components</h3>

				<Section title="Sidebar">
					<div className="bg-chrome rounded-md h-[400px] flex">
						<Sidebar />
					</div>
				</Section>

				<Section title="Site Menu">
					<div className="bg-chrome rounded-md p-4">
						<SiteMenu />
					</div>
				</Section>
			</div>
		</MockProviders>
	);
}
