// Load a TS module straight from src/ so a test can never run against a
// stale build copy. Only for modules with no runtime imports (type-only
// imports are erased); anything with a real import needs its own setup.
// Runs in THIS context on purpose: objects from a fresh vm context have a
// different Array/Object realm and every deepStrictEqual would fail.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');

module.exports = function loadTs(relativePath) {
  const source = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} };
  const run = vm.runInThisContext(
    `(function (exports, module) {\n${javascript}\n})`,
    { filename: relativePath },
  );
  run(mod.exports, mod);
  return mod.exports;
};
