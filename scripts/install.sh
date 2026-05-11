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
# Поддерживается: linux x86_64/aarch64, macOS x86_64/arm64, WSL, Android (Termux).
# В чистом Windows — используй .exe инсталлер из github releases.

set -eu

# -------- pretty output --------
_color() { if [ -t 2 ] && command -v tput >/dev/null 2>&1; then printf "%s" "$(tput "$@")"; fi; }
B=$(_color bold); D=$(_color sgr0); G=$(_color setaf 2); R=$(_color setaf 1); Y=$(_color setaf 3)
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
# Termux — это не обычный linux: бинарники с nodejs.org там не работают (другой ABI),
# нужен Termux-native node через `pkg install nodejs`.
# Сохраняем оригинальный $PREFIX (в Termux это путь к рантайму, типа /data/data/com.termux/files/usr),
# чтобы не конфликтовать с нашим script-локальным $PREFIX для установки.
TERMUX_NATIVE_PREFIX="${PREFIX:-}"
is_termux() {
  if [ -n "${TERMUX_VERSION:-}" ]; then return 0; fi
  if [ -d "/data/data/com.termux/files/usr" ]; then return 0; fi
  if [ -n "$TERMUX_NATIVE_PREFIX" ] && [ -d "$TERMUX_NATIVE_PREFIX/bin" ] && command -v termux-info >/dev/null 2>&1; then return 0; fi
  return 1
}
detect_os() {
  if is_termux; then echo "termux"; return; fi
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

# Termux: используем нативный node из pkg, ставим глобально (в $PREFIX/lib/node_modules).
# PATH уже содержит $PREFIX/bin — ничего настраивать не нужно.
if [ "$OS" = "termux" ]; then
  TERMUX_RUNTIME_PREFIX="${TERMUX_NATIVE_PREFIX:-/data/data/com.termux/files/usr}"
  BIN_DIR="${TERMUX_RUNTIME_PREFIX}/bin"
  # runtime использует os.homedir()/.local/share/girl-agent/data — на Termux это валидный путь
  DATA_DIR="$HOME/.local/share/girl-agent/data"
  MODE="termux"
  say "детектирован Termux (Android) — runtime в ${TERMUX_RUNTIME_PREFIX}, data в $DATA_DIR"
fi

# -------- determine mode --------
if [ "$MODE" = "auto" ]; then
  if [ "$OS" = "termux" ]; then
    say "Termux — docker не поддерживается, используем нативный node из pkg"
    MODE="termux"
  elif command -v docker >/dev/null 2>&1; then
    say "docker найден — используем docker-режим (нет конфликтов версий)"
    MODE="docker"
  else
    say "docker не найден — используем локальный режим (изолированная нода)"
    MODE="local"
  fi
elif [ "$OS" = "termux" ] && [ "$MODE" != "termux" ]; then
  warn "в Termux работает только termux-режим (--docker/--local не поддерживаются), переключаю"
  MODE="termux"
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

# -------- mode: termux --------
# В Termux не качаем nodejs.org — бинарники оттуда линкуются против glibc, а в Termux его нет (bionic).
# Используем нативный node из `pkg install nodejs`.
install_termux() {
  if ! command -v node >/dev/null 2>&1; then
    say "node не найден в Termux — ставлю через pkg..."
    if ! command -v pkg >/dev/null 2>&1; then
      die "pkg не найден — это не Termux? Поставь Termux из F-Droid: https://f-droid.org/packages/com.termux/"
    fi
    pkg update -y >&2 || warn "pkg update с ошибкой, продолжаю"
    pkg install -y nodejs >&2 || die "не удалось pkg install nodejs"
  fi
  say "node: $(node --version) (termux-native)"

  # Глобальная установка в Termux работает прямолинейно — npm пишет в $PREFIX/lib/node_modules
  # и кладёт shim в $PREFIX/bin. Никаких sudo не нужно.
  say "ставлю @thesashadev/girl-agent@${PKG_VERSION} глобально (в Termux $PREFIX)"
  npm install -g --no-audit --no-fund "@thesashadev/girl-agent@${PKG_VERSION}" >&2 \
    || die "npm install -g не удался"

  ok "Termux-установка готова"
  ok "node:    $(node --version)"
  ok "package: ${PKG_VERSION}"
  ok "data:    $DATA_DIR"
}

# -------- run install --------
case "$MODE" in
  docker) install_docker ;;
  local) install_local ;;
  termux) install_termux ;;
  *) die "неизвестный режим: $MODE" ;;
esac

# -------- PATH hint --------
if [ "$OS" = "termux" ]; then
  # в Termux $PREFIX/bin всегда в PATH — ничего не нужно добавлять
  ok "PATH в Termux уже содержит npm-prefix/bin"
else
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
fi

if [ "$OS" = "termux" ]; then
  cat >&2 <<EOF

готово (Termux). что дальше:

  ${B}girl-agent${D}                    # открывает WebUI на http://localhost:3000
  ${B}girl-agent server --help${D}      # серверный режим (config-файл / env vars)

профили хранятся в: ${DATA_DIR}
открой WebUI в браузере на том же телефоне: http://localhost:3000
чтобы не убивался процесс при блокировке экрана:
  ${B}termux-wake-lock${D}
проверить нет ли проблем с storage:
  ${B}termux-setup-storage${D}

обновить: npm install -g @thesashadev/girl-agent@latest
удалить: npm uninstall -g @thesashadev/girl-agent

EOF
else
  cat >&2 <<EOF

готово. что дальше:

  ${B}girl-agent${D}                    # открывает WebUI на http://localhost:3000
  ${B}girl-agent server --help${D}      # серверный режим (config-файл / env vars)
  ${B}girl-agent server --print-config > bot.json${D}
  ${B}girl-agent server --config bot.json --headless${D}

профили хранятся в: ${DATA_DIR}
обновить: запусти install.sh ещё раз
удалить: rm -rf ${PREFIX} ${BIN_DIR}/girl-agent

EOF
fi
