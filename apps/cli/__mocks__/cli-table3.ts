module.exports = class MockTable {
	constructor() {}
	push() {
		return this;
	}
	toString() {
		return 'table output';
	}
};
