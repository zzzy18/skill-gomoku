# 贡献指南

感谢你愿意参与「星虚对弈 / skill-gomoku」开发！

## 环境要求

- Node.js ≥ 18
- npm ≥ 9

## 本地开发

```bash
git clone git@github.com:zzzy18/skill-gomoku.git
cd skill-gomoku
npm install
npm run dev          # 启动开发服务（带 --watch 自动重启）
```

打开浏览器访问 `http://localhost:3000`。

## 运行测试

```bash
npm test
```

测试基于 Node 内置 `node:test`，无额外框架依赖。新增规则相关 PR 请补充对应单测，至少覆盖：

- 边界情况（落子越界、对手位置、空位）
- 全局法则交互（吞噬 / 衰变 / 裂隙 / 超新星 / 血战清场）
- 技能交互（无懈可击保护、擒拿打断、暗度陈仓真假棋胜利判定）

## 代码风格

- 缩进：2 空格、`LF` 行尾、UTF-8（详见 `.editorconfig`）
- 模块组织：
  - `server.js` 仅做 HTTP / WS 接入与消息分发
  - 规则相关的纯函数从 `server.js` 导出，方便测试
  - `config/rules.js` 集中所有数值常量，**不要在业务代码里写魔法数字**
- 协议变更：每次新增或修改 WebSocket 消息，请同步更新 `PROTOCOL.md` 与 `validate.js` 中的校验逻辑

## 提交规范

推荐使用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans)：

```
feat:     新功能
fix:      修复 bug
refactor: 重构（不改变行为）
perf:     性能改进
docs:     文档
test:     测试
chore:    构建 / 工具链 / 依赖
```

示例：
```
feat(skill): 新增"乾坤一掷"技能
fix(server): 修正暗度陈仓被对手撞破后的状态泄漏
```

## Pull Request

1. Fork → 新建分支 → 提交改动
2. 确保 `npm test` 通过
3. 如改动了协议或规则，同步更新 `PROTOCOL.md` / `README.md`
4. 发起 PR，描述清楚动机、改动点、潜在影响

## 报告 Issue

请尽量提供：

- 复现步骤、期望结果、实际结果
- Node 版本、操作系统
- 服务端日志（`console.log` 输出）和浏览器 console 错误

谢谢！
