# Korbit: установка на VPS (Ubuntu 22.04/24.04)

## 1. Подготовь Git-репозиторий

На локальной машине в корне проекта:

```bash
git init
git branch -M main
git add .
git commit -m "chore: initial korbit step1"
```

Создай пустой репозиторий на GitHub/GitLab, затем:

```bash
git remote add origin <YOUR_REPO_URL>
git push -u origin main
```

## 2. Подготовь VPS

Подключение:

```bash
ssh <user>@<vps_ip>
```

Обнови систему и поставь базовые пакеты:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl gnupg lsb-release git ufw
```

Открой firewall:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

## 3. Установи Docker + Compose plugin

```bash
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo $VERSION_CODENAME) stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER
newgrp docker
docker --version
docker compose version
```

## 4. Склонируй проект на VPS

```bash
cd /opt
sudo git clone <YOUR_REPO_URL> korbit
sudo chown -R $USER:$USER /opt/korbit
cd /opt/korbit
```

## 5. Настрой production env

```bash
cp .env.vps.example .env.vps
nano .env.vps
```

Обязательно измени:
- `POSTGRES_PASSWORD`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `ADMIN_PASSWORD`
- `CORS_ORIGIN` (например `https://chat.example.com`)
- `NEXT_PUBLIC_API_URL` (например `https://api.example.com`)

## 6. Запусти Korbit в Docker

```bash
docker compose --env-file .env.vps -f docker-compose.vps.yml up -d --build
```

Проверь:

```bash
docker compose --env-file .env.vps -f docker-compose.vps.yml ps
curl http://127.0.0.1:4000/health
```

Ожидается `{"status":"ok",...}`.

## 7. Поставь Nginx и прокси на web/api

```bash
sudo apt install -y nginx
```

Создай конфиг `/etc/nginx/sites-available/korbit`:

```nginx
server {
    server_name chat.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    server_name api.example.com;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Активируй:

```bash
sudo ln -s /etc/nginx/sites-available/korbit /etc/nginx/sites-enabled/korbit
sudo nginx -t
sudo systemctl reload nginx
```

## 8. Включи HTTPS (Let’s Encrypt)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d chat.example.com -d api.example.com
```

Проверь автопродление:

```bash
sudo systemctl status certbot.timer
```

## 9. Первый вход в систему

Логинься в web (`https://chat.example.com`) с:
- username: `ADMIN_USERNAME` из `.env.vps`
- password: `ADMIN_PASSWORD` из `.env.vps`

После первого входа:
1. создай инвайт;
2. создай обычного пользователя;
3. смени админский пароль;
4. при необходимости отключи bootstrap:
   - `ADMIN_BOOTSTRAP_ENABLED=false` в `.env.vps`;
   - `docker compose --env-file .env.vps -f docker-compose.vps.yml up -d`.

## 10. Обновление приложения

```bash
cd /opt/korbit
git pull
docker compose --env-file .env.vps -f docker-compose.vps.yml up -d --build
```

## 11. Бэкап PostgreSQL

Создать dump:

```bash
mkdir -p /opt/korbit/backups
docker exec -t korbit_postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > /opt/korbit/backups/korbit_$(date +%F_%H-%M).sql
```

Восстановить:

```bash
cat /opt/korbit/backups/<dump_file>.sql | docker exec -i korbit_postgres psql -U "$POSTGRES_USER" "$POSTGRES_DB"
```

## 12. Полезная диагностика

```bash
docker compose --env-file .env.vps -f docker-compose.vps.yml logs -f api
docker compose --env-file .env.vps -f docker-compose.vps.yml logs -f web
docker compose --env-file .env.vps -f docker-compose.vps.yml restart api web
```

