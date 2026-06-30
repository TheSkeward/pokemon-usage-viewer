import "./styles/main.css";
import { mountPoolOptimizer } from "./poolWidget";
import { startUpdateNotifier } from "./updateNotifier";

const app = document.querySelector("#pool-app");

mountPoolOptimizer(app, {
  embedded: false,
});

startUpdateNotifier();
