export interface Message {
  id: string;
  from: string;
  to: string;
  type: 'request' | 'response' | 'notification' | 'broadcast';
  protocol: 'mcp' | 'a2a' | 'rest' | 'websocket' | 'internal';
  payload: any;
  timestamp: Date;
  correlationId?: string;
  replyTo?: string;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: any;
  outputSchema?: any;
  handler: (input: any) => Promise<any>;
}

export interface MCPServer {
  id: string;
  name: string;
  tools: Map<string, MCPTool>;
  start(): Promise<void>;
  stop(): Promise<void>;
  registerTool(tool: MCPTool): void;
  unregisterTool(name: string): void;
}

export interface CommunicationChannel {
  id: string;
  type: 'direct' | 'broadcast' | 'pubsub';
  protocol: string;
  participants: string[];
  send(message: Message): Promise<void>;
  receive(handler: (message: Message) => void): void;
  close(): Promise<void>;
}