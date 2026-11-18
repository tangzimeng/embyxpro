# Dockerfile for EmbyX Pro
# 内置飞牛适配 Go 网关：网关同时负责静态页面服务 + 飞牛影视/Emby/Jellyfin API 反代
# 行为等同官方 fpk，部署时用 host 网络，网关可直接访问宿主机飞牛影视 127.0.0.1:8005
FROM alpine:latest
WORKDIR /app

# 中英文前端源码
COPY zh/ /app/dist/zh/
COPY en/ /app/dist/en/

# 飞牛适配网关（架构自适应，纯静态二进制，musl/glibc 均可）
COPY docker/bin/proxy-x86_64 /app/bin/proxy-x86_64
COPY docker/bin/proxy-aarch64 /app/bin/proxy-aarch64

# 启动脚本
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh /app/bin/proxy-x86_64 /app/bin/proxy-aarch64 \
    && mkdir -p /app/www /app/logs

# 默认语言与端口
ENV APP_LANG=zh
ENV APP_PORT=8090
ENV TRIM_APPDEST=/app
ENV EMBYX_LOG_DIR=/app/logs

EXPOSE 8090

ENTRYPOINT ["/entrypoint.sh"]
