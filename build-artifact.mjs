// Membuat versi artifact (halaman hosted) dari index.html.
// Halaman hosted sudah menyediakan <!doctype>, <head>, dan <body> sendiri,
// jadi yang dikirim hanya <title>, <style>, dan isi <body>.
//
//   node build-artifact.mjs        -> menulis dist/artifact.html
//
// index.html tetap satu-satunya sumber kebenaran; jangan sunting hasil build.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const src = await readFile(resolve(root, "index.html"), "utf8");

const pick = (re, label) => {
  const m = src.match(re);
  if (!m) throw new Error(`Tidak menemukan ${label} di index.html`);
  return m[1];
};

const title = pick(/<title>([\s\S]*?)<\/title>/, "<title>").trim();
const style = pick(/<style>([\s\S]*?)<\/style>/, "<style>");
const body = pick(/<body>([\s\S]*?)<\/body>/, "<body>").trim();

const out = `<title>${title}</title>\n<style>${style}</style>\n${body}\n`;

await mkdir(resolve(root, "dist"), { recursive: true });
await writeFile(resolve(root, "dist/artifact.html"), out);
console.log(`dist/artifact.html — ${out.length} bytes`);
