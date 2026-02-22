const fs = require("fs");
const path = require("path");

// Cria diretório de logs quando necessário
const ensureDirectory = (directory) => {
  if (fs.existsSync(directory)) return;
  fs.mkdirSync(directory, { recursive: true });
};

const appendLog = async (entry, config) => {
  if (!config.logging.enabled) return;

  ensureDirectory(config.logging.directory);
  const filePath = path.join(
    config.logging.directory,
    config.logging.fileName
  );

  await fs.promises.appendFile(
    filePath,
    `${JSON.stringify(entry)}\n`,
    "utf8"
  );
};

module.exports = {
  appendLog,
};
