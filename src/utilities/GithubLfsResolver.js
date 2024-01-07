export class GithubLfsResolver {

	constructor() {

		this.pagesStem = '';
		this.targetStem = 'https://media.githubusercontent.com/media';
		this.branch = 'main';
		this.repo = '';
		this.org = '';

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

		const { pagesStem, targetStem, branch, org, repo } = this;
		const remainder = url.href.substring( pagesStem.length );
		const tokens = remainder.split( /[\/]/g );
		return `${ targetStem }/${ org }/${ repo }/${ branch }/${ tokens.join( '/' ) }`;

	}

}
