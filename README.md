MyPainel
Painel web em Node.js para gerenciar usuários SSH em VPS Linux.
Criar / editar / apagar usuários
Limite de conexões e data de expiração
Monitoramento em tempo real (CPU, RAM, rede, ping, speedtest)
Teste grátis público (`/teste`)
Sistema de revendas
Integração opcional com DragonCoreSSH
Repositório: https://github.com/Willapela/mypainel
---
Requisitos
Linux (Ubuntu / Debian recomendado)
Node.js 18+
Acesso root (para `useradd`, `chpasswd`, `userdel`, `chage`)
Opcional: `ping`, `curl`, `speedtest` (Ookla)
```bash
# Node 18+ (exemplo Ubuntu)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
node -v
```
---
Instalação rápida
```bash
# 1) Clone
git clone https://github.com/Willapela/mypainel.git
cd mypainel

# 2) Dependências
npm install

# 3) Configuração
cp .env.example .env
nano .env
```
Gerar senha do admin
```bash
node -e "console.log(require('bcryptjs').hashSync('SUA_SENHA', 12))"
```
Cole o hash em `ADMIN_HASH` no `.env`. Defina também:
```env
ADMIN_USER=admin
SESSION_SECRET=troque_por_uma_string_longa_aleatoria_24+
```
Iniciar
```bash
node server.js
```
Ou com PM2:
```bash
npm install -g pm2
pm2 start server.js --name mypainel
pm2 save
pm2 startup
```
Painel em: `http://127.0.0.1:3100` (ou a porta do `.env`).
---
Atualizar
```bash
cd mypainel
git pull
npm install
pm2 restart mypainel
```
---
Configuração (`.env`)
Obrigatório
```env
USERS_FILE=/root/usuarios.db
MIN_UID=1000

ADMIN_USER=admin
ADMIN_HASH='cole_o_hash_aqui'
SESSION_SECRET=string_aleatoria_minimo_24_caracteres

HOST=127.0.0.1
PORT=3100
NODE_ENV=production
```
Teste grátis (`/teste`)
```env
TESTE_ENABLED=1
TESTE_HORAS=2
TESTE_MAX_DIA=30
TESTE_LIMITE=1
WHATSAPP=5591999999999
TESTE_MSG=Olá! Fiz o teste grátis e quero contratar.
SERVER_HOST=seu.ip.ou.dominio
SSH_PORT=22

# Opcional — Cloudflare Turnstile
TURNSTILE_SITEKEY=
TURNSTILE_SECRET=

# Opcional — botão de download do app
APP_DOWNLOAD_URL=https://seu-link.com/app.apk
APP_DOWNLOAD_LABEL=Baixar aplicativo
```
Acesse: `http://SEU_DOMINIO/teste`
DragonCoreSSH (opcional)
```env
DRAGONCORE_ENABLED=1
DRAGONCORE_URL=http://127.0.0.1:9090
DRAGONCORE_USER=admin
DRAGONCORE_PASS=senha_do_admin_dragoncore
```
Quando ativo, criar/editar/apagar usuário no MyPainel também sincroniza no DragonCore.
---
Funcionalidades
Recurso	Descrição
Usuários SSH	Criar, senha, expiração (DD/MM/YYYY), limite, excluir
Online	Conexões ativas e tempo online
Revendas	Contas com limite de usuários (admin)
Monitoramento	CPU real, RAM real, rede, ping, speedtest Ookla
Teste grátis	Página pública com WhatsApp e link do app
Avatares	Automáticos por nome (masculino/feminino)
DragonCore	Sync opcional via API HTTP
Monitoramento
Métrica	Como mede
CPU	`/proc/stat` (uso real)
RAM	`MemAvailable` em `/proc/meminfo`
Rede	`/proc/net/dev`
Ping	a cada ~12s → `1.1.1.1`
Speedtest	Ookla a cada 5 min (botão “Rodar agora” disponível)
---
Nginx (recomendado)
```nginx
server {
    listen 80;
    server_name painel.seudominio.com;

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
```bash
certbot --nginx -d painel.seudominio.com
```
Deixe `HOST=127.0.0.1` no `.env` para não expor o Node direto.
---
Estrutura
```
mypainel/
├── server.js
├── package.json
├── .env.example
├── data/painel.json
├── public/           # painel logado
└── public-teste/     # página /teste
```
---
API (resumo)
Método	Rota	Descrição
POST	`/api/login`	Login
GET	`/api/metrics`	CPU, RAM, rede, ping, speed
GET/POST/PUT/DELETE	`/api/users`	Usuários
GET	`/api/online`	Online
GET/POST/PUT/DELETE	`/api/revendas`	Revendas
GET	`/api/config`	Config do teste
POST	`/api/teste`	Gerar teste grátis
---
Troubleshooting
Não inicia
```bash
grep -E 'ADMIN_USER|ADMIN_HASH|SESSION_SECRET' .env
# SESSION_SECRET precisa ter 24+ caracteres
node server.js
```
Speedtest
```bash
which speedtest || echo "Instale o Ookla CLI; sem ele usa fallback Cloudflare"
```
DragonCore
```bash
curl -s -X POST "http://127.0.0.1:9090/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"SENHA"}'
pm2 logs mypainel | grep DragonCore
```
Teste grátis
`TESTE_ENABLED=1` e reinicie o processo
URL: `/teste`
---
Licença
Uso operacional em VPS própria. Gerenciar usuários do sistema exige privilégios elevados — use com cuidado.
---
https://github.com/Willapela/mypainel
