# 星虚对弈

多人在线抽象五子棋对战游戏。

## 快速部署

### 方式一：Node.js 直接部署

```bash
# 1. 上传项目到服务器
scp gomoku-online.tar.gz user@your-server:/opt/

# 2. 解压并安装依赖
ssh user@your-server
cd /opt && tar xzf gomoku-online.tar.gz && cd gomoku-online
npm ci --production

# 3. 启动（前台）
node server.js

# 4. 或用 systemd 守护进程（推荐）
sudo cp deploy/gomoku.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now gomoku
sudo systemctl status gomoku
```

### 方式二：Docker 部署

```bash
# 构建镜像
docker build -t gomoku .

# 运行
docker run -d --name gomoku -p 3000:3000 --restart unless-stopped gomoku

# 或使用 docker-compose
docker compose up -d
```

### 方式三：PM2 部署

```bash
npm install -g pm2
pm2 start server.js --name gomoku
pm2 save && pm2 startup
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | 3000 | 服务端口 |

## 反向代理（Nginx 示例）

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

> WebSocket 需要 `Upgrade` 和 `Connection` 头，上面的配置已包含。

## 游戏特色

- 2人/3人对战模式
- 角色名称自定义
- 四大全局法则（吞噬/衰变/超新星/裂隙）可开关
- 八大个人技能选2携带：飞沙走石、静如止水、擒拿、力拔山兮、偷梁换柱、斗转星移、无懈可击、暗度陈仓
