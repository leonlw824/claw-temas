# Gateway 事件接口文档

## Gateway 消息格式概览

Gateway 通过 WebSocket 发送的消息有三种主要格式：

### 1. 响应消息（Response）
```typescript
{
  type: "res",
  id: string,
  ok: boolean,
  payload?: unknown,
  error?: {
    message?: string;
    code?: number;
  }
}
```

### 2. 事件消息（Event）
```typescript
{
  type: "event",
  event: string,  // 事件名称，如 "chat", "agent", "channel.status"
  payload: unknown  // 事件数据
}
```

### 3. JSON-RPC 通知（Notification）
```typescript
{
  jsonrpc: "2.0",
  method: string,
  params?: unknown
}
```

---

## Chat 相关事件

### agent 事件（实际使用的格式）

**原始格式**（Gateway 发送）：
```typescript
{
  type: "event",
  event: "agent",
  payload: {
    runId?: string;
    sessionKey: string;
    state: string;  // 'streaming', 'final', 'error', etc.
    message?: unknown;  // 实际的消息内容
    data?: {
      // 可能包含额外数据
    }
  }
}
```

**经过 event-dispatch.ts 处理后发出的事件**：
```typescript
// 事件名：'chat:message'
// 数据结构：
{
  message: {
    runId?: string;
    sessionKey: string;
    seq?: number;
    state: string;      // 'streaming', 'final', 'error'
    message?: unknown;  // 消息内容（流式时为文本片段，final时可能为空）
    error?: string;     // 错误信息（当 state='error' 时）
    ...data            // payload.data 中的其他字段会被展开到这里
  }
}
```

**实际示例**：

流式消息（streaming）：
```json
{
  "message": {
    "runId": "1773469458358-tjxtd534j",
    "sessionKey": "agent:viper:main",
    "seq": 1,
    "state": "streaming",
    "message": "Hello, "
  }
}
```

完成消息（final）：
```json
{
  "message": {
    "runId": "1773469458358-tjxtd534j",
    "sessionKey": "agent:viper:main",
    "seq": 4,
    "state": "final"
  }
}
```

错误消息（error）：
```json
{
  "message": {
    "runId": "1773469458358-tjxtd534j",
    "sessionKey": "agent:viper:main",
    "state": "error",
    "error": "API key not configured"
  }
}
```

### chat 事件（旧格式，可能已废弃）
**原始格式**（Gateway 发送）：
```typescript
{
  type: "event",
  event: "chat",
  payload: {
    sessionKey: string;
    event: 'delta' | 'final' | 'error';
    delta?: {
      content: unknown;  // 文本内容或结构化内容
    };
    error?: string;
  }
}
```

**经过 event-dispatch.ts 处理后发出的事件**：
```typescript
// 事件名：'chat:message'
// 数据结构（包装格式）：
{
  message: {
    sessionKey: string;
    event: 'delta' | 'final' | 'error';
    delta?: {
      content: unknown;
    };
    error?: string;
  }
}
```

**注意**：在某些情况下，事件可能直接发送消息数据（非包装格式）：
```typescript
// 非包装格式（某些 Gateway 版本或配置）：
{
  sessionKey: string;
  event: 'delta' | 'final' | 'error';
  delta?: {
    content: unknown;
  };
  error?: string;
}
```

**task-executor.ts 处理逻辑**：代码已更新为自动检测并支持两种格式。

### agent 事件
**原始格式**（Gateway 发送）：
```typescript
{
  type: "event",
  event: "agent",
  payload: {
    runId?: string;
    sessionKey?: string;
    state?: string;
    message?: unknown;
    data?: {
      runId?: string;
      sessionKey?: string;
      state?: string;
      message?: unknown;
    };
  }
}
```

**经过 event-dispatch.ts 处理后发出的事件**：
```typescript
// 事件名：'chat:message'
// 数据结构：
{
  message: {
    runId?: string;
    sessionKey?: string;
    state?: string;
    message?: unknown;
  }
}
```

---

## 接口定义位置

### 1. Gateway Manager 事件类型
**文件**：`electron/gateway/manager.ts`
**位置**：第 62-70 行

```typescript
export interface GatewayManagerEvents {
  status: (status: GatewayStatus) => void;
  message: (message: unknown) => void;
  notification: (notification: JsonRpcNotification) => void;
  exit: (code: number | null) => void;
  error: (error: Error) => void;
  'channel:status': (data: { channelId: string; status: string }) => void;
  'chat:message': (data: { message: unknown }) => void;
}
```

### 2. 消息处理逻辑
**文件**：`electron/gateway/manager.ts`
**方法**：`handleMessage`
**位置**：第 642-689 行

处理顺序：
1. 检查响应消息（`type: "res"`）
2. 检查事件消息（`type: "event"`）→ 调用 `dispatchProtocolEvent`
3. 检查 JSON-RPC 响应
4. 检查 JSON-RPC 通知

### 3. 事件分发逻辑
**文件**：`electron/gateway/event-dispatch.ts`

#### `dispatchProtocolEvent` 函数（第 8-41 行）
处理 `type: "event"` 格式的消息：

| event 值 | 发出的事件 | 数据格式 |
|---------|-----------|---------|
| `"chat"` | `chat:message` | `{ message: payload }` |
| `"agent"` | `chat:message` | `{ message: { ...data, runId, sessionKey, state, message } }` |
| `"channel.status"` | `channel:status` | `payload` |
| 其他 | `notification` | `{ method: event, params: payload }` |

#### `dispatchJsonRpcNotification` 函数（第 43-63 行）
处理 JSON-RPC 通知：

| method 值 | 发出的事件 | 数据格式 |
|----------|-----------|---------|
| `GatewayEventType.CHANNEL_STATUS_CHANGED` | `channel:status` | `params` |
| `GatewayEventType.MESSAGE_RECEIVED` | `chat:message` | `{ message: params.message }` |
| `GatewayEventType.ERROR` | `error` | `new Error(params.message)` |

### 4. 协议类型定义
**文件**：`electron/gateway/protocol.ts`

#### GatewayEventType 枚举（第 83-98 行）
```typescript
export enum GatewayEventType {
  STATUS_CHANGED = 'gateway.status_changed',
  CHANNEL_STATUS_CHANGED = 'channel.status_changed',
  MESSAGE_RECEIVED = 'chat.message_received',
  MESSAGE_SENT = 'chat.message_sent',
  TOOL_CALL_STARTED = 'tool.call_started',
  TOOL_CALL_COMPLETED = 'tool.call_completed',
  ERROR = 'error',
}
```

---

## 使用示例

### 订阅 chat:message 事件

```typescript
import { GatewayManager } from '../gateway/manager';

const gatewayManager = new GatewayManager();

// 订阅事件
gatewayManager.on('chat:message', (data: { message: unknown }) => {
  const msg = data.message as {
    sessionKey: string;
    event: 'delta' | 'final' | 'error';
    delta?: { content: unknown };
    error?: string;
  };

  console.log('Session:', msg.sessionKey);
  console.log('Event type:', msg.event);

  if (msg.event === 'delta') {
    console.log('Content delta:', msg.delta?.content);
  } else if (msg.event === 'final') {
    console.log('Chat completed');
  } else if (msg.event === 'error') {
    console.error('Chat error:', msg.error);
  }
});
```

### 发送 RPC 请求

```typescript
// 发送消息到智能体
const response = await gatewayManager.rpc('chat.send', {
  sessionKey: 'agent:main-agent:main',
  message: 'Hello!',
  deliver: true,
});
```

---

## 调试技巧

### 1. 查看原始 WebSocket 消息
在 `electron/gateway/manager.ts` 的 `handleMessage` 方法中添加日志：

```typescript
private handleMessage(message: unknown): void {
  console.log('[Gateway] Raw message:', JSON.stringify(message, null, 2));
  // ... 原有代码
}
```

### 2. 查看事件分发
在 `electron/gateway/event-dispatch.ts` 中添加日志：

```typescript
export function dispatchProtocolEvent(
  emitter: GatewayEventEmitter,
  event: string,
  payload: unknown,
): void {
  console.log('[Dispatch] Event:', event, 'Payload:', payload);
  // ... 原有代码
}
```

### 3. 使用 Chrome DevTools
运行 `pnpm run dev:debug`，在 DevTools 中设置断点：
- `electron/gateway/manager.ts` 第 642 行（`handleMessage`）
- `electron/gateway/event-dispatch.ts` 第 16 行（chat 事件）
- `electron/services/task-executor.ts` 第 242 行（`handleChatEvent`）
