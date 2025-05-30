module.exports = {
	lock: jest.fn().mockImplementation( ( path, options, callback ) => callback( null ) ),
	unlock: jest.fn().mockImplementation( ( path, callback ) => callback( null ) ),
};
