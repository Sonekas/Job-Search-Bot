// Garante extração segura de texto da mensagem
const extractText = (message) => {
  if (!message) return "";
  if (typeof message.body === "string") return message.body;
  if (typeof message.caption === "string") return message.caption;
  return "";
};

module.exports = {
  extractText,
};
