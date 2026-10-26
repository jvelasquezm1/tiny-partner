// Downloads and caches the embedding model at image build time, so the first question is fast.
import { Embedder } from "./embedder.js";

await new Embedder().embedQuery("warm up");
console.log("embedding model cached");
