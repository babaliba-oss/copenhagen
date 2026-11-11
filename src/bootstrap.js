import './style.css';
import './loading-screen.css';
import './boot-art.css'; // with the page's own stylesheet: the title picture shows as soon as it is there, not once the game's code has arrived
import {installGameResilience} from './game-resilience.js';
import {initLanguage} from './i18n.js';

initLanguage(); // EN / DA (Copenhagen): with Danish chosen the dictionary loads beside the game, not after it

const resilience=installGameResilience();
import('./main.js').catch(error=>resilience.fail(error,'startup'));
