import * as THREE from 'three';

/**
 *	@author zz85 / http://twitter.com/blurspline / http://www.lab4games.net/zz85/blog
 *
 *	A general perpose camera, for setting FOV, Lens Focal Length,
 *		and switching between perspective and orthographic views easily.
 *		Use this only if you do not wish to manage
 *		both a Orthographic and Perspective Camera
 *
 */

//CombinedCamera = function ( width, height, fov, near, far, orthoNear, orthoFar ) {
class CombinedCamera extends THREE.Camera {
  constructor(width, height, fov, near, far) {
    super();

    this.fov = fov;

    this.far = far;
    this.near = near;

    this.left = -width / 2;
    this.right = width / 2;
    this.top = height / 2;
    this.bottom = -height / 2;

    this.aspect = width / height;
    this.zoom = 1;
    this.view = null;
    // We could also handle the projectionMatrix internally, but just wanted to test nested camera objects

    //this.cameraO = new THREE.OrthographicCamera( width / - 2, width / 2, height / 2, height / - 2, 	orthoNear, orthoFar );
    this.cameraO = new THREE.OrthographicCamera(width / -2, width / 2, height / 2, height / -2, near, far);
    this.cameraP = new THREE.PerspectiveCamera(fov, width / height, near, far);

    this.toPerspective();
  }
}

CombinedCamera.prototype.isCombinedCamera = true;

CombinedCamera.prototype.toPerspective = function() {
  // Switches to the Perspective Camera

  this.cameraP.near = this.near; //this.near = this.cameraP.near;
  this.cameraP.far = this.far; //this.far = this.cameraP.far;

  this.cameraP.aspect = this.aspect;
  this.cameraP.fov = this.fov; //this.cameraP.fov =  this.fov / this.zoom ;
  this.cameraP.view = this.view;

  this.cameraP.updateProjectionMatrix();

  this.projectionMatrix = this.cameraP.projectionMatrix;
  this.projectionMatrixInverse = this.cameraP.projectionMatrixInverse;

  //this.inPerspectiveMode = true;
  //this.inOrthographicMode = false;
  this.isPerspectiveCamera = true;
  this.isOrthographicCamera = false;
};

//CombinedCamera.prototype.toOrthographic = function () {
//
//	// Switches to the Orthographic camera estimating viewport from Perspective
//
//	var fov = this.fov;
//	var aspect = this.cameraP.aspect;
//	var near = this.cameraP.near;
//	var far = this.cameraP.far;
//
//	// The size that we set is the mid plane of the viewing frustum
//
//	var hyperfocus = ( near + far ) / 2;
//
//	var halfHeight = Math.tan( fov * Math.PI / 180 / 2 ) * hyperfocus;
//	var halfWidth = halfHeight * aspect;
//
//	halfHeight /= this.zoom;
//	halfWidth /= this.zoom;
//
//	this.cameraO.left = - halfWidth;
//	this.cameraO.right = halfWidth;
//	this.cameraO.top = halfHeight;
//	this.cameraO.bottom = - halfHeight;
//	this.cameraO.view = this.view;
//
//	this.cameraO.updateProjectionMatrix();
//
//	this.near = this.cameraO.near;
//	this.far = this.cameraO.far;
//	this.projectionMatrix = this.cameraO.projectionMatrix;
//
//	this.inPerspectiveMode = false;
//	this.inOrthographicMode = true;
//
//};
CombinedCamera.prototype.toOrthographic = function() {
  // Switches to the Orthographic camera

  this.cameraO.near = this.near;
  this.cameraO.far = this.far;

  this.cameraO.zoom = this.zoom;

  this.cameraO.left = this.left;
  this.cameraO.right = this.right;
  this.cameraO.top = this.top;
  this.cameraO.bottom = this.bottom;

  this.cameraO.view = this.view;

  this.cameraO.updateProjectionMatrix();

  this.projectionMatrix = this.cameraO.projectionMatrix;
  this.projectionMatrixInverse = this.cameraO.projectionMatrixInverse;

  this.isPerspectiveCamera = false;
  this.isOrthographicCamera = true;
};

CombinedCamera.prototype.copy = function(source) {
  THREE.Camera.prototype.copy.call(this, source);

  this.fov = source.fov;
  this.far = source.far;
  this.near = source.near;

  this.left = source.left;
  this.right = source.right;
  this.top = source.top;
  this.bottom = source.bottom;

  this.zoom = source.zoom;
  this.view = source.view === null ? null : Object.assign({}, source.view);
  this.aspect = source.aspect;

  this.cameraO.copy(source.cameraO);
  this.cameraP.copy(source.cameraP);

  //this.inOrthographicMode = source.inOrthographicMode;
  //this.inPerspectiveMode = source.inPerspectiveMode;
  this.isOrthographicCamera = source.isOrthographicCamera;
  this.isPerspectiveCamera = source.isPerspectiveCamera;

  return this;
};

CombinedCamera.prototype.setViewOffset = function(fullWidth, fullHeight, x, y, width, height) {
  this.view = {
    fullWidth: fullWidth,
    fullHeight: fullHeight,
    offsetX: x,
    offsetY: y,
    width: width,
    height: height,
  };

  // if ( this.inPerspectiveMode ) {
  if (this.isPerspectiveCamera) {
    this.aspect = fullWidth / fullHeight;

    this.toPerspective();
  } else {
    this.toOrthographic();
  }
};

CombinedCamera.prototype.clearViewOffset = function() {
  this.view = null;
  this.updateProjectionMatrix();
};

CombinedCamera.prototype.setSize = function(width, height) {
  this.aspect = width / height; //this.cameraP.aspect = width / height;
  this.left = -width / 2;
  this.right = width / 2;
  this.top = height / 2;
  this.bottom = -height / 2;
};

CombinedCamera.prototype.setFov = function(fov) {
  this.fov = fov;

  //if ( this.inPerspectiveMode ) {
  if (this.isPerspectiveCamera) {
    this.toPerspective();
  } else {
    this.toOrthographic();
  }
};

// For maintaining similar API with PerspectiveCamera

CombinedCamera.prototype.updateProjectionMatrix = function() {
  //if ( this.inPerspectiveMode ) {
  if (this.isPerspectiveCamera) {
    this.toPerspective();
  } else {
    //this.toPerspective();
    this.toOrthographic();
  }
};

/*
* Uses Focal Length (in mm) to estimate and set FOV
* 35mm (full frame) camera is used if frame size is not specified;
* Formula based on http://www.bobatkins.com/photography/technical/field_of_view.html
*/
CombinedCamera.prototype.setLens = function(focalLength, filmGauge) {
  if (filmGauge === undefined) filmGauge = 35;

  var vExtentSlope = (0.5 * filmGauge) / (focalLength * Math.max(this.cameraP.aspect, 1));

  var fov = THREE.Math.RAD2DEG * 2 * Math.atan(vExtentSlope);

  this.setFov(fov);

  return fov;
};

CombinedCamera.prototype.setZoom = function(zoom) {
  this.zoom = zoom;

  //	if ( this.inPerspectiveMode ) {
  //
  //		this.toPerspective();
  //
  //	} else {
  //
  //		this.toOrthographic();
  //
  //	}
  if (this.isOrthographicCamera) {
    this.toOrthographic();
  }
};

//moving this functionality to TrackballControls
//CombinedCamera.prototype.toFrontView = function() {
//
//	this.rotation.x = 0;
//	this.rotation.y = 0;
//	this.rotation.z = 0;
//
//	// should we be modifing the matrix instead?
//
//};
//
//CombinedCamera.prototype.toBackView = function() {
//
//	this.rotation.x = 0;
//	this.rotation.y = Math.PI;
//	this.rotation.z = 0;
//
//};
//
//CombinedCamera.prototype.toLeftView = function() {
//
//	this.rotation.x = 0;
//	this.rotation.y = - Math.PI / 2;
//	this.rotation.z = 0;
//
//};
//
//CombinedCamera.prototype.toRightView = function() {
//
//	this.rotation.x = 0;
//	this.rotation.y = Math.PI / 2;
//	this.rotation.z = 0;
//
//};
//
//CombinedCamera.prototype.toTopView = function() {
//
//	this.rotation.x = - Math.PI / 2;
//	this.rotation.y = 0;
//	this.rotation.z = 0;
//
//};
//
//CombinedCamera.prototype.toBottomView = function() {
//
//	this.rotation.x = Math.PI / 2;
//	this.rotation.y = 0;
//	this.rotation.z = 0;
//
//};

CombinedCamera.prototype.dump = function() {
  console.log(`mode: ${this.isPerspectiveCamera ? 'perspective' : 'orthographic'}`);
  console.log(`aspect: ${this.aspect}, vfov: ${this.fov}, near: ${this.near}, far: ${this.far}`);
  console.log(`zoom: ${this.zoom}, left: ${this.left}, right: ${this.right}, top: ${this.top}, bottom: ${this.bottom}`);
  console.log(`width: ${this.right - this.left}, height: ${this.top - this.bottom}`);
};

export { CombinedCamera };