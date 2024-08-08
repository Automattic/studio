type FsExtra = typeof import('fs-extra');
interface MockedFsExtra extends FsExtra {
	__mockFiles: Record< string, string | string[] >;
	__setFileContents: ( path: string, fileContents: string | string[] ) => void;
}

const fsExtra = jest.createMockFromModule< MockedFsExtra >( 'fs-extra' );

fsExtra.__mockFiles = {};
fsExtra.__setFileContents = ( path: string, fileContents: string | string[] ) => {
	fsExtra.__mockFiles[ path ] = fileContents;
};

( fsExtra.readFile as jest.Mock ).mockImplementation( async ( path: string ): Promise< string > => {
	const fileContents = fsExtra.__mockFiles[ path ];

	if ( typeof fileContents === 'string' ) {
		return fileContents;
	}

	return '';
} );

( fsExtra.readFileSync as jest.Mock ).mockImplementation( ( path: string ): string => {
	const fileContents = fsExtra.__mockFiles[ path ];

	if ( typeof fileContents === 'string' ) {
		return fileContents;
	}

	return '';
} );

( fsExtra.readdir as jest.Mock ).mockImplementation(
	async ( path: string ): Promise< Array< string > > => {
		const dirContents = fsExtra.__mockFiles[ path ];

		if ( Array.isArray( dirContents ) ) {
			return dirContents;
		}

		return [];
	}
);

( fsExtra.pathExists as jest.Mock ).mockImplementation(
	async ( path: string ): Promise< boolean > => {
		return !! fsExtra.__mockFiles[ path ];
	}
);

module.exports = fsExtra;
