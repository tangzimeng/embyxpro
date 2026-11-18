#!/bin/sh
set -e

# 默认参数
APP_LANG=${APP_LANG:-zh}
APP_PORT=${APP_PORT:-8090}

echo "EmbyX Pro (fnOS gateway) configuration:"
echo " - Language:  $APP_LANG"
echo " - Port:      $APP_PORT"

# 1. 按语言把前端部署到网关的 web 根目录（网关 webRoot = $TRIM_APPDEST/www）
rm -rf /app/www/*
if [ "$APP_LANG" = "zh" ]; then
    echo "Deploying Chinese version..."
    cp -rf /app/dist/zh/* /app/www/
else
    echo "Deploying English version..."
    cp -rf /app/dist/en/* /app/www/
fi

# 2. 架构自适应选择网关二进制
ARCH=$(uname -m)
case "$ARCH" in
    x86_64|amd64)
        PROXY_BIN=/app/bin/proxy-x86_64
        ;;
    aarch64|arm64)
        PROXY_BIN=/app/bin/proxy-aarch64
        ;;
    *)
        echo "[错误] 不支持的 CPU 架构: $ARCH" >&2
        exit 1
        ;;
esac

if [ ! -x "$PROXY_BIN" ]; then
    echo "[错误] 网关二进制不存在或不可执行: $PROXY_BIN" >&2
    exit 1
fi

# 3. 网关所需环境变量
# TRIM_APPDEST：网关据此定位 www 静态目录与 app.sock
# PORT：网关 TCP 监听端口（必须与映射端口一致）
# EMBYX_LOG_DIR：网关日志目录（Dockerfile 已建好）
export TRIM_APPDEST=/app
export PORT="${APP_PORT}"
export EMBYX_LOG_DIR=${EMBYX_LOG_DIR:-/app/logs}
mkdir -p "$EMBYX_LOG_DIR"

echo " - Gateway:   $PROXY_BIN ($ARCH)"
echo " - WebRoot:   /app/www"
echo " - LogDir:    $EMBYX_LOG_DIR"
echo "启动飞牛适配网关，监听 :$APP_PORT ..."

# 4. 启动网关（网关自身同时提供静态页面与 API 反代，无需 nginx）
exec "$PROXY_BIN"
