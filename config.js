const dotenv = require("dotenv");

dotenv.config();

const parseList = (value, fallback) => {
  if (!value || !value.trim()) return fallback;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const getConfig = () => {
  const monitoredGroups = parseList(process.env.MONITORED_GROUPS, [
    "Vagas DF",
    "Empregos Brasília",
    "Oportunidades TI DF",
  ]);

  const destinationGroup =
    process.env.DESTINATION_GROUP || "Vagas Filtradas Pedro";

  const locationKeywords = parseList(process.env.LOCATION_KEYWORDS, [
    "Cruzeiro",
    "Asa Sul",
    "Asa Norte",
    "Sudoeste",
    "Guará",
    "Brasília",
    "DF",
  ]);

  const areaKeywords = parseList(process.env.AREA_KEYWORDS, [
    "administrativo",
    "estágio",
    "ti",
    "tecnologia",
    "dados",
    "suporte",
    "sistemas",
    "power bi",
    "banco de dados",
  ]);

  const delayMinSecEnv = toNumber(process.env.DELAY_MIN_SEC);
  const delayMaxSecEnv = toNumber(process.env.DELAY_MAX_SEC);
  const delayMinMsEnv = toNumber(process.env.DELAY_MIN_MS);
  const delayMaxMsEnv = toNumber(process.env.DELAY_MAX_MS);

  const delayMinSec =
    delayMinSecEnv ??
    (delayMinMsEnv !== null ? delayMinMsEnv / 1000 : 2);
  const delayMaxSec =
    delayMaxSecEnv ??
    (delayMaxMsEnv !== null ? delayMaxMsEnv / 1000 : 6);

  return {
    monitoredGroups,
    destinationGroup,
    locationKeywords,
    areaKeywords,
    delaySeconds: {
      min: delayMinSec,
      max: delayMaxSec,
    },
    logging: {
      enabled: process.env.LOG_ENABLED === "true",
      directory: process.env.LOG_DIR || "logs",
      fileName: process.env.LOG_FILE || "forwarded.jsonl",
    },
  };
};

module.exports = {
  getConfig,
};
