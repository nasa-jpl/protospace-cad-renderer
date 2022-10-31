// RenderLayer Class
// A layer for use in the LayeredRenderer class to
// composite multiple indendently rendered layers
// name:      name used in debug spew
// zindex:    used to order the rendered layers
// enabled:   whether or not to render this layer
export class RenderLayer {

	constructor( zindex = 0, name = 'new render layer' ) {

		this.name = name;
		this.zindex = zindex;

	}

	/* Interface */
	redraw() {}

	needsToDraw() {

		return true;

	}

	isVisible() {

		return true;

	}

	render( /* renderer, target, viewWidth, viewHeight */ ) {}

	dispose() {}

}
