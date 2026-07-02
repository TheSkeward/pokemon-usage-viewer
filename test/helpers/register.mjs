// Entry for `node --import`: installs the loader hooks so app modules resolve.
import { register } from "node:module";
register("./loader.mjs", import.meta.url);
