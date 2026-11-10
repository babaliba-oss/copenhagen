import './style.css';
import './loading-screen.css';
import './boot-art.css'; // with the page's own stylesheet: the title picture shows as soon as it is there, not once the game's code has arrived
import {installGameResilience} from './game-resilience.js';

const resilience=installGameResilience();
import('./main.js').catch(error=>resilience.fail(error,'startup'));
