/*
 * MAIANA Device Controller
 * 
 * Handles MAIANA AIS transponder device control and configuration
 * Serial communication for command sending only - AIS parsing handled by SignalK data connections
 * 
 * Copyright (C) 2025 Maurice Tamman
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import { EventEmitter } from 'eventemitter3';
import type { PluginOptions } from './types';

export class MaianaController extends EventEmitter {
  private port?: SerialPort;
  private parser?: ReadlineParser;
  private devicePath: string;
  private baudRate: number;
  private connected = false;
  private reconnectTimer?: NodeJS.Timeout;
  private reconnectInterval = 5000;

  constructor(options: PluginOptions) {
    super();
    
    this.devicePath = options.devicePath || '/dev/ttyUSB0';
    this.baudRate = options.baudRate || 38400;
  }

  async connect(): Promise<void> {
    try {
      this.port = new SerialPort({
        path: this.devicePath,
        baudRate: this.baudRate,
        autoOpen: false
      });

      this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\r\n' }));

      this.port.on('open', () => {
        this.connected = true;
        this.emit('connected');
        // Connected to device for control
      });

      this.port.on('close', () => {
        this.connected = false;
        this.emit('disconnected');
        // Control connection disconnected
        this.scheduleReconnect();
      });

      this.port.on('error', (error: Error) => {
        this.emit('error', error);
        // Control error handled by event emission
        this.scheduleReconnect();
      });

      // We only listen for responses to our commands, not AIS data
      this.parser.on('data', (line: string) => {
        this.handleResponse(line.trim());
      });

      await this.port.open();
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    if (this.port && this.port.isOpen) {
      await this.port.close();
    }

    this.connected = false;
    this.port = undefined;
    this.parser = undefined;
  }

  async sendCommand(command: string): Promise<void> {
    if (!this.connected || !this.port) {
      throw new Error('MAIANA controller not connected');
    }

    return new Promise((resolve, reject) => {
      this.port!.write(command + '\r\n', (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  private handleResponse(line: string): void {
    if (!line) return;

    // Handle command responses and status messages
    // AIS data (!AIVDM/!AIVDO) will be handled by SignalK data connection
    if (line.startsWith('!AIVDM') || line.startsWith('!AIVDO')) {
      // Ignore AIS data - handled by SignalK data connection
      return;
    }

    // Handle command responses and system messages
    this.emit('response', line);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = undefined;
      try {
        // Attempting to reconnect control connection
        await this.connect();
      } catch (error) {
        // Control reconnection failed
        this.scheduleReconnect();
      }
    }, this.reconnectInterval);
  }

  isConnected(): boolean {
    return this.connected;
  }

  getStatus() {
    return {
      connected: this.connected,
      devicePath: this.devicePath,
      baudRate: this.baudRate
    };
  }
}