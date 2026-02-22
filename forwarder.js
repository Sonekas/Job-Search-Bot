// Gera atraso humano entre ações sensíveis
const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const randomDelay = (min, max) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const toMs = (seconds) => Math.max(0, Math.round(seconds * 1000));

const forwardWithDelay = async (message, destinationChat, config) => {
  const { min, max } = config.delaySeconds;
  const minMs = toMs(min);
  const maxMs = toMs(max);
  await sleep(randomDelay(minMs, maxMs));
  await message.forward(destinationChat.id._serialized);
  await sleep(randomDelay(minMs, maxMs));
};

module.exports = {
  forwardWithDelay,
};
