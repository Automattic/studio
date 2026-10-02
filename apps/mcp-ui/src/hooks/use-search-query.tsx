import { createContext, useContext, useState, type ReactNode } from 'react';

type SearchQuery = [ string, ( query: string ) => void ];

const SearchQueryContext = createContext< SearchQuery >( [ '', () => undefined ] );

// The search outlives the list route, so it is still there after a site's page.
export function SearchQueryProvider( { children }: { children: ReactNode } ) {
	const state = useState( '' );
	return <SearchQueryContext.Provider value={ state }>{ children }</SearchQueryContext.Provider>;
}

export const useSearchQuery = () => useContext( SearchQueryContext );
