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

import { MaianaController } from './maiana-controller';
import type { PluginOptions, MaianaStatus, PluginInstance } from './types';

export = function(app: any): PluginInstance {
  let maianaController: MaianaController;
  let currentOptions: PluginOptions = {};
  let transmitEnabled = false;
  const putHandlers = new Map();
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
    name: 'MAIANA AIS Transponder Controller',
    description: 'Plugin for controlling MAIANA AIS transponder configuration and transmission (AIS data parsing handled by SignalK data connections)',

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
        enableTransmit: {
          type: 'boolean',
          title: 'Enable Transmission',
          description: 'Allow the transponder to transmit AIS messages',
          default: false
        },
        debug: {
          type: 'boolean',
          title: 'Debug Mode',
          description: 'Enable debug logging',
          default: false
        },
        enablePutControl: {
          type: 'boolean',
          title: 'Enable PUT Control',
          description: 'Allow external control of transmission via PUT requests',
          default: false
        },
        transmitControlPath: {
          type: 'string',
          title: 'Transmit Control Path',
          description: 'SignalK path for transmission control',
          default: 'commands.ais.transmit.state'
        }
      }
    }),

    start: (options: PluginOptions) => {
      try {
        app.debug('Starting MAIANA AIS plugin with options:', options);
        currentOptions = { ...options };
        
        // Initialize transmission state from configuration
        transmitEnabled = options.enableTransmit || false;

        // Initialize MAIANA controller
        maianaController = new MaianaController(options);

        // Set up event handlers
        setupEventHandlers();

        // Connect to MAIANA device for control
        maianaController.connect()
          .then(() => {
            app.debug('MAIANA controller connected successfully');
            status.connected = true;
            
            // Configure MAIANA with vessel data from SignalK
            configureMAIANA();
            
            // Setup PUT control if enabled
            if (options.enablePutControl) {
              setupPutControl();
            }
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
      
      // Clean up PUT handlers
      putHandlers.clear();
      
      if (maianaController) {
        maianaController.disconnect()
          .then(() => {
            app.debug('MAIANA controller stopped');
          })
          .catch((error: Error) => {
            app.error('Error stopping MAIANA controller:', error.message);
          });
      }

      status.connected = false;
      status.transmitting = false;
      status.receiving = false;
    },

    statusForLog: () => {
      return status;
    },

    registerWithRouter: (router: any) => {
      router.post('/reconfigure', (req: any, res: any) => {
        try {
          if (!maianaController || !maianaController.isConnected()) {
            return res.status(400).json({ error: 'MAIANA controller not connected' });
          }
          
          configureMAIANA()
            .then(() => {
              res.json({ status: 'ok', message: 'MAIANA reconfigured with current vessel data' });
            })
            .catch((error: Error) => {
              app.error('Error reconfiguring MAIANA:', error);
              res.status(500).json({ error: 'Failed to reconfigure MAIANA: ' + error.message });
            });
        } catch (error) {
          app.error('Error reconfiguring MAIANA:', error);
          res.status(500).json({ error: 'Failed to reconfigure MAIANA' });
        }
      });

      router.get('/vessel-data', (req: any, res: any) => {
        const vesselData = getVesselDataFromSignalK();
        res.json(vesselData);
      });
    }
  };

  function setupEventHandlers(): void {
    maianaController.on('connected', () => {
      app.debug('MAIANA controller connected');
      status.connected = true;
      app.emit('maiana-connected');
    });

    maianaController.on('disconnected', () => {
      app.debug('MAIANA controller disconnected');
      status.connected = false;
      status.transmitting = false;
      status.receiving = false;
      app.emit('maiana-disconnected');
    });

    maianaController.on('error', (error: Error) => {
      app.error('MAIANA controller error:', error.message);
      status.errors++;
      app.emit('maiana-error', error);
    });

    maianaController.on('response', (response: string) => {
      app.debug('MAIANA response:', response);
      // Handle command responses and status messages
      handleMaianaResponse(response);
    });
  }

  function getVesselDataFromSignalK() {
    return {
      mmsi: app.getSelfPath('mmsi'),
      name: app.getSelfPath('name'),
      callsign: app.getSelfPath('communication.callsignVhf'),
      design: {
        length: app.getSelfPath('design.length.overall'),
        beam: app.getSelfPath('design.beam'),
        draft: app.getSelfPath('design.draft.maximum'),
        aisShipType: app.getSelfPath('design.aisShipType')
      },
      sensors: {
        gps: {
          fromBow: app.getSelfPath('sensors.gps.fromBow.value'),
          fromCenter: app.getSelfPath('sensors.gps.fromCenter.value')
        }
      }
    };
  }

  async function configureMAIANA(): Promise<void> {
    if (!maianaController || !maianaController.isConnected()) {
      throw new Error('MAIANA controller not connected');
    }

    const vesselData = getVesselDataFromSignalK();
    
    // Validate required data
    if (!vesselData.mmsi) {
      throw new Error('MMSI not configured in vessel settings');
    }

    // Map SignalK ship type to MAIANA-supported values (30, 34, 36, 37)
    let shipType = 37; // Default to "Other"
    if (vesselData.design?.aisShipType) {
      const signalKType = vesselData.design.aisShipType;
      if ([30, 34, 36, 37].includes(signalKType)) {
        shipType = signalKType;
      }
    }

    // Build MAIANA station command: mmsi,name,callsign,type,len,beam,portoffset,bowoffset
    const stationParams = [
      vesselData.mmsi || '',
      vesselData.name || '',
      vesselData.callsign || '',
      shipType,
      Math.round(vesselData.design?.length || 0),
      Math.round(vesselData.design?.beam || 0),
      Math.round(vesselData.sensors?.gps?.fromCenter || 0), // port offset (from center)
      Math.round(vesselData.sensors?.gps?.fromBow || 0)     // bow offset
    ];

    const command = `station ${stationParams.join(',')}`;
    
    app.debug('Configuring MAIANA with command:', command);
    await maianaController.sendCommand(command);
    
    // Enable transmission if configured
    if (transmitEnabled) {
      await maianaController.sendCommand('tx on');
    } else {
      await maianaController.sendCommand('tx off');
    }
  }

  function handleMaianaResponse(response: string): void {
    // Handle MAIANA command responses and status messages
    // AIS data (!AIVDM/!AIVDO) is handled by SignalK data connection
    app.debug('MAIANA response:', response);
    
    // Parse any status information from responses
    // Most responses are just acknowledgments or error messages
    if (response.includes('tx')) {
      // Could parse transmission status updates here
      app.debug('Transmission status response:', response);
    }
  }

  function setupPutControl(): void {
    const controlPath = currentOptions.transmitControlPath || 'commands.ais.transmit.state';
    
    // Create PUT handler
    const putHandler = (
      context: string,
      requestPath: string,
      value: any,
      callback?: (result: { state: string; statusCode?: number }) => void
    ): { state: string; statusCode?: number } => {
      app.debug(`PUT request received for ${requestPath} with value: ${JSON.stringify(value)}`);
      
      if (requestPath === controlPath) {
        const newState = Boolean(value);
        handleTransmitControl(newState);
        
        // Update plugin configuration so checkbox reflects the change
        updatePluginConfig();
        
        // Publish updated state
        const updatedDelta = createSignalKDelta(controlPath, newState);
        app.handleMessage(plugin.id, updatedDelta);
        
        const result = { state: 'COMPLETED' };
        if (callback) callback(result);
        return result;
      } else {
        const result = { state: 'COMPLETED', statusCode: 405 };
        if (callback) callback(result);
        return result;
      }
    };
    
    // Register PUT handler with SignalK
    app.registerPutHandler('vessels.self', controlPath, putHandler, 'maiana-ais');
    
    // Store handler for cleanup
    putHandlers.set(controlPath, putHandler);
    
    // Publish current state
    const initialDelta = createSignalKDelta(controlPath, transmitEnabled);
    app.handleMessage(plugin.id, initialDelta);
    
    app.debug(`PUT control enabled for transmission on path: ${controlPath}`);
  }
  
  function handleTransmitControl(newState: boolean): void {
    if (newState !== transmitEnabled) {
      app.debug(`${newState ? 'Enabling' : 'Disabling'} transmission via PUT control`);
      
      transmitEnabled = newState;
      
      if (maianaController && maianaController.isConnected()) {
        const command = newState ? 'tx on' : 'tx off';
        maianaController.sendCommand(command)
          .then(() => {
            app.debug(`Transmission ${newState ? 'enabled' : 'disabled'}`);
          })
          .catch((error: Error) => {
            app.error('Error controlling transmission:', error.message);
          });
      }
      
      app.setProviderStatus(`MAIANA transmission ${newState ? 'enabled' : 'disabled'} via external control`);
    }
  }
  
  function updatePluginConfig(): void {
    if (!currentOptions) return;
    
    const updatedConfig = {
      ...currentOptions,
      enableTransmit: transmitEnabled
    };
    
    app.savePluginOptions(updatedConfig, (err?: any) => {
      if (err) {
        app.error('Could not save plugin configuration: ' + err.message);
      } else {
        app.debug('Plugin configuration updated to match PUT state changes');
        currentOptions = updatedConfig;
      }
    });
  }
  
  function createSignalKDelta(path: string, value: any) {
    return {
      context: 'vessels.self',
      updates: [{
        source: {
          sentence: 'CONTROL',
          talker: 'AI',
          type: 'NMEA0183',
          label: 'ais'
        },
        $source: 'ais.AI',
        timestamp: new Date().toISOString(),
        values: [{
          path: path,
          value: value
        }]
      }]
    };
  }

  return plugin;
};