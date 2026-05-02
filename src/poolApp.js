import './styles/main.css';
import { mountPoolOptimizer } from './poolWidget';

const app = document.querySelector('#pool-app');

mountPoolOptimizer(app, {
  embedded: false,
});
