import './styles/main.css';
import { mountPoolOptimizer } from './pool-widget';
import { startUpdateNotifier } from './update-notifier';

const app = document.querySelector('#pool-app');

mountPoolOptimizer(app, {
  embedded: false,
});

startUpdateNotifier();
