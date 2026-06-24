# WebSocket 协议参考

> 适用版本：`gomoku-online@1.1.x`
> 通信地址：`ws(s)://<host>:<port>/`（与 HTTP 同端口）
> 编码：UTF-8 JSON 字符串；单条消息体上限 **8 KB**

## 通用规则

- 客户端 → 服务端：消息必须是合法 JSON 对象，**必须**含 `type` 字段。
- 服务端 → 客户端：消息均为 JSON 对象，含 `type` 字段。
- 棋盘坐标 `r / c / fr / fc / tr / tc / myR / myC / opR / opC` 均必须是 `0..14` 之间的整数。
- 字符串字段长度限制：`name ≤ 8`、`roomId ≤ 16`、`chat.text ≤ 200`。
- 服务端会对所有入站消息做 schema 校验，违反会回 `{type:'error', message:'...'}`。
- 单连接限流：令牌桶容量 40、每秒补 20；超限同样返回 `error`。

## 棋盘状态枚举

| 值 | 含义 |
|---|---|
| 0 | EMPTY 空 |
| 1 | P1 玩家一 |
| 2 | P2 玩家二 |
| 3 | P3 玩家三（3 人模式） |
| 4 | RUIN 废墟 |
| 5 | RIFT 裂隙 |

## 全局法则与游戏模式

| 字段 | 取值 | 说明 |
|---|---|---|
| `globalSettings.devour` | bool | 吞噬法则 |
| `globalSettings.decay`  | bool | 衰变法则 |
| `globalSettings.nova`   | bool | 超新星法则 |
| `globalSettings.rift`   | bool | 裂隙法则 |
| `gameMode` | `'classic' \| 'blood'` | 经典 / 血战 |

## 客户端 → 服务端消息

### 房间生命周期

#### `create` 创建房间

```json
{
  "type": "create",
  "mode": 2,                  // 2 | 3
  "names": {"1":"星辰","2":"虚空"},
  "gameMode": "classic",       // 'classic' | 'blood'
  "aiMode": false,             // 可选；true=人机对战
  "aiDifficulty": "medium"     // 'simple' | 'medium' | 'hard'
}
```

#### `join` 加入房间

```json
{"type":"join","roomId":"ABCDE","name":"玩家2"}
```

#### `setName` 修改昵称

```json
{"type":"setName","name":"星辰"}
```

#### `toggleSetting` 切换全局法则（仅房主）

```json
{"type":"toggleSetting","key":"devour"}  // key ∈ devour|decay|nova|rift
```

#### `equipSkills` 选定技能（最多 2 个）

```json
{"type":"equipSkills","skills":["sandstorm","intercept"]}
```

#### `startGame` 开始（仅房主）

```json
{"type":"startGame"}
```

#### `restart` 请求再来一局

```json
{"type":"restart"}
```

#### `reconnect` 断线重连

```json
{"type":"reconnect","roomId":"ABCDE","sessionToken":"<服务端在 joined 中下发的 token>"}
```

- 客户端应在收到 `joined` 时持久化 `sessionToken`（如 `sessionStorage`）。
- 连接异常断开后，**60 秒宽限期**内（默认值，可通过 `config.net.reconnectGraceMs` 调整）携带原 token 即可恢复座位。
- 重连成功时服务端会回发：
  - `joined`（`reconnected: true`，原 `role` / `playerIndex` / `sessionToken`）
  - `roomUpdate`（最新房间元数据）
  - `update` (`action: 'reconnect'`)，附带个性化 `snapshot`
- 超过宽限期或 token 不匹配会回 `{type:'error', message:'会话凭证无效'}` 或 `'房间不存在或已过期'`。

### 对局操作

#### `place` 落子

```json
{"type":"place","r":7,"c":7}
```

#### `useSkill` 主动技能

| `skill` | 字段 |
|---|---|
| `sandstorm` 飞沙走石 | `r`, `c` |
| `swap` 偷梁换柱 | `r`, `c` |
| `swapPos` 移形换影 | `myR`, `myC`, `opR`, `opC` |
| `move` 斗转星移 | `fr`, `fc`, `tr`, `tc` |
| `mountain` 力拔山兮 | 无 |
| `ambush` 暗度陈仓 | 无（开启后接两次 `place`） |

被动技能 `intercept` / `impervious` 不通过此消息触发：
- `intercept` 在对手 `pendingSkill` 期间通过下方独立消息发起
- `impervious` 自动生效

```json
{"type":"useSkill","skill":"sandstorm","r":5,"c":5}
{"type":"useSkill","skill":"move","fr":7,"fc":7,"tr":6,"tc":7}
```

#### `intercept` 擒拿打断

```json
{"type":"intercept"}
```

#### `supernova` / `dismissNova` 超新星

形成四连后由本方决定是否引爆：

```json
{"type":"supernova"}      // 引爆
{"type":"dismissNova"}    // 放弃
```

#### `undoRequest` / `undoResponse` 悔棋

```json
{"type":"undoRequest"}
{"type":"undoResponse","accepted":true}
```

AI 房间会自动接受悔棋请求。

### 聊天

```json
{"type":"chat","text":"打得不错"}
```

## 服务端 → 客户端消息

### 状态/通知

| `type` | 触发时机 | 关键字段 |
|---|---|---|
| `joined`        | 加入房间后 / 重连成功 | `roomId`, `role`, `playerIndex`, `mode`, `names`, `aiMode`, `gameMode`, `sessionToken`, `reconnected?` |
| `roomUpdate`    | 房间内任何元数据变化 | `players[]`, `settings`, `names`, `mode`, `allSkills`, `equipped`, `gameMode` |
| `playerDisconnected` | 玩家断开但仍在宽限期 | `playerIndex`, `role`, `graceMs` |
| `playerReconnected`  | 玩家重连成功 | `playerIndex`, `role` |
| `playerLeft`    | 玩家彻底离开（宽限期超时或未开局直接断开） | `playerIndex`, `role` |
| `gameStart`     | 房主发 `startGame` | `snapshot`, `names`, `mode`, `aiMode`, `gameMode` |
| `restartRequested` | 一方申请重开 | — |
| `restarted`     | 双方就绪后开新局 | `snapshot`, `names`, `mode`, `gameMode` |
| `error`         | 入参校验失败 / 限流 / 业务错误 | `message` |

### 棋局事件

| `type` | 携带字段（除通用 `snapshot` 外） |
|---|---|
| `update`           | `action`, `devoured`, `ambushComplete?`, `fakePos?`, `bloodClear?`, `bloodMode?` |
| `skill`            | `action='skill'`, `skill`, 以及对应技能的参数 |
| `skillPending`     | `skill`, `player`, 以及 r/c/myR/myC/... |
| `skillApplied`     | `skill`, `player`, 以及对应坐标 |
| `intercept`        | `interceptor`, `originalPlayer`, `interceptedSkill` |
| `ambushFake`       | `player`, `r`, `c` |
| `ambushExposed`    | `owner`, `pos` |
| `undoRequestPending` | `from` |
| `undoAccepted`     | `from`, `undone` |
| `undoRejected`     | `from` |
| `chat`             | `from`, `text` |

### Snapshot 结构（核心字段）

```ts
{
  board: number[15][15],          // 含暗度陈仓视角隔离后的棋盘
  stoneAge: number[15][15],
  riftAge: number[15][15],
  ruinAge: number[15][15],
  currentPlayer: 1 | 2 | 3,
  totalMoves: number,
  gameOver: boolean,
  winCells: [r, c][],
  novaLine: { cells: [r,c][], player } | null,
  scores: { [role]: number },
  skipNext: number[],
  globalSettings: { devour, decay, nova, rift },
  pendingSkill: { type, player, r?, c?, myR?, myC?, opR?, opC? } | null,
  equipped: { [role]: string[] },
  skillState: { [role]: { [skillId]: cooldown } },
  sandstormLastUsed: { [role]: number },
  gameMode: 'classic' | 'blood',
  bloodWinCondition: { fiveCount: number, bloodScore: number },
  targetScore: number,
  bloodScores: { [role]: number },
  ambushPhase: 'fake' | 'real' | null,
  ambushPlayer: number | null,
  ambushFakePos: [r,c] | null,
  ambushRealPos: [r,c] | null,
  ambushHidden: { [key]: role },     // "r,c"=真棋子, "fake_r_c"=假棋子
  ambushFakePositions: [r, c, owner][],
  swapMap: { [key]: { owner, turnsLeft } }
}
```

> 不同玩家收到的 `snapshot.board` 不同：暗度陈仓的真棋子对**非施法者**显示为 `EMPTY`。

## 错误响应

```json
{"type":"error","message":"<人类可读的中文原因>"}
```

常见原因：

- `不是你的回合`
- `此处不可落子`
- `等待技能结算`
- `飞沙走石冷却中，还需 N 回合`
- `回合数不足 50`
- `暗度陈仓全局只能使用一次，你已经用过了`
- `请求过于频繁，请稍候再试`（限流）
- `位置非法` / `未知消息类型` / `chat 内容非法`（schema 校验）

## 心跳

服务端每 30 秒发送一次 WebSocket `ping` 帧。客户端正常实现 WS 协议即可（浏览器原生 `WebSocket` 自动响应 pong）。连续未响应会被服务端 `terminate`。

## 协议演进

- 当前未声明版本号字段，未来可能新增 `v` 字段做向前兼容协商。
- 字段只增不删；如必须删除会同步在 `CHANGELOG` 中标记。
