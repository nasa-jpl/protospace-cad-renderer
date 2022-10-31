import * as THREE from 'three';

// BufferLayer Class
// A set of plane and rendertargets used for rendering
// in the layered renderer
class BufferLayer {

	get target() {

		if ( ! this._target ) {

			this._target = new THREE.WebGLRenderTarget( 1, 1, {
				minFilter: THREE.LinearFilter,
				magFilter: THREE.NearestFilter,
			} );

		}

		return this._target;

	}

	get plane() {

		if ( ! this._plane ) {

			const planegeom = new THREE.PlaneGeometry( 2, 2, 1, 1 );
			const planemat = new THREE.MeshBasicMaterial( {
				color: 0xffffff,
				transparent: true,
				opacity: 1,
				depthTest: true,
				depthWrite: false,
				map: this.target.texture,
			} );
			this._plane = new THREE.Mesh( planegeom, planemat );

		}

		return this._plane;

	}

	dispose() {

		this.target.dispose();

	}

}

// LayerRenderer Class
// A renderer for rendering multiple RenderLayer objects
// and compositing them in space
export default class LayeredRenderer {

	get domElement() {

		return this._renderer.domElement;

	}

	/* Lifecycle Functions */
	constructor( bgColor = 0x000000 ) {

		this.clearColor = bgColor;
		this.enabled = true;
		this.accountForDPI = true;
		this.antialiasing = 1;
		this.useCompositeTarget = true;

		this._scene = new THREE.Scene();
		this._renderer = new THREE.WebGLRenderer( { preserveDrawingBuffer: true } );
		this._renderer.setPixelRatio( window.devicePixelRatio );
		this._camera = new THREE.OrthographicCamera( - 1, 1, 1, - 1, 1, 1000 );
		this._layers = [];

		// For final buffer composite
		this._compositeBuffer = null;
		this._compositeScene = null;

		// A map of "RenderLayers" > "BufferLayers"
		// The keys for the weakMap are kept in _layers
		this._buffers = new WeakMap();

		this._animationFrameId = null;

		const renderLoop = () => {

			if ( this.enabled ) this._render();
			this._animationFrameId = requestAnimationFrame( renderLoop );

		};

		renderLoop();

	}

	dispose() {

		this._renderer.dispose();

		this._layers.forEach( l => {

			this._buffers.get( l ).dispose();
			this._buffers.delete( l );

		} );

		if ( this._compositeBuffer ) this._compositeBuffer.dispose();

		cancelAnimationFrame( this._animationFrameId );

	}

	/* Public API */
	// Add a layer to render and composite
	addLayer( layer ) {

		if ( this._layers.indexOf( layer ) !== - 1 ) throw new Error( `Layer ${layer.name} already added` );

		this._layers.push( layer );
		this._buffers.set( layer, new BufferLayer() );

	}

	// Removes a layer
	removeLayer( layer ) {

		const index = this._layers.indexOf( layer );
		if ( index === - 1 ) return;

		this._layers.splice( index, 1 );
		this._buffers.delete( layer );

	}

	forEachLayer( func ) {

		this._layers.forEach( layer => func( layer ) );

	}

	// overrideable functions for pre and post render
	prerender( /* viewWidth, viewHeight */ ) {}

	postrender() {}

	/* Private Functions */
	_render() {

		const renderer = this._renderer;
		const gl = renderer.context;
		const camera = this._camera;
		const scene = this._scene;

		// scale the renderer based on the AA and the DPI of the screen
		const scale = this.accountForDPI ? window.devicePixelRatio : 1;
		const canvasWidth = this.domElement.offsetWidth * scale;
		const canvasHeight = this.domElement.offsetHeight * scale;

		// the widths and heights of the target account
		// for anti aliasing
		let targetWidth = canvasWidth * this.antialiasing;
		let targetHeight = canvasHeight * this.antialiasing;

		// Clamp the texture size the max texture size
		// that the platform can support
		const maxdim = gl.getParameter( gl.MAX_TEXTURE_SIZE );
		if ( targetWidth > maxdim ) {

			targetHeight *= maxdim / targetWidth;
			targetWidth = maxdim;

		}

		if ( targetHeight > maxdim ) {

			targetWidth *= maxdim / targetHeight;
			targetHeight = maxdim;

		}

		targetWidth = Math.floor( targetWidth );
		targetHeight = Math.floor( targetHeight );

		// If the size of the canvas changed from the last time
		// we drew, then all the children should have to redraw
		const currSize = new THREE.Vector2();
		renderer.getSize( currSize );
		if ( canvasWidth !== currSize.width || canvasHeight !== currSize.height ) {

			this._layers.forEach( layer => layer.redraw() );

		}

		// pass false so we don't set the style of the renderer, which would
		// negate the scaling we apply
		// Setting the pixel ratio here doesn't affect our render targets, so
		// just set this to 1 and we'll use the same width and height everywhere
		renderer.setPixelRatio( 1 );
		renderer.setSize( canvasWidth, canvasHeight, false );

		this.prerender( targetWidth, targetHeight );

		this._layers.forEach( layer => {

			const buf = this._buffers.get( layer );
			if ( buf.plane.parent !== scene ) scene.add( buf.plane );

			buf.plane.position.set( 0, 0, - camera.far + 1 + layer.zindex );
			buf.plane.visible = !! layer.isVisible();

			if ( buf.plane.visible && layer.needsToDraw() ) {

				this._renderLayer( layer, renderer, buf.target, targetWidth, targetHeight );

			}

		} );

		this._compositeRender( targetWidth, targetHeight );

		this.postrender();

	}

	// Composite all the render layers into a final target
	_compositeRender( targetWidth, targetHeight ) {

		const renderer = this._renderer;
		renderer.autoClear = true;
		renderer.setClearColor( this.clearColor, 1 );

		// If our final target size is _smaller_ than the AA'd size,
		// then composite to a separate buffer before rendering to the
		// canvas to avoid issues with the dithered rendering.
		// See issue #571
		if ( this.antialiasing > 1 && this.useCompositeTarget ) {

			if ( this._compositeBuffer == null ) {

				this._compositeBuffer = new BufferLayer();
				this._compositeScene = new THREE.Scene();

				const pl = this._compositeBuffer.plane;
				this._compositeScene.add( this._compositeBuffer.plane );
				pl.position.set( 0, 0, - 1 );

			}

			this._compositeBuffer.target.setSize( targetWidth, targetHeight );
			
			renderer.setRenderTarget( this._compositeBuffer.target );
			renderer.render( this._scene, this._camera );
			renderer.setRenderTarget( null );

			renderer.render( this._compositeScene, this._camera );

		} else {

			if ( this._compositeBuffer != null ) {

				this._compositeBuffer.dispose();
				this._compositeBuffer = null;
				this._compositeScene = null;

			}

			renderer.render( this._scene, this._camera );

		}

	}

	_renderLayer( layer, renderer, target, width, height ) {

		layer.render( renderer, target, width, height );

	}

}
