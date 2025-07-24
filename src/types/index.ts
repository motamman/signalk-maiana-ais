/*
 * Type definitions for MAIANA AIS Plugin
 * 
 * Adapted from the MAIANA AIS Transponder project by Peter Antypas
 * Original work: https://github.com/peterantypas/maiana
 * Copyright (C) Peter Antypas
 * 
 * SignalK plugin adaptation:
 * Copyright (C) 2024 Maurice Tamman
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

export interface PluginOptions {
  devicePath?: string;
  baudRate?: number;
  enableTransmit?: boolean;
  enablePutControl?: boolean;
  transmitControlPath?: string;
  debug?: boolean;
}

export interface SignalKDelta {
  context: string;
  updates: Array<{
    source: {
      sentence: string;
      talker: string;
      type: string;
      label: string;
    };
    $source: string;
    timestamp: string;
    values: Array<{
      path: string;
      value: any;
    }>;
  }>;
}

export interface MaianaStatus {
  connected: boolean;
  transmitting: boolean;
  receiving: boolean;
  lastMessage?: Date;
  messagesReceived: number;
  messagesTransmitted: number;
  errors: number;
}

export interface PluginInstance {
  id: string;
  name: string;
  description: string;
  schema: () => object;
  start: (options: PluginOptions) => void;
  stop: () => void;
  statusForLog: () => MaianaStatus;
  registerWithRouter?: (router: any) => void;
}