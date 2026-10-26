import { hydrate } from "preact";
import { App } from "./app";
import { decodeBootstrap } from "./bootstrap";

const root = document.getElementById("app");
const encoded = root?.dataset.bootstrap;
if (root && encoded) hydrate(<App {...decodeBootstrap(encoded)} />, root);
