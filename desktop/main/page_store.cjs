const fs = require("node:fs");
const path = require("node:path");

function ensureShellPage(cacheDir, fileName, html) {
  const pageDir = path.join(cacheDir, "shell-pages");
  fs.mkdirSync(pageDir, { recursive: true });

  const targetPath = path.join(pageDir, fileName);
  fs.writeFileSync(targetPath, html, "utf8");
  return targetPath;
}

module.exports = {
  ensureShellPage
};
