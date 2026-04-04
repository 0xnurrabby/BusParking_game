(function () {
  'use strict';

  class WebAppImpl {
    constructor() {
      this._audioElements = [];
      this._pausedAudioElements = [];
      this._audioContexts = [];
      this._pausedAudioContexts = [];
      this.initialize();
    }

    initialize() {
      if (!Audio.prototype.webapp_play) {
        Audio.prototype.webapp_play = Audio.prototype.play;
        Audio.prototype.play = function () {
          window.WebApp.addAudioElement(this);
          return this.webapp_play(arguments);
        };
      }
      if (!AudioContext.prototype.webapp_createBufferSource) {
        AudioContext.prototype.webapp_createBufferSource =
          AudioContext.prototype.createBufferSource;
        AudioContext.prototype.createBufferSource = function () {
          const result = this.webapp_createBufferSource(arguments);
          window.WebApp.addAudioContext(this);
          return result;
        };
      }
      if (!AudioContext.prototype.webapp_createConstantSource) {
        AudioContext.prototype.webapp_createConstantSource =
          AudioContext.prototype.createConstantSource;
        AudioContext.prototype.createConstantSource = function () {
          const result = this.webapp_createConstantSource(arguments);
          window.WebApp.addAudioContext(this);
          return result;
        };
      }
      if (!AudioContext.prototype.webapp_createMediaElementSource) {
        AudioContext.prototype.webapp_createMediaElementSource =
          AudioContext.prototype.createMediaElementSource;
        AudioContext.prototype.createMediaElementSource = function () {
          const result = this.webapp_createMediaElementSource(arguments);
          window.WebApp.addAudioContext(this);
          return result;
        };
      }
      if (!AudioContext.prototype.webapp_createMediaStreamSource) {
        AudioContext.prototype.webapp_createMediaStreamSource =
          AudioContext.prototype.createMediaStreamSource;
        AudioContext.prototype.createMediaStreamSource = function () {
          const result = this.webapp_createMediaStreamSource(arguments);
          window.WebApp.addAudioContext(this);
          return result;
        };
      }
      if (typeof window.NativeApp !== 'undefined') {
        window.NativeApp.onReady();
      }
    }

    addAudioElement(element) {
      if (this._audioElements.includes(element)) {
        return;
      }
      this._audioElements.push(element);
    }

    addAudioContext(context) {
      if (this._audioContexts.includes(context)) {
        return;
      }
      this._audioContexts.push(context);
    }

    pauseAudio() {
      let result = 0;
      let audioElements = Array.from(document.querySelectorAll('audio'));
      audioElements = audioElements.concat(this._audioElements);
      for (const audioElement of audioElements) {
        if (!audioElement.paused) {
          audioElement.pause();
          this._pausedAudioElements.push(audioElement);
          result++;
        }
      }

      for (const audioContext of this._audioContexts) {
        if (audioContext.state === 'running') {
          audioContext.suspend();
          this._pausedAudioContexts.push(audioContext);
          result++;
        }
      }
      return result;
    }

    resumeAudio() {
      let result = 0;
      for (const audioElement of this._pausedAudioElements) {
        if (audioElement.webapp_play) {
          audioElement.webapp_play();
        } else {
          audioElement.play();
        }
        result++;
      }
      this._pausedAudioElements = [];

      for (const audioContext of this._pausedAudioContexts) {
        audioContext.resume();
        result++;
      }
      this._pausedAudioContexts = [];

      return result;
    }
  }

  window.WebApp = new WebAppImpl();
})();
