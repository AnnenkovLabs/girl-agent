# Girl-Agent — шпаргалка 10 команд

## 1. Подключиться к NAS
```bash
ssh -i /home/node/.openclaw/workspace/id_ed25519_nas -p 29 -o StrictHostKeyChecking=no root@192.168.31.166
```

## 2. Перейти в репозиторий
```bash
cd /volume1/docker/girl-agent/repo
```

## 3. Проверить статус контейнера
```bash
docker compose -f deploy/synology/docker-compose.yml ps
```

## 4. Посмотреть runtime-логи контейнера
```bash
docker compose -f deploy/synology/docker-compose.yml logs --tail=100 girl-agent
```

## 5. Посмотреть лог поведения профиля
```bash
sed -n '1,240p' /volume1/docker/girl-agent/repo/data/girl/log/$(date +%F).md
```

## 6. Посмотреть текущий group config
```bash
python3 - <<'PY'
import json
p='/volume1/docker/girl-agent/repo/data/girl/config.json'
with open(p,'r',encoding='utf-8') as f:
    cfg=json.load(f)
print(json.dumps(cfg['group'], ensure_ascii=False, indent=2))
PY
```

## 7. Перезапустить сервис
```bash
docker compose -f deploy/synology/docker-compose.yml restart girl-agent
```

## 8. Пересобрать и поднять заново
```bash
docker compose -f deploy/synology/docker-compose.yml build girl-agent && docker compose -f deploy/synology/docker-compose.yml up -d girl-agent
```

## 9. Сделать backup перед изменениями
```bash
BASE=/volume1/docker/girl-agent; BACK=$BASE/backups; TS=$(date +%Y%m%d-%H%M%S); mkdir -p "$BACK"; tar -czf "$BACK/repo-$TS.tgz" -C "$BASE" repo; ls -lh "$BACK/repo-$TS.tgz"
```

## 10. Проверить OmniRoute с NAS
```bash
curl -s http://127.0.0.1:20128/v1/models | head
```

## Быстрая логика диагностики
- личка работает, группа молчит -> смотри `allowedChatIds`, `allowedUserIds`, `message_thread_id`
- контейнер падает -> смотри `docker compose ... logs`
- бот молчит везде -> проверь OmniRoute key/baseURL и Telegram token
