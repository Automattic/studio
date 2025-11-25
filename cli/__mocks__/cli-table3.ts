export default class MockTable {
	constructor( options: any ) {}
	push( ...rows: any[] ) {
		return this;
	}
	toString() {
		return 'table output';
	}
}
