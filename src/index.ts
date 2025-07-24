/*
 * MAIANA AIS Transponder Plugin for Signal K
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

import { MaianaSerial } from './maiana-serial';
import { AISParser } from './ais-parser';
import type { PluginOptions, MaianaStatus, PluginInstance } from './types';

export = function(app: any): PluginInstance {
  let maianaSerial: MaianaSerial;
  let aisParser: AISParser;
  const status: MaianaStatus = {
    connected: false,
    transmitting: false,
    receiving: false,
    messagesReceived: 0,
    messagesTransmitted: 0,
    errors: 0
  };

  const plugin: PluginInstance = {
    id: 'maiana-ais',
    name: 'MAIANA AIS Transponder',
    description: 'Plugin for interfacing with MAIANA AIS transponders',

    schema: () => ({
      type: 'object',
      required: ['devicePath'],
      properties: {
        devicePath: {
          type: 'string',
          title: 'Serial Device Path',
          description: 'Path to the MAIANA serial device',
          default: '/dev/ttyUSB0'
        },
        baudRate: {
          type: 'number',
          title: 'Baud Rate',
          description: 'Serial communication baud rate',
          default: 38400,
          enum: [9600, 19200, 38400, 57600, 115200]
        },
        ownMMSI: {
          type: 'number',
          title: 'Own MMSI',
          description: 'Your vessel\'s MMSI number for transmission',
          minimum: 200000000,
          maximum: 799999999
        },
        enableTransmit: {
          type: 'boolean',
          title: 'Enable Transmission',
          description: 'Allow the transponder to transmit AIS messages',
          default: false
        },
        transmitInterval: {
          type: 'number',
          title: 'Transmit Interval (seconds)',
          description: 'Interval between AIS transmissions',
          default: 30,
          minimum: 5,
          maximum: 300
        },
        debug: {
          type: 'boolean',
          title: 'Debug Mode',
          description: 'Enable debug logging',
          default: false
        }
      }
    }),

    start: (options: PluginOptions) => {
      try {
        app.debug('Starting MAIANA AIS plugin with options:', options);

        // Initialize serial communication
        maianaSerial = new MaianaSerial(options);
        aisParser = new AISParser(options.ownMMSI);

        // Set up event handlers
        setupEventHandlers();

        // Connect to MAIANA device
        maianaSerial.connect()
          .then(() => {
            app.debug('MAIANA AIS plugin started successfully');
            status.connected = true;
          })
          .catch((error: Error) => {
            app.error('Failed to connect to MAIANA device:', error.message);
            status.errors++;
          });

      } catch (error) {
        app.error('Failed to start MAIANA AIS plugin:', error);
        status.errors++;
        throw error;
      }
    },

    stop: () => {
      app.debug('Stopping MAIANA AIS plugin');
      
      if (maianaSerial) {
        maianaSerial.disconnect()
          .then(() => {
            app.debug('MAIANA AIS plugin stopped');
          })
          .catch((error: Error) => {
            app.error('Error stopping MAIANA AIS plugin:', error.message);
          });
      }

      status.connected = false;
      status.transmitting = false;
      status.receiving = false;
    },

    statusForLog: () => {
      return status;
    }
  };

  function setupEventHandlers(): void {
    maianaSerial.on('connected', () => {
      app.debug('MAIANA device connected');
      status.connected = true;
      app.emit('maiana-connected');
    });

    maianaSerial.on('disconnected', () => {
      app.debug('MAIANA device disconnected');
      status.connected = false;
      status.transmitting = false;
      status.receiving = false;
      app.emit('maiana-disconnected');
    });

    maianaSerial.on('error', (error: Error) => {
      app.error('MAIANA serial error:', error.message);
      status.errors++;
      app.emit('maiana-error', error);
    });

    maianaSerial.on('ais-message', (sentence: string) => {
      try {
        status.messagesReceived++;
        status.receiving = true;
        
        const aisMessage = aisParser.parseAISMessage(sentence);
        if (aisMessage) {
          const delta = aisParser.createSignalKDelta(aisMessage);
          app.handleMessage('maiana-ais', delta);
          
          app.debug('AIS message processed:', {
            mmsi: aisMessage.mmsi,
            messageType: aisMessage.messageType
          });
        }
      } catch (error) {
        app.error('Error processing AIS message:', error);
        status.errors++;
      }
    });

    maianaSerial.on('system-message', (sentence: string) => {
      app.debug('MAIANA system message:', sentence);
      // Handle MAIANA-specific system messages
      handleSystemMessage(sentence);
    });

    maianaSerial.on('position-message', (sentence: string) => {
      app.debug('MAIANA position message:', sentence);
      // Handle position reports from MAIANA
    });

    maianaSerial.on('config-message', (sentence: string) => {
      app.debug('MAIANA config message:', sentence);
      // Handle configuration messages
    });

    maianaSerial.on('raw-message', (sentence: string) => {
      if (app.debug.enabled) {
        app.debug('Raw MAIANA message:', sentence);
      }
    });
  }

  function handleSystemMessage(sentence: string): void {
    // Parse MAIANA system messages
    // $PAISYS,status,transmitting,receiving,...
    if (sentence.startsWith('$PAISYS')) {
      const parts = sentence.split(',');
      if (parts.length >= 4) {
        status.transmitting = parts[2] === '1';
        status.receiving = parts[3] === '1';
      }
    }
  }

  return plugin;
};