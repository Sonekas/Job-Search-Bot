🚀 Job Search Filter Bot (WhatsApp)

Automação inteligente para filtrar e organizar vagas de emprego recebidas em grupos do WhatsApp.

Este bot monitora grupos selecionados, aplica filtros personalizados por área profissional e/ou localização, e encaminha apenas as mensagens relevantes para um grupo de destino — reduzindo ruído e aumentando eficiência na busca por oportunidades.

📌 Problema que resolve

Grupos de vagas no WhatsApp costumam apresentar:

Alto volume de mensagens irrelevantes

Falta de organização

Informações repetidas

Perda de oportunidades por excesso de ruído

Este projeto automatiza esse processo, funcionando como um filtro inteligente de oportunidades.

💡 Visão de Produto (Evolução Comercial)

Este projeto começou como uma solução pessoal para otimizar minha busca por vagas.

Porém, a arquitetura foi pensada para permitir evolução futura para um modelo mais comercial e aplicável ao mercado de trabalho, como por exemplo:

🔹 Plataforma SaaS de curadoria automática de vagas

🔹 Ferramenta para recrutadores filtrarem candidatos automaticamente

🔹 Sistema de triagem automatizada por palavras-chave

🔹 Monitoramento inteligente de oportunidades em múltiplas fontes

A ideia é evoluir o bot de um uso pessoal para uma solução escalável e útil para empresas e profissionais.

⚙️ Tecnologias Utilizadas

Node.js 20+

Automação do WhatsApp Web (Puppeteer)

Interface Web com fluxo guiado

Variáveis de ambiente (.env)

Processamento assíncrono controlado

Sistema opcional de logs

🧠 Arquitetura e Decisões Técnicas

✔ Processamento sequencial por grupo (reduz risco de bloqueio)

✔ Delay configurável para simular comportamento humano

✔ Filtro flexível (Área OU Localização)

✔ Interface isolada por padrão (127.0.0.1)

✔ Logs desativados por padrão (privacy-first)

✔ Estrutura preparada para futura integração com banco de dados

🎯 Funcionalidades

🔎 Monitoramento de múltiplos grupos

🧠 Filtro inteligente por palavras-chave

🔁 Encaminhamento automático

🖥 Interface Web com fluxo por etapas:

QR Code

Configuração

Execução

📊 Logs em tempo real

⚙ Configuração via .env ou interface

🛠 Como Rodar Localmente
1️⃣ Instalar dependências
npm install
2️⃣ Criar arquivo .env (opcional)
MONITORED_GROUPS=Grupo A,Grupo B
DESTINATION_GROUP=Grupo Destino
LOCATION_KEYWORDS=Brasília,Asa Sul,Sudoeste
AREA_KEYWORDS=ti,dados,power bi
DELAY_MIN_SEC=2
DELAY_MAX_SEC=6

LOG_ENABLED=false
LOG_DIR=logs
LOG_FILE=forwarded.jsonl

UI_PORT=3000
UI_HOST=127.0.0.1
3️⃣ Iniciar aplicação
node index.js
4️⃣ Acessar interface
http://127.0.0.1:3000
🔐 Segurança

.env e .wwebjs_auth/ devem estar no .gitignore

Interface acessível apenas localmente por padrão

Logs não armazenam o texto integral das mensagens

Projeto destinado a uso responsável

📈 Roadmap Futuro

Dashboard com métricas e estatísticas

Banco de dados estruturado

Sistema de pontuação por relevância (score)

API REST para integração externa

Deploy em VPS com autenticação

Transformação em produto SaaS

🧑‍💻 Sobre o Projeto

Este projeto demonstra habilidades em:

Automação web

Arquitetura backend em Node.js

Controle de concorrência

Design de fluxo de usuário

Pensamento de produto

Planejamento de escalabilidade

⚠ Aviso

Este projeto depende da automação do WhatsApp Web.
Use com responsabilidade e respeite as políticas da plataforma.
