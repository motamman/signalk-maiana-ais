/*
 * MAIANA AIS Transponder Plugin for Signal K
 * 
 * Adapted from the MAIANA AIS Transponder project by Peter Antypas
 * Original work: https://github.com/peterantypas/maiana
 * Copyright (C) Peter Antypas
 * 
 * SignalK plugin adaptation:
 * Copyright (C) 2025 Maurice Tamman
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { MaianaController } from './maiana-controller';
import type { PluginOptions, MaianaStatus, PluginInstance } from './types';
import * as nmea from 'nmea-simple';

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
        
        // Setup PUT control (always enabled)
        setupPutControl();

        // Connect to MAIANA device for control
        maianaController.connect()
          .then(() => {
            app.debug('MAIANA controller connected successfully');
            status.connected = true;
            
            // Configure MAIANA with vessel data from SignalK
            configureMAIANA();
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

      router.get('/debug-status', (req: any, res: any) => {
        const debugInfo = {
          status: status,
          transmitEnabled: transmitEnabled,
          connected: maianaController?.isConnected() || false,
          vesselData: getVesselDataFromSignalK(),
          timestamp: new Date().toISOString()
        };
        res.json(debugInfo);
      });

      router.get('/reconfigure-now', (req: any, res: any) => {
        try {
          if (!maianaController || !maianaController.isConnected()) {
            return res.status(400).json({ error: 'MAIANA controller not connected' });
          }
          
          configureMAIANA()
            .then(() => {
              res.json({ status: 'ok', message: 'MAIANA reconfigured via GET request' });
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
      // Enhanced debug logging with message classification
      const messageType = classifyMessage(response);
      app.debug(`MAIANA ${messageType}:`, response);
      
      // Handle command responses and status messages
      handleMaianaResponse(response);
    });
  }

  function getVesselDataFromSignalK() {
    // Helper function to safely extract values
    const getValue = (path: string) => {
      const data = app.getSelfPath(path);
      return data?.value !== undefined ? data.value : data;
    };

    return {
      mmsi: getValue('mmsi'),
      name: getValue('name'), 
      callsign: getValue('communication.callsignVhf'),
      design: {
        length: getValue('design.length.overall') || getValue('design.length'),
        beam: getValue('design.beam'),
        draft: getValue('design.draft.maximum') || getValue('design.draft'),
        aisShipType: getValue('design.aisShipType')?.id || getValue('design.aisShipType')
      },
      sensors: {
        gps: {
          fromBow: getValue('sensors.gps.fromBow') || 0,
          fromCenter: getValue('sensors.gps.fromCenter') || 0  
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
    
    app.debug('🏷️  Vessel data extracted:', JSON.stringify(vesselData, null, 2));
    app.debug('🏷️  Station parameters:', stationParams);
    app.debug('🏷️  Configuring MAIANA with command:', command);
    
    await maianaController.sendCommand(command);
    
    // Enable transmission if configured
    if (transmitEnabled) {
      await maianaController.sendCommand('tx on');
    } else {
      await maianaController.sendCommand('tx off');
    }
  }

  function classifyMessage(message: string): string {
    if (message.startsWith('!AIVDM') || message.startsWith('!AIVDO')) {
      return 'AIS-TX'; // Transmitted AIS message
    } else if (message.startsWith('$GPGGA') || message.startsWith('$GNGGA')) {
      return 'GPS-FIX';
    } else if (message.startsWith('$GNRMC') || message.startsWith('$GPRMC')) {
      return 'GPS-RMC';
    } else if (message.startsWith('$GPGSV') || message.startsWith('$GLGSV')) {
      return 'GPS-SAT';
    } else if (message.startsWith('$GPVTG')) {
      return 'GPS-VTG';
    } else if (message.startsWith('$GNGSA') || message.startsWith('$GPGSA')) {
      return 'GPS-DOP';
    } else if (message.startsWith('$GNGLL') || message.startsWith('$GPGLL')) {
      return 'GPS-POS';
    } else if (message.startsWith('$')) {
      return 'NMEA-OTHER';
    } else if (message.includes('tx')) {
      return 'TX-STATUS';
    } else if (message.includes('station')) {
      return 'STATION-CONFIG';
    } else {
      return 'MAIANA-CMD';
    }
  }

  function handlePAINFMessage(message: string): void {
    // Parse MAIANA proprietary info messages: $PAINF,A,0x3d*0E
    try {
      const parts = message.split(',');
      if (parts.length >= 3) {
        const type = parts[1]; // A or B
        const hexValue = parts[2].split('*')[0]; // Remove checksum
        const decimalValue = parseInt(hexValue, 16);
        
        app.debug(`🔍 MAIANA INFO [${type}]: ${hexValue} (${decimalValue} decimal) - ${message}`);
        
        // Try to decode common patterns
        if (type === 'A') {
          decodePAINFTypeA(decimalValue, hexValue);
        } else if (type === 'B') {
          decodePAINFTypeB(decimalValue, hexValue);
        }
      }
    } catch (error) {
      app.debug('Could not parse PAINF message:', message, error);
    }
  }

  function decodePAINFTypeA(value: number, hex: string): void {
    // Type A might be device status/health
    const bits = value.toString(2).padStart(8, '0');
    app.debug(`🔍 PAINF Type A Analysis: ${hex} = ${value} = 0b${bits}`);
    
    // Common status bit patterns to look for:
    if (value & 0x01) app.debug('  - Bit 0 set: Possible power/ready status');
    if (value & 0x02) app.debug('  - Bit 1 set: Possible GPS status');
    if (value & 0x04) app.debug('  - Bit 2 set: Possible transmission status');
    if (value & 0x08) app.debug('  - Bit 3 set: Possible error/warning');
    if (value & 0x10) app.debug('  - Bit 4 set: Unknown status flag');
    if (value & 0x20) app.debug('  - Bit 5 set: Unknown status flag');
    if (value & 0x40) app.debug('  - Bit 6 set: Unknown status flag');
    if (value & 0x80) app.debug('  - Bit 7 set: Unknown status flag');
  }

  function decodePAINFTypeB(value: number, hex: string): void {
    // Type B might be configuration/operational status
    const bits = value.toString(2).padStart(8, '0');
    app.debug(`🔍 PAINF Type B Analysis: ${hex} = ${value} = 0b${bits}`);
    
    // Look for patterns that might indicate transmission capability
    if (value === 0x52) app.debug('  - Common value 0x52 detected');
    if (value === 0x32) app.debug('  - Common value 0x32 detected');
    if (value === 0x1a) app.debug('  - Common value 0x1a detected');
    
    // Check if this could be related to AIS transmission status
    if (value & 0x01) app.debug('  - Bit 0 set: Could be TX ready');
    if (value & 0x02) app.debug('  - Bit 1 set: Could be RX active');
    if (value & 0x04) app.debug('  - Bit 2 set: Could be config valid');
    if (value & 0x08) app.debug('  - Bit 3 set: Could be antenna status');
  }

  function convertNmeaToSignalK(parsed: any): any {
    if (!parsed || !parsed.sentenceId) {
      return null;
    }

    const timestamp = new Date().toISOString();
    const source = {
      sentence: parsed.sentenceId,
      talker: parsed.talkerId || 'GP',
      type: 'NMEA0183',
      label: 'maiana-gps'
    };

    const values: any[] = [];

    switch (parsed.sentenceId) {
      case 'GGA':
        // GPS Fix Data
        if (parsed.latitude !== undefined && parsed.longitude !== undefined) {
          values.push({
            path: 'navigation.position',
            value: {
              latitude: parsed.latitude,
              longitude: parsed.longitude
            }
          });
        }
        if (parsed.altitude !== undefined) {
          values.push({
            path: 'navigation.gnss.antennaAltitude',
            value: parsed.altitude
          });
        }
        if (parsed.quality !== undefined) {
          values.push({
            path: 'navigation.gnss.type',
            value: parsed.quality === 1 ? 'GPS' : 'DGPS'
          });
        }
        if (parsed.satellitesInUse !== undefined) {
          values.push({
            path: 'navigation.gnss.satellitesInUse',
            value: parsed.satellitesInUse
          });
        }
        if (parsed.horizontalDilution !== undefined) {
          values.push({
            path: 'navigation.gnss.horizontalDilution',
            value: parsed.horizontalDilution
          });
        }
        break;

      case 'RMC':
        // Recommended Minimum Course
        if (parsed.latitude !== undefined && parsed.longitude !== undefined) {
          values.push({
            path: 'navigation.position',
            value: {
              latitude: parsed.latitude,
              longitude: parsed.longitude
            }
          });
        }
        if (parsed.speedKnots !== undefined) {
          values.push({
            path: 'navigation.speedOverGround',
            value: parsed.speedKnots * 0.514444 // Convert knots to m/s
          });
        }
        if (parsed.trackTrue !== undefined) {
          values.push({
            path: 'navigation.courseOverGroundTrue',
            value: parsed.trackTrue * Math.PI / 180 // Convert degrees to radians
          });
        }
        break;

      case 'VTG':
        // Track Made Good and Ground Speed
        if (parsed.speedKnots !== undefined) {
          values.push({
            path: 'navigation.speedOverGround',
            value: parsed.speedKnots * 0.514444 // Convert knots to m/s
          });
        }
        if (parsed.trackTrue !== undefined) {
          values.push({
            path: 'navigation.courseOverGroundTrue',
            value: parsed.trackTrue * Math.PI / 180 // Convert degrees to radians
          });
        }
        break;

      case 'GSA':
        // GPS DOP and Active Satellites
        if (parsed.pdop !== undefined) {
          values.push({
            path: 'navigation.gnss.positionDilution',
            value: parsed.pdop
          });
        }
        if (parsed.hdop !== undefined) {
          values.push({
            path: 'navigation.gnss.horizontalDilution',
            value: parsed.hdop
          });
        }
        if (parsed.vdop !== undefined) {
          values.push({
            path: 'navigation.gnss.verticalDilution',
            value: parsed.vdop
          });
        }
        break;

      case 'GSV':
        // GPS Satellites in View
        if (parsed.satellites && Array.isArray(parsed.satellites)) {
          values.push({
            path: 'navigation.gnss.satellitesInView',
            value: {
              count: parsed.satellitesInView || parsed.satellites.length,
              satellites: parsed.satellites.map((sat: any) => ({
                id: sat.prnNumber,
                elevation: sat.elevationDegrees ? sat.elevationDegrees * Math.PI / 180 : undefined,
                azimuth: sat.azimuthTrue ? sat.azimuthTrue * Math.PI / 180 : undefined,
                SNR: sat.SNRdB
              }))
            }
          });
        }
        break;

      case 'GLL':
        // Geographic Position
        if (parsed.latitude !== undefined && parsed.longitude !== undefined) {
          values.push({
            path: 'navigation.position',
            value: {
              latitude: parsed.latitude,
              longitude: parsed.longitude
            }
          });
        }
        break;

      default:
        // Unsupported sentence type
        return null;
    }

    if (values.length === 0) {
      return null;
    }

    return {
      context: 'vessels.self',
      updates: [{
        source: source,
        $source: `maiana-gps.${source.talker}`,
        timestamp: timestamp,
        values: values
      }]
    };
  }

  function handleMaianaResponse(response: string): void {
    // Handle NMEA sentences and MAIANA command responses
    if (response.startsWith('$')) {
      // Handle MAIANA proprietary messages specially
      if (response.startsWith('$PAINF')) {
        handlePAINFMessage(response);
        return;
      }
      
      // Parse standard NMEA sentences using nmea-simple
      try {
        const parsed = nmea.parseNmeaSentence(response);
        const delta = convertNmeaToSignalK(parsed);
        if (delta) {
          app.handleMessage(plugin.id, delta);
        }
      } catch (error) {
        // Ignore parsing errors for unsupported NMEA sentences
        app.debug('Could not parse NMEA sentence:', response, error);
      }
    } else if (response.startsWith('!')) {
      // AIS data transmission detected!
      status.messagesTransmitted++;
      app.setProviderStatus(`AIS transmission detected! Total: ${status.messagesTransmitted}`);
      
      if (response.startsWith('!AIVDM') || response.startsWith('!AIVDO')) {
        app.debug('🚢 AIS TRANSMISSION DETECTED:', response);
        
        // Try to parse and forward the AIS message
        try {
          const parsed = nmea.parseNmeaSentence(response);
          const delta = convertNmeaToSignalK(parsed);
          if (delta) {
            app.handleMessage(plugin.id, delta);
          }
        } catch (error) {
          app.debug('Could not parse transmitted AIS sentence:', response, error);
        }
      }
    } else {
      // MAIANA command responses and status messages
      if (response.includes('tx')) {
        app.debug('🔧 Transmission control response:', response);
        
        if (response.includes('tx on') || response.includes('TX ON')) {
          status.transmitting = true;
          app.setProviderStatus('MAIANA transmission enabled');
        } else if (response.includes('tx off') || response.includes('TX OFF')) {
          status.transmitting = false;
          app.setProviderStatus('MAIANA transmission disabled');
        }
      } else if (response.includes('station')) {
        app.debug('🏷️  Station configuration response:', response);
      }
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