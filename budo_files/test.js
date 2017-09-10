(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
var turbojs = require('./turbo');

var foo;
var mainStr = "void main(void) { commit(read() * 1.);  }"

function init(){
    foo = turbojs.alloc(1e6);
    for (var i = 0; i < 1e6; i++) foo.data[i] = i;
}

function run(){
    var startTime = +new Date;
    for(var ii = 0; ii < 10; ii++) turbojs.run(foo, mainStr);
    var endTime = +new Date;

    return endTime - startTime;
}


module.exports = {
    init : init,
    runTest : run
}
},{"./turbo":3}],2:[function(require,module,exports){
var easyBenchMark = require('./index');

easyBenchMark.init();
var duration = easyBenchMark.runTest();

var div = document.createElement('div')
div.innerText = 'GPU Benchmark Test: ' + duration + 'ms';
document.body.appendChild(div)
},{"./index":1}],3:[function(require,module,exports){
(function (root, factory) {
	if (typeof define === 'function' && define.amd) {
		// AMD. Register as an anonymous module.
		define([], factory);
	} else if (typeof module === 'object' && module.exports) {
		// Node. Does not work with strict CommonJS, but
		// only CommonJS-like environments that support module.exports,
		// like Node.
		module.exports = factory();
	} else {
		// Browser globals (root is window)
		root.turbojs = factory();
	}
}(this, function () {

	// turbo.js
	// (c) turbo - github.com/turbo
	// MIT licensed

	"use strict";

	// Mozilla reference init implementation
	var initGLFromCanvas = function(canvas) {
		var gl = null;
		var attr = {alpha : false, antialias : false};

		// Try to grab the standard context. If it fails, fallback to experimental.
		gl = canvas.getContext("webgl", attr) || canvas.getContext("experimental-webgl", attr);

		// If we don't have a GL context, give up now
		if (!gl)
			throw new Error("turbojs: Unable to initialize WebGL. Your browser may not support it.");

		return gl;
	}

	var gl = initGLFromCanvas(document.createElement('canvas'));

	// turbo.js requires a 32bit float vec4 texture. Some systems only provide 8bit/float
	// textures. A workaround is being created, but turbo.js shouldn't be used on those
	// systems anyway.
	// if (!gl.getExtension('OES_texture_float'))
	// 	throw new Error('turbojs: Required texture format OES_texture_float not supported.');

	// GPU texture buffer from JS typed array
	function newBuffer(data, f, e) {
		var buf = gl.createBuffer();

		gl.bindBuffer((e || gl.ARRAY_BUFFER), buf);
		gl.bufferData((e || gl.ARRAY_BUFFER), new (f || Float32Array)(data), gl.STATIC_DRAW);

		return buf;
	}

	var positionBuffer = newBuffer([ -1, -1, 1, -1, 1, 1, -1, 1 ]);
	var textureBuffer  = newBuffer([  0,  0, 1,  0, 1, 1,  0, 1 ]);
	var indexBuffer    = newBuffer([  1,  2, 0,  3, 0, 2 ], Uint16Array, gl.ELEMENT_ARRAY_BUFFER);

	var vertexShaderCode =
	"attribute vec2 position;\n" +
	"varying vec2 pos;\n" +
	"attribute vec2 texture;\n" +
	"\n" +
	"void main(void) {\n" +
	"  pos = texture;\n" +
	"  gl_Position = vec4(position.xy, 0.0, 1.0);\n" +
	"}"

	var stdlib =
	"\n" +
	"precision mediump float;\n" +
	"uniform sampler2D u_texture;\n" +
	"varying vec2 pos;\n" +
	"\n" +
	"vec4 read(void) {\n" +
	"  return texture2D(u_texture, pos);\n" +
	"}\n" +
	"\n" +
	"void commit(vec4 val) {\n" +
	"  gl_FragColor = val;\n" +
	"}\n" +
	"\n" +
	"// user code begins here\n" +
	"\n"

	var vertexShader = gl.createShader(gl.VERTEX_SHADER);

	gl.shaderSource(vertexShader, vertexShaderCode);
	gl.compileShader(vertexShader);

	// This should not fail.
	if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS))
		throw new Error(
			"\nturbojs: Could not build internal vertex shader (fatal).\n" + "\n" +
			"INFO: >REPORT< THIS. That's our fault!\n" + "\n" +
			"--- CODE DUMP ---\n" + vertexShaderCode + "\n\n" +
			"--- ERROR LOG ---\n" + gl.getShaderInfoLog(vertexShader)
		);

	// Transfer data onto clamped texture and turn off any filtering
	function createTexture(data, size) {
		var texture = gl.createTexture();

		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
		gl.bindTexture(gl.TEXTURE_2D, null);

		return texture;
	}

	return {
		// run code against a pre-allocated array
		run : function(ipt, code) {
			var fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);

			gl.shaderSource(
				fragmentShader,
				stdlib + code
			);

			gl.compileShader(fragmentShader);

			// Use this output to debug the shader
			// Keep in mind that WebGL GLSL is **much** stricter than e.g. OpenGL GLSL
			if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
				var LOC = code.split('\n');
				var dbgMsg = "ERROR: Could not build shader (fatal).\n\n------------------ KERNEL CODE DUMP ------------------\n"

				for (var nl = 0; nl < LOC.length; nl++)
					dbgMsg += (stdlib.split('\n').length + nl) + "> " + LOC[nl] + "\n";

				dbgMsg += "\n--------------------- ERROR  LOG ---------------------\n" + gl.getShaderInfoLog(fragmentShader)

				throw new Error(dbgMsg);
			}

			var program = gl.createProgram();

			gl.attachShader(program, vertexShader);
			gl.attachShader(program, fragmentShader);
			gl.linkProgram(program);

			if (!gl.getProgramParameter(program, gl.LINK_STATUS))
				throw new Error('turbojs: Failed to link GLSL program code.');

			var uTexture = gl.getUniformLocation(program, 'u_texture');
			var aPosition = gl.getAttribLocation(program, 'position');
			var aTexture = gl.getAttribLocation(program, 'texture');

			gl.useProgram(program);

			var size = Math.sqrt(ipt.data.length) / 4;
			var texture = createTexture(ipt.data, size);

			gl.viewport(0, 0, size, size);
			gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());

			// Types arrays speed this up tremendously.
			var nTexture = createTexture(new Uint8Array(ipt.data.length), size);

			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, nTexture, 0);

			// Test for mobile bug MDN->WebGL_best_practices, bullet 7
			var frameBufferStatus = (gl.checkFramebufferStatus(gl.FRAMEBUFFER) == gl.FRAMEBUFFER_COMPLETE);

			// if (!frameBufferStatus)
			// 	throw new Error('turbojs: Error attaching float texture to framebuffer. Your device is probably incompatible. Error info: ' + frameBufferStatus.message);

			gl.bindTexture(gl.TEXTURE_2D, texture);
			gl.activeTexture(gl.TEXTURE0);
			gl.uniform1i(uTexture, 0);
			gl.bindBuffer(gl.ARRAY_BUFFER, textureBuffer);
			gl.enableVertexAttribArray(aTexture);
			gl.vertexAttribPointer(aTexture, 2, gl.FLOAT, false, 0, 0);
			gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
			gl.enableVertexAttribArray(aPosition);
			gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);
			gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
			gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
			// gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, ipt.data);
			//                                 ^ 4 x 32 bit ^

			return ipt.data.subarray(0, ipt.length);
		},
		alloc: function(sz) {
			// A sane limit for most GPUs out there.
			// JS falls apart before GLSL limits could ever be reached.
			if (sz > 16777216)
				throw new Error("turbojs: Whoops, the maximum array size is exceeded!");

			var ns = Math.pow(Math.pow(2, Math.ceil(Math.log(sz) / 1.386) - 1), 2);
			return {
				data : new Uint8Array(ns * 16),
				length : sz
			};
		}
	};

}));


},{}]},{},[2])
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJpbmRleC5qcyIsInRlc3QuanMiLCJ0dXJiby5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDUEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwidmFyIHR1cmJvanMgPSByZXF1aXJlKCcuL3R1cmJvJyk7XHJcblxyXG52YXIgZm9vO1xyXG52YXIgbWFpblN0ciA9IFwidm9pZCBtYWluKHZvaWQpIHsgY29tbWl0KHJlYWQoKSAqIDEuKTsgIH1cIlxyXG5cclxuZnVuY3Rpb24gaW5pdCgpe1xyXG4gICAgZm9vID0gdHVyYm9qcy5hbGxvYygxZTYpO1xyXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCAxZTY7IGkrKykgZm9vLmRhdGFbaV0gPSBpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBydW4oKXtcclxuICAgIHZhciBzdGFydFRpbWUgPSArbmV3IERhdGU7XHJcbiAgICBmb3IodmFyIGlpID0gMDsgaWkgPCAxMDsgaWkrKykgdHVyYm9qcy5ydW4oZm9vLCBtYWluU3RyKTtcclxuICAgIHZhciBlbmRUaW1lID0gK25ldyBEYXRlO1xyXG5cclxuICAgIHJldHVybiBlbmRUaW1lIC0gc3RhcnRUaW1lO1xyXG59XHJcblxyXG5cclxubW9kdWxlLmV4cG9ydHMgPSB7XHJcbiAgICBpbml0IDogaW5pdCxcclxuICAgIHJ1blRlc3QgOiBydW5cclxufSIsInZhciBlYXN5QmVuY2hNYXJrID0gcmVxdWlyZSgnLi9pbmRleCcpO1xyXG5cclxuZWFzeUJlbmNoTWFyay5pbml0KCk7XHJcbnZhciBkdXJhdGlvbiA9IGVhc3lCZW5jaE1hcmsucnVuVGVzdCgpO1xyXG5cclxudmFyIGRpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpXHJcbmRpdi5pbm5lclRleHQgPSAnR1BVIEJlbmNobWFyayBUZXN0OiAnICsgZHVyYXRpb24gKyAnbXMnO1xyXG5kb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGRpdikiLCIoZnVuY3Rpb24gKHJvb3QsIGZhY3RvcnkpIHtcclxuXHRpZiAodHlwZW9mIGRlZmluZSA9PT0gJ2Z1bmN0aW9uJyAmJiBkZWZpbmUuYW1kKSB7XHJcblx0XHQvLyBBTUQuIFJlZ2lzdGVyIGFzIGFuIGFub255bW91cyBtb2R1bGUuXHJcblx0XHRkZWZpbmUoW10sIGZhY3RvcnkpO1xyXG5cdH0gZWxzZSBpZiAodHlwZW9mIG1vZHVsZSA9PT0gJ29iamVjdCcgJiYgbW9kdWxlLmV4cG9ydHMpIHtcclxuXHRcdC8vIE5vZGUuIERvZXMgbm90IHdvcmsgd2l0aCBzdHJpY3QgQ29tbW9uSlMsIGJ1dFxyXG5cdFx0Ly8gb25seSBDb21tb25KUy1saWtlIGVudmlyb25tZW50cyB0aGF0IHN1cHBvcnQgbW9kdWxlLmV4cG9ydHMsXHJcblx0XHQvLyBsaWtlIE5vZGUuXHJcblx0XHRtb2R1bGUuZXhwb3J0cyA9IGZhY3RvcnkoKTtcclxuXHR9IGVsc2Uge1xyXG5cdFx0Ly8gQnJvd3NlciBnbG9iYWxzIChyb290IGlzIHdpbmRvdylcclxuXHRcdHJvb3QudHVyYm9qcyA9IGZhY3RvcnkoKTtcclxuXHR9XHJcbn0odGhpcywgZnVuY3Rpb24gKCkge1xyXG5cclxuXHQvLyB0dXJiby5qc1xyXG5cdC8vIChjKSB0dXJibyAtIGdpdGh1Yi5jb20vdHVyYm9cclxuXHQvLyBNSVQgbGljZW5zZWRcclxuXHJcblx0XCJ1c2Ugc3RyaWN0XCI7XHJcblxyXG5cdC8vIE1vemlsbGEgcmVmZXJlbmNlIGluaXQgaW1wbGVtZW50YXRpb25cclxuXHR2YXIgaW5pdEdMRnJvbUNhbnZhcyA9IGZ1bmN0aW9uKGNhbnZhcykge1xyXG5cdFx0dmFyIGdsID0gbnVsbDtcclxuXHRcdHZhciBhdHRyID0ge2FscGhhIDogZmFsc2UsIGFudGlhbGlhcyA6IGZhbHNlfTtcclxuXHJcblx0XHQvLyBUcnkgdG8gZ3JhYiB0aGUgc3RhbmRhcmQgY29udGV4dC4gSWYgaXQgZmFpbHMsIGZhbGxiYWNrIHRvIGV4cGVyaW1lbnRhbC5cclxuXHRcdGdsID0gY2FudmFzLmdldENvbnRleHQoXCJ3ZWJnbFwiLCBhdHRyKSB8fCBjYW52YXMuZ2V0Q29udGV4dChcImV4cGVyaW1lbnRhbC13ZWJnbFwiLCBhdHRyKTtcclxuXHJcblx0XHQvLyBJZiB3ZSBkb24ndCBoYXZlIGEgR0wgY29udGV4dCwgZ2l2ZSB1cCBub3dcclxuXHRcdGlmICghZ2wpXHJcblx0XHRcdHRocm93IG5ldyBFcnJvcihcInR1cmJvanM6IFVuYWJsZSB0byBpbml0aWFsaXplIFdlYkdMLiBZb3VyIGJyb3dzZXIgbWF5IG5vdCBzdXBwb3J0IGl0LlwiKTtcclxuXHJcblx0XHRyZXR1cm4gZ2w7XHJcblx0fVxyXG5cclxuXHR2YXIgZ2wgPSBpbml0R0xGcm9tQ2FudmFzKGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2NhbnZhcycpKTtcclxuXHJcblx0Ly8gdHVyYm8uanMgcmVxdWlyZXMgYSAzMmJpdCBmbG9hdCB2ZWM0IHRleHR1cmUuIFNvbWUgc3lzdGVtcyBvbmx5IHByb3ZpZGUgOGJpdC9mbG9hdFxyXG5cdC8vIHRleHR1cmVzLiBBIHdvcmthcm91bmQgaXMgYmVpbmcgY3JlYXRlZCwgYnV0IHR1cmJvLmpzIHNob3VsZG4ndCBiZSB1c2VkIG9uIHRob3NlXHJcblx0Ly8gc3lzdGVtcyBhbnl3YXkuXHJcblx0Ly8gaWYgKCFnbC5nZXRFeHRlbnNpb24oJ09FU190ZXh0dXJlX2Zsb2F0JykpXHJcblx0Ly8gXHR0aHJvdyBuZXcgRXJyb3IoJ3R1cmJvanM6IFJlcXVpcmVkIHRleHR1cmUgZm9ybWF0IE9FU190ZXh0dXJlX2Zsb2F0IG5vdCBzdXBwb3J0ZWQuJyk7XHJcblxyXG5cdC8vIEdQVSB0ZXh0dXJlIGJ1ZmZlciBmcm9tIEpTIHR5cGVkIGFycmF5XHJcblx0ZnVuY3Rpb24gbmV3QnVmZmVyKGRhdGEsIGYsIGUpIHtcclxuXHRcdHZhciBidWYgPSBnbC5jcmVhdGVCdWZmZXIoKTtcclxuXHJcblx0XHRnbC5iaW5kQnVmZmVyKChlIHx8IGdsLkFSUkFZX0JVRkZFUiksIGJ1Zik7XHJcblx0XHRnbC5idWZmZXJEYXRhKChlIHx8IGdsLkFSUkFZX0JVRkZFUiksIG5ldyAoZiB8fCBGbG9hdDMyQXJyYXkpKGRhdGEpLCBnbC5TVEFUSUNfRFJBVyk7XHJcblxyXG5cdFx0cmV0dXJuIGJ1ZjtcclxuXHR9XHJcblxyXG5cdHZhciBwb3NpdGlvbkJ1ZmZlciA9IG5ld0J1ZmZlcihbIC0xLCAtMSwgMSwgLTEsIDEsIDEsIC0xLCAxIF0pO1xyXG5cdHZhciB0ZXh0dXJlQnVmZmVyICA9IG5ld0J1ZmZlcihbICAwLCAgMCwgMSwgIDAsIDEsIDEsICAwLCAxIF0pO1xyXG5cdHZhciBpbmRleEJ1ZmZlciAgICA9IG5ld0J1ZmZlcihbICAxLCAgMiwgMCwgIDMsIDAsIDIgXSwgVWludDE2QXJyYXksIGdsLkVMRU1FTlRfQVJSQVlfQlVGRkVSKTtcclxuXHJcblx0dmFyIHZlcnRleFNoYWRlckNvZGUgPVxyXG5cdFwiYXR0cmlidXRlIHZlYzIgcG9zaXRpb247XFxuXCIgK1xyXG5cdFwidmFyeWluZyB2ZWMyIHBvcztcXG5cIiArXHJcblx0XCJhdHRyaWJ1dGUgdmVjMiB0ZXh0dXJlO1xcblwiICtcclxuXHRcIlxcblwiICtcclxuXHRcInZvaWQgbWFpbih2b2lkKSB7XFxuXCIgK1xyXG5cdFwiICBwb3MgPSB0ZXh0dXJlO1xcblwiICtcclxuXHRcIiAgZ2xfUG9zaXRpb24gPSB2ZWM0KHBvc2l0aW9uLnh5LCAwLjAsIDEuMCk7XFxuXCIgK1xyXG5cdFwifVwiXHJcblxyXG5cdHZhciBzdGRsaWIgPVxyXG5cdFwiXFxuXCIgK1xyXG5cdFwicHJlY2lzaW9uIG1lZGl1bXAgZmxvYXQ7XFxuXCIgK1xyXG5cdFwidW5pZm9ybSBzYW1wbGVyMkQgdV90ZXh0dXJlO1xcblwiICtcclxuXHRcInZhcnlpbmcgdmVjMiBwb3M7XFxuXCIgK1xyXG5cdFwiXFxuXCIgK1xyXG5cdFwidmVjNCByZWFkKHZvaWQpIHtcXG5cIiArXHJcblx0XCIgIHJldHVybiB0ZXh0dXJlMkQodV90ZXh0dXJlLCBwb3MpO1xcblwiICtcclxuXHRcIn1cXG5cIiArXHJcblx0XCJcXG5cIiArXHJcblx0XCJ2b2lkIGNvbW1pdCh2ZWM0IHZhbCkge1xcblwiICtcclxuXHRcIiAgZ2xfRnJhZ0NvbG9yID0gdmFsO1xcblwiICtcclxuXHRcIn1cXG5cIiArXHJcblx0XCJcXG5cIiArXHJcblx0XCIvLyB1c2VyIGNvZGUgYmVnaW5zIGhlcmVcXG5cIiArXHJcblx0XCJcXG5cIlxyXG5cclxuXHR2YXIgdmVydGV4U2hhZGVyID0gZ2wuY3JlYXRlU2hhZGVyKGdsLlZFUlRFWF9TSEFERVIpO1xyXG5cclxuXHRnbC5zaGFkZXJTb3VyY2UodmVydGV4U2hhZGVyLCB2ZXJ0ZXhTaGFkZXJDb2RlKTtcclxuXHRnbC5jb21waWxlU2hhZGVyKHZlcnRleFNoYWRlcik7XHJcblxyXG5cdC8vIFRoaXMgc2hvdWxkIG5vdCBmYWlsLlxyXG5cdGlmICghZ2wuZ2V0U2hhZGVyUGFyYW1ldGVyKHZlcnRleFNoYWRlciwgZ2wuQ09NUElMRV9TVEFUVVMpKVxyXG5cdFx0dGhyb3cgbmV3IEVycm9yKFxyXG5cdFx0XHRcIlxcbnR1cmJvanM6IENvdWxkIG5vdCBidWlsZCBpbnRlcm5hbCB2ZXJ0ZXggc2hhZGVyIChmYXRhbCkuXFxuXCIgKyBcIlxcblwiICtcclxuXHRcdFx0XCJJTkZPOiA+UkVQT1JUPCBUSElTLiBUaGF0J3Mgb3VyIGZhdWx0IVxcblwiICsgXCJcXG5cIiArXHJcblx0XHRcdFwiLS0tIENPREUgRFVNUCAtLS1cXG5cIiArIHZlcnRleFNoYWRlckNvZGUgKyBcIlxcblxcblwiICtcclxuXHRcdFx0XCItLS0gRVJST1IgTE9HIC0tLVxcblwiICsgZ2wuZ2V0U2hhZGVySW5mb0xvZyh2ZXJ0ZXhTaGFkZXIpXHJcblx0XHQpO1xyXG5cclxuXHQvLyBUcmFuc2ZlciBkYXRhIG9udG8gY2xhbXBlZCB0ZXh0dXJlIGFuZCB0dXJuIG9mZiBhbnkgZmlsdGVyaW5nXHJcblx0ZnVuY3Rpb24gY3JlYXRlVGV4dHVyZShkYXRhLCBzaXplKSB7XHJcblx0XHR2YXIgdGV4dHVyZSA9IGdsLmNyZWF0ZVRleHR1cmUoKTtcclxuXHJcblx0XHRnbC5iaW5kVGV4dHVyZShnbC5URVhUVVJFXzJELCB0ZXh0dXJlKTtcclxuXHRcdGdsLnRleFBhcmFtZXRlcmkoZ2wuVEVYVFVSRV8yRCwgZ2wuVEVYVFVSRV9XUkFQX1MsIGdsLkNMQU1QX1RPX0VER0UpO1xyXG5cdFx0Z2wudGV4UGFyYW1ldGVyaShnbC5URVhUVVJFXzJELCBnbC5URVhUVVJFX1dSQVBfVCwgZ2wuQ0xBTVBfVE9fRURHRSk7XHJcblx0XHRnbC50ZXhQYXJhbWV0ZXJpKGdsLlRFWFRVUkVfMkQsIGdsLlRFWFRVUkVfTUlOX0ZJTFRFUiwgZ2wuTkVBUkVTVCk7XHJcblx0XHRnbC50ZXhQYXJhbWV0ZXJpKGdsLlRFWFRVUkVfMkQsIGdsLlRFWFRVUkVfTUFHX0ZJTFRFUiwgZ2wuTkVBUkVTVCk7XHJcblx0XHRnbC50ZXhJbWFnZTJEKGdsLlRFWFRVUkVfMkQsIDAsIGdsLlJHQkEsIHNpemUsIHNpemUsIDAsIGdsLlJHQkEsIGdsLlVOU0lHTkVEX0JZVEUsIGRhdGEpO1xyXG5cdFx0Z2wuYmluZFRleHR1cmUoZ2wuVEVYVFVSRV8yRCwgbnVsbCk7XHJcblxyXG5cdFx0cmV0dXJuIHRleHR1cmU7XHJcblx0fVxyXG5cclxuXHRyZXR1cm4ge1xyXG5cdFx0Ly8gcnVuIGNvZGUgYWdhaW5zdCBhIHByZS1hbGxvY2F0ZWQgYXJyYXlcclxuXHRcdHJ1biA6IGZ1bmN0aW9uKGlwdCwgY29kZSkge1xyXG5cdFx0XHR2YXIgZnJhZ21lbnRTaGFkZXIgPSBnbC5jcmVhdGVTaGFkZXIoZ2wuRlJBR01FTlRfU0hBREVSKTtcclxuXHJcblx0XHRcdGdsLnNoYWRlclNvdXJjZShcclxuXHRcdFx0XHRmcmFnbWVudFNoYWRlcixcclxuXHRcdFx0XHRzdGRsaWIgKyBjb2RlXHJcblx0XHRcdCk7XHJcblxyXG5cdFx0XHRnbC5jb21waWxlU2hhZGVyKGZyYWdtZW50U2hhZGVyKTtcclxuXHJcblx0XHRcdC8vIFVzZSB0aGlzIG91dHB1dCB0byBkZWJ1ZyB0aGUgc2hhZGVyXHJcblx0XHRcdC8vIEtlZXAgaW4gbWluZCB0aGF0IFdlYkdMIEdMU0wgaXMgKiptdWNoKiogc3RyaWN0ZXIgdGhhbiBlLmcuIE9wZW5HTCBHTFNMXHJcblx0XHRcdGlmICghZ2wuZ2V0U2hhZGVyUGFyYW1ldGVyKGZyYWdtZW50U2hhZGVyLCBnbC5DT01QSUxFX1NUQVRVUykpIHtcclxuXHRcdFx0XHR2YXIgTE9DID0gY29kZS5zcGxpdCgnXFxuJyk7XHJcblx0XHRcdFx0dmFyIGRiZ01zZyA9IFwiRVJST1I6IENvdWxkIG5vdCBidWlsZCBzaGFkZXIgKGZhdGFsKS5cXG5cXG4tLS0tLS0tLS0tLS0tLS0tLS0gS0VSTkVMIENPREUgRFVNUCAtLS0tLS0tLS0tLS0tLS0tLS1cXG5cIlxyXG5cclxuXHRcdFx0XHRmb3IgKHZhciBubCA9IDA7IG5sIDwgTE9DLmxlbmd0aDsgbmwrKylcclxuXHRcdFx0XHRcdGRiZ01zZyArPSAoc3RkbGliLnNwbGl0KCdcXG4nKS5sZW5ndGggKyBubCkgKyBcIj4gXCIgKyBMT0NbbmxdICsgXCJcXG5cIjtcclxuXHJcblx0XHRcdFx0ZGJnTXNnICs9IFwiXFxuLS0tLS0tLS0tLS0tLS0tLS0tLS0tIEVSUk9SICBMT0cgLS0tLS0tLS0tLS0tLS0tLS0tLS0tXFxuXCIgKyBnbC5nZXRTaGFkZXJJbmZvTG9nKGZyYWdtZW50U2hhZGVyKVxyXG5cclxuXHRcdFx0XHR0aHJvdyBuZXcgRXJyb3IoZGJnTXNnKTtcclxuXHRcdFx0fVxyXG5cclxuXHRcdFx0dmFyIHByb2dyYW0gPSBnbC5jcmVhdGVQcm9ncmFtKCk7XHJcblxyXG5cdFx0XHRnbC5hdHRhY2hTaGFkZXIocHJvZ3JhbSwgdmVydGV4U2hhZGVyKTtcclxuXHRcdFx0Z2wuYXR0YWNoU2hhZGVyKHByb2dyYW0sIGZyYWdtZW50U2hhZGVyKTtcclxuXHRcdFx0Z2wubGlua1Byb2dyYW0ocHJvZ3JhbSk7XHJcblxyXG5cdFx0XHRpZiAoIWdsLmdldFByb2dyYW1QYXJhbWV0ZXIocHJvZ3JhbSwgZ2wuTElOS19TVEFUVVMpKVxyXG5cdFx0XHRcdHRocm93IG5ldyBFcnJvcigndHVyYm9qczogRmFpbGVkIHRvIGxpbmsgR0xTTCBwcm9ncmFtIGNvZGUuJyk7XHJcblxyXG5cdFx0XHR2YXIgdVRleHR1cmUgPSBnbC5nZXRVbmlmb3JtTG9jYXRpb24ocHJvZ3JhbSwgJ3VfdGV4dHVyZScpO1xyXG5cdFx0XHR2YXIgYVBvc2l0aW9uID0gZ2wuZ2V0QXR0cmliTG9jYXRpb24ocHJvZ3JhbSwgJ3Bvc2l0aW9uJyk7XHJcblx0XHRcdHZhciBhVGV4dHVyZSA9IGdsLmdldEF0dHJpYkxvY2F0aW9uKHByb2dyYW0sICd0ZXh0dXJlJyk7XHJcblxyXG5cdFx0XHRnbC51c2VQcm9ncmFtKHByb2dyYW0pO1xyXG5cclxuXHRcdFx0dmFyIHNpemUgPSBNYXRoLnNxcnQoaXB0LmRhdGEubGVuZ3RoKSAvIDQ7XHJcblx0XHRcdHZhciB0ZXh0dXJlID0gY3JlYXRlVGV4dHVyZShpcHQuZGF0YSwgc2l6ZSk7XHJcblxyXG5cdFx0XHRnbC52aWV3cG9ydCgwLCAwLCBzaXplLCBzaXplKTtcclxuXHRcdFx0Z2wuYmluZEZyYW1lYnVmZmVyKGdsLkZSQU1FQlVGRkVSLCBnbC5jcmVhdGVGcmFtZWJ1ZmZlcigpKTtcclxuXHJcblx0XHRcdC8vIFR5cGVzIGFycmF5cyBzcGVlZCB0aGlzIHVwIHRyZW1lbmRvdXNseS5cclxuXHRcdFx0dmFyIG5UZXh0dXJlID0gY3JlYXRlVGV4dHVyZShuZXcgVWludDhBcnJheShpcHQuZGF0YS5sZW5ndGgpLCBzaXplKTtcclxuXHJcblx0XHRcdGdsLmZyYW1lYnVmZmVyVGV4dHVyZTJEKGdsLkZSQU1FQlVGRkVSLCBnbC5DT0xPUl9BVFRBQ0hNRU5UMCwgZ2wuVEVYVFVSRV8yRCwgblRleHR1cmUsIDApO1xyXG5cclxuXHRcdFx0Ly8gVGVzdCBmb3IgbW9iaWxlIGJ1ZyBNRE4tPldlYkdMX2Jlc3RfcHJhY3RpY2VzLCBidWxsZXQgN1xyXG5cdFx0XHR2YXIgZnJhbWVCdWZmZXJTdGF0dXMgPSAoZ2wuY2hlY2tGcmFtZWJ1ZmZlclN0YXR1cyhnbC5GUkFNRUJVRkZFUikgPT0gZ2wuRlJBTUVCVUZGRVJfQ09NUExFVEUpO1xyXG5cclxuXHRcdFx0Ly8gaWYgKCFmcmFtZUJ1ZmZlclN0YXR1cylcclxuXHRcdFx0Ly8gXHR0aHJvdyBuZXcgRXJyb3IoJ3R1cmJvanM6IEVycm9yIGF0dGFjaGluZyBmbG9hdCB0ZXh0dXJlIHRvIGZyYW1lYnVmZmVyLiBZb3VyIGRldmljZSBpcyBwcm9iYWJseSBpbmNvbXBhdGlibGUuIEVycm9yIGluZm86ICcgKyBmcmFtZUJ1ZmZlclN0YXR1cy5tZXNzYWdlKTtcclxuXHJcblx0XHRcdGdsLmJpbmRUZXh0dXJlKGdsLlRFWFRVUkVfMkQsIHRleHR1cmUpO1xyXG5cdFx0XHRnbC5hY3RpdmVUZXh0dXJlKGdsLlRFWFRVUkUwKTtcclxuXHRcdFx0Z2wudW5pZm9ybTFpKHVUZXh0dXJlLCAwKTtcclxuXHRcdFx0Z2wuYmluZEJ1ZmZlcihnbC5BUlJBWV9CVUZGRVIsIHRleHR1cmVCdWZmZXIpO1xyXG5cdFx0XHRnbC5lbmFibGVWZXJ0ZXhBdHRyaWJBcnJheShhVGV4dHVyZSk7XHJcblx0XHRcdGdsLnZlcnRleEF0dHJpYlBvaW50ZXIoYVRleHR1cmUsIDIsIGdsLkZMT0FULCBmYWxzZSwgMCwgMCk7XHJcblx0XHRcdGdsLmJpbmRCdWZmZXIoZ2wuQVJSQVlfQlVGRkVSLCBwb3NpdGlvbkJ1ZmZlcik7XHJcblx0XHRcdGdsLmVuYWJsZVZlcnRleEF0dHJpYkFycmF5KGFQb3NpdGlvbik7XHJcblx0XHRcdGdsLnZlcnRleEF0dHJpYlBvaW50ZXIoYVBvc2l0aW9uLCAyLCBnbC5GTE9BVCwgZmFsc2UsIDAsIDApO1xyXG5cdFx0XHRnbC5iaW5kQnVmZmVyKGdsLkVMRU1FTlRfQVJSQVlfQlVGRkVSLCBpbmRleEJ1ZmZlcik7XHJcblx0XHRcdGdsLmRyYXdFbGVtZW50cyhnbC5UUklBTkdMRVMsIDYsIGdsLlVOU0lHTkVEX1NIT1JULCAwKTtcclxuXHRcdFx0Ly8gZ2wucmVhZFBpeGVscygwLCAwLCBzaXplLCBzaXplLCBnbC5SR0JBLCBnbC5VTlNJR05FRF9CWVRFLCBpcHQuZGF0YSk7XHJcblx0XHRcdC8vICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXiA0IHggMzIgYml0IF5cclxuXHJcblx0XHRcdHJldHVybiBpcHQuZGF0YS5zdWJhcnJheSgwLCBpcHQubGVuZ3RoKTtcclxuXHRcdH0sXHJcblx0XHRhbGxvYzogZnVuY3Rpb24oc3opIHtcclxuXHRcdFx0Ly8gQSBzYW5lIGxpbWl0IGZvciBtb3N0IEdQVXMgb3V0IHRoZXJlLlxyXG5cdFx0XHQvLyBKUyBmYWxscyBhcGFydCBiZWZvcmUgR0xTTCBsaW1pdHMgY291bGQgZXZlciBiZSByZWFjaGVkLlxyXG5cdFx0XHRpZiAoc3ogPiAxNjc3NzIxNilcclxuXHRcdFx0XHR0aHJvdyBuZXcgRXJyb3IoXCJ0dXJib2pzOiBXaG9vcHMsIHRoZSBtYXhpbXVtIGFycmF5IHNpemUgaXMgZXhjZWVkZWQhXCIpO1xyXG5cclxuXHRcdFx0dmFyIG5zID0gTWF0aC5wb3coTWF0aC5wb3coMiwgTWF0aC5jZWlsKE1hdGgubG9nKHN6KSAvIDEuMzg2KSAtIDEpLCAyKTtcclxuXHRcdFx0cmV0dXJuIHtcclxuXHRcdFx0XHRkYXRhIDogbmV3IFVpbnQ4QXJyYXkobnMgKiAxNiksXHJcblx0XHRcdFx0bGVuZ3RoIDogc3pcclxuXHRcdFx0fTtcclxuXHRcdH1cclxuXHR9O1xyXG5cclxufSkpO1xyXG5cclxuIl19
