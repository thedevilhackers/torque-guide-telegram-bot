// Entry point for `npm start`. It checks the Node.js version before loading anything that
// needs a recent Node, so an old install gets a clear message instead of a crash.
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(
    `\nStore POS needs Node.js 22.13 or newer, but this computer has Node.js ${process.versions.node}.\n` +
      `Install the current LTS version from https://nodejs.org, close and reopen the terminal,\n` +
      `then run "npm start" again in the store-pos folder.\n`
  );
  process.exit(1);
}

// Node prints a one-time "SQLite is an experimental feature" notice; hide only that kind of warning.
const emitWarning = process.emitWarning;
process.emitWarning = function (warning, ...args) {
  const type = typeof args[0] === "string" ? args[0] : args[0]?.type;
  if (type === "ExperimentalWarning" || warning?.name === "ExperimentalWarning") return;
  return emitWarning.call(process, warning, ...args);
};

const { main } = await import("./server.js");
main();
