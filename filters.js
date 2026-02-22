// Normaliza texto para comparação sem acentos e sem case
const normalizeText = (text) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

const escapeRegex = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const matchesKeyword = (normalizedText, keyword) => {
  const normalizedKeyword = normalizeText(keyword || "");
  if (!normalizedKeyword) return false;
  if (normalizedKeyword.includes(" ")) {
    return normalizedText.includes(normalizedKeyword);
  }
  const pattern = new RegExp(`\\b${escapeRegex(normalizedKeyword)}\\b`);
  return pattern.test(normalizedText);
};

const containsAny = (text, keywords) => {
  const normalizedText = normalizeText(text);
  return keywords.some((keyword) =>
    matchesKeyword(normalizedText, keyword)
  );
};

const isRelevantMessage = (text, config) => {
  if (!text) return false;
  return (
    containsAny(text, config.locationKeywords) ||
    containsAny(text, config.areaKeywords)
  );
};

module.exports = {
  normalizeText,
  containsAny,
  isRelevantMessage,
};
