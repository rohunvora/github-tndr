/**
 * Tool Registry
 * Auto-discovers and routes to tools
 */

import type { Context } from 'grammy';
import type { Tool, ToolCommand, MessageHandler, CallbackHandler } from './types.js';
import { info, error as logErr } from '../core/logger.js';

// ============ REGISTRY ============

class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private commands: Map<string, ToolCommand & { toolName: string }> = new Map();
  private messageHandlers: Array<MessageHandler & { toolName: string }> = [];
  private callbackHandlers: Array<CallbackHandler & { toolName: string }> = [];

  /**
   * Register a tool with the registry
   */
  async register(tool: Tool): Promise<void> {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }

    // Initialize tool if it has an init function
    if (tool.init) {
      await tool.init();
    }

    this.tools.set(tool.name, tool);

    // Register commands
    if (tool.commands) {
      for (const cmd of tool.commands) {
        if (this.commands.has(cmd.name)) {
          throw new Error(`Command "/${cmd.name}" is already registered by another tool`);
        }
        this.commands.set(cmd.name, { ...cmd, toolName: tool.name });
      }
    }

    // Register message handlers
    if (tool.messageHandlers) {
      for (const handler of tool.messageHandlers) {
        this.messageHandlers.push({ ...handler, toolName: tool.name });
      }
      // Sort by priority (highest first)
      this.messageHandlers.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    }

    // Register callback handlers
    if (tool.callbackHandlers) {
      for (const handler of tool.callbackHandlers) {
        this.callbackHandlers.push({ ...handler, toolName: tool.name });
      }
    }

    info('registry', `Registered tool: ${tool.name} v${tool.version}`, {
      commands: tool.commands?.map(c => c.name) || [],
      messageHandlers: tool.messageHandlers?.map(h => h.type) || [],
      callbackHandlers: tool.callbackHandlers?.length || 0,
    });
  }

  /**
   * Get all registered commands (for /help)
   */
  getAllCommands(): Array<ToolCommand & { toolName: string }> {
    return Array.from(this.commands.values());
  }

  /**
   * Get a command handler by name
   */
  getCommand(name: string): (ToolCommand & { toolName: string }) | undefined {
    return this.commands.get(name);
  }

  /**
   * Handle a command
   */
  async handleCommand(name: string, ctx: Context, args: string): Promise<boolean> {
    const cmd = this.commands.get(name);
    if (!cmd) return false;

    try {
      info('registry', `Executing command: /${name}`, { tool: cmd.toolName, args });
      await cmd.handler(ctx, args);
      return true;
    } catch (err) {
      logErr('registry', err, { command: name, tool: cmd.toolName });
      throw err;
    }
  }

  /**
   * Handle a message by type
   */
  async handleMessage(type: 'photo' | 'document' | 'text', ctx: Context): Promise<boolean> {
    for (const handler of this.messageHandlers) {
      if (handler.type !== type) continue;

      // For text messages, check pattern if specified
      if (type === 'text' && handler.pattern) {
        const text = ctx.message?.text || '';
        if (!handler.pattern.test(text)) continue;
      }

      try {
        info('registry', `Handling message: ${type}`, { tool: handler.toolName });
        await handler.handler(ctx);
        return true;
      } catch (err) {
        logErr('registry', err, { type, tool: handler.toolName });
        throw err;
      }
    }

    return false;
  }

  /**
   * Handle a callback query
   */
  async handleCallback(data: string, ctx: Context): Promise<boolean> {
    for (const handler of this.callbackHandlers) {
      const matches = typeof handler.pattern === 'string'
        ? data.startsWith(handler.pattern)
        : handler.pattern.test(data);

      if (!matches) continue;

      try {
        info('registry', `Handling callback: ${data}`, { tool: handler.toolName });
        await handler.handler(ctx, data);
        return true;
      } catch (err) {
        logErr('registry', err, { callback: data, tool: handler.toolName });
        throw err;
      }
    }

    return false;
  }

  /**
   * Get a tool by name
   */
  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all registered tools
   */
  getAllTools(): Tool[] {
    return Array.from(this.tools.values());
  }
}

// Singleton instance
export const registry = new ToolRegistry();

// ============ REGISTRATION HELPER ============

/**
 * Register multiple tools at once
 */
export async function registerTools(tools: Tool[]): Promise<void> {
  for (const tool of tools) {
    await registry.register(tool);
  }
  info('registry', `Registered ${tools.length} tools`);
}

