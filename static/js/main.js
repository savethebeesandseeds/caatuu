import { initResizers } from './resizers.js';
import { bindEvents, syncSettingsUI, requestNewChallenge, handleMessage, initTTS } from './ui.js';
import { connectWS, setOnMessage, setConnDotEl } from './socket.js';
import { $ } from './utils.js';

(function init(){
  setOnMessage(handleMessage);
  setConnDotEl($('#connDot'));
  connectWS();          // auto-fallback to mock
  initResizers();
  initTTS();            // ← populate TTS voices + hooks
  bindEvents();
  syncSettingsUI();
  requestNewChallenge();
})();
