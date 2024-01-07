export class GithubLfsResolver {

	constructor() {

		this.pagesStem = '';
		this.targetStem = '';
		this.targetBranch = '';

	}

	matchesPageStem( url ) {

		const { pagesStem } = this;
		return url.href.indexOf( pagesStem ) === 0;

	}

	resolve( url ) {

		if ( ! ( url instanceof URL ) ) {

			url = new URL( url, location.href );

		}

		if ( ! this.matchesPageStem( url ) ) {

			return url;

		}

		const { pagesStem, targetBranch, targetStem } = this;
		const remainder = url.href.substring( pagesStem.length );
		const tokens = remainder.split( /[\/]/g );
		const githubOrg = tokens.shift();
		const githubRepo = tokens.shift();
		return `${ targetStem }/${ githubOrg }/${ githubRepo }/blob/${ targetBranch }/${ tokens.join( '/' ) }?raw=true`;

	}

}
