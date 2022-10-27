import * as THREE from '/node_modules/three/build/three.module.js';
import EventDispatcher from './EventDispatcher.js';

// "Animation" format
// {
//
//    name: String,           // animation name
//    num_motions: Number,    // number of nodes moving
//    relative: Boolean,      // whether the transform is relative to the start pos
//    motions: [ {
//
//        node_guid: String,          // the guid of the node to move
//        num_frames: Number,         // the number of frames
//        frames: [ {                  // the set of transforms representing frames
//
//            rotation: { x, y, z, w },
//            scale: { x, y, z },
//            translation: { x, y, z },
//
//        }, ... ],
//
//    }, ... ],
//
// }

export default class AnimationPlayer extends EventDispatcher {

	static get BoundaryCondition() {

		if ( ! this._BoundaryCondition ) {

			this._BoundaryCondition = {
				get STOP() {

					return 0;

				},
				get LOOP() {

					return 1;

				},
				get ZIGZAG() {

					return 2;

				},
			};

		}

		return this._BoundaryCondition;

	}

	get currentFrame() {

		return this._frame;

	}
	get totalFrames() {

		return this._totalFrames;

	}
	get percentComplete() {

		return this.currentFrame / ( this.totalFrames - 1 );

	}
	get hasAnimation() {

		return !! this._animation;

	}

	get secondsPerFrame() {

		return 1 / this._frameRate;

	}

	get playing() {

		return this._frameHandle || this._frame > 0;

	} //neither paused nor stopped
	set playing( val ) {

		if ( val ) this.play();
		else this.pause();

	}

	get frame() {

		return this._frame;

	}
	set frame( val ) {

		if ( isNaN( val ) ) return;
		const f = parseFloat( val );
		if ( this._goToFrame( f ) ) this._dispatch( 'anim-seek' );

	}

	get speed() {

		return this._speed;

	}
	set speed( val ) {

		if ( isNaN( val ) ) return;
		const s = parseFloat( val );
		if ( s !== this._speed ) {

			this._speed = s;
			this._dispatch( 'anim-speed' );

		}

	}

	get reverse() {

		return this._reverse;

	}
	set reverse( val ) {

		const r = !! val;
		if ( r !== this._reverse ) {

			this._reverse = r;
			this._dispatch( 'anim-reverse' );

		}

	}

	get replayMode() {

		return this._replayMode;

	}
	set replayMode( val ) {

		if ( isNaN( val ) ) return;
		const m = Math.max( 0, Math.min( 2, parseInt( val ) ) );
		if ( m !== this._replayMode ) {

			this._replayMode = m;
			this._dispatch( 'anim-mode' );

		}

	}

	/* Life Cycle Functions */
	constructor( model ) {

		super();
		this.mutatingFromNetwork = false;
		this._model = model;
		this._animation = null;
		this._frame = 0;
		this._totalFrames = 0;
		this._frameRate = 24;
		this._speed = 1;
		this._reverse = false;
		this._replayMode = AnimationPlayer.BoundaryCondition.STOP;

	}

	/* Public API */

	play() {

		if ( ! this._animation ) return;
		if ( this._frameHandle ) return;

		let lastTime = window.performance.now();
		const run = () => {

			const currTime = window.performance.now();
			const deltaSecond = ( currTime - lastTime ) / 1000;
			const deltaFrame = this._speed * ( this._reverse ? - 1 : 1 ) * ( deltaSecond / this.secondsPerFrame );
			lastTime = currTime;

			this._goToFrame( this._frame + deltaFrame );

			const runNextFrame = () => ( this._frameHandle = requestAnimationFrame( run ) );
			if ( ( ! this.reverse && this.percentComplete >= 1 ) || ( this.reverse && this.percentComplete <= 0 ) ) {

				// finished animation
				switch ( this._replayMode ) {

					case AnimationPlayer.BoundaryCondition.LOOP:
						this._frame = this.reverse ? this.totalFrames - 1 : 0;
						runNextFrame();
						break;
					case AnimationPlayer.BoundaryCondition.ZIGZAG:
						this.reverse = ! this.reverse;
						runNextFrame();
						break;
					default:
						this.pause();

				}

			} else {

				runNextFrame();

			}

		};

		run();
		this._dispatch( 'anim-start' );

	}

	pause() {

		if ( ! this._frameHandle ) return;
		if ( this._frameHandle ) cancelAnimationFrame( this._frameHandle );
		this._frameHandle = null;
		this._dispatch( 'anim-pause' );

	}

	stop() {

		if ( ! this._frameHandle && this._frame === 0 ) return;
		if ( this._frameHandle ) cancelAnimationFrame( this._frameHandle );
		this._frameHandle = null;
		this._frame = 0;
		this._replayMode = AnimationPlayer.BoundaryCondition.STOP; //replicate behavior from HoloLens client
		this._reverse = false; //replicate behavior from HoloLens client
		this._model.resetTransforms();
		this._dispatch( 'anim-stop' );

	}

	add( anim, frameRate = 30 ) {

		this._animation = anim;
		this._totalFrames = anim.motions.reduce( ( acc, val ) => Math.max( acc, val.num_frames ), 0 );
		this._frameRate = frameRate;
		this._dispatch( 'anim-added' );

	}

	/* Private Functions */
	_goToFrame( f ) {

		if ( isNaN( f ) || this._frame === f ) return false;

		this._frame = f;
		this._frame = Math.max( 0, Math.min( this._frame, this.totalFrames - 1 ) );

		if ( ! this._animation ) return true;

		const lerp = ( a, b, t ) => ( 1 - t ) * a + t * b;

		const thisFrameNum = Math.floor( this._frame );
		const nextFrameNum = Math.ceil( this._frame );
		const interp = this._frame - thisFrameNum;

		this._animation.motions.forEach( m => {

			const guid = m.node_guid;
			const n = this._model._guidMap[ guid ];
			const frames = m.frames;

			// this frame and the next frame
			const tf = m.frames[ Math.min( thisFrameNum, frames.length - 1 ) ];
			const nf = m.frames[ Math.min( nextFrameNum, frames.length - 1 ) ];

			// the first frame's trs values
			const t0 = tf.translation;
			const r0 = tf.rotation;
			const s0 = tf.scale;

			// the THREE js versions
			const pos = new THREE.Vector3( t0.x, t0.y, t0.z );
			const rot = new THREE.Quaternion( r0.x, r0.y, r0.z, r0.w );
			const sca = new THREE.Vector3( s0.x, s0.y, s0.z );

			// interpolate if they're different frames
			if ( tf !== nf ) {

				const t1 = nf.translation;
				pos.x = lerp( pos.x, t1.x, interp );
				pos.y = lerp( pos.y, t1.y, interp );
				pos.z = lerp( pos.z, t1.z, interp );

				const r1 = nf.rotation;
				rot.slerp( new THREE.Quaternion( r1.x, r1.y, r1.z, r1.w ), interp );

				const s1 = nf.scale;
				sca.x = lerp( sca.x, s1.x, interp );
				sca.y = lerp( sca.y, s1.y, interp );
				sca.z = lerp( sca.z, s1.z, interp );

			}

			this._model.setRelativeTRS( n, pos, rot, sca, this._model.root, this._animation.relative );

		} );

		this._dispatch( 'anim-frame' );

		return true;

	}

	_dispatch( ev, detail = {} ) {

		detail.fromNetwork = this.mutatingFromNetwork;
		super._dispatch( ev, detail );

	}

}
