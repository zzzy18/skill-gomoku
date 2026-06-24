# 星虚对弈 (skill-gomoku)

[![CI](https://github.com/zzzy18/skill-gomoku/actions/workflows/ci.yml/badge.svg)](https://github.com/zzzy18/skill-gomoku/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen)](https://nodejs.org/)

> 多人在线 **抽象五子棋** 对战：在标准 15×15 棋盘上叠加 **全局法则** 与 **个人技能**，支持 2/3 人对战、人机对战（三档难度）、经典/血战双模式。

## 游戏特色

- 2/3 人在线对战 + 人机对战（简单 / 进阶 / 宗师）
- **四大全局法则** 可开关：吞噬 / 衰变 / 超新星 / 裂隙
- **八大个人技能** 选 2 携带：飞沙走石、静如止水、擒拿、力拔山兮、偷梁换柱、斗转星移、无懈可击、暗度陈仓
- 经典模式 vs 血战模式（连击清场 + 累计积分胜利）
- 在线悔棋协商
- 角色昵称自定义

## 项目结构

```
.
├── server.js              # HTTP 静态服务 + WebSocket 主入口 + 规则引擎
├── ai-engine.js           # AI 决策引擎（简单 / 中等 / 困难）
├── validate.js            # WS 入参 schema 校验 + 令牌桶限流
├── config/
│   └── rules.js           # 集中管理所有规则常量（冷却 / 阈值 / 网络参数等）
├── public/
│   └── index.html         # 前端单文件（HTML + CSS + JS + WS 客户端）
├── test/
│   ├── rules.test.js      # 规则引擎单元测试
│   └── validate.test.js   # 输入校验测试
├── deploy/
│   ├── nginx.conf         # 反代示例
│   └── gomoku.service     # systemd 单元
├── Dockerfile             # 多阶段构建，非 root 用户，HEALTHCHECK
├── docker-compose.yml
└── .github/workflows/ci.yml
```

## 快速开始

### 本地开发

```bash
git clone git@github.com:zzzy18/skill-gomoku.git
cd skill-gomoku
npm install
npm run dev          # node --watch server.js（默认 PORT=3000）
```

浏览器打开 `http://localhost:3000`。

### 运行测试

```bash
npm test
```

基于 Node 内置 `node:test`，**零额外依赖**。

## 部署

### 方式一：Node.js 直接部署

```bash
# 1. 上传项目到服务器
scp -r ./skill-gomoku user@your-server:/opt/

# 2. 安装依赖
ssh user@your-server
cd /opt/skill-gomoku && npm ci --omit=dev

# 3. 启动（前台）
node server.js

# 4. 或用 systemd 守护进程
sudo cp deploy/gomoku.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now gomoku
sudo systemctl status gomoku
```

### 方式二：Docker

```bash
# 单容器
docker build -t gomoku .
docker run -d --name gomoku -p 3000:3000 --restart unless-stopped gomoku

# 或使用 docker compose
docker compose up -d
```

### 方式三：PM2

```bash
npm install -g pm2
pm2 start server.js --name gomoku
pm2 save && pm2 startup
```

### 反向代理（Nginx 示例）

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
    }
}
```

> WebSocket 需要 `Upgrade` 和 `Connection` 头，上面的配置已包含；完整文件见 `deploy/nginx.conf`。

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | 服务监听端口 |

## 调参与配置

所有规则常量都集中在 [`config/rules.js`](config/rules.js)，可以在不改业务代码的情况下做平衡调整：

| 配置 | 默认值 | 含义 |
|---|---|---|
| `rules.decayTurns` | 12 | 棋子衰变（→ 废墟）回合数 |
| `rules.ruinDuration` | 10 | 废墟消失回合数 |
| `rules.rift.interval` / `duration` | 5 / 4 | 裂隙生成周期与存活回合 |
| `rules.mountainMinTurn` | 50 | 力拔山兮可用的最低回合数 |
| `rules.blood.fiveCount` / `scoreToWin` | 5 / 20 | 血战胜利门槛 |
| `skills.sandstorm.cooldown` | 5 | 飞沙走石冷却 |
| `skills.swapPos.cooldown` | 4 | 移形换影冷却 |
| `skills.move.cooldown` | 5 | 斗转星移冷却 |
| `skills.swap.duration` | 3 | 偷梁换柱维持回合 |
| `skills.pendingTimerMs` | 1500 | 擒拿响应窗口（ms） |
| `net.maxPayloadBytes` | 8192 | 单条 WS 消息上限 |
| `net.rateLimit` | `{40, 20}` | 令牌桶容量/补给速率（次/秒） |

## 协议参考

WebSocket 完整消息协议见 [`PROTOCOL.md`](PROTOCOL.md)。

## 贡献

欢迎提 Issue 与 PR，开发流程见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

## License

[MIT](LICENSE)
