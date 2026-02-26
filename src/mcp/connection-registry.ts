import type { Response } from 'express';

interface MCPConnection {
  userId: string;
  connectionId: string;
  connectedAt: Date;
  response: Response;
}

export class MCPConnectionRegistry {
  private connections: Map<string, MCPConnection>;

  constructor() {
    this.connections = new Map();
  }

  register(userId: string, response: Response): string {
    const connectionId = `${userId}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    this.connections.set(connectionId, {
      userId,
      connectionId,
      connectedAt: new Date(),
      response,
    });
    console.log(`[MCPConnectionRegistry] Registered connection ${connectionId} for user ${userId}`);
    return connectionId;
  }

  unregister(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (connection) {
      this.connections.delete(connectionId);
      console.log(`[MCPConnectionRegistry] Unregistered connection ${connectionId}`);
    }
  }

  getByUserId(userId: string): MCPConnection[] {
    const userConnections: MCPConnection[] = [];
    for (const connection of this.connections.values()) {
      if (connection.userId === userId) {
        userConnections.push(connection);
      }
    }
    return userConnections;
  }

  terminateByUserId(userId: string): number {
    const userConnections = this.getByUserId(userId);
    for (const connection of userConnections) {
      try {
        connection.response.end();
        this.connections.delete(connection.connectionId);
        console.log(`[MCPConnectionRegistry] Terminated connection ${connection.connectionId} for user ${userId}`);
      } catch (error) {
        console.error(`[MCPConnectionRegistry] Error terminating connection ${connection.connectionId}:`, error);
      }
    }
    return userConnections.length;
  }

  cleanup(): void {
    const stats = this.getStats();
    console.log('[MCPConnectionRegistry] Active connections:', stats);
  }

  getConnectionCount(): number {
    return this.connections.size;
  }

  getStats(): { total: number; byUser: Record<string, number> } {
    const byUser: Record<string, number> = {};
    for (const connection of this.connections.values()) {
      byUser[connection.userId] = (byUser[connection.userId] || 0) + 1;
    }
    return { total: this.connections.size, byUser };
  }

  notifyRedeployment(): void {
    console.log('[MCPConnectionRegistry] Notifying all connections of redeployment');
    for (const connection of this.connections.values()) {
      try {
        connection.response.write(': Server redeploying, please reconnect\n\n');
      } catch (error) {
        console.error(`[MCPConnectionRegistry] Error notifying ${connection.connectionId}:`, error);
      }
    }
  }

  closeAll(): void {
    console.log(`[MCPConnectionRegistry] Force closing ${this.connections.size} connections`);
    for (const connection of this.connections.values()) {
      try {
        connection.response.end();
      } catch (error) {
        // Already closed
      }
    }
    this.connections.clear();
  }
}
