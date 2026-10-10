import { Game } from './game.js';

const $ = (id) => document.getElementById(id);
const game = new Game($('app'), {
  overlay: $('overlay'),
  overlayTitle: $('overlay-title'),
  play: $('play'),
  hotbar: $('hotbar'),
  blockName: $('block-name'),
  debug: $('debug'),
});
window.__game = game;
game.start();
