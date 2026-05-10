#!/usr/bin/env sh
# girl-agent — universal installer
#
#   curl -fsSL https://raw.githubusercontent.com/TheSashaDev/girl-agent/master/scripts/install.sh | sh
#
# Что делает:
#   1. Не требует node на машине — скачивает official Node.js 22 LTS в локальный
#      каталог ~/.local/share/girl-agent/runtime/ (без sudo, без /usr/local).
#   2. Ставит сам пакет `@thesashadev/girl-agent` в тот же изолированный prefix.
#   3. Кладёт shim-скрипт `girl-agent` в ~/.local/bin/.
#   4. Если уже есть docker — предлагает docker-вариант (ещё меньше зависит от
#      системы, ноль шансов на конфликты версий).
#   5. Не трогает существующий node, npm, ничего глобально.
#
# Поддерживается: linux x86_64/aarch64, macOS x86_64/arm64, WSL.
# В чистом Windows — используй .exe инсталлер из github releases.

set -eu

# -------- pretty output --------
_color() { if [ -t 2 ] && command -v tput >/dev/null 2>&1; then printf "%s" "$(tput "$@")"; fi; }
B=$(_color bold); D=$(_color sgr0); G=$(_color setaf 2); R=$(_color setaf 1); Y=$(_color setaf 3); BLUE=$(_color setaf 4)
say() { printf "%s[girl-agent]%s %s\n" "$B" "$D" "$1" >&2; }
ok()  { printf "%s[girl-agent]%s %s%s%s\n" "$B" "$D" "$G" "$1" "$D" >&2; }
warn(){ printf "%s[girl-agent]%s %s%s%s\n" "$B" "$D" "$Y" "$1" "$D" >&2; }
die() { printf "%s[girl-agent]%s %sошибка:%s %s\n" "$B" "$D" "$R" "$D" "$1" >&2; exit 1; }

# -------- CLI flags --------
MODE="auto"        # auto | local | docker
NODE_VERSION="22.12.0"
PKG_VERSION="latest"
PREFIX="$HOME/.local/share/girl-agent"
BIN_DIR="$HOME/.local/bin"
DATA_DIR="$HOME/.local/share/girl-agent/data"
DOCKER_IMAGE="ghcr.io/thesashadev/girl-agent:latest"
SKIP_PATH=0
QUIET=0

while [ $# -gt 0 ]; do
  case "$1" in
    --docker) MODE="docker" ;;
    --local) MODE="local" ;;
    --node-version=*) NODE_VERSION="${1#*=}" ;;
    --version=*) PKG_VERSION="${1#*=}" ;;
    --prefix=*) PREFIX="${1#*=}" ;;
    --bin-dir=*) BIN_DIR="${1#*=}" ;;
    --skip-path) SKIP_PATH=1 ;;
    --quiet|-q) QUIET=1 ;;
    -h|--help) cat <<EOF
girl-agent universal installer

usage:
  curl -fsSL .../install.sh | sh
  curl -fsSL .../install.sh | sh -s -- --docker
  curl -fsSL .../install.sh | sh -s -- --local --node-version=22.12.0

flags:
  --docker            форсировать docker-вариант
  --local             форсировать локальную ноду + npm install
  --node-version=X.Y.Z   нужная версия node (по умолч. ${NODE_VERSION})
  --version=X.Y.Z     версия @thesashadev/girl-agent (по умолч. latest)
  --prefix=<dir>      куда ставить (по умолч. \$HOME/.local/share/girl-agent)
  --bin-dir=<dir>     куда положить shim (по умолч. \$HOME/.local/bin)
  --skip-path         не модифицировать ~/.bashrc / ~/.zshrc
  -q, --quiet         тише

После установки:
  girl-agent              # запуск ink-визарда (нужен TTY)
  girl-agent server --help

Удаление:
  rm -rf "${PREFIX}" "${BIN_DIR}/girl-agent"
EOF
      exit 0 ;;
    *) die "неизвестный флаг: $1 (--help для справки)" ;;
  esac
  shift
done

# -------- detect platform --------
detect_os() {
  case "$(uname -s)" in
    Linux*) echo "linux" ;;
    Darwin*) echo "darwin" ;;
    CYGWIN*|MINGW*|MSYS*) echo "win" ;;
    *) die "неподдерживаемая ОС: $(uname -s). для windows используй .exe инсталлер." ;;
  esac
}
detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64) echo "x64" ;;
    aarch64|arm64) echo "arm64" ;;
    armv7l) echo "armv7l" ;;
    *) die "неподдерживаемая архитектура: $(uname -m)" ;;
  esac
}

OS=$(detect_os)
ARCH=$(detect_arch)
say "детект: ${OS}-${ARCH}"

# -------- determine mode --------
if [ "$MODE" = "auto" ]; then
  if [ -n "${TERMUX_VERSION:-}" ] || command -v termux-info >/dev/null 2>&1; then
    say "termux обнаружен — используем termux-режим (через системный pkg)"
    MODE="termux"
  elif command -v docker >/dev/null 2>&1; then
    say "docker найден — используем docker-режим (нет конфликтов версий)"
    MODE="docker"
  else
    say "docker не найден — используем локальный режим (изолированная нода)"
    MODE="local"
  fi
fi

# -------- common: ensure dirs --------
mkdir -p "$BIN_DIR" "$DATA_DIR"

# -------- mode: docker --------
install_docker() {
  command -v docker >/dev/null 2>&1 || die "docker не установлен. установи docker desktop / docker engine, или используй --local."
  say "тяну ${DOCKER_IMAGE} (это занимает 30-60 сек)..."
  if ! docker pull "$DOCKER_IMAGE" >&2; then
    warn "не удалось pull образ (приватный пакет или нет сети)"
    warn "переключаюсь на локальный режим (изолированная нода)..."
    install_local
    return
  fi

  cat >"$BIN_DIR/girl-agent" <<'SHIM'
#!/usr/bin/env sh
# girl-agent docker shim
set -eu
IMAGE="${GIRL_AGENT_IMAGE:-ghcr.io/thesashadev/girl-agent:latest}"
DATA="${GIRL_AGENT_DATA_HOST:-$HOME/.local/share/girl-agent/data}"
mkdir -p "$DATA"

# Если stdin/stdout оба TTY — запускаем интерактивно (ink-визард работает).
# Иначе — обычный pipe (для systemd / cron / docker logs).
TTY_FLAGS="-i"
if [ -t 0 ] && [ -t 1 ]; then
  TTY_FLAGS="-it"
fi

exec docker run --rm $TTY_FLAGS \
  -v "$DATA:/data" \
  -e "GIRL_AGENT_DATA=/data" \
  -e "TERM=${TERM:-xterm-256color}" \
  "$IMAGE" "$@"
SHIM
  chmod +x "$BIN_DIR/girl-agent"
  ok "docker shim установлен: ${BIN_DIR}/girl-agent"
}

# -------- mode: termux --------
install_termux() {
  NODE="$(command -v node || echo "")"
  NPM="$(command -v npm || echo "")"
  
  if [ -x "$NODE" ]; then
    say "nodejs уже установлен, пропускаю установку через pkg..."
  else
    say "устанавливаю nodejs через pkg..."
    if command -v pkg >/dev/null 2>&1; then
      # Игнорируем ошибку update (например, если зеркало недоступно), но пытаемся установить nodejs
      pkg update -y || warn "pkg update завершился с ошибкой, продолжаю установку..."
      pkg install -y nodejs-lts || warn "pkg install nodejs-lts завершился с ошибкой"
    else
      warn "команда pkg не найдена, не могу установить nodejs"
    fi
    
    NODE="$(command -v node || echo "")"
    NPM="$(command -v npm || echo "")"
    
    if [ ! -x "$NODE" ]; then
      die "node не установился. Если проблема с репозиториями Termux, выполните 'termux-change-repo', выберите другие зеркала и запустите скрипт заново."
    fi
  fi

  say "ставлю утилиты сборки (python, make, clang, binutils) для нативных модулей npm..."
  if command -v pkg >/dev/null 2>&1; then
    pkg install -y python make clang binutils || warn "не удалось установить инструменты сборки, установка может упасть."
  fi

  say "ставлю PM2 для фоновой работы..."
  "$NPM" install -g pm2 --loglevel error || warn "не удалось установить PM2 глобально."

  say "активирую wake-lock (предотвращение сна)..."
  termux-wake-lock || warn "не удалось активировать wake-lock."

  say "ставлю @thesashadev/girl-agent@${PKG_VERSION} в ${PREFIX}/lib..."
  mkdir -p "$PREFIX/lib"
  
  if ! "$NPM" install --prefix "$PREFIX/lib" --no-audit --no-fund --no-optional --ignore-scripts --loglevel error "@thesashadev/girl-agent@${PKG_VERSION}"; then
    warn "Возможные причины ошибки в Termux:"
    warn "1. Нехватка памяти (OOM) — закройте тяжелые приложения в фоне Android."
    warn "2. Отсутствие нужных библиотек. Читайте ошибку выше (обычно node-gyp rebuild failed)."
    die "npm install не удался. Посмотрите ошибки выше."
  fi

  cat >"$BIN_DIR/girl-agent" <<EOF
#!/usr/bin/env sh
# girl-agent termux shim — generated by install.sh
exec "$NODE" "${PREFIX}/lib/node_modules/@thesashadev/girl-agent/dist/cli.js" "\$@"
EOF
  chmod +x "$BIN_DIR/girl-agent"
  ok "termux установка готова: ${BIN_DIR}/girl-agent"
  ok "node:    $("$NODE" --version)"
  ok "package: ${PKG_VERSION}"
}

# -------- mode: local --------
install_local() {
  say "ставлю изолированную ноду v${NODE_VERSION} в ${PREFIX}/runtime/"
  mkdir -p "$PREFIX/runtime"

  NODE_TARBALL_NAME="node-v${NODE_VERSION}-${OS}-${ARCH}.tar.xz"
  NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_TARBALL_NAME}"
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT

  if [ -x "$PREFIX/runtime/bin/node" ] && [ "$("$PREFIX/runtime/bin/node" --version 2>/dev/null)" = "v${NODE_VERSION}" ]; then
    say "node v${NODE_VERSION} уже распакован, пропускаю."
  else
    say "качаю ${NODE_URL}"
    if command -v curl >/dev/null 2>&1; then
      curl -fsSL "$NODE_URL" -o "$TMP/node.tar.xz" || die "не удалось скачать ноду"
    elif command -v wget >/dev/null 2>&1; then
      wget -q "$NODE_URL" -O "$TMP/node.tar.xz" || die "не удалось скачать ноду"
    else
      die "ни curl, ни wget не найдены"
    fi
    say "распаковываю..."
    tar -xJf "$TMP/node.tar.xz" -C "$TMP" || die "tar -xJ не сработал (нужен xz)"
    rm -rf "$PREFIX/runtime"
    mv "$TMP/node-v${NODE_VERSION}-${OS}-${ARCH}" "$PREFIX/runtime"
  fi

  NODE="$PREFIX/runtime/bin/node"
  NPM="$PREFIX/runtime/bin/npm"
  [ -x "$NODE" ] || die "node не нашёлся в $PREFIX/runtime/bin/"

  say "ставлю @thesashadev/girl-agent@${PKG_VERSION} в локальный prefix..."
  mkdir -p "$PREFIX/lib"
  # `npm install --prefix <dir>` — изолированная установка, не трогает глобал
  "$NODE" "$NPM" install --prefix "$PREFIX/lib" --no-audit --no-fund --silent "@thesashadev/girl-agent@${PKG_VERSION}" \
    || die "npm install не удался"

  cat >"$BIN_DIR/girl-agent" <<EOF
#!/usr/bin/env sh
# girl-agent local node shim — generated by install.sh
exec "${PREFIX}/runtime/bin/node" "${PREFIX}/lib/node_modules/@thesashadev/girl-agent/dist/cli.js" "\$@"
EOF
  chmod +x "$BIN_DIR/girl-agent"
  ok "локальная установка готова: ${BIN_DIR}/girl-agent"
  ok "node:    $("$NODE" --version) (изолированная)"
  ok "package: ${PKG_VERSION}"
}

# -------- run install --------
case "$MODE" in
  docker) install_docker ;;
  local) install_local ;;
  termux) install_termux ;;
  *) die "неизвестный режим: $MODE" ;;
esac

# -------- PATH hint --------
case ":$PATH:" in
  *":$BIN_DIR:"*) ok "${BIN_DIR} уже в PATH" ;;
  *)
    if [ "$SKIP_PATH" = "1" ]; then
      warn "${BIN_DIR} не в PATH; --skip-path указан, ничего не дописываю."
      warn "запускай через полный путь: ${BIN_DIR}/girl-agent"
    else
      RC=""
      [ -f "$HOME/.zshrc" ] && RC="$HOME/.zshrc"
      [ -z "$RC" ] && [ -f "$HOME/.bashrc" ] && RC="$HOME/.bashrc"
      [ -z "$RC" ] && [ -f "$HOME/.profile" ] && RC="$HOME/.profile"
      if [ -z "$RC" ] && [ -n "${TERMUX_VERSION:-}" ]; then
        RC="$HOME/.bashrc"
        touch "$RC"
        ok "создал $RC для Termux"
      fi

      if [ -n "$RC" ]; then
        if ! grep -qF ".local/bin" "$RC" 2>/dev/null; then
          printf '\n# added by girl-agent install.sh\nexport PATH="$HOME/.local/bin:$PATH"\n' >>"$RC"
          ok "добавил .local/bin в PATH через $RC"
          warn "перезапусти shell или выполни: export PATH=\"\$HOME/.local/bin:\$PATH\""
        else
          ok "$RC уже добавляет .local/bin в PATH"
        fi
      else
        warn "shell rc-файл не найден; добавь сам: export PATH=\"\$HOME/.local/bin:\$PATH\""
      fi
    fi
    ;;
esac

cat >&2 <<EOF

готово. что дальше:

  ${B}girl-agent${D}                    # ink-визард (нужен обычный терминал с TTY)
  ${B}girl-agent server --help${D}      # серверный режим (config-файл / env vars)
  ${B}girl-agent server --print-config > bot.json${D}
  ${B}girl-agent server --config bot.json --headless${D}
EOF

if [ "$MODE" = "termux" ]; then
cat >&2 <<EOF

${B}${Y}Termux Hosting Tips:${D}
  - Чтобы бот не засыпал: ${G}termux-wake-lock${D} (уже активно)
  - Для фоновой работы используй PM2:
      ${BLUE}pm2 start girl-agent -- server --headless --profile=ВАШ_ПРОФИЛЬ${D}
  - В настройках Android ${Y}отключи оптимизацию батареи${D} для Termux.
EOF
fi

cat >&2 <<EOF

профили хранятся в: ${DATA_DIR}
обновить: запусти install.sh ещё раз
удалить: rm -rf ${PREFIX} ${BIN_DIR}/girl-agent

EOF
