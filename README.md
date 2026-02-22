# Bot de Filtro de Vagas (WhatsApp)

Bot em Node.js que lê mensagens de grupos do WhatsApp, aplica filtros por palavras-chave (área e/ou localização) e encaminha apenas as mensagens relevantes para um grupo destino. Inclui uma interface web por etapas (QR → Configuração → Execução) para facilitar o uso.

## Principais recursos

- UI por etapas (QR Code → Configuração → Execução)
- Seleção de múltiplos grupos monitorados
- Processamento sequencial por grupo (evita sobrecarga)
- Filtro: mensagem passa se bater em **área OU localização**
- Logs em tempo real na UI (sem salvar conteúdo sensível por padrão)

## Requisitos

- Node.js 20+
- Google Chrome/Chromium disponível (usado pelo WhatsApp Web via Puppeteer)

## Como rodar (local)

1) Instale dependências:

```bash
npm install
```

2) (Opcional) Crie um arquivo `.env` na raiz do projeto (ele NÃO deve ser commitado).

Exemplo de variáveis:

```env
MONITORED_GROUPS=Grupo A,Grupo B
DESTINATION_GROUP=Grupo Destino
LOCATION_KEYWORDS=Brasília,Asa Sul,Sudoeste
AREA_KEYWORDS=ti,dados,power bi
DELAY_MIN_SEC=2
DELAY_MAX_SEC=6

# Logs em arquivo (opcional). Padrão: desativado.
LOG_ENABLED=false
LOG_DIR=logs
LOG_FILE=forwarded.jsonl

# UI (padrão: só localhost)
UI_PORT=3000
UI_HOST=127.0.0.1
```

3) Inicie:

```bash
node index.js
```

4) Abra a interface:

- http://127.0.0.1:3000

Fluxo:

- Escaneie o QR Code
- Configure grupos, destino, palavras-chave e delays
- Clique em “Iniciar leitura”

## Segurança e privacidade

- **Nunca** commite `.env` (config local) nem `.wwebjs_auth/` (sessão do WhatsApp).
- A UI, por padrão, roda somente em `127.0.0.1` para evitar acesso por terceiros na rede.
- Logs em arquivo ficam **desativados por padrão** e, mesmo ligados, não salvam o texto integral da mensagem.

## Observações

- Este projeto depende de automação via WhatsApp Web. Use com responsabilidade e esteja ciente de possíveis limitações/regras da plataforma.

